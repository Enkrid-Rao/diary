# -*- coding: utf-8 -*-
# Diary 启动壳：源码运行时加载同目录的 app.py；打包后 app.py 在解包目录里
import os
import runpy
import sys
import tempfile
import traceback

_FROZEN = getattr(sys, "frozen", False)
_BASE = os.path.dirname(sys.executable) if _FROZEN else os.path.dirname(os.path.abspath(__file__))
# PyInstaller 会把打包进去的资源解到 sys._MEIPASS，app.py 也在那里
_RES = getattr(sys, "_MEIPASS", _BASE)

# noconsole 打包时 sys.stdout/stderr 为 None，CLR 初始化需要有效的输出流
if _FROZEN:
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = sys.stdout

try:
    runpy.run_path(os.path.join(_RES, "app.py"), run_name="__main__")
except SystemExit:
    raise
except Exception:
    text = traceback.format_exc()
    try:
        with open(os.path.join(_BASE, "Diary-error.log"), "w", encoding="utf-8") as f:
            f.write(text)
    except OSError:
        with open(os.path.join(tempfile.gettempdir(), "Diary-error.log"), "w", encoding="utf-8") as f:
            f.write(text)
    raise
