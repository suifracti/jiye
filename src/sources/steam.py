"""Steam documented app catalog API. No undocumented storefront scraping."""
import json
import urllib.parse
from .base import Source, result, title_key

class SteamSource(Source):
    key='steam'
    def __init__(self,**options):
        super().__init__(**options)
        self.catalog={}
    def _page(self,last_appid=0,max_results=10000):
        api_key=self.options.get('api_key','')
        if not api_key: return None
        params={'key':api_key,'input_json':json.dumps({'last_appid':int(last_appid),'max_results':max_results,'include_games':True,'include_dlc':True,'include_software':True,'include_videos':True,'include_hardware':True})}
        data=self.request('https://partner.steam-api.com/IStoreService/GetAppList/v1/?'+urllib.parse.urlencode(params))
        response=data.get('response')
        if not isinstance(response,dict) or not isinstance(response.get('apps'),list): raise ValueError('missing apps')
        for row in response['apps']:
            if str(row.get('appid','')).isdigit(): self.catalog[str(row['appid'])]=row
        return response
    def _info(self,row):
        identifier=str(row['appid'])
        return {'source':'Steam','source_id':identifier,'appid':int(identifier), 'name':row.get('name',''),
                'url':'https://store.steampowered.com/app/'+identifier+'/', 'type':'store_item',
                'metadata_license':'Steam Web API Terms of Use; personal use through this application',
                'attribution_url':'https://steamcommunity.com/dev/apiterms',
                'detail_limit':'官方目录接口提供编号和名称；简介与封面使用用户授权的 JSON 来源补充'}
    def _search(self,title):
        if not self.options.get('api_key'): return result(self.key,'configuration_required',reason='Steam 官方目录 API 需要用户自己的 Web API key；可改用 JSON 资料')
        last=0; complete=False
        for _ in range(max(1,int(self.options.get('max_pages',10)))):
            page=self._page(last)
            rows=page['apps']
            if not page.get('have_more_results'):
                complete=True; break
            next_id=int(page.get('last_appid') or (rows[-1]['appid'] if rows else 0))
            if next_id<=last: raise ValueError('pagination did not progress')
            last=next_id
        matches=[self._info(r) for r in self.catalog.values() if title_key(title) in title_key(r.get('name'))]
        response=result(self.key,'candidates' if matches else 'genuine_not_found' if complete else 'partial',candidates=matches,
                        reason='' if complete else '仅检索了已读取的目录页，可提高 max_pages 或导入目录 JSON')
        response['truncated']=not complete
        return response
    def _detail(self,source_id):
        if not source_id.isdigit(): return result(self.key,'insufficient_input',reason='Steam appid 应为数字')
        if source_id not in self.catalog:
            if self._page(max(0,int(source_id)-1),1) is None:
                return result(self.key,'configuration_required',reason='Steam 官方 API key 未配置，可手填资料或导入 JSON')
        row=self.catalog.get(source_id)
        return result(self.key,'matched' if row else 'genuine_not_found',info=self._info(row) if row else None)
