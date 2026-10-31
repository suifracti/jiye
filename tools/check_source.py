#!/usr/bin/env python3
"""One opt-in API detail probe; print status and field names, never metadata bodies."""
from pathlib import Path
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

def check(source,identifier,live=False,environ=None):
    from src.sources import default_registry
    env=os.environ if environ is None else environ
    observed={'http_status':None,'requests':0}
    def transport(url,payload=None,headers=None):
        # Detail requests use GET; the key-bearing URL is never printed or persisted.
        request=urllib.request.Request(url,headers=headers or {})
        observed['requests']+=1
        try:
            with urllib.request.urlopen(request,timeout=20) as response:
                observed['http_status']=response.status
                return json.loads(response.read(8*1024*1024).decode('utf-8'))
        except urllib.error.HTTPError as error:
            observed['http_status']=error.code
            raise
    config={source:{'enabled':bool(live),'min_interval':0}}
    if source=='steam':config[source]['api_key']=env.get('STEAM_WEB_API_KEY','')
    registry=default_registry(config,{source:transport})
    response=registry.detail(source,str(identifier))
    output={'source':source,'live':bool(live),'status':response['status'],**observed,
            'returned_fields':sorted((response.get('info') or {}).keys())}
    if response.get('reason'):output['reason']=response['reason']
    return output

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',choices=('bangumi','steam'),default='bangumi')
    parser.add_argument('--id',default='1',help='来源条目编号，仅用于本次请求')
    parser.add_argument('--live',action='store_true',help='仅此标记会启用一次 API 详情请求，不下载图片')
    args=parser.parse_args()
    output=check(args.source,args.id,live=args.live)
    print(json.dumps(output,ensure_ascii=False,sort_keys=True))
    return 0 if not args.live or output['status'] in ('matched','configuration_required') else 1

if __name__=='__main__':raise SystemExit(main())
