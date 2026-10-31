"""Bangumi documented public API; image rights are separate from API access."""
from .base import Source, result

class BangumiSource(Source):
    key = 'bangumi'
    def _info(self, row):
        identifier=str(row['id'])
        names=[row.get('name_cn'),row.get('name')]
        return {'source':'Bangumi','source_id':identifier,'bangumi_id':int(identifier),
                'url':'https://bgm.tv/subject/'+identifier, 'name':row.get('name_cn') or row.get('name',''),
                'aliases':list(dict.fromkeys(v for v in names if v)), 'summary':row.get('summary',''),
                'type':{1:'book',2:'animation',3:'music',4:'game',6:'live_action'}.get(row.get('type'),'other'),
                'cover_url':(row.get('images') or {}).get('large') or (row.get('images') or {}).get('common',''),
                'cover_redistribution_allowed':False, 'cover_license':'逐张核对；API 链接不等于图片再分发授权',
                'metadata_license':'Bangumi 条目信息版权声明，CC BY-SA；已有版权的作品另行处理',
                'attribution_url':'https://bgm.tv/about/copyright'}
    def _search(self,title):
        payload={'keyword':title,'sort':'match','filter':{'nsfw':False}}
        if self.options.get('types'): payload['filter']['type']=self.options['types']
        data=self.request('https://api.bgm.tv/v0/search/subjects?limit=30&offset=0',payload)
        if not isinstance(data.get('data'),list): raise ValueError('missing results')
        candidates=[self._info(row) for row in data['data'] if str(row.get('id','')).isdigit()]
        response=result(self.key,'candidates' if candidates else 'genuine_not_found',candidates=candidates)
        response['total']=data.get('total',len(candidates))
        response['truncated']=response['total']>len(candidates)
        return response
    def _detail(self,source_id):
        if not source_id.isdigit(): return result(self.key,'insufficient_input',reason='Bangumi 编号应为数字')
        data=self.request('https://api.bgm.tv/v0/subjects/'+source_id)
        if str(data.get('id',''))!=source_id: raise ValueError('identity mismatch')
        return result(self.key,'matched',info=self._info(data))
