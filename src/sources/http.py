"""Minimal external-site guard shared by image and reference-page downloads."""
import ipaddress
import socket
import urllib.parse
import urllib.request
import urllib.error

def validate_public_url(url):
    parsed=urllib.parse.urlsplit(str(url or ''))
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('仅支持无账号信息的 http/https 外部网址')
    if parsed.port not in (None,80,443): raise ValueError('仅支持常规网页端口')
    host=parsed.hostname
    try: addresses=[ipaddress.ip_address(host)]
    except ValueError:
        try: addresses=[ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host,parsed.port or (443 if parsed.scheme=='https' else 80),type=socket.SOCK_STREAM)]
        except socket.gaierror as exc: raise urllib.error.URLError('网站域名暂时无法解析') from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError('不能访问本机、私网或保留地址')
    return str(url)

class PublicRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,msg,headers,newurl):
        validate_public_url(newurl)
        return super().redirect_request(request,fp,code,msg,headers,newurl)

def public_open(request,timeout=20,context=None):
    url=request.full_url if isinstance(request,urllib.request.Request) else request
    validate_public_url(url)
    handlers=[PublicRedirectHandler()]
    if context is not None:handlers.append(urllib.request.HTTPSHandler(context=context))
    return urllib.request.build_opener(*handlers).open(request,timeout=timeout)


def retry_request(callback, cancelled=None, retries=2):
    """Retry a transient connection twice; access/rate limits return immediately."""
    import http.client
    import time
    import urllib.error
    for attempt in range(retries + 1):
        if cancelled and cancelled(): raise InterruptedError('已取消')
        try: return callback()
        except urllib.error.HTTPError as error:
            if error.code not in (408,425,500,502,503,504) or attempt==retries: raise
            error.close()
        except (OSError,TimeoutError,EOFError,http.client.HTTPException):
            if attempt==retries: raise
        for _ in range((attempt+1)*5):
            if cancelled and cancelled():raise InterruptedError('已取消')
            time.sleep(.2)
