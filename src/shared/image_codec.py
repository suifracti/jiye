"""普通压缩图片存储 img2；enc1 仅作为只读迁移格式。"""
import base64
import re
import zlib
LEGACY_KEY = b'catalog-images-v1'
PATTERN = re.compile(r'^data:(image/[\w.+-]+);base64,([\s\S]+)$')

def encode(value):
    m = PATTERN.match(value)
    if not m:
        return value
    mime = m[1].encode('ascii')
    raw = bytes([len(mime)]) + mime + base64.b64decode(m[2])
    packed = zlib.compress(raw)
    text = base64.urlsafe_b64encode(packed).decode().rstrip('=')
    return 'img2:' + '.'.join(text[i:i+40] for i in range(0, len(text), 40))

def protect(value):
    if isinstance(value, str):
        return encode(value)
    if isinstance(value, list):
        return [protect(x) for x in value]
    if isinstance(value, dict):
        return {k: protect(v) for k, v in value.items()}
    return value


def decode(value):
    if not isinstance(value,str) or not value.startswith(('img2:','enc1:')): return value
    text=value[5:].replace('.','')
    packed=base64.urlsafe_b64decode(text+'='*((4-len(text)%4)%4))
    if value.startswith('enc1:'): packed=bytes(b ^ LEGACY_KEY[i % len(LEGACY_KEY)] for i,b in enumerate(packed))
    raw=zlib.decompress(packed); length=raw[0]
    return 'data:'+raw[1:1+length].decode('ascii')+';base64,'+base64.b64encode(raw[1+length:]).decode('ascii')

def restore(value):
    if isinstance(value,str): return decode(value)
    if isinstance(value,list): return [restore(x) for x in value]
    if isinstance(value,dict): return {k:restore(v) for k,v in value.items()}
    return value
