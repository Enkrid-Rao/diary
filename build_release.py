# -*- coding: utf-8 -*-
"""打一个普通人能直接用的 Windows 包。

做的事情：
  1. 用 PyInstaller 把 app.py、static/ 和 Python 运行时打成一个绿色版目录
  2. 在目录里放 portable.txt，让数据（settings.json / diaries）跟着文件夹走
  3. 压缩成 zip，名字带版本号

用法：
    python build_release.py            # 出 dist/Diary-<版本>-win64-portable.zip
    python build_release.py --dir      # 只出目录，不压缩
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")
APP_NAME = "Diary"


def app_version():
    with open(os.path.join(HERE, "app.py"), encoding="utf-8") as f:
        m = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', f.read())
    return m.group(1) if m else "0.0.0"


def build():
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean",
        "--windowed",
        "--onedir",
        "--name", APP_NAME,
        "--icon", os.path.join(HERE, "app.ico"),
        "--distpath", DIST,
        "--workpath", os.path.join(HERE, "build"),
        "--specpath", os.path.join(HERE, "build"),
        # 静态资源（首页、样式、CodeMirror、KaTeX 字体）
        "--add-data", os.path.join(HERE, "static") + os.pathsep + "static",
        # 用不到的重家伙，排除掉能小一圈
        "--exclude-module", "PIL",
        "--exclude-module", "numpy",
        "--exclude-module", "tkinter",
        "--exclude-module", "matplotlib",
        "--exclude-module", "unittest",
        "--exclude-module", "pydoc",
        os.path.join(HERE, "release_entry.py"),
    ]
    print("PyInstaller：")
    print("  " + " ".join(cmd))
    r = subprocess.run(cmd, cwd=HERE)
    if r.returncode != 0:
        raise SystemExit("打包失败，退出码 %d" % r.returncode)


def finalize(folder):
    """补上绿色版标记与说明文件。"""
    with open(os.path.join(folder, "portable.txt"), "w", encoding="utf-8") as f:
        f.write(
            "这个文件让 Diary 把设置和日记放在本文件夹里，整个目录可以随身带走。\n"
            "删掉它，Diary 会改用 %APPDATA%\\Diary 与「文档\\Diary」。\n"
        )

    for name in ("LICENSE",):
        src = os.path.join(HERE, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(folder, name))

    readme = os.path.join(folder, "使用说明.txt")
    with open(readme, "w", encoding="utf-8") as f:
        f.write(
            "Diary 使用说明\n"
            "==============\n\n"
            "1. 双击 Diary.exe 就能用，不需要装 Python，也不需要联网。\n"
            "2. 第一次打开会在本文件夹里生成 diaries\\ 与 settings.json，\n"
            "   日记就是一天一个 .md 文件，可以用任何编辑器打开。\n"
            "3. 想换日记存放位置：右上角齿轮 → 常规 → 日记目录。\n"
            "4. 想放到桌面/开始菜单：右键 Diary.exe → 发送到 → 桌面快捷方式。\n"
            "5. 整个文件夹可以拷到 U 盘或另一台 Windows 10/11 上直接用。\n\n"
            "如果打不开，看看同目录有没有 Diary-error.log，里面是报错原文。\n"
        )


# 打包版运行后会生成这些用户数据，绝不能进发布包
USER_DATA = {"diaries", "settings.json", "settings.json.tmp",
             ".webview-data", "Diary-error.log", "boot.log", "stacks.txt"}


def is_user_data(rel):
    return any(part in USER_DATA for part in rel.replace("\\", "/").split("/"))


# 打包版运行后会生成这些用户数据，绝不能进发布包
USER_DATA = {"diaries", "settings.json", "settings.json.tmp",
             ".webview-data", "Diary-error.log", "boot.log", "stacks.txt"}


def is_user_data(rel):
    return any(part in USER_DATA for part in rel.replace("\\", "/").split("/"))


def zip_folder(folder, out_zip):
    if os.path.exists(out_zip):
        os.remove(out_zip)
    root_name = os.path.basename(folder)
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, dirs, files in os.walk(folder):
            for fn in files:
                full = os.path.join(base, fn)
                rel = os.path.relpath(full, folder)
                if is_user_data(rel):
                    continue
                z.write(full, os.path.join(root_name, rel))
    return out_zip


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", action="store_true", help="只出目录，不压缩")
    args = ap.parse_args()

    ver = app_version()
    build()
    folder = os.path.join(DIST, APP_NAME)
    if not os.path.isdir(folder):
        raise SystemExit("没找到打包输出：" + folder)
    finalize(folder)

    total = 0
    for base, _, files in os.walk(folder):
        for fn in files:
            total += os.path.getsize(os.path.join(base, fn))
    print("目录：%s（%.1f MB）" % (folder, total / 1048576))

    if args.dir:
        return
    out = os.path.join(DIST, "Diary-%s-win64-portable.zip" % ver)
    zip_folder(folder, out)
    print("压缩包：%s（%.1f MB）" % (out, os.path.getsize(out) / 1048576))


if __name__ == "__main__":
    main()
