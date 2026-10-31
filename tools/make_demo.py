#!/usr/bin/env python3
"""固定种子生成原创、无网络的集页演示目录。"""
import argparse, base64, json, random
from datetime import date, timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0,str(ROOT))
from src.shared.product import NAME, SLUG

def geometric_cover(index):
    colors=['#337d79','#5757a4','#ba713d','#3f719e','#8f5680','#597b42']
    color=colors[index%len(colors)]
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140" viewBox="0 0 200 140"><rect width="200" height="140" fill="{color}"/><circle cx="160" cy="25" r="56" fill="#fff" opacity=".18"/><path d="M0 120L65 43L145 140H0Z" fill="#fff" opacity=".3"/><text x="18" y="109" fill="white" font-family="sans-serif" font-size="26">ITEM {index+1:03}</text></svg>'
    return 'data:image/svg+xml;base64,'+base64.b64encode(svg.encode()).decode()

def make_demo(count=48):
    rng=random.Random(20261027)
    zones=['虚构书单','虚构影单','阅读与观影笔记']
    nouns=['星河手记','山间邮局','纸上花园','晨光工坊','小岛漫游','云端画室','森林来信','沙丘笔记','时钟街角','月光地图','风车课堂','海岸图集']
    now=date(2026,11,1)
    collections=[{'id':f'C{i+1:02}','label':['纸上书架','周末影单','城市阅读','纪录片手记'][i], 'baidu':f'https://example.invalid/demo/collection-{i+1}/files','quark':f'https://example.invalid/demo/collection-{i+1}/folders','quark_folders':{}} for i in range(4)]
    records=[]; covers={}
    for i in range(count):
        col=collections[i%4]; day=now-timedelta(days=i%12);ds=day.isoformat();zone=i%3
        name=nouns[i%12]+f' · 示例{i//12+1:02}'
        # 第13条与第1条同名，演示多个版本；它们仍然各有稳定ID。
        if i==12:name=nouns[0]+' · 示例01'
        r={'id':f'DEMO-{i+1:04}','code':f'ITEM-{i+1:04}','name':name,'title':name,'raw_name':name,'raw_title':name,
          'version':'v1.1' if i==0 else 'v1.0','author':f'虚构作者{i%6+1}','circle':f'虚构作者{i%6+1}',
          'genre':['小说','电影','随笔'][zone],'main_genre':['小说','电影','随笔'][zone],'platform':['纸质与电子','数字影像','电子笔记'][zone],
          'translation':'默认','tags':['演示',['文学','剧情','观察'][zone]],'play_tags':[], 'theme_tags':[],
          'types':[zones[zone]],'perks':['附阅读笔记'] if i%5==0 else [],'cheats':[],'aliases':[f'Example {i+1}'],
          'date':ds,'publish_date':ds,'date_short':f'{day.month}/{day.day:02}','date_label':f'{day.year}年{day.month}月{day.day}日',
          'month_batch':f'{day.year}年{day.month}月','zone_sub':f'{day.year}年{day.month}月','category':ds,'category_raw':ds,
          'sheet':zones[zone],'zone':f'sheet-{zone}','zone_icon':['✦','▤','◈'][zone],'sheet_type':'default',
          'category_sheets':[zones[zone]],'category_zones':[f'sheet-{zone}'],'source_schema':'structured',
          'size_str':f'{rng.randint(50,900)}M','size_mb':100+i,'size':100+i,'notes':'原创虚构演示条目；链接仅为示意，不可下载。',
          'updated':i%6==0,'is_update':i%6==0,'update_summary':'新增说明与示例附件' if i%6==0 else '', 'version_date':(day-timedelta(days=2)).isoformat() if i%6==0 else '',
          'baidu_url':col['baidu'],'quark_url':col['quark'],'web_info':{},'source_checks':{},'source':'','source_id':'',
          'palette':['#deece9','#367669'],'symbol':'✦','row_num':i+1,'region_locked':False,'is_hang':False,'is_heji':False,
          'quark_location_status':'not_found'}
        if i%9==0:
            r['category_sheets'].append(zones[(zone+1)%3]);r['category_zones'].append(f'sheet-{(zone+1)%3}')
        r['search']=' '.join([name,r['code'],r['author'],r['genre'],r['platform'],r['translation'],*r['tags'],*r['aliases']])
        records.append(r)
        if i<48:covers[r['id']]=geometric_cover(i)
    steps=[{'title':'找到作品','body':'用目录编号和筛选找到想查看的条目。'},{'title':'查看合集','body':'演示链接不可访问，自己的资源链接可在母版配置。'},{'title':'阅读说明','body':'按自己的条目填写说明与附件。'}]
    ui={'theme':'eye','show_background':False,'background_url':'','background_mobile_url':'','show_covers':True,'show_hero':True,'show_random':True,'hero_title':NAME+' · 随身目录','hero_subtitle':'48 条原创示例，所有资源链接均为演示。','hero_style':'compact','eyebrow':'离线目录 · 随心整理','footer_text':NAME+' · 只整理你有权分享的内容','sidebar_text':'原创演示目录','show_nav_cards':True,'doc_title':'使用指南','doc_subtitle':'查看目录说明','doc_url':'','guide_title':'使用指南','guide_subtitle':'查看目录说明','contact_title':'更新动态','contact_subtitle':'了解目录变化','contact_url':'','allow_remote_images':False,'doc_image':geometric_cover(0),'contact_image':geometric_cover(1),'hero_image':geometric_cover(2),'logo_image':geometric_cover(3),'stale_days':0,'enable_export':True}
    meta={'input_name':NAME+'演示目录','title':NAME+'演示目录','collection_key':SLUG+'-demo-v1','update_date':now.isoformat(),'is_demo':True,'password':'','warning':'','notice':'','extract_guide':'请只整理和分享你有权使用的内容。','row2_body':'请按自己的资源填写使用说明。','row5_steps':steps,'row4_modules':steps,'row5_template':{'steps':steps,'文档链接':'','更新链接':'','更新标题':'更新动态'},'ui_config':ui, 'latest_catalog_url':'','top_notice':{'text':'','visible':False,'copyable':False},'version_types':[{'name':'默认','color':'#367669'}],'modules':{'downloads':False,'quark':False}}
    return {'schema':SLUG+'-demo-v1','meta':meta,'records':records,'collections':collections,'covers':covers,'coverSources':{},'privateNotes':{},
       'rankings':[{'id':'rank-demo','title':'本月精选榜','period':'2026年11月','published':True,'note':'虚构示例，排序可自由调整','tiers':[{'name':'推荐','items':[{'id':r['id'],'score':str(90-i),'note':'原创示例'} for i,r in enumerate(records[:5])]},{'name':'值得一看','items':[{'id':r['id'],'score':'85','note':''} for r in records[5:8]]}],'regions':[]}],
       'monthLists':[{'id':'month-demo','title':'11月阅读与观影','period':'2026年11月','published':True,'lines':[{'type':'item','id':r['id'],'raw':r['name'],'text':r['name']} for r in records[:10]]}],
       'sourceConfig':{'steam':{'enabled':False},'bangumi':{'enabled':False},'custom_sources':[]},'refSites':[]}

def main():
    p=argparse.ArgumentParser();p.add_argument('--count',type=int,default=48);p.add_argument('--blank',action='store_true');p.add_argument('--out',type=Path,default=ROOT/'demo/demo-data.json');a=p.parse_args()
    data=make_demo(0 if a.blank else a.count)
    if a.blank:
        data.update(covers={},collections=[],rankings=[],monthLists=[])
        data['meta'].update(input_name=NAME+'空白目录',title=NAME+'空白目录',collection_key=SLUG+'-blank-v1',is_demo=False,update_date='')
        data['meta']['ui_config'].update(hero_title='我的目录',hero_subtitle='添加自己的第一条内容',hero_image='',logo_image='',doc_image='',contact_image='',show_random=False)
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');print(f'生成 {len(data["records"])} 条原创演示记录：{a.out.name}')
if __name__=='__main__':main()
