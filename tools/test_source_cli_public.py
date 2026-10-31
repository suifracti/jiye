"""The diagnostic CLI must remain offline unless --live is chosen."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('source_cli',Path(__file__).with_name('check_source.py'))
cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)

class SourceCliTest(unittest.TestCase):
    def test_default_is_offline(self):
        with patch('urllib.request.urlopen',side_effect=AssertionError('unexpected request')):
            result=cli.check('bangumi','1')
        self.assertEqual(result['status'],'disabled')
        self.assertEqual(result['requests'],0)
        self.assertEqual(result['returned_fields'],[])
    def test_steam_without_key_does_not_connect(self):
        with patch('urllib.request.urlopen',side_effect=AssertionError('unexpected request')):
            result=cli.check('steam','1',live=True,environ={})
        self.assertEqual(result['status'],'configuration_required')
        self.assertEqual(result['requests'],0)

if __name__=='__main__':unittest.main()
