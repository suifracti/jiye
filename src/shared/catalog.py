"""母版共享记录压缩格式，与浏览器读写一致。"""
import base64,json,zlib

def pack(records):
    sources=[{k:v for k,v in r.items() if k!='source_record'} for r in records]
    value={'format':'catalog-shared-v1','strings':[],'data':[sources,[{} for _ in sources]]}
    return {'format':'catalog-shared-v1','codec':'deflate-base64','data':base64.b64encode(zlib.compress(json.dumps(value,ensure_ascii=False,separators=(',',':')).encode())).decode()}

def unpack(value):
    if value.get('codec')=='deflate-base64':value=json.loads(zlib.decompress(base64.b64decode(value['data'])))
    strings=value.get('strings',[]);keys=value.get('keys')
    def decode(x):
        if isinstance(x,str):return strings[int(x[2:])] if x.startswith('~@') else x[1:] if x.startswith('~~') else x
        if isinstance(x,list):return [decode(v) for v in x]
        if isinstance(x,dict):return {(keys[int(k)] if keys else k):decode(v) for k,v in x.items()}
        return x
    sources,deltas=decode(value['data']);return [dict(a,**b) for a,b in zip(sources,deltas)]
