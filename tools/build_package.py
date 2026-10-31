#!/usr/bin/env python3
"""从原创演示或用户自选母版构建集页完整包。"""
import argparse,glob,hashlib,importlib.util,json,os,shutil,sys,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.shared.product import NAME, apply_identity
BAT = '@echo off\nrem Start the catalog helper together with the master file.\nchcp 65001 >nul\nset PYTHONIOENCODING=utf-8\nset PYTHONUTF8=1\ncd /d "%~dp0"\nif exist "%~dp0helper\\python\\python.exe" (\n  "%~dp0helper\\python\\python.exe" "%~dp0helper\\server.py"\n) else (\n  py -3 "%~dp0helper\\server.py" 2>nul || python "%~dp0helper\\server.py"\n)\nif errorlevel 1 pause\n'
COMMAND = '#!/bin/bash\n# Mac：双击启动小助手和母版（用系统里的 python3）\ncd "$(dirname "$0")"\nexec python3 helper/server.py\n'
UPGRADE_BAT = '@echo off\nchcp 65001 >nul\nset PYTHONIOENCODING=utf-8\nset PYTHONUTF8=1\ncd /d "%~dp0"\nif exist "%~dp0helper\\python\\python.exe" (\n  "%~dp0helper\\python\\python.exe" "%~dp0helper\\upgrade_master.py" %*\n) else (\n  where py >nul 2>nul\n  if errorlevel 1 (\n    python "%~dp0helper\\upgrade_master.py" %*\n  ) else (\n    py -3 "%~dp0helper\\upgrade_master.py" %*\n  )\n)\npause\n'
UPGRADE_COMMAND = '#!/bin/bash\n# 拖入旧母版，或双击后选择旧母版；当前文件夹里的母版会先备份。\ncd "$(dirname "$0")"\npython3 helper/upgrade_master.py "$@"\necho\nread -r -p "按回车关闭窗口…"\n'

README="""__PRODUCT_NAME__ · 三步开始

1. 双击「空白母版.html」，点「新增作品」填自己的书、电影、课程或资料；「目录表-母版.html」是虚构演示。
2. 在「设置」调整字段名称、版本类型和展示，保存母版。文件模式会下载新文件；要直接写回和备份，双击「启动空白目录」。
3. 点「导出分发版」，将生成的只读 HTML 给读者。母版和完整 XLSX 由自己保留。

Windows 包带便携 Python，Mac 使用 python3。启动脚本后保持小助手窗口开启；看演示用「启动目录表」。

可选功能：来源设置默认关闭，参考网站默认空。配置自己的资料来源再抓取；夸克扫描需在设置启用，只扫描自己的分享。今日例行可一键开始，步骤和失败分别汇总；待办、标签整理、本地回填也可单独运行。
图片：本地选择、粘贴、拖入后压缩；可内嵌或保留网址，导出时可离线带图。没有图片上传图床功能。
表格：先导出完整 XLSX，修改后导回并确认冲突；CSV 仅单表。升级：解压新包到新目录，用「升级母版」选旧母版，目标文件先备份。

本工具不提供资源。只整理与分享自己有权使用的内容和链接。详细说明见项目 docs。
"""

def load_builder():
    spec=importlib.util.spec_from_file_location('build_master',ROOT/'tools/build_master.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def main():
    p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--from-json',type=Path);g.add_argument('--from-master',type=Path);g.add_argument('--from-html',type=Path);p.add_argument('--out',type=Path,default=ROOT/'dist'/NAME);p.add_argument('--python-zip',type=Path);a=p.parse_args()
    bm=load_builder()
    project=bm.project_from_master(a.from_master) if a.from_master else bm.project_from_board(a.from_html) if a.from_html else bm.project_from_json(a.from_json or ROOT/'demo/demo-data.json')
    out=a.out;out.mkdir(parents=True,exist_ok=True)
    target=out/'目录表-母版.html'
    if target.exists():
        backup=out/'备份';backup.mkdir(exist_ok=True)
        import time
        shutil.copy2(target,backup/f'目录表-构建前-{time.time_ns()}.html')
    bm.write_atomic(str(target),bm.build_master_html(project))
    blank=bm.project_from_json(ROOT/'demo/blank-data.json')
    bm.write_atomic(str(out/'空白母版.html'),bm.build_master_html(blank))
    helper=out/'helper';helper.mkdir(exist_ok=True)
    for path in (ROOT/'src/helper').glob('*.py'):shutil.copy2(path,helper/path.name)
    # 保持包内 src 命名空间，避免携带全量开发源码和其他目录。
    for name in ['sources','importers','shared']:
        dest=helper/'src'/name;dest.mkdir(parents=True,exist_ok=True)
        for path in (ROOT/'src'/name).glob('*.py'):shutil.copy2(path,dest/path.name)
    shutil.copy2(ROOT/'src/shared/image_codec.py',helper/'image_codec.py')
    lib=helper/'lib';lib.mkdir(exist_ok=True)
    for wheel in (ROOT/'tools/vendor').glob('*.whl'):
        with zipfile.ZipFile(wheel) as z:z.extractall(lib)
    # 升级脚本需要完整的清洁程序模板，不依赖源码仓库。
    upgrade=helper/'upgrade-template.html';bm.write_atomic(str(upgrade),bm.build_master_html(project))
    for name,content in [('启动目录表.bat',BAT),('启动目录表.command',COMMAND),('升级母版.bat',UPGRADE_BAT),('升级母版.command',UPGRADE_COMMAND)]:
        if name=='启动目录表.bat':content=content.replace('server.py"','server.py" --master "%~dp0目录表-母版.html"')
        if name=='启动目录表.command':content=content.replace('exec python3 helper/server.py','exec python3 helper/server.py --master "目录表-母版.html"')
        path=out/name;path.write_text(content,encoding='utf-8',newline='\r\n' if name.endswith('.bat') else '\n');path.chmod(0o755)
    (out/'启动空白目录.command').write_text(COMMAND.replace('exec python3 helper/server.py','exec python3 helper/server.py --master "空白母版.html"'),encoding='utf-8')
    (out/'启动空白目录.command').chmod(0o755)
    blank_bat=BAT.replace('server.py"','server.py" --master "%~dp0空白母版.html"')
    (out/'启动空白目录.bat').write_text(blank_bat,encoding='utf-8',newline='\r\n')
    (out/'使用说明.txt').write_text(apply_identity(README),encoding='utf-8-sig')
    shutil.copytree(ROOT/'LICENSES',out/'LICENSES',dirs_exist_ok=True);shutil.copy2(ROOT/'LICENSE',out/'LICENSE')
    python_zip=a.python_zip or next((ROOT/'tools/vendor').glob('python-*-embed-amd64.zip'),None)
    if python_zip:
        manifest=json.loads((ROOT/'tools/vendor/python-runtime.json').read_text())
        if hashlib.sha256(python_zip.read_bytes()).hexdigest()!=manifest['sha256']:
            raise ValueError('便携 Python 与官方来源清单的 SHA256 不一致')
        with zipfile.ZipFile(python_zip) as z:
            z.extractall(helper/'python')
            for n in z.namelist():
                if 'license' in n.lower():(out/'LICENSES/Python.txt').write_bytes(z.read(n))
    (out/'分发').mkdir(exist_ok=True)
    print(f'已构建 {out.name}：{project["catalogId"]}，便携 Python：{"已包含" if python_zip else "未包含，使用本机 Python"}')
    return 0
if __name__=='__main__':raise SystemExit(main())
