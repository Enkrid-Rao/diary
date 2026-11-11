# -*- coding: utf-8 -*-
"""自动更新：查 GitHub Release、下安装包、校验后交给安装器。

原则：
  · 默认不联网。只有用户在设置里打开「自动更新」才会在启动后查一次；
    手动点「检查更新」也算一次明确的请求。
  · 只访问 api.github.com 与 github.com/Enkrid-Rao/diary/releases，
    不发送任何本机信息（UA 只写 Diary/<版本>）。
  · 下载只认 release 里按版本号拼出来的 setup.exe（HTTPS），落盘后检查体积与 MZ 头，
    不像安装包就删掉不执行。Release 里以后如果放 SHA256SUMS.txt，可以再补摘要校验。
  · 绿色版不自动替换文件（正在运行的 exe 没法替换），只提示并打开下载页。
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

REPO = "Enkrid-Rao/diary"
LATEST_URL = "https://github.com/%s/releases/latest" % REPO
RELEASES_PAGE = LATEST_URL
DOWNLOAD_BASE = "https://github.com/%s/releases/download" % REPO
ALLOWED_PREFIX = DOWNLOAD_BASE + "/"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """只想要 302 的 Location，别让 urllib 自己跟着跳。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def latest_tag():
    """不碰 api.github.com（匿名配额一小时 60 次，容易打满），
    直接读 releases/latest 的跳转地址，一个请求拿到版本号。"""
    # 用默认的代理处理：Windows 上会读系统代理设置，公司/机场环境都能走
    opener = urllib.request.build_opener(_NoRedirect())
    req = urllib.request.Request(LATEST_URL, headers={"User-Agent": "Diary-updater"})
    try:
        with opener.open(req, timeout=8) as r:
            final = r.geturl()
    except urllib.error.HTTPError as e:
        if e.code not in (301, 302, 303, 307, 308):
            raise
        final = e.headers.get("Location") or ""
    m = re.search(r"/releases/tag/v?([0-9][0-9a-zA-Z.\-]*)", final or "")
    return m.group(1) if m else ""

CACHE_SECONDS = 300          # 手动连点「检查更新」不重复打接口
AUTO_INTERVAL = 6 * 3600     # 自动检查的间隔


def _opener():
    # 走系统代理设置；不额外加 header
    return urllib.request.build_opener()


def ver_tuple(text):
    """'v1.5.0' → (1, 5, 0)，够用就行。"""
    nums = re.findall(r"\d+", str(text or ""))
    if not nums:
        return (0,)
    return tuple(int(n) for n in nums[:3])


def is_newer(latest, current):
    a, b = ver_tuple(latest), ver_tuple(current)
    n = max(len(a), len(b))
    a = a + (0,) * (n - len(a))
    b = b + (0,) * (n - len(b))
    return a > b


class Updater:
    def __init__(self, current_version, portable, is_frozen, exe_path=None):
        self.current = current_version
        self.exe_path = exe_path or sys.executable
        self.portable = bool(portable)
        self.frozen = bool(is_frozen)
        self._lock = threading.Lock()
        self._cache = None
        self._cache_at = 0.0
        self._state = {"phase": "idle", "pct": 0, "msg": "", "path": "",
                       "version": "", "error": ""}

    # ---------------- 查询 ----------------
    def check(self, force=False):
        with self._lock:
            if not force and self._cache and time.time() - self._cache_at < CACHE_SECONDS:
                return dict(self._cache)
        try:
            latest = latest_tag()
        except Exception as e:
            return {"ok": False, "error": "连不上 GitHub：%s" % e, "current": self.current}
        if not latest:
            return {"ok": False, "error": "没读到最新版本号", "current": self.current}

        exe_name = "Diary-%s-win64-setup.exe" % latest
        out = {
            "ok": True,
            "current": self.current,
            "latest": latest,
            "hasUpdate": is_newer(latest, self.current),
            "url": "https://github.com/%s/releases/tag/v%s" % (REPO, latest),
            "publishedAt": "",
            "portable": self.portable,
            "canAutoInstall": not self.portable and self.frozen,
            "asset": {
                "name": exe_name,
                "size": 0,
                "url": "%s/v%s/%s" % (DOWNLOAD_BASE, latest, exe_name),
                "sha256": "",
            },
        }
        with self._lock:
            self._cache = out
            self._cache_at = time.time()
        return dict(out)

    # ---------------- 下载 ----------------
    def state(self):
        with self._lock:
            return dict(self._state)

    def _set(self, **kw):
        with self._lock:
            self._state.update(kw)

    def start_download(self):
        with self._lock:
            if self._state["phase"] in ("downloading", "ready"):
                return dict(self._state)
            self._state = {"phase": "downloading", "pct": 0, "msg": "准备下载…",
                           "path": "", "version": "", "error": ""}
        info = self.check()
        if not info.get("ok"):
            self._set(phase="error", error=info.get("error", "检查失败"))
            return self.state()
        if not info.get("hasUpdate"):
            self._set(phase="idle", msg="已是最新版本")
            return self.state()
        if not info.get("canAutoInstall") or not info.get("asset"):
            self._set(phase="manual", msg="绿色版需要手动替换",
                      version=info.get("latest", ""))
            return self.state()
        t = threading.Thread(target=self._download_worker, args=(info,), daemon=True)
        t.start()
        return self.state()

    def _download_worker(self, info):
        asset = info["asset"]
        url = str(asset.get("url") or "")
        if not url.startswith(ALLOWED_PREFIX):
            self._set(phase="error", error="下载地址不在白名单里")
            return
        name = re.sub(r"[^\w.\-]", "_", str(asset.get("name") or "Diary-setup.exe"))
        folder = os.path.join(tempfile.gettempdir(), "Diary-update")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name)
        want = str(asset.get("sha256") or "").lower()
        total = int(asset.get("size") or 0)

        req = urllib.request.Request(url, headers={"User-Agent": "Diary/%s" % self.current})
        h = hashlib.sha256()
        got = 0
        try:
            with _opener().open(req, timeout=20) as r, open(path, "wb") as f:
                while True:
                    chunk = r.read(262144)
                    if not chunk:
                        break
                    f.write(chunk)
                    h.update(chunk)
                    got += len(chunk)
                    pct = int(got * 100 / total) if total else 0
                    self._set(pct=min(99, pct), msg="下载中 %d%%" % min(99, pct))
            # 安装包里没有 checksum 时，至少确认下下来的是个像样的 Windows 可执行文件
            ok_pe = False
            try:
                with open(path, "rb") as pf:
                    ok_pe = pf.read(2) == b"MZ"
            except OSError:
                ok_pe = False
            if not ok_pe or os.path.getsize(path) < 512 * 1024:
                try:
                    os.remove(path)
                except OSError:
                    pass
                self._set(phase="error", error="下载到的文件不像安装包，已删除")
                return
            if want and h.hexdigest().lower() != want:
                try:
                    os.remove(path)
                except OSError:
                    pass
                self._set(phase="error", error="校验失败，安装包已删除")
                return
            self._set(phase="ready", pct=100, msg="下载完成，可以安装",
                      path=path, version=info.get("latest", ""))
        except Exception as e:
            self._set(phase="error", error="下载失败：%s" % e)
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass

    # ---------------- 安装 ----------------
    def install(self):
        st = self.state()
        if st.get("phase") != "ready" or not st.get("path"):
            return {"ok": False, "error": "还没有可安装的包"}
        setup = st["path"]
        if not os.path.isfile(setup):
            self._set(phase="error", error="安装包不见了，请重新下载")
            return {"ok": False, "error": "安装包不存在"}
        exe = self.exe_path
        # 安装器会关掉正在运行的 Diary，装完再由同一个批处理把新版本拉起来
        bat_dir = os.path.join(tempfile.gettempdir(), "Diary-update")
        os.makedirs(bat_dir, exist_ok=True)
        bat = os.path.join(bat_dir, "run-update.bat")
        lines = [
            "@echo off",
            'start "" /wait "%s" /SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS' % setup,
            'if exist "%s" start "" "%s"' % (exe, exe),
            'del "%%~f0" >nul 2>nul',
        ]
        with open(bat, "w", encoding="mbcs", errors="replace") as f:
            f.write("\r\n".join(lines) + "\r\n")
        try:
            subprocess.Popen(["cmd", "/c", bat],
                             creationflags=0x00000008 | 0x00000200,  # DETACHED | NEW_GROUP
                             close_fds=True)
        except Exception as e:
            self._set(phase="error", error="启动安装器失败：%s" % e)
            return {"ok": False, "error": str(e)}
        return {"ok": True, "restarting": True}
