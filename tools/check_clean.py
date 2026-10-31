#!/usr/bin/env python3
"""检查公开源码、Git 历史及生成的 HTML/ZIP；退出 0 表示无命中。"""
import argparse
import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('clean_scan', ROOT / 'src/shared/clean_scan.py')
clean_scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clean_scan)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('targets', nargs='*', type=Path, default=[ROOT], help='默认仓库根目录，也可指定 HTML/ZIP')
    args = parser.parse_args(argv)
    failed = False
    for target in args.targets:
        result = clean_scan.scan_path(target)
        for label, line, reason in result.findings[:100]:
            print(f'{label}:{line}: {reason}')
        print(f'{target.name}: ' + ' / '.join(f'{k}={v}' for k,v in result.counts.items()) + f' / 命中={len(result.findings)}')
        failed = failed or bool(result.findings)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
