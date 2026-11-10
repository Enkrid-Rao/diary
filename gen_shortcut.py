# -*- coding: utf-8 -*-
"""生成/更新 Diary 的开始菜单快捷方式（基于 pylnk3，含完整 TargetIDList）
移动了日记文件夹后重新运行本脚本即可。
加 --desktop 参数可同时生成桌面快捷方式。
"""
import os
import sys

import pylnk3

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "Diary.exe")
ICON = os.path.join(HERE, "app.ico")


def make(path):
    pylnk3.for_file(TARGET, lnk_name=path, work_dir=HERE,
                    icon_file=ICON, icon_index=0, description="Diary")
    print("created:", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    start_menu = os.path.join(
        os.environ["APPDATA"],
        r"Microsoft\Windows\Start Menu\Programs",
    )
    make(os.path.join(start_menu, "Diary.lnk"))
    if "--desktop" in sys.argv:
        make(os.path.join(os.path.expanduser("~"), "Desktop", "Diary.lnk"))
