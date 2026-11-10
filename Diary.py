# -*- coding: utf-8 -*-
# Diary.exe 启动壳：从 exe 同目录加载 app.py（不打包进 exe，保持可编辑）
import os
import runpy
import sys
import traceback

_BASE = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) \
    else os.path.dirname(os.path.abspath(__file__))

# noconsole 打包时 sys.stdout/stderr 为 None，CLR 初始化需要有效的输出流
if getattr(sys, "frozen", False):
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = sys.stdout

try:
    runpy.run_path(os.path.join(_BASE, "app.py"), run_name="__main__")
except SystemExit:
    raise
except Exception:
    with open(os.path.join(_BASE, "Diary-error.log"), "w", encoding="utf-8") as f:
        f.write(traceback.format_exc())
    raise
