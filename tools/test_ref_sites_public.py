"""Offline reference-site regression tests; every title, page and image is synthetic."""
import base64
import copy
import importlib.util
from pathlib import Path
import socket
import struct
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class ReferenceSitesPublicTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('public_ref_sites_test_target', ROOT / 'src/helper/ref_sites.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        # Fake clients below must never perform DNS resolution or open a socket.
        self.dns = patch('socket.getaddrinfo', side_effect=AssertionError('unexpected DNS in offline fixture'))
        self.connection = patch('socket.socket.connect', side_effect=AssertionError('unexpected network in offline fixture'))
        self.dns.start()
        self.connection.start()
        self.addCleanup(self.dns.stop)
        self.addCleanup(self.connection.stop)

    def test_title_cleanup_confidence_and_lazy_post_image_parser(self):
        m = self.module
        self.assertEqual(m.clean_title('更新[课程] 演示资料甲 Ver1.2 2GB 中文版'), '演示资料甲')
        self.assertEqual(m.title_confidence({'title': '演示资料甲'}, '更新[课程] 演示资料甲 中文版'), 'exact')
        self.assertEqual(m.title_confidence({'title': '演示资料甲'}, '演示资料甲 合成补充篇'), 'prefix')
        self.assertIsNone(m.title_confidence({'title': '演示资料甲2'}, '演示资料甲3'))
        self.assertIsNone(m.title_confidence({'title': '演示资料甲'}, '演示资料甲2'))
        page = ('<img src="avatar.jpg" width="64"><img data-src="/cover.jpg" width="640">'
                '<img src="//example.invalid/next.jpg"><img src="/cover.jpg" width="640">'
                '<a href="https://store.steampowered.com/app/0/">合成资料入口</a>')
        result = m.parse_page(page, 'https://example.invalid/post')
        self.assertEqual(result['images'], ['https://example.invalid/cover.jpg', 'https://example.invalid/next.jpg'])
        self.assertEqual(result['official'][0]['appid'], '0')
        self.assertEqual(result['links'][0]['title'], '合成资料入口')

    def test_mixed_language_queries_keep_embedded_latin_and_prioritize_names(self):
        m = self.module
        self.assertEqual(m.query_names({'title': '演示画册 Synthetic Album 図案見本 図案標本'}), ['演示画册', '図案見本'])
        self.assertEqual(m.query_names({'title': '演示配色 Companion Example'}), ['演示配色'])
        self.assertEqual(m.query_names({'title': '更新 演示配色SVG指南 Synthetic Guide v1.09'}), ['演示配色SVG指南'])
        self.assertEqual(m.query_names({'title': '演示主册 合成副册 架空書店 配色ガイド'}), ['演示主册 合成副册', '架空書店 配色ガイド'])
        self.assertEqual(m.title_confidence({'title': '演示配色 Companion Example'}, '[课程] 演示配色'), 'exact')
        self.assertIsNone(m.title_confidence({'title': '演示画册 Synthetic Album'}, '完全不同的合成画册'))

    def test_detection_keeps_redirect_and_classifies_wordpress_web_blocked_and_failed(self):
        m = self.module
        class Client:
            mode = 'wordpress'
            def page(self, url):
                if self.mode == 'blocked': raise m.SiteBlocked('synthetic HTTP 403')
                if self.mode == 'failed': raise OSError('synthetic offline')
                return '<p>synthetic page</p>', 'https://example.invalid/redirected/page'
            def json(self, url):
                if self.mode != 'wordpress': raise ValueError('synthetic non-JSON page')
                return []
        client = Client()
        site = {'id': 'demo-site', 'name': '演示站点', 'url': 'https://example.invalid/start'}
        original = copy.deepcopy(site)
        checked = m.check_site(site, client)
        self.assertEqual(checked['finalUrl'], 'https://example.invalid/')
        self.assertEqual(checked['type'], 'wordpress')
        self.assertEqual(checked['lastCheck']['status'], 'ok')
        client.mode = 'web'
        self.assertEqual(m.check_site(site, client)['lastCheck']['status'], 'needs_template')
        self.assertEqual(m.check_site(dict(site, searchTemplate='https://example.invalid/search?q={q}'), client)['lastCheck']['status'], 'ok')
        client.mode = 'blocked'
        self.assertEqual(m.check_site(site, client)['lastCheck']['status'], 'blocked')
        client.mode = 'failed'
        self.assertEqual(m.check_site(site, client)['lastCheck']['status'], 'failed')
        self.assertEqual(site, original)

    def test_blocked_site_is_skipped_once_and_successful_candidates_are_preview_only(self):
        m = self.module
        image = 'data:image/png;base64,' + base64.b64encode(b'synthetic-preview-marker').decode()
        class Client:
            requests = []
            def json(self, url):
                self.requests.append(url)
                if '/blocked/' in url: raise m.SiteBlocked('synthetic HTTP 403')
                return [{'title': {'rendered': '[课程] 演示资料甲'}, 'link': 'https://example.invalid/post', 'content': {'rendered': '<img src="/cover.png" width="640">'}}]
            def image(self, url, referer): return image
        records = [{'id': 'demo-a', 'title': '演示资料甲'}, {'id': 'demo-b', 'title': '演示资料甲'}]
        sites = [{'id': 'blocked', 'name': '演示不可用站点', 'url': 'https://example.invalid/blocked', 'type': 'wordpress'},
                 {'id': 'enabled', 'name': '演示可用站点', 'url': 'https://example.invalid/enabled', 'type': 'wordpress'}]
        before = copy.deepcopy((records, sites))
        client = Client()
        result = m.find_covers(records, sites, client)
        self.assertEqual(len(result['candidates']), 2)
        self.assertEqual(result['candidates'][0]['confidence'], 'exact')
        self.assertEqual(result['candidates'][0]['siteId'], 'enabled')
        self.assertEqual(result['candidates'][0]['url'], 'https://example.invalid/post')
        self.assertEqual(result['candidates'][0]['imageUrl'], 'https://example.invalid/cover.png')
        self.assertEqual(result['sites'][0]['lastCheck']['status'], 'blocked')
        self.assertEqual(result['stats']['matched'], 2)
        self.assertEqual(sum('/blocked/' in url for url in client.requests), 1)
        self.assertNotIn('covers', result)
        self.assertEqual((records, sites), before)

    def test_failed_image_continues_to_next_image_and_failed_record_keeps_other_candidate(self):
        m = self.module
        class Client:
            def json(self, url):
                title = '失败合成条目' if 'search=%E5%A4%B1' in url else '演示资料甲'
                return [{'title': {'rendered': title}, 'link': 'https://example.invalid/post', 'content': {'rendered': '<img src="/first.png"><img src="/next.png">'}}]
            def image(self, url, referer):
                if 'first' in url: raise ValueError('synthetic image failure')
                return 'data:image/png;base64,' + base64.b64encode(b'generated-next-preview').decode()
        picture = m.download_candidate({'body': '<img src="/first.png"><img src="/next.png">', 'url': 'https://example.invalid/post'}, Client())
        self.assertEqual(picture['imageIndex'], 1)
        self.assertEqual(picture['imageUrl'], 'https://example.invalid/next.png')
        self.assertEqual(picture['downloadErrors'], ['synthetic image failure'])
        class PerRecordClient(Client):
            def image(self, url, referer):
                if referer.endswith('/failed'): raise ValueError('synthetic denied image')
                return super().image(url, referer)
            def json(self, url):
                failed = 'search=%E5%A4%B1' in url
                return [{'title': {'rendered': '失败合成条目' if failed else '演示资料甲'}, 'link': 'https://example.invalid/failed' if failed else 'https://example.invalid/post', 'content': {'rendered': '<img src="/first.png"><img src="/next.png">'}}]
        result = m.find_covers([{'id': 'demo-failed', 'code': 'DEMO101', 'title': '失败合成条目'}, {'id': 'demo-ok', 'title': '演示资料甲'}], [{'id': 'demo-site', 'url': 'https://example.invalid', 'type': 'wordpress'}], PerRecordClient())
        self.assertEqual(result['stats']['downloadFailed'], 1)
        self.assertEqual(result['stats']['matched'], 1)
        self.assertEqual(result['failed'][0]['code'], 'DEMO101')
        self.assertIn('synthetic denied image', result['failed'][0]['errors'][0])
        self.assertEqual(result['candidates'][0]['id'], 'demo-ok')

    def test_next_image_reselection_returns_source_without_mutating_selection(self):
        m = self.module
        class Client:
            def page(self, url): return '<img src="/first.png"><img src="/second.png">', url
            def image(self, url, referer): return 'data:image/png;base64,' + base64.b64encode(url.rsplit('/', 1)[-1].encode()).decode()
        payload = {'source': {'url': 'https://example.invalid/post', 'imageUrl': 'https://example.invalid/first.png', 'imageIndex': 0}}
        before = copy.deepcopy(payload)
        job = type('Job', (), {'cancelled': False})()
        with patch.object(m, 'RefClient', return_value=Client()):
            result = m.job_ref_next(job, payload)
        self.assertEqual(result['imageIndex'], 1)
        self.assertEqual(result['imageUrl'], 'https://example.invalid/second.png')
        self.assertEqual(result['url'], payload['source']['url'])
        self.assertEqual(payload, before)
        with patch.object(m, 'RefClient', return_value=Client()):
            with self.assertRaisesRegex(ValueError, '后面没有可用图片'):
                m.job_ref_next(job, {'source': dict(payload['source'], imageUrl=result['imageUrl'])})

    def test_real_client_size_parser_uses_generated_bytes_and_mocked_transport(self):
        m = self.module
        data = b'\x89PNG\r\n\x1a\n' + b'\0' * 8 + struct.pack('>II', 640, 480) + b'\0' * 4096
        self.assertEqual(m.image_size(data), (640, 480))
        self.assertIsNone(m.image_size(b'synthetic non-image'))
        class Headers:
            def get_content_type(self): return 'image/png'
        class Reply:
            headers = Headers()
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, _): return data
            def geturl(self): return 'https://example.invalid/cover.png'
        resolved = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('1.1.1.1', 443))]
        with patch('src.sources.http.socket.getaddrinfo', return_value=resolved), patch.object(m, 'public_open', return_value=Reply()) as transport:
            image = m.RefClient().image('https://example.invalid/cover.png', 'https://example.invalid/post')
        self.assertEqual(base64.b64decode(image.split(',', 1)[1]), data)
        self.assertEqual(transport.call_count, 1)
        client = m.RefClient()
        with patch.object(client, 'read', return_value=(data[:100], 'https://example.invalid/small.png', 'image/png')):
            with self.assertRaisesRegex(ValueError, '太小'):
                client.image('https://example.invalid/small.png', '')


if __name__ == '__main__':
    unittest.main()
