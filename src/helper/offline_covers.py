"""离线导出只代读已有图片网址；压成小图仍由浏览器完成。"""
import base64
import os
import ssl
import urllib.parse
import urllib.request
from src.sources.http import public_open, validate_public_url


def download_cover(url):
    url = str(url or '').strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        raise ValueError('封面地址要以 http:// 或 https:// 开头')
    context = ssl.create_default_context()
    # 部分 macOS Python 未带默认 CA 路径，补用系统证书，照常验证 HTTPS。
    if os.path.isfile('/etc/ssl/cert.pem'):
        context.load_verify_locations('/etc/ssl/cert.pem')
    validate_public_url(url)
    referer = f'{parsed.scheme}://{parsed.netloc}/'
    request = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0', 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.5', 'Referer': referer,
    })
    with public_open(request, timeout=15, context=context) as response:
        content_type = response.headers.get_content_type()
        if not content_type.startswith('image/'):
            raise ValueError('这个地址返回的不是图片（可能被网站拦住了）')
        data = response.read(16 * 1024 * 1024 + 1)
    if not data:
        raise ValueError('封面内容为空')
    if len(data) > 16 * 1024 * 1024:
        raise ValueError('原封面超过 16 MB，换一张小图后再试')
    return f'data:{content_type};base64,' + base64.b64encode(data).decode('ascii')
