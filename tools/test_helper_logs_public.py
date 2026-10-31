"""Offline helper-log regressions with temporary files and invented secret markers."""
import contextlib
from datetime import datetime
import io
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'src/helper'))
import server


class HelperLogsTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('socket.socket.connect', side_effect=AssertionError('unexpected network in log fixture'))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.old_logger = getattr(server, 'FILE_LOG', None)
        server.JOBS.clear()

    def tearDown(self):
        server.FILE_LOG = self.old_logger
        self.tmp.cleanup()

    def configure(self):
        import helper_logs
        server.FILE_LOG = helper_logs.DailyLog(self.root)
        return server.FILE_LOG

    def text(self):
        return ''.join(p.read_text(encoding='utf-8') for p in sorted((self.root / '日志').glob('*.log')))

    def wait_job(self, job):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if job.status != 'running' and f'任务 {job.kind} 结束：{job.status}' in self.text():
                return
            time.sleep(.01)
        self.fail('任务没有完成并写入日志')

    def test_log_appends_utf8_and_preserves_console(self):
        self.configure()
        console = io.StringIO()
        with contextlib.redirect_stdout(console):
            server.log('开始保存')
            server.log('保存完成')
        self.assertIn('开始保存', console.getvalue())
        self.assertIn('开始保存', self.text())
        self.assertIn('保存完成', self.text())
        self.assertEqual(len(list((self.root / '日志').glob('小助手-????????.log'))), 1)

    def test_task_print_direct_write_and_traceback_are_logged_once(self):
        self.configure()
        def task(job):
            print('任务输出', '完整的一行')
            job.write('直接任务消息\n')
            server.log('任务内 log')
            print('未换行的尾部', end='')
            raise ValueError('测试异常')
        with contextlib.redirect_stdout(io.StringIO()), patch.object(sys, '__stdout__', io.StringIO()) as console:
            job = server.start_job('离线异常', task)
            self.wait_job(job)
        text = self.text()
        for line in ('任务输出 完整的一行', '直接任务消息', '任务内 log', '未换行的尾部', 'ValueError: 测试异常', '任务 离线异常 结束：error'):
            self.assertEqual(text.count(line), 1, line)
        self.assertIn('Traceback (most recent call last)', text)
        self.assertIn('ValueError: 测试异常', console.getvalue())
        self.assertEqual(job.status, 'error')

    def test_successful_task_flushes_tail_without_newline(self):
        self.configure()
        def task(job):
            print('最后半行', end='')
            return {'ok': True}
        with contextlib.redirect_stdout(io.StringIO()), patch.object(sys, '__stdout__', io.StringIO()):
            job = server.start_job('离线完成', task)
            self.wait_job(job)
        self.assertIn('最后半行', self.text())
        self.assertEqual(job.result, {'ok': True})

    def test_sensitive_values_are_redacted_after_fragmented_writes(self):
        self.configure()
        job = server.Job('脱敏')
        console = io.StringIO()
        tee = server.Tee(job, console)
        for chunk in ('Cookie', ': session=', 'COOKIE_SECRET; other=SECOND_COOKIE_SECRET\n', '解压密码：', 'ARCHIVE_SECRET\n',
                      'https://example.invalid/demo?pwd=', 'LINK_SECRET&x=1\n',
                      '{"access_token": "', 'TOKEN_SECRET"}\n', '提取码: ', 'CODE_SECRET'):
            tee.write(chunk)
            tee.flush()
        job.flush()
        with contextlib.redirect_stdout(io.StringIO()):
            server.log('Authorization: Bearer AUTH_SECRET')
            server.log('已导出 分发/演示目录【密码FILENAME_SECRET】.html')
            server.log('X-Helper-Token: HELPER_SECRET')
        text = self.text()
        for secret in ('COOKIE_SECRET', 'ARCHIVE_SECRET', 'LINK_SECRET', 'TOKEN_SECRET', 'CODE_SECRET', 'AUTH_SECRET', 'SECOND_COOKIE_SECRET', 'FILENAME_SECRET', 'HELPER_SECRET'):
            self.assertNotIn(secret, text)
        self.assertIn('[已隐藏]', text)
        self.assertIn('COOKIE_SECRET', console.getvalue())
        self.assertIn('CODE_SECRET', '\n'.join(job.lines))

    def test_keeps_today_and_previous_thirteen_days_across_date_change(self):
        import helper_logs
        directory = self.root / '日志'
        directory.mkdir()
        for day in ('20260101', '20260102', '20260114', '20260115'):
            (directory / f'小助手-{day}.log').write_text('旧记录\n', encoding='utf-8')
        (directory / '其他.log').write_text('保留', encoding='utf-8')
        logger = self.configure()
        class Clock(datetime):
            current = datetime(2026, 1, 15, 10, 0)
            @classmethod
            def now(cls): return cls.current
        with patch.object(helper_logs, 'datetime', Clock):
            logger.write('今天')
            self.assertFalse((directory / '小助手-20260101.log').exists())
            self.assertTrue((directory / '小助手-20260102.log').exists())
            Clock.current = datetime(2026, 1, 16, 0, 1)
            logger.write('新一天')
        self.assertFalse((directory / '小助手-20260102.log').exists())
        self.assertIn('新一天', (directory / '小助手-20260116.log').read_text(encoding='utf-8'))
        self.assertEqual((directory / '其他.log').read_text(encoding='utf-8'), '保留')

    def test_main_uses_actual_root_and_records_missing_master(self):
        with patch.object(sys, 'argv', ['server.py', '--root', str(self.root), '--no-browser']), patch.object(sys, 'stdin', None), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(server.main(), 1)
        self.assertIn('找不到母版', self.text())
        self.assertIn('小助手已退出', self.text())

    def test_startup_exception_is_logged_with_traceback_and_redacted(self):
        with patch.object(sys, 'argv', ['server.py', '--root', str(self.root)]), patch.object(server, 'run_helper', side_effect=ValueError('Cookie: STARTUP_SECRET')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(server.main(), 1)
        self.assertIn('Traceback (most recent call last)', self.text())
        self.assertIn('ValueError', self.text())
        self.assertNotIn('STARTUP_SECRET', self.text())


if __name__ == '__main__':
    unittest.main()
