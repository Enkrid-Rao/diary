# -*- coding: utf-8 -*-
"""Diary - 轻量日记应用
- 本地 HTTP 服务，只监听 127.0.0.1
- 日记以 YYYY-MM-DD.md 纯文本存于 diaries/（可在设置里改到任意目录）
- 用 pywebview 开原生窗口（自绘图标，任务栏显示 Diary 图标）；窗口关闭自动退出服务
- 设置持久化在 settings.json，启动时注入首页，避免首屏闪烁
"""
import copy
import json
import os
import re
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

_T0 = time.perf_counter()
APP_VERSION = "1.4.0"

if getattr(sys, "frozen", False):
    # PyInstaller windowed 模式下 OS 层 stdout/stderr 句柄无效，
    # WebView2 子进程继承无效句柄会直接崩。重定向到 NUL 修复。
    BASE_DIR = os.path.dirname(sys.executable)
    _null = os.open(os.devnull, os.O_RDWR)
    for _fd in (0, 1, 2):
        try:
            os.dup2(_null, _fd)
        except OSError:
            pass
    # CRT 层之外还要修 Win32 进程标准句柄，WebView2 子进程继承的是这层
    try:
        import ctypes
        import msvcrt
        _h = msvcrt.get_osfhandle(_null)
        _k32 = ctypes.windll.kernel32
        for _sh in (-10, -11, -12):  # STD_INPUT/OUTPUT/ERROR_HANDLE
            _k32.SetStdHandle(_sh, _h)
    except Exception:
        pass
    sys.stdout = open(os.devnull, "w")
    sys.stderr = sys.stdout
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DEFAULT_DIARY_DIR = os.path.join(BASE_DIR, "diaries")
PORT = 17823
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

# ============ 设置 ============
SETTINGS_PATH = os.path.join(BASE_DIR, "settings.json")

DEFAULT_SHORTCUTS = {
    "save": "Ctrl-S",
    "bold": "Ctrl-B",
    "italic": "Ctrl-I",
    "code": "Ctrl-E",
    "strike": "Ctrl-Shift-X",
    "link": "Ctrl-K",
    "search": "Ctrl-F",
    "h1": "Ctrl-1",
    "h2": "Ctrl-2",
    "h3": "Ctrl-3",
    "prevDay": "Alt-Left",
    "nextDay": "Alt-Right",
    "today": "Ctrl-T",
    "toggleSide": "Ctrl-\\",
    "settings": "Ctrl-,",
}

DEFAULT_SETTINGS = {
    "version": 1,
    "general": {
        "diaryDir": "",              # "" = 默认 BASE_DIR/diaries
        "autosaveDelay": 900,        # 毫秒
        "startup": "today",          # today | last
        "rememberWindow": True,
        "lastDate": "",
        "window": {"w": 1280, "h": 820, "x": None, "y": None, "max": False},
    },
    "appearance": {
        "mode": "dark",              # dark | light（浅色为备选，纸感底色）
        "theme": "ink",              # ink | graphite | ocean
        "accent": "amber",           # amber | cyan | violet | rose
        "topbar": "flat",            # flat | glass
        "blur": 30,
        "aurora": True,
        "grain": True,
        "motion": True,              # 界面动效与过渡
        "sidebarWidth": 258,
        "previewWidth": 660,
        "splitRatio": 0.5,
        "syncScroll": True,          # 编辑区 ↔ 预览区 联动滚动
    },
    "editor": {
        "fontSize": 14,
        "lineHeight": 1.85,
        "tabSize": 2,
        "autoPairs": True,
        "continueList": True,
        "lineNumbers": False,
    },
    "shortcuts": dict(DEFAULT_SHORTCUTS),
}

_MODES = ("dark", "light")
_THEMES = ("ink", "graphite", "ocean")
_ACCENTS = ("amber", "cyan", "violet", "rose")
_TOPBARS = ("flat", "glass")
_STARTUPS = ("today", "last")
# 主题底色 → 原生标题栏 / 边框颜色（必须与 style.css 的 --ink 一致）
_THEME_INK = {"ink": "#07080c", "graphite": "#0a0a0b", "ocean": "#050910"}


def _int(v, lo, hi, default):
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _float(v, lo, hi, default):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, round(n, 3)))


def _bool(v, default):
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(v, (int, float)):
        return bool(v)
    return default


def _choice(v, allowed, default):
    return v if v in allowed else default


def sanitize(raw):
    """把任意来源的 dict 收敛成合法设置（缺字段用默认值补齐）"""
    s = copy.deepcopy(DEFAULT_SETTINGS)
    if not isinstance(raw, dict):
        return s

    g = raw.get("general") or {}
    if isinstance(g, dict):
        d = g.get("diaryDir")
        s["general"]["diaryDir"] = d.strip().strip('"') if isinstance(d, str) else ""
        s["general"]["autosaveDelay"] = _int(g.get("autosaveDelay"), 200, 5000, 900)
        s["general"]["startup"] = _choice(g.get("startup"), _STARTUPS, "today")
        s["general"]["rememberWindow"] = _bool(g.get("rememberWindow"), True)
        last = g.get("lastDate")
        s["general"]["lastDate"] = last if isinstance(last, str) and DATE_RE.match(last) else ""
        w = g.get("window") or {}
        if isinstance(w, dict):
            win = {
                "w": _int(w.get("w"), 880, 4096, 1280),
                "h": _int(w.get("h"), 560, 3000, 820),
            }
            for k in ("x", "y"):
                v = w.get(k)
                win[k] = _int(v, -32000, 32000, None) if isinstance(v, (int, float)) else None
            win["max"] = _bool(w.get("max"), False)
            s["general"]["window"] = win

    a = raw.get("appearance") or {}
    if isinstance(a, dict):
        s["appearance"]["mode"] = _choice(a.get("mode"), _MODES, "dark")
        s["appearance"]["theme"] = _choice(a.get("theme"), _THEMES, "ink")
        s["appearance"]["accent"] = _choice(a.get("accent"), _ACCENTS, "amber")
        s["appearance"]["topbar"] = _choice(a.get("topbar"), _TOPBARS, "flat")
        s["appearance"]["blur"] = _int(a.get("blur"), 0, 44, 30)
        s["appearance"]["aurora"] = _bool(a.get("aurora"), True)
        s["appearance"]["grain"] = _bool(a.get("grain"), True)
        s["appearance"]["motion"] = _bool(a.get("motion"), True)
        s["appearance"]["sidebarWidth"] = _int(a.get("sidebarWidth"), 200, 380, 258)
        s["appearance"]["previewWidth"] = _int(a.get("previewWidth"), 520, 980, 660)
        s["appearance"]["splitRatio"] = _float(a.get("splitRatio"), 0.2, 0.8, 0.5)
        s["appearance"]["syncScroll"] = _bool(a.get("syncScroll"), True)

    e = raw.get("editor") or {}
    if isinstance(e, dict):
        s["editor"]["fontSize"] = _int(e.get("fontSize"), 11, 22, 14)
        s["editor"]["lineHeight"] = _float(e.get("lineHeight"), 1.4, 2.6, 1.85)
        s["editor"]["tabSize"] = _choice(_int(e.get("tabSize"), 1, 8, 2), (2, 4, 8), 2)
        s["editor"]["autoPairs"] = _bool(e.get("autoPairs"), True)
        s["editor"]["continueList"] = _bool(e.get("continueList"), True)
        s["editor"]["lineNumbers"] = _bool(e.get("lineNumbers"), False)

    sc = raw.get("shortcuts") or {}
    if isinstance(sc, dict):
        for k in DEFAULT_SHORTCUTS:
            v = sc.get(k)
            # 允许空字符串 = 用户主动解绑
            if isinstance(v, str) and len(v) <= 40:
                s["shortcuts"][k] = v.strip()
    return s


_settings_lock = threading.Lock()


def load_settings():
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError):
        raw = {}
    return sanitize(raw)


def save_settings(raw):
    """原子写入，返回落盘后的最终设置"""
    s = sanitize(raw)
    with _settings_lock:
        tmp = SETTINGS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(s, f, ensure_ascii=False, indent=2)
        os.replace(tmp, SETTINGS_PATH)
    return s


def current_diary_dir(s=None):
    s = s or load_settings()
    d = s["general"]["diaryDir"]
    if d:
        d = os.path.expanduser(d)
        try:
            os.makedirs(d, exist_ok=True)
        except OSError:
            d = DEFAULT_DIARY_DIR
    else:
        d = DEFAULT_DIARY_DIR
    try:
        os.makedirs(d, exist_ok=True)
    except OSError:
        pass
    return d


def valid_date(s):
    if not DATE_RE.match(s or ""):
        return False
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def entry_path(date):
    return os.path.join(current_diary_dir(), date + ".md")


def list_entries():
    d = current_diary_dir()
    out = []
    try:
        names = os.listdir(d)
    except OSError:
        names = []
    for fn in names:
        if not fn.endswith(".md"):
            continue
        date = fn[:-3]
        if not valid_date(date):
            continue
        p = os.path.join(d, fn)
        try:
            with open(p, "r", encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        # 摘要：去掉 markdown 记号后的前两行非空文字
        plain = re.sub(r"[#>*`\-\[\]()]|\$", "", text)
        lines = [l.strip() for l in plain.splitlines() if l.strip()]
        excerpt = " ".join(lines)[:60]
        out.append({
            "date": date,
            "excerpt": excerpt,
            "chars": len(text.strip()),
            "mtime": os.path.getmtime(p),
        })
    out.sort(key=lambda e: e["date"], reverse=True)
    return out


# ============ 全文搜索 ============
# 逐行匹配，命中行再切出"所在句子"，前端只负责高亮与跳转。
SENT_END = "。！？；…!?;．"


def sentence_span(line, start, end_):
    """把 [start, end_) 所在的句子边界切出来（含句末标点）"""
    n = len(line)
    s = start
    while s > 0 and line[s - 1] not in SENT_END:
        s -= 1
    e = end_
    while e < n and line[e] not in SENT_END:
        e += 1
    if e < n:
        e += 1
    return s, e


def entry_title(text):
    for line in text.splitlines():
        t = line.strip().lstrip("#").strip()
        if t:
            return t[:40]
    return ""


def search_entries(q, limit=80, per_entry=6):
    q = (q or "").strip()
    if not q:
        return []
    ql = q.lower()
    d = current_diary_dir()
    try:
        names = [n for n in os.listdir(d) if n.endswith(".md") and valid_date(n[:-3])]
    except OSError:
        return []
    names.sort(reverse=True)          # 新日记排前面
    out = []
    for fn in names:
        try:
            with open(os.path.join(d, fn), "r", encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        title = entry_title(text)
        hits = 0
        for i, line in enumerate(text.split("\n")):
            if not line.strip():
                continue
            idx = line.lower().find(ql)
            if idx < 0:
                continue
            s, e = sentence_span(line, idx, idx + len(q))
            seg = line[s:e].rstrip()
            # 去掉行首的 markdown 记号，但保持关键词偏移正确
            lead = len(seg) - len(seg.lstrip("#>-*` \t"))
            seg = seg[lead:]
            hl = idx - s - lead
            if hl < 0 or hl >= len(seg):
                continue
            out.append({
                "date": fn[:-3],
                "title": title,
                "line": i,
                "col": idx,
                "snippet": seg,
                "hl": hl,
                "hlEnd": min(len(seg), hl + len(q)),
                "from": s + lead,          # 句子在源码行里的范围，用于选中
                "to": e,
            })
            hits += 1
            if hits >= per_entry or len(out) >= limit:
                break
        if len(out) >= limit:
            break
    return out


# ============ 窗口位置校验 ============
def _virtual_screen():
    try:
        import ctypes
        u = ctypes.windll.user32
        return (u.GetSystemMetrics(76), u.GetSystemMetrics(77),
                u.GetSystemMetrics(78), u.GetSystemMetrics(79))
    except Exception:
        return None


def geometry_on_screen(x, y, w, h):
    """保存的窗口坐标是否还落在当前显示器范围内（防止换屏后窗口跑到屏幕外）"""
    if x is None or y is None:
        return False
    box = _virtual_screen()
    if not box:
        return True
    vx, vy, vw, vh = box
    cx, cy = x + w // 2, y + h // 3
    return vx <= cx <= vx + vw and vy <= cy <= vy + vh


def _self_hwnd():
    """按标题找本进程的主窗口；找不到返回 None"""
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        pid = os.getpid()
        found = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def _cb(hwnd, _lparam):
            p = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
            if p.value == pid and user32.IsWindowVisible(hwnd):
                buf = ctypes.create_unicode_buffer(80)
                user32.GetWindowTextW(hwnd, buf, 80)
                if buf.value == "Diary":
                    found.append(hwnd)
            return True

        user32.EnumWindows(_cb, 0)
        return found[0] if found else None
    except Exception:
        return None


def _dpi_scale():
    """当前主屏的 DPI 缩放比（125% -> 1.25）。pywebview 的 width/height 按逻辑像素算，
    而 GetWindowRect 给的是物理像素，两者必须换算，否则每次启动都会放大一圈。"""
    try:
        import ctypes
        u = ctypes.windll.user32
        try:
            return max(1.0, u.GetDpiForSystem() / 96.0)
        except Exception:
            hdc = u.GetDC(0)
            dpi = ctypes.windll.gdi32.GetDeviceCaps(hdc, 88)  # LOGPIXELSX
            u.ReleaseDC(0, hdc)
            return max(1.0, (dpi or 96) / 96.0)
    except Exception:
        return 1.0


def _find_window(timeout=10.0, require_visible=False):
    """按标题找本进程的主窗口"""
    try:
        import ctypes
        import time as _t
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        pid = os.getpid()
        found = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def _cb(hwnd, _lparam):
            p = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
            if p.value == pid:
                if require_visible and not user32.IsWindowVisible(hwnd):
                    return True
                buf = ctypes.create_unicode_buffer(80)
                user32.GetWindowTextW(hwnd, buf, 80)
                if buf.value == "Diary":
                    found.append(hwnd)
            return True

        deadline = _t.time() + timeout
        while _t.time() < deadline:
            found.clear()
            user32.EnumWindows(_cb, 0)
            if found:
                return found[0]
            _t.sleep(0.1)
        return None
    except Exception:
        return None


def _colorref(hex_str):
    """#RRGGBB -> Win32 COLORREF (0x00BBGGRR)"""
    h = hex_str.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b << 16) | (g << 8) | r


def _apply_dwm(hwnd, ink="#07080c", border="#1a1c22"):
    """Win11 窗口级质感：深色标题栏 + 圆角 + 与页面同色的标题栏/边框。
    Win10 上这些属性会被静默忽略，不影响正常使用。"""
    try:
        import ctypes
        dwm = ctypes.windll.dwmapi
    except Exception:
        return

    def _set(attr, value):
        try:
            v = ctypes.c_int(value)
            dwm.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(v), ctypes.sizeof(v))
        except Exception:
            pass

    _set(19, 1)   # DWMWA_USE_IMMERSIVE_DARK_MODE（Win10 1809 编号）
    _set(20, 1)   # 同上（Win10 20H1+ / Win11 编号）
    _set(33, 2)   # DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND
    _set(35, _colorref(ink))     # DWMWA_CAPTION_COLOR：标题栏底色贴住页面
    _set(34, _colorref(border))  # DWMWA_BORDER_COLOR：换成深色细边，去掉浅色描边


def window_geometry():
    """读窗口的真实矩形与最大化状态（JS 的 screenX 有边框偏差，会逐次漂移）"""
    hwnd = _self_hwnd()
    if not hwnd:
        return None
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return None
        # 最小化时 rect 是 (-32000, -32000)，不要存
        if rect.left <= -30000 or rect.top <= -30000:
            return None
        return {
            "w": max(880, rect.right - rect.left),
            "h": max(560, rect.bottom - rect.top),
            "x": rect.left,
            "y": rect.top,
            "max": bool(user32.IsZoomed(hwnd)),
        }
    except Exception:
        return None


def _restore_window_geometry(hwnd, s):
    """窗口建好后按保存的物理矩形精确还原（绕开 pywebview 与 DPI 的换算歧义）"""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        g = s["general"]
        if not g.get("rememberWindow"):
            return
        w = g["window"]
        if w.get("max"):
            user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE
            return
        if geometry_on_screen(w.get("x"), w.get("y"), w.get("w"), w.get("h")):
            SWP_NOZORDER, SWP_NOACTIVATE = 0x0004, 0x0010
            user32.SetWindowPos(hwnd, 0, w["x"], w["y"], w["w"], w["h"],
                                SWP_NOZORDER | SWP_NOACTIVATE)
    except Exception:
        pass


class Handler(BaseHTTPRequestHandler):
    server_version = "Diary/1.1"

    def log_message(self, *a):  # 静默日志
        pass

    def _cancel_bye(self):
        """窗口刷新时先发了 bye 又立刻重新请求 -> 取消延迟退出"""
        t = getattr(self.server, "_bye_timer", None)
        if t is not None:
            t.cancel()
            self.server._bye_timer = None

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send(self, body, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path):
        if not os.path.isfile(path):
            self.send_error(404)
            return
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            body = f.read()
        self._send(body, MIME.get(ext, "application/octet-stream"))

    def _page(self):
        """首页：把当前设置直接注入，避免首屏用默认值再跳变的闪烁"""
        idx = os.path.join(STATIC_DIR, "index.html")
        if not os.path.isfile(idx):
            self.send_error(404)
            return
        with open(idx, "r", encoding="utf-8") as f:
            html = f.read()
        s = load_settings()
        payload = {"settings": s,
                   "defaults": DEFAULT_SETTINGS,
                   "meta": {"version": APP_VERSION,
                            "diaryDir": current_diary_dir(s),
                            "defaultDir": DEFAULT_DIARY_DIR}}
        blob = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
        inject = "<script>window.__BOOT__=" + blob + ";</script></head>"
        if "</head>" in html:
            html = html.replace("</head>", inject, 1)
        else:
            html = inject + html
        self._send(html.encode("utf-8"), "text/html; charset=utf-8")

    def do_GET(self):
        self._cancel_bye()
        path = self.path.split("?", 1)[0]
        query = {}
        if "?" in self.path:
            for kv in self.path.split("?", 1)[1].split("&"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    query[k] = v

        if path == "/" or path == "/index.html":
            if not getattr(self.server, "_page_served", False):
                self.server._page_served = True
                _mark("page html served")
            self._page()
        elif path == "/api/ping":
            self._json({"ok": True})
        elif path == "/api/today":
            self._json({"date": datetime.now().strftime("%Y-%m-%d")})
        elif path == "/api/settings":
            s = load_settings()
            self._json({"settings": s,
                        "defaults": DEFAULT_SETTINGS,
                        "meta": {"version": APP_VERSION,
                                 "diaryDir": current_diary_dir(s),
                                 "defaultDir": DEFAULT_DIARY_DIR},
                        "shortcutDefaults": DEFAULT_SHORTCUTS})
        elif path == "/api/entry":
            date = query.get("date", "")
            if not valid_date(date):
                self._json({"error": "bad date"}, 400)
                return
            p = entry_path(date)
            content = ""
            if os.path.isfile(p):
                with open(p, "r", encoding="utf-8") as f:
                    content = f.read()
            self._json({"date": date, "content": content,
                        "exists": os.path.isfile(p)})
        elif path == "/api/list":
            self._json({"entries": list_entries(), "dir": current_diary_dir()})
        elif path == "/api/search":
            q = unquote(query.get("q", ""))
            try:
                limit = max(1, min(200, int(query.get("limit", "80"))))
            except ValueError:
                limit = 80
            res = search_entries(q, limit)
            self._json({"q": q, "count": len(res), "results": res})
        elif path.startswith("/static/"):
            rel = os.path.normpath(path[len("/static/"):])
            full = os.path.join(STATIC_DIR, rel)
            if not os.path.abspath(full).startswith(os.path.abspath(STATIC_DIR)):
                self.send_error(403)
                return
            self._file(full)
        else:
            self.send_error(404)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/bye":
            self._cancel_bye()

        def body():
            try:
                n = int(self.headers.get("Content-Length", 0))
                return json.loads(self.rfile.read(n).decode("utf-8"))
            except (ValueError, json.JSONDecodeError):
                return None

        if path == "/api/entry":
            data = body()
            if not isinstance(data, dict):
                self._json({"error": "bad body"}, 400)
                return
            date = data.get("date", "")
            content = data.get("content", "")
            if not valid_date(date):
                self._json({"error": "bad date"}, 400)
                return
            p = entry_path(date)
            if content.strip():
                tmp = p + ".tmp"
                with open(tmp, "w", encoding="utf-8", newline="\n") as f:
                    f.write(content)
                os.replace(tmp, p)  # 原子写入，防写一半丢数据
            else:
                # 内容清空则删除该日文件，保持目录干净
                if os.path.isfile(p):
                    os.remove(p)
            self._json({"ok": True, "savedAt": datetime.now().strftime("%H:%M:%S")})
        elif path == "/api/settings":
            data = body()
            if not isinstance(data, dict):
                self._json({"error": "bad body"}, 400)
                return
            saved = save_settings(data)
            self._json({"ok": True, "settings": saved,
                        "meta": {"diaryDir": current_diary_dir(saved),
                                 "defaultDir": DEFAULT_DIARY_DIR}})
        elif path == "/api/settings/window":
            # 只更新窗口几何，独立接口避免与设置页保存互相覆盖
            body()  # 读掉请求体，避免残留数据
            s = load_settings()
            if s["general"]["rememberWindow"]:
                geo = window_geometry()
                if geo:
                    s["general"]["window"] = geo
                    save_settings(s)
            self._json({"ok": True})
        elif path == "/api/settings/lastdate":
            data = body() or {}
            date = data.get("date", "")
            s = load_settings()
            if valid_date(date):
                s["general"]["lastDate"] = date
                save_settings(s)
            self._json({"ok": True})
        elif path == "/api/open-dir":
            data = body() or {}
            target = data.get("dir") or current_diary_dir()
            target = os.path.expanduser(str(target))
            ok = False
            try:
                if os.path.isdir(target):
                    os.startfile(target)  # noqa: S606 - 用户主动点"打开文件夹"
                    ok = True
            except OSError:
                ok = False
            self._json({"ok": ok, "dir": target})
        elif path == "/api/dir/check":
            data = body() or {}
            p = str(data.get("dir") or "").strip().strip('"')
            p = os.path.expanduser(p)
            if not p:
                self._json({"ok": True, "exists": False, "mdCount": 0})
                return
            exists = os.path.isdir(p)
            count = 0
            if exists:
                try:
                    count = len([f for f in os.listdir(p) if f.endswith(".md")])
                except OSError:
                    count = 0
            self._json({"ok": True, "exists": exists, "mdCount": count})
        elif path == "/api/bye":
            self._json({"ok": True})
            if os.environ.get("DIARY_NOOPEN"):
                return  # 只做预览的测试服务：页面关掉后别把服务带走
            # 延迟 3 秒退出：若只是刷新页面，随后的请求会取消退出
            def _bye():
                try:
                    self.server.shutdown()
                except Exception:
                    pass
            t = threading.Timer(3.0, _bye)
            t.daemon = True
            self.server._bye_timer = t
            t.start()
        else:
            self.send_error(404)


def already_running():
    """本机端口探测：裸 socket，避免 urllib 走系统代理导致 1 秒级超时"""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=0.2) as s:
            s.sendall(b"GET /api/ping HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
            s.settimeout(0.35)
            head = s.recv(64)
            return b" 200 " in head
    except OSError:
        return False


def _mark(m):
    if os.environ.get("DIARY_DEBUG"):
        try:
            import time as _t
            with open(os.path.join(BASE_DIR, "boot.log"), "a", encoding="utf-8") as f:
                f.write("%.3fs %s\n" % (_t.perf_counter() - _T0, m))
        except Exception:
            pass


def _apply_window_chrome():
    """给窗口设图标 + DWM 质感 + 还原几何（纯 Win32，避免 pythonnet 事件线程死锁）"""
    hwnd = _find_window(10.0)
    if not hwnd:
        return
    st = load_settings()
    _apply_dwm(hwnd, _THEME_INK.get(st["appearance"]["theme"], "#07080c"))
    ico = os.path.join(BASE_DIR, "app.ico")
    if os.path.isfile(ico):
        import ctypes
        user32 = ctypes.windll.user32
        IMAGE_ICON, LR_LOADFROMFILE, WM_SETICON = 1, 0x10, 0x80
        for size, which in ((16, 0), (32, 1), (48, 1), (64, 1), (256, 1)):
            h = user32.LoadImageW(None, ico, IMAGE_ICON, size, size, LR_LOADFROMFILE)
            if h:
                user32.SendMessageW(hwnd, WM_SETICON, which, h)
    _restore_window_geometry(hwnd, load_settings())


class Api:
    """暴露给前端 JS 的原生能力（pywebview js_api）"""

    def pick_folder(self):
        try:
            import webview
            wins = getattr(webview, "windows", None) or []
            if not wins:
                return ""
            dialog = getattr(webview, "FOLDER_DIALOG", None)
            if dialog is None:
                dialog = getattr(getattr(webview, "FileDialog", None), "FOLDER", None)
            res = wins[0].create_file_dialog(dialog)
            if not res:
                return ""
            return res[0] if isinstance(res, (list, tuple)) else str(res)
        except Exception:
            return ""


def open_window_native():
    """pywebview 原生窗口，阻塞到窗口关闭"""
    _mark("before import webview")
    import webview
    _mark("webview imported")
    s = load_settings()
    win = s["general"]["window"]
    sc = _dpi_scale()
    # 先用保存尺寸的近似值建窗（减少后续 SetWindowPos 的跳变），再在 Win32 线程里精确校正
    opts = {"width": max(880, int(win["w"] / sc)),
            "height": max(560, int(win["h"] / sc)),
            "min_size": (880, 560),
            "background_color": _THEME_INK.get(s["appearance"]["theme"], "#07080c")}
    webview.create_window("Diary", f"http://127.0.0.1:{PORT}/", **opts)
    _mark("window created")

    threading.Thread(target=_apply_window_chrome, daemon=True).start()

    _mark("before webview.start")
    try:
        webview.start(private_mode=False, js_api=Api(),
                      storage_path=os.path.join(BASE_DIR, ".webview-data"))
    except TypeError:
        # 老版本 pywebview 不认 js_api 关键字
        webview.start(private_mode=False,
                      storage_path=os.path.join(BASE_DIR, ".webview-data"))
    _mark("webview.start returned")


def main():
    if os.environ.get("DIARY_DIAG"):
        import faulthandler
        _fh = open(os.path.join(BASE_DIR, "stacks.txt"), "w", encoding="utf-8")
        faulthandler.dump_traceback_later(6, repeat=True, file=_fh)
    # 测试模式：只起服务不开窗口
    if os.environ.get("DIARY_NOOPEN"):
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
        server.daemon_threads = True
        server._bye_timer = None
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return

    server = None
    if not already_running():
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
        server.daemon_threads = True
        server._bye_timer = None
        threading.Thread(target=server.serve_forever, daemon=True).start()
        _mark("server thread started")

    open_window_native()  # 阻塞，直到用户关窗

    if server is not None:
        try:
            server.shutdown()
            server.server_close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
