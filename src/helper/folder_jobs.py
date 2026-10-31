"""Small job wrappers around the optional read-only folder source."""
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from src.sources.quark import (ScanCache, ScanError, QuarkShareClient, TemplateShareClient,
    scan_tree, scan_key, imported_tree, match_record_quark_folder, parse_quark_share_info,
    folder_url, date_folders, record_health, record_fid)
from src.sources.http import retry_request, public_open

CACHE_PATH=Path(__file__).resolve().parent/'.folder-scan-progress.json'


def enabled(payload):return (payload.get('modules') or {}).get('quark') is True


def client_for(url,payload,job):
    config=payload.get('quarkConfig') or {}
    if config.get('list_url') or config.get('share_check_url'):return TemplateShareClient(url,config,lambda:job.cancelled)
    return QuarkShareClient(url,enabled=True,cancelled=lambda:job.cancelled)


def progress(job,text,done=0,total=0):job.progress={'text':text,'done':done,'total':total}


def _share_records(share):return share.get('records') or []


def run_folders(job,payload,mode='scan',keep_cache=False):
    result={'records':{},'summary':[],'sizes':{},'sizeErrors':{},'checkedAt':datetime.now().isoformat(timespec='seconds'),'cancelled':False}
    if not enabled(payload):return dict(result,status='disabled',note='分享模块未启用，未联网')
    shares=[]
    for source_share in payload.get('shares') or []:
        groups={source_share.get('quark') or '':[]}
        origin=parse_quark_share_info(source_share.get('quark'))
        for record in _share_records(source_share):
            direct=parse_quark_share_info(record.get('quark_location_url')) if record.get('quark_location_manual') else None
            target=record.get('quark_location_url','').split('#',1)[0] if direct and direct!=origin and not payload.get('forceRescan') else source_share.get('quark') or ''
            groups.setdefault(target,[]).append(record)
        for url,records in groups.items():
            if records:shares.append(dict(source_share,quark=url,records=records,_alternate=url!=(source_share.get('quark') or '')))
    cache=ScanCache(CACHE_PATH);listings=payload.get('folderListings') or {}
    for index,share in enumerate(shares):
        if job.cancelled:break
        identifier=share.get('id','');url=share.get('quark') or '';info=parse_quark_share_info(url)
        listing=listings.get(info[0]) if info else None
        if listing is None and not share.get('_alternate'):listing=listings.get(str(identifier))
        records=deepcopy(_share_records(share));force=payload.get('forceRescan') is True
        progress(job,f'分享目录 {index+1}/{len(shares)}',index,len(shares))
        if listing is not None:tree=imported_tree(listing)
        else:
            try:
                client=client_for(url,payload,job)
                tree=scan_tree(client.page,cache=cache,key=scan_key(url,payload.get('quarkConfig')),
                    cancelled=lambda:job.cancelled,
                    progress=lambda done,left:progress(job,f'分享目录 {index+1}/{len(shares)} · 已读 {done} 页，待扫 {left} 个文件夹',index,len(shares)))
            except ScanError as error:tree={'folders':[],'files':[],'complete':False,'status':error.status,'error':str(error),'requests':0}
            except (OSError,ValueError):tree={'folders':[],'files':[],'complete':False,'status':'network_error','error':'分享暂时无法读取','requests':0}
        counts={'matched':0,'ambiguous':0,'not_found':0}
        by_fid={str(folder['fid']):folder for folder in tree['folders']}
        for record in records:
            if force:
                for key in ('quark_location_manual','quark_location_url','quark_folder_fid','quark_real_path'):record.pop(key,None)
            state,url_out,path,fid,candidates=match_record_quark_folder(record,tree['folders'],*(info or ('','')))
            if tree['status']!='ok' and state!='matched':state=tree['status']
            if state=='not_found' and not tree['complete']:state='unknown'
            counts[state]=counts.get(state,0)+1
            record_id=record.get('id')
            if not record_id:continue
            if mode=='checks':
                original_info=parse_quark_share_info(record.get('quark_location_url'))
                if original_info and info and original_info!=info:
                    health={'status':'unknown','reason':'人工直达属于另一分享，请单独检查','scanComplete':False}
                else:
                    checked=deepcopy(record)
                    if not checked.get('quark_folder_fid') and state=='matched':checked['quark_folder_fid']=fid
                    health=record_health(checked,tree)
                result['records'][record_id]=dict(health,collection=identifier)
            else:
                result['records'][record_id]={'status':state,'url':url_out,'path':path,'fid':fid,'collection':identifier,
                    'scanComplete':tree['complete'],'candidates':[dict(item,url=folder_url(*(info or ('','')),item.get('fid'))) for item in candidates][:20]}
                if tree['error']:result['records'][record_id]['error']=tree['error']
            has_size=bool(str(record.get('size_str') or '').strip())
            try:has_size=has_size or float(record.get('size_mb') or 0)>0
            except (ValueError,TypeError):pass
            if mode!='checks' and not has_size:
                target=record_fid(record) or str(fid)
                folder=by_fid.get(target)
                if tree['complete'] and folder and folder.get('size_complete') and folder.get('size_bytes',0)>0:
                    size_mb=round(folder['size_bytes']/1048576,3)
                    text=f'{size_mb/1024:.2f} GB' if size_mb>=1024 else f'{size_mb:g} MB'
                    result['sizes'][record_id]={'size_str':text,'size_mb':size_mb,'bytes':folder['size_bytes']}
                elif mode=='sizes':result['sizeErrors'][record_id]=tree['error'] or '未完整定位或未读到文件大小'
        dates={date:folder_url(*(info or ('','')),values[0]['fid']) for date,values in date_folders(tree['folders']).items() if len(values)==1}
        result['summary'].append({'collection':identifier,'status':tree['status'],'error':tree['error'],'complete':tree['complete'],
                                  'folders':len(tree['folders']),'requests':tree['requests'],'dates':dates,'extraCodes':[],**counts})
    result['cancelled']=bool(job.cancelled)
    result['status']='cancelled' if job.cancelled else 'ok' if result['summary'] and all(row['status']=='ok' for row in result['summary']) else 'unconfigured' if not result['summary'] else 'partial'
    if not keep_cache and result['status']=='ok' and all(row['complete'] for row in result['summary']):cache.forget_completed()
    return result


def check_shares(job,payload):
    if not enabled(payload):return []
    shares=payload.get('allShares') or payload.get('shares') or [];targets=[]
    for share in shares:
        for kind,key in (('quark','quark'),('baidu','baidu')):
            if share.get(key):targets.append((share.get('id'),share.get('label') or '分享',share[key],kind))
    if payload.get('latestTableUrl'):targets.append(('latest','最新版目录',payload['latestTableUrl'],'latest'))
    checked=[];seen={}
    for index,(identifier,label,url,kind) in enumerate(targets):
        if job.cancelled:break
        progress(job,f'分享检查 {index+1}/{len(targets)}',index,len(targets))
        status='ok';reason='分享可读取'
        if url in seen:status,reason=seen[url]
        else:
            try:
                if parse_quark_share_info(url):client_for(url,payload,job).check_share()
                else:
                    import urllib.request
                    request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
                    def read():
                        with public_open(request,timeout=15) as response:return response.read(512*1024).decode('utf-8','replace')
                    page=retry_request(read,lambda:job.cancelled)
                    if any(text in page for text in ('分享已取消','分享已失效','分享的文件已经被取消','链接不存在','分享文件已过期')):
                        status='invalid';reason='页面明确提示分享失效'
            except ScanError as error:
                status='invalid' if error.status=='invalid_share' else 'network_failed';reason=str(error)
            except (OSError,ValueError,InterruptedError):status='network_failed';reason='本次未能读取，未判为失效'
            seen[url]=(status,reason)
        checked.append({'collection':identifier,'id':identifier,'label':label,'url':url,'kind':kind,'status':status,'reason':reason})
    return checked
