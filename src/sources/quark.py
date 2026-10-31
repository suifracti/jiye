"""Optional read-only share browsing; tokens live only for the current job."""
from collections import deque
from copy import deepcopy
import re
import urllib.parse
import urllib.error
import json
import hashlib
import http.client
import os
import time
from pathlib import Path
from .base import json_request
from .http import retry_request, validate_public_url
from .base import title_key, query_names

class ScanError(RuntimeError):
    def __init__(self,status,message): super().__init__(message); self.status=status

def parse_quark_share_info(url):
    parsed=urllib.parse.urlparse(str(url or '').strip())
    if parsed.scheme!='https' or parsed.hostname!='pan.quark.cn': return None
    match=re.fullmatch(r'/s/([A-Za-z0-9_-]+)/?',parsed.path)
    if not match: return None
    return match[1],urllib.parse.parse_qs(parsed.query).get('pwd',[''])[0]

def is_exact_code_match(code,folder_name):
    code=str(code or '').strip(); name=str(folder_name or '').strip()
    return bool(code and (code.casefold()==name.casefold() or re.search(r'(?:^|[\s_\[\(【])'+re.escape(code)+r'(?:[\s_\]\)】.\-]|$)',name,re.I)))

_is_exact_code_match=is_exact_code_match

def _date_keys(text):
    dates=[]
    for month,day in re.findall(r'(?<!\d)(\d{1,2})[./月-](\d{1,2})(?:日)?(?!\d)',str(text or '')):
        if 1<=int(month)<=12 and 1<=int(day)<=31: dates.append(f'{int(month)}.{int(day):02d}')
    return dates

def date_folders(folders):
    grouped={}
    for folder in folders:
        for date in _date_keys(folder.get('name')): grouped.setdefault(date,[]).append(folder)
    return grouped

def crawl_share(page_loader,max_depth=6,target_codes=None,page_size=50,cancelled=None):
    """Traverse a permitted read-only adapter; metadata._total takes precedence."""
    folders=[]; queue=deque([('0','',0)]); by_fid={}; visited=set(); requests=0
    max_depth=max(1,int(max_depth)); page_size=max(1,int(page_size))
    while queue:
        fid,path,depth=queue.popleft()
        if fid in visited: continue
        visited.add(fid); page=1; seen=0
        while True:
            if cancelled and cancelled(): raise ScanError('cancelled','扫描已取消')
            response=page_loader(fid,page,page_size) or {}; requests+=1
            if response.get('status') not in (None,0,200,'ok','success') or response.get('code') not in (None,0,200):
                raise ScanError('access_denied','目录读取被来源拒绝，请检查授权或提取码')
            data=response.get('data') or {}; items=data.get('list') or []
            if not isinstance(items,list): raise ScanError('invalid_response','目录列表格式不正确')
            total=(response.get('metadata') or {}).get('_total')
            if total is None: total=data.get('_total')
            try: total=int(total or 0)
            except (TypeError,ValueError): total=0
            seen+=len(items)
            for item in items:
                if item.get('file_type')!=0 and item.get('is_dir') is not True:
                    if fid in by_fid:
                        by_fid[fid]['has_files']=True; by_fid[fid]['file_count']+=1
                    continue
                child=str(item.get('fid') or item.get('id') or '')
                name=str(item.get('file_name') or item.get('name') or '')
                if not child or not name: continue
                if child in by_fid: continue
                folder={'fid':child,'name':name,'path':path+'/'+name,'parent_fid':fid,
                        'depth':depth+1,'has_files':False,'file_count':0}
                folders.append(folder); by_fid[child]=folder
                parent=by_fid.get(fid)
                target=target_codes is None or any(is_exact_code_match(c,name) for c in target_codes)
                code_name=lambda text:bool(re.fullmatch(r'[A-Za-z]{1,8}\d[A-Za-z0-9_-]{2,}',text))
                is_code=code_name(name) or (target_codes is not None and target)
                same_nested=bool(parent and name.casefold()==parent['name'].casefold())
                inside_code=bool(parent and (code_name(parent['name']) or target_codes is not None and any(is_exact_code_match(c,parent['name']) for c in target_codes)))
                descend=(target if is_code else not inside_code) or same_nested
                if descend and (depth+1<max_depth or is_code and target and depth+1==max_depth or same_nested and depth+1<max_depth+2):
                    queue.append((child,folder['path'],depth+1))
            if not items or total and seen>=total or not total and len(items)<page_size: break
            page+=1
    return folders,requests

def folder_url(share_id,passcode,fid):
    if not share_id or not fid: return ''
    query='?'+urllib.parse.urlencode({'pwd':passcode}) if passcode else ''
    return 'https://pan.quark.cn/s/'+urllib.parse.quote(share_id,safe='')+query+'#/list/share/'+urllib.parse.quote(str(fid),safe='')

def record_fid(record):
    fid=str(record.get('quark_folder_fid') or '')
    if not fid:
        match=re.search(r'(?:^|/)list/share/([^/?]+)',urllib.parse.urlsplit(str(record.get('quark_location_url') or '')).fragment)
        if match:fid=urllib.parse.unquote(match[1])
    return fid


def match_record_quark_folder(record,share_folders,pwd_id='',pwd=''):
    if record.get('quark_location_manual') and record.get('quark_location_url'):
        return 'matched',record['quark_location_url'],record.get('quark_real_path',''),record_fid(record),[]
    code=record.get('code') or record.get('id') or ''
    matches=[f for f in share_folders if is_exact_code_match(code,f.get('name'))]
    def selected(folder):
        return 'matched',folder_url(pwd_id,pwd,folder.get('fid')),folder.get('path',''),folder.get('fid',''),[]
    if len(matches)==1: return selected(matches[0])
    if matches:
        dates=set(d for field in ('raw_title','title','category_raw','category','date_short','date_label','added_date','updated_date') for d in _date_keys(record.get(field)))
        dated=[f for f in matches if dates.intersection(_date_keys(f.get('path')))]
        if len(dated)==1:return selected(dated[0])
        considered=dated or matches
        with_files=[f for f in considered if f.get('has_files') or f.get('file_count',0)>0]
        if len(with_files)==1:return selected(with_files[0])
        return 'ambiguous','','','',[dict(f,match='code') for f in considered]
    keys={title_key(n) for n in query_names(record) if len(title_key(n))>=4}
    candidates=[]
    for folder in share_folders:
        key=title_key(re.sub(r'\bv(?:er)?\.?\s*\d+(?:\.\d+)*','',folder.get('name',''),flags=re.I))
        if any(key==name or min(len(key),len(name))>=6 and (key.startswith(name) or name.startswith(key)) for name in keys):
            candidates.append(dict(folder,match='name'))
    # A near spelling remains a manual candidate; never silently change an ID.
    if not candidates and code:
        normalize=lambda value:re.sub(r'[^a-z0-9]','',str(value).lower())
        hint=normalize(code)
        candidates=[dict(f,match='code_hint') for f in share_folders if len(hint)>=6 and hint==normalize(f.get('name'))]
    return ('ambiguous','','','',candidates) if candidates else ('not_found','','','',[])

def scan_records(records,page_loader=None,share_url='',authorized=False,listing=None,max_depth=6,page_size=50,cancelled=None):
    records=deepcopy(records); folders=[]; requests=0; status='ok'; error=''
    share=parse_quark_share_info(share_url) or ('','')
    if listing is not None:
        folders=[deepcopy(f) for f in listing if isinstance(f,dict)]
        for folder in folders:
            folder.setdefault('name',folder.get('file_name','')); folder.setdefault('path','/'+folder['name'])
            folder.setdefault('fid',folder.get('id',''))
    elif not authorized:
        status='authorization_required'; error='联网目录适配器需要提供方许可及用户授权；也可导入目录 JSON'
    elif page_loader is None:
        status='adapter_required'; error='请启用分享读取，或导入目录 JSON'
    else:
        try:
            targets=[r.get('code') or r.get('id') for r in records if not r.get('quark_location_manual')]
            folders,requests=crawl_share(page_loader,max_depth,targets,page_size,cancelled)
        except ScanError as exc:status=exc.status;error=str(exc)
        except (OSError,TimeoutError,EOFError,http.client.HTTPException):status='network_error';error='目录来源暂时无法连接'
        except (KeyError,ValueError,TypeError):status='invalid_response';error='目录来源格式有变化'
        except Exception:status='adapter_error';error='目录适配器读取失败'
    for record in records:
        if status!='ok':
            record['quark_scan_status']=status
            if not record.get('quark_location_url'):record['quark_location_status']=status
            continue
        matched,url,path,fid,candidates=match_record_quark_folder(record,folders,*share)
        record['quark_location_status']=matched;record['quark_scan_status']='ok'
        record['quark_location_candidates']=candidates
        if matched=='matched': record.update(quark_location_url=url,quark_real_path=path,quark_folder_fid=fid)
    dates={date:folder_url(*share,values[0]['fid']) for date,values in date_folders(folders).items() if len(values)==1}
    return {'records':records,'folders':folders,'dates':dates,'status':status,'error':error,'requests':requests}


def _validate_response(response):
    if not isinstance(response,dict):raise ScanError('invalid_response','分享返回格式有变化')
    status=response.get('status');code=response.get('code')
    if status in (None,0,200,'ok','success') and code in (None,0,200):return response
    if status in (401,403,429) or code in (401,403,429):
        raise ScanError('blocked','分享访问被限制，请稍后重试或检查提取码')
    message=str(response.get('message') or response.get('msg') or '')
    if str(code) in ('41002','41003','41004','41017') or any(word in message for word in ('已失效','已取消','已过期','不存在','已删除','违规')):
        raise ScanError('invalid_share','分享已失效或已停止分享')
    if str(code) in ('41006','41008') or any(word in message for word in ('提取码','密码错误')):
        raise ScanError('access_denied','分享提取码不正确')
    if isinstance(status,int) and status>=500:raise urllib.error.URLError('分享服务暂时不可用')
    raise ScanError('source_error','分享暂时无法读取，请稍后重试')


class QuarkShareClient:
    """Read the share supplied by an opted-in user; no login cookie is needed."""
    def __init__(self,share_url,enabled=False,transport=None,min_interval=.35,cancelled=None):
        self.share=parse_quark_share_info(share_url)
        self.enabled=enabled;self.transport=transport or json_request
        self.min_interval=max(0,float(min_interval));self.cancelled=cancelled
        self.token='';self.last=0;self.requests=0
    def _request(self,url,payload=None):
        if not self.enabled:raise ScanError('disabled','分享模块未启用，未联网')
        if not self.share:raise ScanError('invalid_url','请填写完整的分享网址')
        def once():
            if self.cancelled and self.cancelled():raise ScanError('cancelled','已取消')
            delay=self.min_interval-(time.monotonic()-self.last)
            if delay>0:time.sleep(delay)
            self.last=time.monotonic();self.requests+=1
            response=self.transport(url,payload=payload,headers={'Referer':'https://pan.quark.cn/','User-Agent':'Mozilla/5.0'})
            return _validate_response(response)
        try:return retry_request(once,self.cancelled)
        except InterruptedError as error:raise ScanError('cancelled','已取消') from error
        except urllib.error.HTTPError as error:
            code=error.code;error.close()
            raise ScanError('blocked' if code in (401,403,429) else 'network_error',f'分享服务 HTTP {code}') from None
        except (OSError,EOFError,http.client.HTTPException) as error:raise ScanError('network_error','分享服务暂时无法连接') from error
    def check_share(self):
        if not self.token:
            response=self._request('https://drive-h.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc',
                                   {'pwd_id':self.share[0] if self.share else '', 'passcode':self.share[1] if self.share else ''})
            self.token=str((response.get('data') or {}).get('stoken') or '')
            if not self.token:raise ScanError('invalid_response','分享没有返回临时读取令牌')
        return {'status':'ok'}
    def page(self,parent_id,page,page_size):
        self.check_share()
        query=urllib.parse.urlencode({'pr':'ucpro','fr':'pc','ver':'2','pwd_id':self.share[0],'stoken':self.token,
                                     'pdir_fid':parent_id,'_page':page,'_size':page_size,'_fetch_total':1})
        return self._request('https://drive-h.quark.cn/1/clouddrive/share/sharepage/detail?'+query)


class TemplateShareClient:
    """Optional user-configured HTTP bridge with the same listing response shape."""
    def __init__(self,share_url,config,cancelled=None):
        self.share=parse_quark_share_info(share_url);self.url=share_url;self.config=config
        self.cancelled=cancelled;self.requests=0
        if config.get('authorized') is not True:raise ScanError('authorization_required','自定义目录接口尚未授权')
    def _request(self,template,parent_id='0',page=1,page_size=50):
        if not template:raise ScanError('unconfigured','自定义接口未填写网址')
        values={'share_id':self.share[0] if self.share else '', 'share_url':self.url,
                'parent_id':parent_id,'page':page,'page_size':page_size}
        url=template
        for key,value in values.items():url=url.replace('{'+key+'}',urllib.parse.quote(str(value),safe=''))
        def once():
            validate_public_url(url)
            self.requests+=1
            return _validate_response(json_request(url))
        return retry_request(once,self.cancelled)
    def check_share(self):
        response=self._request(self.config.get('share_check_url') or self.config.get('list_url'))
        return {'status':'ok'} if response else {'status':'network_error'}
    def page(self,parent_id,page,page_size):return self._request(self.config.get('list_url'),parent_id,page,page_size)


class ScanCache:
    """Only directory entries and continuation positions; never tokens or URLs."""
    def __init__(self,path=None):
        self.path=Path(path) if path else None;self.values={}
        if self.path:
            try:
                value=json.loads(self.path.read_text(encoding='utf-8'))
                if isinstance(value,dict):self.values=value
            except (OSError,ValueError):pass
    def save(self,key,state):
        self.values[key]=deepcopy(state)
        if self.path:
            try:
                self.path.parent.mkdir(parents=True,exist_ok=True)
                tmp=self.path.with_suffix('.tmp')
                tmp.write_text(json.dumps(self.values,ensure_ascii=False),encoding='utf-8');os.replace(tmp,self.path)
            except OSError:pass
    def forget_completed(self):
        self.values={key:value for key,value in self.values.items() if not value.get('complete')}
        if self.path:
            try:self.path.write_text(json.dumps(self.values,ensure_ascii=False),encoding='utf-8')
            except OSError:pass


def scan_key(share_url,config=None):
    return hashlib.sha256(json.dumps([share_url,config or {}],sort_keys=True).encode()).hexdigest()


def _tree_result(state,status='ok',error=''):
    folders=[deepcopy(node) for node in state['nodes'].values() if node['file_type']==0]
    files=[deepcopy(node) for node in state['nodes'].values() if node['file_type']!=0]
    by_fid={folder['fid']:folder for folder in folders}
    for folder in folders:folder.update(file_count=0,size_bytes=0,size_complete=True)
    for file in files:
        size=file.get('size');parent=file.get('parent_fid');visited=set()
        while parent in by_fid and parent not in visited:
            visited.add(parent);folder=by_fid[parent];folder['file_count']+=1
            if isinstance(size,(int,float)) and not isinstance(size,bool) and size>=0:folder['size_bytes']+=size
            else:folder['size_complete']=False
            parent=folder.get('parent_fid')
    for folder in folders:folder['has_files']=folder['file_count']>0
    return {'folders':folders,'files':files,'complete':bool(state.get('complete')),
            'status':status,'error':error,'requests':state.get('requests',0)}


def imported_tree(listing):
    if isinstance(listing,list):listing={'folders':listing,'complete':False}
    nodes={}
    for kind in ('folders','files'):
        for item in listing.get(kind) or []:
            if not isinstance(item,dict):continue
            node=deepcopy(item);fid=str(node.get('fid') or node.get('id') or '')
            if not fid:continue
            node.update(fid=fid,name=str(node.get('name') or node.get('file_name') or ''),
                        file_type=0 if kind=='folders' else 1,parent_fid=str(node.get('parent_fid') or '0'))
            node.setdefault('path','/'+node['name']);nodes[fid]=node
    return _tree_result({'nodes':nodes,'complete':listing.get('complete') is True,'requests':0})


def scan_tree(page_loader,cache=None,key='',page_size=50,cancelled=None,min_interval=.35,progress=None,force=False):
    cache=cache or ScanCache()
    state=deepcopy(cache.values.get(key)) if key and not force else None
    if not state:state={'nodes':{},'queue':[{'fid':'0','path':'','page':1,'seen':[]}],'visited':['0'],'requests':0,'complete':False}
    if state.get('complete'):return _tree_result(state)
    last=0
    try:
        while state['queue']:
            if cancelled and cancelled():raise ScanError('cancelled','扫描已取消，下次继续')
            current=state['queue'][0];delay=min_interval-(time.monotonic()-last)
            if delay>0:time.sleep(delay)
            last=time.monotonic()
            response=_validate_response(page_loader(current['fid'],current['page'],page_size));state['requests']+=1
            data=response.get('data')
            if not isinstance(data,dict) or not isinstance(data.get('list'),list):raise ScanError('invalid_response','分享目录列表格式有变化')
            items=data['list'];total=(response.get('metadata') or {}).get('_total',data.get('_total'))
            try:total=int(total) if total is not None else None
            except (TypeError,ValueError):raise ScanError('invalid_response','分享目录条数格式有变化')
            added=0
            for item in items:
                if not isinstance(item,dict):raise ScanError('invalid_response','分享目录条目格式有变化')
                fid=str(item.get('fid') or item.get('id') or '');name=str(item.get('file_name') or item.get('name') or '')
                if not fid or not name:raise ScanError('invalid_response','分享目录条目缺少编号或文件名')
                if fid in current['seen']:continue
                current['seen'].append(fid);added+=1
                is_dir=item.get('file_type')==0 or item.get('is_dir') is True or item.get('dir') is True
                node={k:deepcopy(item[k]) for k in ('size','ban','risk_type') if k in item}
                node.update(fid=fid,name=name,path=current['path']+'/'+name,parent_fid=current['fid'],file_type=0 if is_dir else 1)
                state['nodes'][fid]=node
                if is_dir and fid not in state['visited']:
                    state['visited'].append(fid);state['queue'].append({'fid':fid,'path':node['path'],'page':1,'seen':[]})
            if total is not None and len(current['seen'])<total and not added:
                raise ScanError('incomplete','目录分页未读完，下次继续')
            done=(total is not None and len(current['seen'])>=total) or total is None and len(items)<page_size
            if not added and items and not done:raise ScanError('incomplete','目录分页重复，下次继续')
            if done:state['queue'].pop(0)
            else:current['page']+=1
            state['complete']=not state['queue'];cache.save(key,state)
            if progress:progress(state['requests'],len(state['queue']))
        return _tree_result(state)
    except ScanError as error:status=error.status;message=str(error)
    except InterruptedError:status='cancelled';message='扫描已取消，下次继续'
    except (OSError,TimeoutError,EOFError,http.client.HTTPException):status='network_error';message='分享暂时无法连接，下次继续'
    except (ValueError,TypeError,KeyError):status='invalid_response';message='分享目录格式有变化，下次继续'
    cache.save(key,state)
    return _tree_result(state,status,message)


def _flagged(node):
    return str(node.get('ban') or '').lower() not in ('','0','false','none') or str(node.get('risk_type') or '').lower() not in ('','0','false','none')


def record_health(record,tree):
    fid=record_fid(record)
    nodes={str(node['fid']):node for node in tree['folders']+tree.get('files',[])}
    base={'scanComplete':tree.get('complete') is True}
    if not fid:return dict(base,status='unknown',reason='尚未定位作品文件夹')
    node=nodes.get(fid)
    if node and _flagged(node):return dict(base,status='banned',reason='分享返回了限制标记',ban=node.get('ban'),risk_type=node.get('risk_type'))
    # A restricted descendant also makes the work incomplete, even if other files remain.
    for child in nodes.values():
        parent=child.get('parent_fid');seen=set()
        while parent in nodes and parent not in seen:
            if parent==fid and _flagged(child):return dict(base,status='banned',reason='作品中有文件返回限制标记',ban=child.get('ban'),risk_type=child.get('risk_type'))
            seen.add(parent);parent=nodes[parent].get('parent_fid')
    if not tree.get('complete'):return dict(base,status='unknown',reason=tree.get('error') or '目录还没完整读完')
    if not node:return dict(base,status='missing',reason='完整目录中找不到原文件夹')
    if node.get('file_type')==0 and not node.get('file_count'):return dict(base,status='missing',reason='完整扫描后文件夹为空')
    return dict(base,status='ok',reason='作品文件可读取')
