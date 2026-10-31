"""Small, opt-in metadata adapters. No credentials or catalog data are bundled."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import http.client
import json
import re
import time
import unicodedata
import urllib.error
import urllib.request

from src.shared.product import SLUG, VERSION
from .http import retry_request

USER_AGENT = f'{SLUG}/{VERSION}'
LABELS = {'steam': 'Steam', 'bangumi': 'Bangumi'}

def source_key(value):
    return str(value or '').strip().lower()

def title_key(value):
    text = unicodedata.normalize('NFKC', str(value or '')).casefold()
    return ''.join(c for c in text if c.isalnum())

def query_names(record):
    if isinstance(record, str): return [record.strip()] if record.strip() else []
    values = [record.get(k) for k in ('name','title','raw_name','orig_title','en_title')]
    values += list(record.get('aliases') or [])
    return list(dict.fromkeys(str(v).strip() for v in values if str(v or '').strip()))

def title_confidence(names, candidate):
    """Exact normalized identity scores 1; partial titles stay reviewable candidates."""
    if isinstance(names, dict): names = query_names(names)
    if isinstance(names, str): names = [names]
    alternatives = query_names(candidate) if isinstance(candidate, dict) else [candidate]
    scores = []
    for name in names:
        a = title_key(name)
        for other in alternatives:
            b = title_key(other)
            if a and b:
                scores.append(1.0 if a == b else min(len(a),len(b))/max(len(a),len(b))*.8 if a in b or b in a else 0)
    return max(scores, default=0)

def json_request(url, payload=None, headers=None):
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
    request = urllib.request.Request(url, data=data, headers={'User-Agent': USER_AGENT, 'Accept':'application/json', **({'Content-Type':'application/json'} if data is not None else {}), **(headers or {})})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read(8 * 1024 * 1024 + 1).decode('utf-8'))

def result(source, status, info=None, candidates=None, reason='', retry_at=0):
    return {'source': source_key(source), 'status': status, 'info': info,
            'candidates': candidates or [], 'reason': reason, 'retry_at': retry_at}

class Source:
    key = 'custom'
    def __init__(self, enabled=False, transport=None, min_interval=1, **options):
        self.enabled = bool(enabled)
        self.transport = transport or json_request
        self.min_interval = max(0,float(min_interval))
        self.options = options
        self.cancelled = options.get('cancelled')
        self.retry_at = 0
        self.last_status = 'unchecked'
        self.last_request = 0
        self.requests = 0
    def search(self, title):
        if not str(title or '').strip(): return result(self.key,'insufficient_input',reason='请先填写名称')
        return self._call(lambda: self._search(str(title).strip()))
    def detail(self, source_id):
        if not str(source_id or '').strip(): return result(self.key,'insufficient_input',reason='请先填写资料编号')
        return self._call(lambda: self._detail(str(source_id).strip()))
    def cover(self, info):
        return {'url': (info or {}).get('cover_url') or (info or {}).get('cover',''), 'source':self.key,
                'redistribution_allowed': bool((info or {}).get('cover_redistribution_allowed')), 'license':(info or {}).get('cover_license','请核对具体图片权利')}
    def request(self, url, payload=None):
        def request_once():
            delay = self.last_request + self.min_interval - time.time()
            if delay > 0: time.sleep(delay)
            self.last_request = time.time()
            self.requests += 1
            return self.transport(url, payload=payload, headers={'User-Agent':USER_AGENT})
        return retry_request(request_once,self.cancelled)
    def _call(self, callback):
        if not self.enabled: return result(self.key,'disabled',reason='来源未启用，未联网')
        if self.retry_at > time.time(): return result(self.key,'cooldown',reason='来源冷却中，可稍后重试',retry_at=self.retry_at)
        try:
            value = callback()
            if not isinstance(value, dict) or 'status' not in value: raise ValueError('invalid result')
        except urllib.error.HTTPError as error:
            status = 'genuine_not_found' if error.code == 404 else 'rate_limited' if error.code == 429 else 'access_denied' if error.code in (401,403) else 'network_error'
            retry = error.headers.get('Retry-After','60') if error.headers else '60'
            delay = float(retry) if str(retry).isdigit() else 60
            self.retry_at = time.time() + max(delay,self.min_interval) if status in ('rate_limited','access_denied') else 0
            value = result(self.key,status,reason=f'HTTP {error.code}，保留现有资料',retry_at=self.retry_at)
            error.close()
        except (OSError, TimeoutError, EOFError, http.client.HTTPException):
            self.retry_at = 0
            value = result(self.key,'network_error',reason='来源暂时无法连接，保留现有资料')
        except (ValueError, TypeError, KeyError):
            value = result(self.key,'invalid_response',reason='来源返回格式有变化，保留现有资料')
        except Exception as error:
            value = result(self.key,'source_error',reason=type(error).__name__+'：来源处理失败，保留现有资料')
        self.last_status = value['status']
        self.retry_at = max(0,self.retry_at)
        value['retry_at'] = self.retry_at
        return value
    def _search(self, title): return result(self.key,'unsupported',reason='此来源未实现名称检索，可手填编号')
    def _detail(self, source_id): return result(self.key,'unsupported',reason='此来源未实现详情，可导入 JSON 资料')

class ManualJSONSource(Source):
    """User-supplied licensed metadata, no network. Arbitrary provider IDs stay intact."""
    def __init__(self, key='manual', records=None, **options):
        super().__init__(enabled=True,min_interval=0)
        self.key = source_key(key)
        self.records = []
        for row in records or []:
            if isinstance(row,dict) and str(row.get('source_id') or row.get('id') or '').strip():
                item = deepcopy(row)
                item.update(source=self.key,source_id=str(row.get('source_id') or row.get('id')))
                self.records.append(item)
    def _search(self,title):
        found = [deepcopy(r) for r in self.records if title_key(title) in title_key(r.get('name') or r.get('title'))]
        return result(self.key,'candidates' if found else 'genuine_not_found',candidates=found)
    def _detail(self,source_id):
        found = next((deepcopy(r) for r in self.records if r['source_id']==source_id),None)
        return result(self.key,'matched' if found else 'genuine_not_found',info=found)

class SourceRegistry:
    def __init__(self, sources=None): self.sources = {s.key:s for s in sources or []}
    def register(self, source): self.sources[source_key(source.key)] = source; return source
    def search(self, source, title):
        adapter=self.sources.get(source_key(source))
        return adapter.search(title) if adapter else result(source,'unconfigured',reason='来源未配置，可导入自定义 JSON 资料')
    def detail(self, source, source_id):
        adapter=self.sources.get(source_key(source))
        return adapter.detail(source_id) if adapter else result(source,'unconfigured',reason='来源未配置，保留手填编号')

class FetchMode(str):
    def __new__(cls,value='missing',sources=None,retry_not_found=False):
        obj=super().__new__(cls,value); obj.sources=sources or []; obj.retry_not_found=retry_not_found; return obj

def web_links(info):
    if not isinstance(info,dict): return []
    values = ([info] if info.get('url') else []) + list(info.get('links') or [])
    found={}
    for entry in values:
        if isinstance(entry,dict) and entry.get('source') and entry.get('url'):
            clean={k:deepcopy(v) for k,v in entry.items() if k not in ('links','field_sources')}
            found[(source_key(clean['source']),clean['url'])]=clean
    return list(found.values())

def source_info(info,source):
    return next((v for v in web_links(info) if source_key(v['source'])==source_key(source)),{})

def manual_id_source(record):
    if record.get('source_id_origin')=='manual' or record.get('source_id_manual'):
        return source_key(record.get('source') or (record.get('web_info') or {}).get('site'))
    info=record.get('web_info') or {}
    if info.get('source')=='manual': return source_key(info.get('site') or ('steam' if info.get('appid') else ''))
    return ''

def record_source_id(record,source):
    key=source_key(source); info=record.get('web_info') or {}; entry=source_info(info,key)
    values=record.get('source_ids') or {}
    direct=record.get('source_id') if source_key(record.get('source'))==key else None
    if isinstance(values,dict): direct=direct or values.get(key) or values.get(LABELS.get(key,''))
    if isinstance(direct,dict): direct=direct.get('id') or direct.get('source_id')
    return str(direct or entry.get('source_id') or (info.get('source_id') if source_key(info.get('site') or info.get('source'))==key else '') or (info.get('appid') if key=='steam' else info.get('bangumi_id') if key=='bangumi' else '') or '')

def merge_web_info(old,new,refresh=False):
    old=deepcopy(old or {})
    if not new: return old
    if old.get('source')=='manual' or old.get('origin')=='manual':
        site=source_key(old.get('site') or (old.get('source') if old.get('source')!='manual' else '') or ('steam' if old.get('appid') else ''))
        new_id=str(new.get('source_id') or new.get('appid') or new.get('bangumi_id') or '')
        old_id=str(old.get('source_id') or old.get('appid') or old.get('bangumi_id') or '')
        if site!=source_key(new.get('source')) or new_id!=old_id: return old
        protected={'source','site','source_id','appid','bangumi_id','url','origin','links'}
        old.update({k:deepcopy(v) for k,v in new.items() if k not in protected and v not in ('',None,[]) and (old.get('field_sources') or {}).get(k)!='manual'})
        if not old.get('url') and new.get('url'):old['url']=new['url']
    else:
        for key,value in new.items():
            if value not in ('',None,[]) and (refresh or not old.get(key)) and (old.get('field_sources') or {}).get(key)!='manual': old[key]=deepcopy(value)
    links={(source_key(v['source']),v['url']):v for v in web_links(old)}
    links.update({(source_key(v['source']),v['url']):v for v in web_links(new)})
    old['links']=list(links.values())
    return old

def compute_query_fingerprint(record):
    payload=[query_names(record),record.get('source'),record.get('source_id'),record.get('source_ids')]
    return hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:24]

def record_needs_check(record,source,mode='missing',retry_not_found=False):
    check=(record.get('source_checks') or {}).get(source_key(source)) or {}
    if check.get('retry_at',0)>time.time():return False
    if str(mode)=='refresh':return True
    if check.get('query_fingerprint')!=compute_query_fingerprint(record):return True
    if check.get('status')=='genuine_not_found' and not retry_not_found:
        try:
            checked=datetime.fromisoformat(check.get('checked_at','').replace('Z','+00:00')).timestamp()
            if time.time()-checked<3*24*60*60:return False
        except (ValueError,TypeError):pass
    if check.get('status')=='matched' and source_info(record.get('web_info'),source):return False
    return True

def enrich_record(record,registry,sources=None,refresh=False,retry_not_found=False):
    selected=manual_id_source(record)
    sources=[selected] if selected else (sources if sources is not None else list(registry.sources))
    for source in sources:
        key=source_key(source); source_id=record_source_id(record,key)
        if not record_needs_check(record,key,'refresh' if refresh else 'missing',retry_not_found):continue
        if selected or source_id:
            response=registry.detail(key,source_id)
        else:
            names=query_names(record)
            response=registry.search(key,names[0] if names else '')
            candidates=response.get('candidates',[])
            exact=[v for v in candidates if title_confidence(names,v)==1]
            if len(exact)==1:
                response=registry.detail(key,exact[0]['source_id'])
            elif candidates: response.update(status='ambiguous',reason='候选需要人工确认')
        check={k:deepcopy(v) for k,v in response.items() if k not in ('info','source')}
        check['checked_at']=datetime.now(timezone.utc).isoformat(timespec='seconds')
        check['query_fingerprint']=compute_query_fingerprint(record)
        record.setdefault('source_checks',{})[key]=check
        info=response.get('info')
        if response['status']=='matched' and info:
            prior=record.get('web_info') or {}
            record['web_info']=merge_web_info(prior,info,refresh=refresh)
            for field in record.get('manual_fields') or []:
                if field in prior:record['web_info'][field]=deepcopy(prior[field])
            record.setdefault('source_ids',{})[key]=info.get('source_id','')
            for field in ('name','summary','maker','cover','cover_url'):
                manual=field in (record.get('manual_fields') or []) or record.get(field+'_source')=='manual'
                if not manual and info.get(field) and (refresh or not record.get(field)): record[field]=info[field]
            check['query_fingerprint']=compute_query_fingerprint(record)
    return record
