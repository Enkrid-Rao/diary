# -*- coding: utf-8 -*-
"""发布版入口：直接 import app 并调用 main()。

和 Diary.py 的区别：Diary.py 用 runpy 在运行时读 app.py（便于改源码），
但那样 PyInstaller 分析不到 app.py 里的依赖，打出来的包会缺模块。
发布版走正常 import，让打包器把用到的模块（含 webview 的延迟导入）都收进去。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app  # noqa: E402

if __name__ == "__main__":
    app.main()
