#!/usr/bin/env python3
"""把旧母版的完整项目数据搬进当前包的新版程序，不依赖源码和第三方库。"""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
import zlib

PROJECT_BLOCK = re.compile(r'''(<script\b(?=[^>]*\bid=["']project-data["'])[^>]*>)(.*?)(</script\s*>)''', re.S | re.I)


def read_project(html):
    match = PROJECT_BLOCK.search(html)
    if not match:
        raise ValueError('这个文件里找不到母版数据，请选择旧版本的「目录表-母版.html」。')
    project = json.loads(match[2])
    if not isinstance(project, dict) or project.get('schema') != 'catalog-master-v1':
        raise ValueError('这个母版的数据格式暂不支持，没有改动任何文件。')
    if not project.get('catalogId'):
        raise ValueError('旧母版缺少目录身份，没有改动任何文件。')
    return project


def project_counts(project):
    catalog = project['catalog']
    if catalog.get('format') != 'catalog-shared-v1' or catalog.get('codec') != 'deflate-base64':
        raise ValueError('母版里的作品数据格式暂不支持。')
    packed = json.loads(zlib.decompress(base64.b64decode(catalog['data'])).decode('utf-8'))
    strings, keys = packed['strings'], packed.get('keys')

    def decode(value):
        if isinstance(value, str):
            return strings[int(value[2:])] if value.startswith('~@') else value[1:] if value.startswith('~~') else value
        if isinstance(value, list):
            return [decode(item) for item in value]
        if isinstance(value, dict):
            return {(keys[int(key)] if keys else key): decode(item) for key, item in value.items()}
        return value

    sources, deltas = decode(packed['data'])
    if len(sources) != len(deltas):
        raise ValueError('旧母版里的作品数据不完整。')
    records = [dict(source, **delta) for source, delta in zip(sources, deltas)]
    cards = [row for row in records if not row.get('canonical_id') or row.get('canonical_id') == row.get('id')]
    collections = project.get('collections')
    collection_count = len(collections) if collections else len({(row.get('baidu_url', ''), row.get('quark_url', '')) for row in cards if row.get('baidu_url') or row.get('quark_url')})
    return {'works': len(cards), 'records': len(records), 'collections': collection_count,
            'quark': sum(bool(row.get('quark_location_url')) for row in cards)}


def protect_images(project):
    # 发布包把共享编码器放在同目录；开发时直接复用 src/shared 的文件。
    codec_path = Path(__file__).with_name('image_codec.py')
    if not codec_path.exists():
        codec_path = Path(__file__).resolve().parents[1] / 'shared/image_codec.py'
    spec = importlib.util.spec_from_file_location('catalog_image_codec', codec_path)
    codec = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(codec)
    return codec.protect(project)


def upgrade_master(old_path, root):
    old_path, root = Path(old_path).resolve(), Path(root).resolve()
    target = root / '目录表-母版.html'
    if old_path == target:
        raise ValueError('选中的是新包自己的母版。请从旧版本文件夹选择你平时使用的母版。')
    old_html = old_path.read_text(encoding='utf-8-sig')
    project = read_project(old_html)
    counts = project_counts(project)
    template = target.read_text(encoding='utf-8-sig')
    read_project(template)
    if 'id="master-app"' not in template or len(PROJECT_BLOCK.findall(template)) != 1:
        raise ValueError('新包的母版程序不完整，请重新解压新包。')
    data = json.dumps(protect_images(project), ensure_ascii=False, separators=(',', ':'))
    data = data.replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    upgraded = PROJECT_BLOCK.sub(lambda match: match[1] + data + match[3], template)
    # 先把完整结果写到同一目录的临时文件；出错时不会写坏现有母版。
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='', dir=root, prefix='.母版升级-', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(upgraded)
        backup_dir = root / '备份'
        backup_dir.mkdir(exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        backup = backup_dir / f'目录表-母版-升级前-{stamp}.html'
        shutil.copy2(target, backup)
        os.replace(temporary, target)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return {'old': str(old_path), 'master': str(target), 'backup': str(backup), 'counts': counts}


def choose_file():
    if sys.platform == 'win32':
        command = r'''[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.OpenFileDialog; $dialog.Title = '选择旧版本的目录表-母版.html'; $dialog.Filter = '母版 HTML (*.html;*.htm)|*.html;*.htm'; if ($dialog.ShowDialog() -eq 'OK') { [Console]::WriteLine($dialog.FileName) }'''
        return subprocess.check_output(['powershell', '-NoProfile', '-STA', '-Command', command], encoding='utf-8').strip()
    if sys.platform == 'darwin':
        result = subprocess.run(['osascript', '-e', 'try', '-e', 'POSIX path of (choose file with prompt "选择旧版本的目录表-母版.html" of type {"html", "htm"})', '-e', 'on error number -128', '-e', 'return ""', '-e', 'end try'], capture_output=True, text=True, check=True)
        return result.stdout.strip()
    from tkinter import Tk, filedialog
    window = Tk()
    window.withdraw()
    try:
        return filedialog.askopenfilename(title='选择旧版本的目录表-母版.html', filetypes=[('母版 HTML', '*.html *.htm')])
    finally:
        window.destroy()


def main():
    parser = argparse.ArgumentParser(description='把旧母版的数据搬进当前文件夹的新版母版')
    parser.add_argument('old_master', nargs='?', help='旧的目录表-母版.html（不填会弹出选文件窗口）')
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[1]), help='新版目录文件夹')
    args = parser.parse_args()
    try:
        old = args.old_master or choose_file()
        if not old:
            print('已取消，没有改动任何文件。')
            return 0
        result = upgrade_master(old, args.root)
        counts = result['counts']
        print(f"升级完成：{counts['works']} 部作品，{counts['records']} 条记录，{counts['collections']} 个合集，夸克已定位 {counts['quark']} 部。")
        print('旧文件（保留原样）：' + result['old'])
        print('新包原母版备份：' + result['backup'])
        print('升级后的母版：' + result['master'])
        print('现在可以双击「启动目录表」继续使用。')
        return 0
    except Exception as error:
        print('升级失败，当前母版没有被覆盖：' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
