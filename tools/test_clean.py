#!/usr/bin/env python3
"""公开扫描器：只用临时合成数据，不在测试源码中放真实敏感实例。"""
import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('clean_scan', ROOT / 'src/shared/clean_scan.py')
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)


class CleanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_original_geometry_legal_fields_and_ini_pass(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="blue" width="10" height="10"/></svg>'
        data = 'data:image/svg+xml;base64,' + base64.b64encode(svg).decode()
        (self.root / 'demo.json').write_text(json.dumps({'appid': 123, 'cover': data, 'pwd_id': 'synthetic-demo', 'fid': 'folder-a', 'share_id': 'another-demo'}))
        (self.root / 'source.js').write_text('// ProviderA ProviderB\nconst example="https://example.com/demo";')
        (self.root / 'entry_points.txt').write_text('[console_scripts]\ntool=demo:main')
        self.assertEqual(scan.scan_path(self.root).findings, [])

    def test_compressed_data_and_zip_leaks_block(self):
        address = 'person' + '@' + 'personal.invalid'
        block = {'codec': 'deflate-base64', 'data': base64.b64encode(zlib.compress(json.dumps({'email': address}).encode())).decode()}
        (self.root / 'master.html').write_text('<script type="application/json" id="project-data">' + json.dumps(block) + '</script>')
        with zipfile.ZipFile(self.root / 'release.zip', 'w') as archive:
            archive.writestr('bad.txt', 'https://' + 'pan.quark.cn' + '/s/' + 'qwerty123456')
        findings = scan.scan_path(self.root).findings
        self.assertTrue(any('decoded' in label and why == '个人邮箱' for label, line, why in findings))
        self.assertTrue(any('release.zip!' in label and why == '真实分享链接' for label, line, why in findings))

    def test_upstream_path_pin_is_content_specific(self):
        import hashlib
        raw = ('C:' + chr(92) + 'Users' + chr(92) + 'SyntheticExample').encode()
        fingerprint = hashlib.sha256(raw).hexdigest()
        scan.UPSTREAM_PATH_HASHES.add(fingerprint)
        try:
            scanner = scan.Scanner()
            scanner.binary(raw, 'upstream.pyc')
            self.assertEqual(scanner.findings, [])
            scanner.binary(raw + b' changed', 'changed.pyc')
            self.assertTrue(any(why == '本机绝对路径' for _, _, why in scanner.findings))
            scanner.binary(raw + (' person' + '@' + 'personal.invalid').encode(), 'changed-email.pyc')
            self.assertTrue(any(why == '个人邮箱' for _, _, why in scanner.findings))
        finally:
            scan.UPSTREAM_PATH_HASHES.remove(fingerprint)

    def test_img2_image_metadata_is_decoded(self):
        svg = ('<svg>' + 'person' + '@' + 'personal.invalid' + '</svg>').encode()
        mime = b'image/svg+xml'
        packed = zlib.compress(bytes([len(mime)]) + mime + svg)
        encoded = 'img2:' + base64.urlsafe_b64encode(packed).decode().rstrip('=')
        (self.root / 'demo.json').write_text(json.dumps({'cover': encoded}))
        findings = scan.scan_path(self.root).findings
        self.assertTrue(any(':image' in label and why == '个人邮箱' for label, line, why in findings))

    def test_deleted_git_history_and_staged_content_block(self):
        def git(*args):
            subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)
        git('init', '-q')
        git('config', 'user.name', 'Demo')
        git('config', 'user.email', '0+demo@users.noreply.github.com')
        path = self.root / 'notes.txt'
        path.write_text('person' + '@' + 'personal.invalid')
        git('add', '.')
        git('commit', '-qm', 'initial')
        path.unlink()
        git('add', '-u')
        git('commit', '-qm', 'remove')
        stage = self.root / 'staged.txt'
        stage.write_text('/' + 'Users/' + 'someone/Documents/file')
        git('add', '.')
        stage.write_text('clean working copy')
        findings = scan.scan_path(self.root).findings
        self.assertTrue(any(label.startswith('history:') and why == '个人邮箱' for label, line, why in findings))
        self.assertTrue(any(label == 'index:staged.txt' and why == '本机绝对路径' for label, line, why in findings))

    def test_pinned_license_history_passes_but_private_email_history_blocks(self):
        def git(*args):
            subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)
        git('init', '-q')
        git('config', 'user.name', 'Demo')
        git('config', 'user.email', '0+demo@users.noreply.github.com')
        license_file = ROOT / 'LICENSES/pypinyin/LICENSE.txt'
        (self.root / 'LICENSE.txt').write_bytes(license_file.read_bytes())
        git('add', '.')
        git('commit', '-qm', 'add upstream license')
        self.assertEqual(scan.scan_path(self.root).findings, [])
        address = 'person' + '@' + 'personal.invalid'
        notes = self.root / 'notes.txt'
        notes.write_text(address)
        git('add', '.')
        git('commit', '-qm', 'contact ' + address)
        notes.unlink()
        git('add', '-u')
        git('commit', '-qm', 'remove private note')
        findings = scan.scan_path(self.root).findings
        self.assertTrue(any(label == 'history:commits' and why == '个人邮箱' for label, line, why in findings))
        self.assertTrue(any(label.startswith('history:notes.txt@') and why == '个人邮箱' for label, line, why in findings))

    def test_ignored_untracked_log_is_not_candidate_but_explicit_and_tracked_are(self):
        def git(*args):
            subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)
        git('init', '-q')
        (self.root / '.gitignore').write_text('*.log\n')
        log = self.root / 'runtime.log'
        log.write_text('person' + '@' + 'personal.invalid')
        self.assertEqual(scan.scan_path(self.root).findings, [])
        self.assertTrue(any(why == '个人邮箱' for _, _, why in scan.scan_path(log).findings))
        git('add', '-f', 'runtime.log')
        findings = scan.scan_path(self.root).findings
        self.assertTrue(any(label == 'runtime.log' and why == '个人邮箱' for label, line, why in findings))

    def test_upstream_author_email_requires_exact_pinned_file(self):
        license_file = ROOT / 'LICENSES/pypinyin/LICENSE.txt'
        if not license_file.exists():
            self.skipTest('未附许可证的源码测试副本')
        clean = license_file.read_bytes()
        self.assertEqual(scan.scan_path(license_file).findings, [])
        (self.root / 'LICENSE.txt').write_bytes(clean + b'\nchanged content\n')
        self.assertTrue(any(why == '个人邮箱' for _, _, why in scan.scan_path(self.root).findings))


if __name__ == '__main__':
    unittest.main()
