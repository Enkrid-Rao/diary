# -*- coding: utf-8 -*-
"""把 cover.html 渲染成投稿用的封面图。

页面用 --u 做等比缩放（--u = min(视口宽/1146, 视口高/717)），
所以同一个布局在 16:10 和 16:9 下都成立，只是留白不同。

用法：
  python cover.py                     # 默认出 B 站 1146×717 与通用 1920×1080
  python cover.py --size 1146x717     # 只出某一个尺寸
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import time

from render import CDP, wait_targets

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PAGE = "file:///" + os.path.join(HERE, "cover.html").replace("\\", "/")
PORT = 9334

SIZES = [(2292, 1434), (1146, 717), (1920, 1080)]


def launch(user_dir, w, h):
    cmd = [
        EDGE,
        "--headless=new",
        "--remote-debugging-port=%d" % PORT,
        "--remote-allow-origins=*",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=%d,%d" % (w, h),
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate,MediaRouter",
        "--user-data-dir=" + user_dir,
        PAGE,
    ]
    return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", action="append", default=None,
                    help="形如 1146x717，可重复；默认出 2 倍图与 16:9")
    ap.add_argument("--prefix", default="cover")
    args = ap.parse_args()

    sizes = SIZES
    if args.size:
        sizes = []
        for s in args.size:
            w, h = s.lower().split("x")
            sizes.append((int(w), int(h)))

    user_dir = os.path.join(HERE, ".edge-profile")
    os.makedirs(user_dir, exist_ok=True)
    proc = launch(user_dir, *sizes[0])
    try:
        pages = wait_targets(PORT)
        page = next((p for p in pages if "cover.html" in p.get("url", "")), pages[0])
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        end = time.time() + 25
        while time.time() < end:
            r = cdp.call("Runtime.evaluate",
                         expression="(window.__ready === true) && document.fonts.status",
                         returnByValue=True)
            if (r.get("result") or {}).get("value") == "loaded":
                break
            time.sleep(0.15)

        for w, h in sizes:
            cdp.call("Emulation.setDeviceMetricsOverride",
                     width=w, height=h, deviceScaleFactor=1, mobile=False)
            # 视口变了要重算 --u（改 metrics 不一定触发 resize）
            cdp.call("Runtime.evaluate", expression="fit()")
            time.sleep(0.45)
            info = cdp.call("Runtime.evaluate",
                            expression="innerWidth + 'x' + innerHeight + ' u=' + "
                                       "getComputedStyle(document.documentElement)"
                                       ".getPropertyValue('--u')",
                            returnByValue=True)
            print("  视口", (info.get("result") or {}).get("value"))
            shot = cdp.call("Page.captureScreenshot", format="png",
                            captureBeyondViewport=False,
                            clip={"x": 0, "y": 0, "width": w, "height": h, "scale": 1})
            name = "%s-%dx%d.png" % (args.prefix, w, h)
            with open(os.path.join(HERE, name), "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            print("输出 %s（%d×%d）" % (name, w, h))
        cdp.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
