#!/usr/bin/env python3
"""Python/浏览器图片格式交叉往返；旧格式只用现场生成的合成字节。"""
import base64
import json
from pathlib import Path
import subprocess
import sys
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.shared import image_codec


class ImageCodecTests(unittest.TestCase):
    def test_python_javascript_img2_and_synthetic_legacy_cross_roundtrip(self):
        raw = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="17" height="13" fill="#50807f"/></svg>'
        data = 'data:image/svg+xml;base64,' + base64.b64encode(raw).decode()
        mime = b'image/svg+xml'
        packed = zlib.compress(bytes([len(mime)]) + mime + raw)
        key = b'catalog-images-v1'
        legacy = 'enc1:' + base64.urlsafe_b64encode(bytes(value ^ key[i % len(key)] for i, value in enumerate(packed))).decode().rstrip('=')
        encoded = image_codec.encode(data)
        self.assertTrue(encoded.startswith('img2:'))
        self.assertEqual(image_codec.decode(encoded), data)
        self.assertEqual(image_codec.decode(legacy), data)
        script = r'''
const fs = require('node:fs'), vm = require('node:vm');
global.window = {};
vm.runInThisContext(fs.readFileSync('src/shared/image-codec.js', 'utf8'));
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => {
  const codec = window.CatalogImages;
  const result = {fromPython: await codec.decode(input.encoded), fromLegacy: await codec.decode(input.legacy), fromJS: await codec.encode(input.data), nested: await codec.restore({list:[input.encoded, input.legacy], untouched:'https://example.invalid/cover'})};
  process.stdout.write(JSON.stringify(result));
})().catch(error => { console.error(error); process.exit(1); });
'''
        result = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps({'data': data, 'encoded': encoded, 'legacy': legacy}), text=True, capture_output=True, check=True)
        out = json.loads(result.stdout)
        self.assertEqual(out['fromPython'], data)
        self.assertEqual(out['fromLegacy'], data)
        self.assertTrue(out['fromJS'].startswith('img2:'))
        self.assertEqual(image_codec.decode(out['fromJS']), data)
        self.assertEqual(out['nested'], {'list': [data, data], 'untouched': 'https://example.invalid/cover'})
        self.assertEqual(image_codec.restore(image_codec.protect({'covers': [data], 'id': 'demo'})), {'covers': [data], 'id': 'demo'})


if __name__ == '__main__':
    unittest.main()
