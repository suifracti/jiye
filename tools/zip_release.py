#!/usr/bin/env python3
"""打正式 ZIP：中文名使用标准 UTF-8 标记，排除日志、备份和本机运行状态。"""
import argparse
from datetime import date
from pathlib import Path
import zipfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from src.shared.product import NAME, SLUG

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'日志', '备份', '表格', '__pycache__', '.DS_Store', 'Thumbs.db', '.instance.json', '.folder-scan-progress.json', '.folder-scan-progress.json.tmp'}


def create_release_zip(package, notes, output):
    package, notes, output = Path(package), Path(notes), Path(output)
    # 先读取说明，避免路径写错后留下一个看似完整的包。
    notes.read_text(encoding='utf-8')
    if not (package / '目录表-母版.html').is_file():
        raise ValueError('发布目录里找不到目录表-母版.html')
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(package.rglob('*')):
            relative = path.relative_to(package)
            if (path.is_file() and not EXCLUDED.intersection(relative.parts)
                    and not path.name.startswith(('.source_request_state.json',))
                    and relative.as_posix() != '本次更新说明.md'):
                archive.write(path, Path(NAME) / relative)
        archive.write(notes, f'{NAME}/本次更新说明.md')
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--date', default=date.today().isoformat())
    parser.add_argument('--root', type=Path, default=ROOT / 'dist'/NAME)
    parser.add_argument('--notes', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    notes = args.notes or ROOT / 'CHANGELOG.md'
    output = args.out or ROOT / f'dist/{SLUG}-{args.version}.zip'
    create_release_zip(args.root, notes, output)
    print(f'已打包：{output}（{output.stat().st_size} 字节；不含日志、备份和运行状态）')


if __name__ == '__main__':
    main()
