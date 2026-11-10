#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 scene.html 的时间轴逐帧截下来，再交给 ffmpeg 编成视频。

原理：页面里所有状态都由 seek(t) 计算（没有 CSS keyframes），所以同一个 t
永远画出同一帧。脚本通过 CDP 驱动无头 Edge：设置 t → 截图 → 下一帧。

用法：
    python render.py                # 全片：0 → 17s，30fps
    python render.py --from 0 --to 4 --fps 12 --out preview.mp4
    python render.py --frames-only  # 只截图，不编码
"""
import argparse
import base64
import glob
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
SCENE = "file:///" + os.path.join(HERE, "scene.html").replace("\\", "/")
FRAMES_DIR = os.path.join(HERE, "frames")
PORT = 9333
W, H = 1920, 1080


class CDP:
    def __init__(self, url):
        import websocket  # websocket-client
        self.ws = websocket.create_connection(url, max_size=256 * 1024 * 1024, timeout=60)
        self.seq = 0

    def call(self, method, **params):
        self.seq += 1
        self.ws.send(json.dumps({"id": self.seq, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.seq:
                if "error" in msg:
                    raise RuntimeError("%s -> %s" % (method, msg["error"]))
                return msg.get("result", {})

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def _no_proxy_open(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(url, timeout=3)


def wait_targets(port, timeout=25):
    end = time.time() + timeout
    while time.time() < end:
        try:
            data = json.loads(_no_proxy_open("http://127.0.0.1:%d/json/list" % port).read())
            pages = [t for t in data if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
            if pages:
                return pages
        except Exception:
            pass
        time.sleep(0.15)
    raise RuntimeError("Edge 调试端口没有就绪")


def launch(user_dir):
    cmd = [
        EDGE,
        "--headless=new",
        "--remote-debugging-port=%d" % PORT,
        "--remote-allow-origins=*",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=%d,%d" % (W, H),
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate,MediaRouter",
        "--user-data-dir=" + user_dir,
        SCENE,
    ]
    return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def encode(frames, out, fps):
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ff, "-y",
        "-framerate", str(fps),
        "-i", os.path.join(frames, "f_%05d.png"),
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-3000:])
        raise SystemExit("ffmpeg 编码失败")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="t0", type=float, default=0.0)
    ap.add_argument("--to", dest="t1", type=float, default=None)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--out", default=os.path.join(HERE, "diary-promo.mp4"))
    ap.add_argument("--frames-only", action="store_true")
    ap.add_argument("--keep", action="store_true", help="保留中间帧")
    args = ap.parse_args()

    # 复用同一个帧目录，逐帧覆盖写入（不做整目录删除）
    os.makedirs(FRAMES_DIR, exist_ok=True)
    user_dir = os.path.join(HERE, ".edge-profile")
    os.makedirs(user_dir, exist_ok=True)
    proc = launch(user_dir)
    try:
        pages = wait_targets(PORT)
        page = next((p for p in pages if "scene.html" in p.get("url", "")), pages[0])
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        cdp.call("Emulation.setDeviceMetricsOverride",
                 width=W, height=H, deviceScaleFactor=1, mobile=False)

        # 等页面把时间和字体都准备好
        end = time.time() + 30
        ready = False
        while time.time() < end:
            r = cdp.call("Runtime.evaluate",
                         expression="(window.__ready === true) && document.fonts.status",
                         returnByValue=True)
            val = (r.get("result") or {}).get("value")
            if val == "loaded":
                ready = True
                break
            time.sleep(0.2)
        if not ready:
            raise SystemExit("页面没有就绪（__ready / fonts）")

        dur = cdp.call("Runtime.evaluate", expression="window.DURATION", returnByValue=True)
        total = float((dur.get("result") or {}).get("value") or 17.0)
        t1 = total if args.t1 is None else min(args.t1, total)
        n = int(round((t1 - args.t0) * args.fps))
        print("渲染 %.2fs → %.2fs，%d fps，共 %d 帧" % (args.t0, t1, args.fps, n))

        for i in range(n):
            t = args.t0 + i / float(args.fps)
            cdp.call("Runtime.evaluate", expression="window.seek(%.6f)" % t)
            shot = cdp.call("Page.captureScreenshot", format="png", captureBeyondViewport=False,
                            clip={"x": 0, "y": 0, "width": W, "height": H, "scale": 1})
            with open(os.path.join(FRAMES_DIR, "f_%05d.png" % (i + 1)), "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            if (i + 1) % 60 == 0 or i + 1 == n:
                print("  已截 %d/%d" % (i + 1, n))
        cdp.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()

    if args.frames_only:
        print("帧目录：", FRAMES_DIR)
        return

    print("编码中…")
    encode(FRAMES_DIR, args.out, args.fps)
    size = os.path.getsize(args.out) / 1024.0 / 1024.0
    print("完成：%s（%.2f MB）" % (args.out, size))
    print("中间帧保留在 %s（可手动删除）" % FRAMES_DIR)


if __name__ == "__main__":
    main()
