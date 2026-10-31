"""小助手本机文件日志：每日追加，保留今天及之前 13 天。"""
from datetime import datetime, timedelta
from pathlib import Path
import re
import threading

# 敏感字段后整段隐藏，Cookie 多个键、带空格密码和 URL 片段也不会漏出。
_SECRET = re.compile(
    r'(?i)(?:解压密码|提取密码|提取码|访问码|解压口令|提取口令|密码)\s*(?:[：:=]|为|是)?\s*.*'
    r'|(?:[\w-]*(?:password|passcode|cookie|token|api[_-]?key)|authorization|pwd)'
    r'[\"\']?\s*(?:[：:=]|%3[dD]|\s)\s*.*'
)
_URL_LOGIN = re.compile(r'(https?://)[^/@\s]+:[^/@\s]+@', re.I)


def redact(text):
    text = _URL_LOGIN.sub(r'\1[已隐藏]@', str(text))
    return _SECRET.sub('[已隐藏]', text)


class DailyLog:
    def __init__(self, root):
        self.directory = Path(root) / '日志'
        self.lock = threading.Lock()
        self.cleaned_day = None

    def write(self, text):
        with self.lock:
            now = datetime.now()
            today = now.date()
            self.directory.mkdir(parents=True, exist_ok=True)
            if self.cleaned_day != today:
                oldest = today - timedelta(days=13)
                for path in self.directory.glob('小助手-????????.log'):
                    try:
                        day = datetime.strptime(path.stem.removeprefix('小助手-'), '%Y%m%d').date()
                        if day < oldest:
                            path.unlink()
                    except (ValueError, OSError):
                        pass
                self.cleaned_day = today
            path = self.directory / f'小助手-{now:%Y%m%d}.log'
            with path.open('a', encoding='utf-8') as stream:
                for line in str(text).splitlines():
                    stream.write(f'{now:%H:%M:%S} {redact(line)}\n')
