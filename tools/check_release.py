#!/usr/bin/env python3
"""一次完成离线测试、演示数据/图片核对、HTML/ZIP/全部历史扫描。"""
import argparse
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.shared.catalog import unpack
from src.shared.product import NAME, SLUG, VERSION
from src.shared.image_codec import restore
from src.shared.clean_scan import scan_path, image_bytes


def load_module(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    item = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(item)
    return item


def validate_artifacts(package, expected_count=48):
    package = Path(package)
    master = package / '目录表-母版.html'
    readers = sorted((package / '分发').glob('*.html'))
    if not master.exists() or len(readers) != 1:
        raise ValueError('应有一份母版和分发目录中唯一一份读者 HTML')
    upgrade = load_module('upgrade', 'src/helper/upgrade_master.py')
    bm = load_module('builder', 'tools/build_master.py')
    project = restore(upgrade.read_project(master.read_text(encoding='utf-8-sig')))
    reader = bm.project_from_board(readers[0])
    meta = restore(reader['meta'])
    records, distributed = unpack(project['catalog']), unpack(reader['catalog'])
    ids, distributed_ids = [r['id'] for r in records], [r['id'] for r in distributed]
    if len(records) != expected_count or len(set(ids)) != expected_count or distributed_ids != ids:
        raise ValueError('母版/读者版数量、稳定 ID 或顺序不一致')
    clean = lambda record: {key: value for key, value in record.items() if key not in {'search_py', 'source_record'}}
    if [clean(r) for r in records] != [clean(r) for r in distributed]:
        raise ValueError('母版与读者版的作品字段不一致')
    if meta.get('collection_key') != project['catalogId']:
        raise ValueError('读者版目录身份不一致')
    master_covers, reader_covers = project.get('covers', {}), meta.get('card_covers', {})
    if expected_count == 48 and set(master_covers) != set(ids):
        raise ValueError('48 条正式演示应每条都有原创封面')
    for key, value in master_covers.items():
        if key not in reader_covers or image_bytes(reader_covers[key]) != image_bytes(value):
            raise ValueError('读者版遗漏或改变原创封面')
        raw = image_bytes(value)
        if not raw or not raw.lstrip().startswith(b'<svg'):
            raise ValueError('源码演示封面应使用原创 SVG 几何图')
    if len(meta.get('collections', [])) != len(project.get('collections', [])):
        raise ValueError('读者版遗漏合集')
    return {'records': len(records), 'covers': len(master_covers), 'collections': len(meta.get('collections', [])), 'html': [master, *readers]}


def check_js(html_files):
    count = 0
    with tempfile.TemporaryDirectory(prefix='jiye-js-check-') as folder:
        for html in html_files:
            text = Path(html).read_text(encoding='utf-8-sig')
            for attributes, body in re.findall(r'<script\b([^>]*)>(.*?)</script\s*>', text, re.S | re.I):
                if re.search(r'type=["\']application/json', attributes, re.I):
                    continue
                path = Path(folder) / f'block-{count}.js'
                path.write_text(body)
                subprocess.run(['node', '--check', str(path)], check=True, capture_output=True, text=True)
                count += 1
    return count


def run_tests():
    tests = sorted((ROOT / 'tools').glob('test_*.py')) + sorted((ROOT / 'tools').glob('test_*.js'))
    for test in tests:
        print(f'运行 {test.name}', flush=True)
        command = [sys.executable, '-I', str(test)] if test.suffix == '.py' else ['node', str(test)]
        subprocess.run(command, cwd=ROOT, check=True)
    if not tests:
        raise ValueError('未找到离线测试')
    return len(tests)


def report_scan(target):
    result = scan_path(target)
    for label, line, reason in result.findings[:100]:
        print(f'{label}:{line}: {reason}')
    print(f'扫描 {Path(target).name}: ' + ' / '.join(f'{key}={value}' for key, value in result.counts.items()) + f' / 命中={len(result.findings)}')
    if result.findings:
        raise ValueError('扫描发现泄漏或无法完整解码的内容')
    return result


def validate_shipping_zip(archive):
    zipper = load_module('zipper', 'tools/zip_release.py')
    with zipfile.ZipFile(archive) as zipped:
        names = zipped.namelist()
    if not any(name.endswith('目录表-母版.html') for name in names) or not any('/分发/' in name and name.endswith('.html') for name in names):
        raise ValueError('ZIP 缺少母版或读者版')
    for name in names:
        path = PurePosixPath(name)
        if zipper.EXCLUDED.intersection(path.parts) or path.name.startswith(('.source_request_state.json',)):
            raise ValueError('ZIP 混入不应分发的日志、备份或运行状态：' + name)
    return names


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-root', type=Path, default=ROOT / 'dist' / NAME)
    parser.add_argument('--zip', type=Path, dest='archive')
    parser.add_argument('--build', action='store_true', help='先构建原创母版、读者版和 ZIP')
    parser.add_argument('--artifacts-only', action='store_true', help='只核对产物和泄漏；不代表离线测试通过')
    parser.add_argument('--expected-count', type=int, default=48)
    args = parser.parse_args(argv)
    try:
        tests = 0 if args.artifacts_only else run_tests()
        archive = args.archive or ROOT / f'dist/{SLUG}-v{VERSION}.zip'
        if args.build:
            subprocess.run([sys.executable, '-I', str(ROOT / 'tools/build_package.py'), '--out', str(args.package_root)], cwd=ROOT, check=True)
            subprocess.run([sys.executable, '-I', str(ROOT / 'tools/build_reader.py'), '--from-master', str(args.package_root / '目录表-母版.html'), '--out', str(args.package_root / '分发' / f'{NAME}演示目录.html')], cwd=ROOT, check=True)
            notes = ROOT / 'CHANGELOG.md'
            if not notes.exists():
                raise ValueError('缺少 CHANGELOG.md，不能生成正式 ZIP')
            zipper = load_module('zipper', 'tools/zip_release.py')
            zipper.create_release_zip(args.package_root, notes, archive)
        summary = validate_artifacts(args.package_root, args.expected_count)
        blank = args.package_root / '空白母版.html'
        if not blank.exists():
            raise ValueError('缺少空白母版')
        bm = load_module('blank_builder', 'tools/build_master.py')
        blank_project = bm.project_from_master(blank)
        if unpack(blank_project['catalog']) or blank_project.get('covers') or blank_project.get('collections'):
            raise ValueError('空白母版含有演示记录、图片或合集')
        blank_meta = blank_project.get('meta', {})
        if any(blank_meta.get('modules', {}).values()) or blank_meta.get('latest_catalog_url') or blank_meta.get('ui_config', {}).get('show_background'):
            raise ValueError('空白母版存在默认联网开关或链接')
        summary['html'].append(blank)
        scripts = check_js(summary['html'])
        report_scan(ROOT)
        # 明确检查将要发出的 HTML；小助手留在本机的日志和备份不在交付范围。
        for artifact in summary['html']:
            report_scan(artifact)
        if not archive.exists():
            raise ValueError('缺少发布 ZIP，请先构建或用 --zip 指定')
        report_scan(archive)
        validate_shipping_zip(archive)
        print(f'通过：{tests} 个离线测试脚本 / {summary["records"]} 条记录 / {summary["covers"]} 张原创封面 / {scripts} 段 JS；源码、历史、产物和 ZIP 无泄漏命中。')
        if args.artifacts_only:
            print('本次跳过离线测试。浏览器、Windows、手机及外站实测需单独记录。')
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print('检查未通过：' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
