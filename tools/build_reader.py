#!/usr/bin/env python3
"""用同一读者模板离线生成只读 HTML；不抓图、不更改母版。"""
import argparse
from copy import deepcopy
import html
import importlib.util
import json
from pathlib import Path

import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.shared.catalog import pack, unpack
from src.shared.product import NAME
from src.shared.image_codec import protect, restore


def builder():
    spec = importlib.util.spec_from_file_location('build_master', ROOT / 'tools/build_master.py')
    item = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(item)
    return item


def public_month_lists(project, known_ids):
    result = []
    for listing in project.get('monthLists', []):
        if not listing.get('published'):
            continue
        groups = [{'title': '', 'items': []}]
        for line in listing.get('lines', []):
            if line.get('type') == 'header':
                groups.append({'title': line.get('text', ''), 'items': []})
            elif line.get('type') == 'item':
                if line.get('id') in known_ids:
                    groups[-1]['items'].append({'id': line['id'], 'star': bool(line.get('star')), 'marks': line.get('marks', [])})
                else:
                    groups[-1]['items'].append({'text': line.get('raw') or line.get('name', '')})
        result.append({'id': listing['id'], 'title': listing['title'], 'groups': [g for g in groups if g['items']], 'text': '\n'.join(line.get('raw') or line.get('text', '') for line in listing.get('lines', []))})
    return result


def build_reader_html(project):
    bm = builder()
    project = restore(deepcopy(project))
    records = unpack(project['catalog'])
    known_ids = {r['id'] for r in records}
    meta = deepcopy(project['meta'])
    meta.update(total_records=len(records),
                collections=[{key: c.get(key, {} if key == 'quark_folders' else '') for key in ['label', 'baidu', 'quark', 'quark_folders']} for c in project.get('collections', [])],
                changes={'first': True},
                rankings=[{key: ranking.get(key, []) if key in {'tiers', 'regions'} else ranking.get(key, '') for key in ['id', 'title', 'period', 'note', 'tiers', 'regions']} for ranking in project.get('rankings', []) if ranking.get('published')],
                card_covers=project.get('covers', {}),
                steam_covers=project.get('steamCovers', {}),
                cover_off=list(project.get('coverOff', {})),
                month_lists=public_month_lists(project, known_ids))
    for ranking in meta['rankings']:
        source = next(item for item in project.get('rankings', []) if item['id'] == ranking['id'])
        ranking['image'] = project.get('rankingImages', {}).get(source.get('imageId'), '')
        if not source.get('imageId'):
            ranking['regions'] = []
    ranked_ids = {item.get('id') for ranking in meta['rankings'] for tier in ranking['tiers'] for item in tier.get('items', [])}
    meta['ranking_covers'] = {key: value for key, value in meta['card_covers'].items() if key in ranked_ids}
    title = html.escape(meta.get('input_name') or meta.get('title') or NAME)
    template = re.sub(r'<title>[^<]*</title>', lambda _: f'<title>{title}</title>', bm._reader_template(), count=1)
    pinyin = project.get('pinyin', {})
    for record in records:
        terms = [pinyin[name] for name in [record.get('name', ''), *record.get('aliases', [])] if name in pinyin]
        if terms and (not record.get('canonical_id') or record['canonical_id'] == record['id']):
            record['search_py'] = ' '.join(terms)
    values = {'__UI_META__': bm._script_json(protect(meta)), '__UI_RECORDS__': bm._script_json(pack(records))}
    return re.sub(r'__UI_META__|__UI_RECORDS__', lambda match: values[match[0]], template)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--from-json', type=Path)
    source.add_argument('--from-master', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args(argv)
    bm = builder()
    project = bm.project_from_master(args.from_master) if args.from_master else bm.project_from_json(args.from_json)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    bm.write_atomic(str(args.out), build_reader_html(project))
    print(f'已生成只读目录：{args.out.name}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
