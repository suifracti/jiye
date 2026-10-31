#!/usr/bin/env python3
"""原创演示的构建、2000 条数据与升级往返；全部离线。"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.shared import catalog, image_codec


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    item = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(item)
    return item


builder = module('builder', 'tools/build_master.py')
reader = module('reader', 'tools/build_reader.py')
demo = module('demo', 'tools/make_demo.py')
upgrade = module('upgrade', 'src/helper/upgrade_master.py')
release = module('release', 'tools/check_release.py')


class BuildTests(unittest.TestCase):
    def project(self, folder, count=48):
        data = demo.make_demo(count)
        path = Path(folder) / 'demo.json'
        path.write_text(json.dumps(data, ensure_ascii=False))
        return data, builder.project_from_json(path)

    def test_48_records_covers_and_public_reader_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            data, project = self.project(folder)
            project['privateNotes'] = {'DEMO-0001': 'synthetic-editor-note'}
            html = reader.build_reader_html(project)
            self.assertNotIn('synthetic-editor-note', html)
            target = Path(folder) / 'reader.html'
            target.write_text(html)
            restored = builder.project_from_board(target)
            self.assertEqual([{k:v for k,v in record.items() if k != 'search_py'} for record in catalog.unpack(restored['catalog'])], data['records'])
            meta = image_codec.restore(restored['meta'])
            self.assertEqual(set(meta['card_covers']), set(data['covers']))
            for key, cover in meta['card_covers'].items():
                self.assertEqual(cover, data['covers'][key])
            self.assertEqual(len(meta['collections']), 4)
            self.assertEqual(len(meta['rankings']), 1)
            self.assertGreater(len(meta['month_lists'][0]['groups'][0]['items']), 0)

    def test_headless_reader_keeps_pinyin_and_ranking_artwork(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data, project = self.project(root)
            project['pinyin'] = {data['records'][0]['name']: 'xinghe shouji xhsj'}
            project['rankingImages'] = {'synthetic-ranking-image': data['covers']['DEMO-0001']}
            project['rankings'][0]['imageId'] = 'synthetic-ranking-image'
            target = root / 'reader.html'
            target.write_text(reader.build_reader_html(project))
            restored = builder.project_from_board(target)
            records = catalog.unpack(restored['catalog'])
            meta = image_codec.restore(restored['meta'])
            self.assertEqual(records[0]['search_py'], 'xinghe shouji xhsj')
            self.assertEqual(meta['rankings'][0]['image'], data['covers']['DEMO-0001'])

    def test_2000_records_keep_ids_relations_and_edits_after_save(self):
        with tempfile.TemporaryDirectory() as folder:
            started = time.monotonic()
            data, project = self.project(folder, 2000)
            records = catalog.unpack(project['catalog'])
            self.assertEqual(len({r['id'] for r in records}), 2000)
            records[1000]['name'] = '合成修改后的名称'
            records[1000]['aliases'].append('Synthetic Changed Alias')
            project['catalog'] = catalog.pack(records)
            master = Path(folder) / 'master.html'
            master.write_text(builder.build_master_html(project))
            saved = builder.project_from_master(master)
            self.assertEqual(catalog.unpack(saved['catalog']), records)
            target = Path(folder) / 'reader.html'
            target.write_text(reader.build_reader_html(saved))
            restored = builder.project_from_board(target)
            self.assertEqual([{k:v for k,v in r.items() if k != 'search_py'} for r in catalog.unpack(restored['catalog'])], records)
            self.assertEqual(len(restored['meta']['collections']), 4)
            self.assertEqual(restored['meta']['collection_key'], data['meta']['collection_key'])
            print(f'2000 条构建/保存/分发往返：{time.monotonic()-started:.2f}s')

    def test_2000_browser_pack_unpack_and_normalized_search(self):
        records = demo.make_demo(2000)['records']
        script = r"""
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const records=JSON.parse(fs.readFileSync(0,'utf8'));
const source=fs.readFileSync('src/master/js/00-core.js','utf8').split('// ---------- 读入母版数据 ----------')[0];
const context={document:{getElementById:()=>({})},Blob,Response,CompressionStream,DecompressionStream,TextEncoder,TextDecoder,Uint8Array,atob,btoa};
vm.createContext(context);
vm.runInContext(source+'\n;globalThis.api={pack,unpack,normalizeSearch,searchText};',context);
const views=records.map(record=>({...record,source_record:structuredClone(record)}));
const restored=context.api.unpack(context.api.pack(views)).map(({source_record,...record})=>record);
assert.deepStrictEqual(JSON.parse(JSON.stringify(restored)),records);
const query=context.api.normalizeSearch(records[1234].code.toLowerCase());
const found=records.filter(record=>context.api.normalizeSearch(context.api.searchText(record)).includes(query));
assert.deepStrictEqual(found.map(record=>record.id),[records[1234].id]);
assert.equal(new Set(restored.map(record=>record.id)).size,2000);
process.stdout.write('2000 条浏览器压缩/还原/编号搜索：通过');
"""
        result = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(records), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        print(result.stdout)

    def test_upgrade_preserves_custom_records_notes_and_cover(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            _, project = self.project(root)
            project['privateNotes'] = {'DEMO-0001': '原创合成制作备注'}
            records = catalog.unpack(project['catalog'])
            records[0]['name'] = '用户修改的合成名称'
            project['catalog'] = catalog.pack(records)
            old = root / 'old.html'
            old.write_text(builder.build_master_html(project))
            package = root / 'package'
            package.mkdir()
            target = package / '目录表-母版.html'
            target.write_text(builder.build_master_html(dict(project, privateNotes={})))
            old_bytes = old.read_bytes()
            result = upgrade.upgrade_master(old, package)
            migrated = image_codec.restore(upgrade.read_project(target.read_text()))
            self.assertEqual(catalog.unpack(migrated['catalog']), records)
            self.assertEqual(migrated['privateNotes'], project['privateNotes'])
            self.assertEqual(migrated['covers'], project['covers'])
            self.assertEqual(old.read_bytes(), old_bytes)
            self.assertTrue(Path(result['backup']).exists())

    def test_release_rejects_reader_missing_a_record(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            _, project = self.project(root)
            (root / '目录表-母版.html').write_text(builder.build_master_html(project))
            readers = root / '分发'
            readers.mkdir()
            target = readers / 'demo.html'
            target.write_text(reader.build_reader_html(project))
            self.assertEqual(release.validate_artifacts(root, 48)['records'], 48)
            records = catalog.unpack(project['catalog'])
            project['catalog'] = catalog.pack(records[:-1])
            target.write_text(reader.build_reader_html(project))
            with self.assertRaises(ValueError):
                release.validate_artifacts(root, 48)

    def test_shipping_zip_excludes_runtime_and_rejects_injected_log(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = root / 'package'
            (package / '分发').mkdir(parents=True)
            (package / '目录表-母版.html').write_text('synthetic master')
            (package / '分发/demo.html').write_text('synthetic reader')
            (package / '日志').mkdir()
            (package / '日志/runtime.log').write_text('/' + 'Users/' + 'synthetic/Documents/file')
            (package / '备份').mkdir()
            (package / '备份/old.html').write_text('synthetic backup')
            (package / '.instance.json').write_text('{}')
            notes = root / 'notes.md'
            notes.write_text('synthetic release notes')
            archive = root / 'release.zip'
            zipper = module('zipper', 'tools/zip_release.py')
            zipper.create_release_zip(package, notes, archive)
            names = release.validate_shipping_zip(archive)
            self.assertFalse(any('runtime.log' in name or '/备份/' in name or '.instance.json' in name for name in names))
            with zipfile.ZipFile(archive, 'a') as output:
                output.writestr('集页/日志/runtime.log', 'synthetic runtime')
            with self.assertRaises(ValueError):
                release.validate_shipping_zip(archive)

    def test_invalid_old_master_does_not_change_target(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            _, project = self.project(root)
            old = root / 'broken.html'
            old.write_text('<html>not a master</html>')
            package = root / 'package'
            package.mkdir()
            target = package / '目录表-母版.html'
            target.write_text(builder.build_master_html(project))
            before = target.read_bytes()
            with self.assertRaises(ValueError):
                upgrade.upgrade_master(old, package)
            self.assertEqual(target.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
