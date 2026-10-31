"""Generic CSV/XLSX import. Unmapped columns survive in extra_fields."""
from copy import deepcopy
import csv
import hashlib
import io
import json
from .core import extract_structured_details

HEADERS={
'id':['目录ID','目录 ID','稳定ID','ID'], 'code':['目录编号','编号'], 'name':['名称','作品名称','标题'],
'source':['资料来源','来源'], 'source_id':['资料编号','来源编号'], 'version':['版本','作品版本'],
'author':['作者','作者／制作组','制作组','社团'], 'genre':['分类','类型'], 'platform':['载体','平台'], 'translation':['版本类型','语言'],
'notes':['备注','说明'], 'tags':['标签'], 'play_tags':['附加标记'], 'aliases':['别名'],
'quark_url':['下载链接2','夸克链接','夸克网盘','合集夸克链接'], 'baidu_url':['下载链接1','百度链接','百度网盘','合集百度链接'],
'collection_id':['合集ID','合集 ID'], 'sheet':['分区','工作表'], 'category':['归档批次','分类日期'],
'date':['收录日期','加入日期'], 'version_date':['作品版本发布日期','版本发布日期'], 'added_date':['加入日期'], 'updated_date':['更新日期'],
'size_str':['大小','体积'], 'cover_url':['封面网址','封面URL'], 'url':['资料链接','官网链接'],
'month_batch':['月度名单','名单月份'], 'release_date':['发售日期'], 'source_ids':['多来源编号JSON','多来源编号'],
'source_id_origin':['编号来源'],'category_raw':['批次'],'updated':['更新'],'update_summary':['更新内容'],
'web_info':['资料JSON'],'source_checks':['来源状态JSON'],'source_record':['原始记录JSON'],'record_extra':['扩展资料JSON'],'extra_fields':['自定义字段JSON'],
'aliases':['别名JSON','别名'],'perks':['特性JSON'],'cheats':['附加代码JSON'],'types':['类型JSON'],'play_tags':['附加标记JSON','附加标记'],'theme_tags':['主题标签JSON'],'manual_fields':['人工字段JSON'],
}
LIST_FIELDS={'tags','play_tags','aliases','perks','cheats','types','theme_tags','manual_fields'}
JSON_FIELDS={'source_ids','web_info','source_checks','source_record','record_extra','extra_fields'}

def _value(value):
    return value.isoformat() if hasattr(value,'isoformat') else str(value or '').strip()

def _rows(records,headers,mapping,sheet,issues):
    resolved={}
    for field,aliases in HEADERS.items():
        wanted=mapping.get(field)
        if isinstance(wanted,int):resolved[field]=wanted
        elif wanted is not None:
            if wanted in headers:resolved[field]=headers.index(wanted)
        else:
            match=next((h for h in aliases if h in headers),None)
            if match is not None:resolved[field]=headers.index(match)
    for field,wanted in mapping.items():
        if isinstance(wanted,int):resolved[field]=wanted
        elif wanted in headers:resolved[field]=headers.index(wanted)
    if 'name' not in resolved:
        issues.append({'sheet':sheet,'row':1,'code':'missing_name_column','reason':'没有识别到名称列，请设置 columnMapping'})
        return []
    output=[]
    for number,row in enumerate(records,2):
        values={field:_value(row[index]) if index<len(row) else '' for field,index in resolved.items()}
        if not values.get('name'):continue
        parsed=extract_structured_details(values['name'],version=values.get('version',''),tags=values.get('tags','')) or {}
        item={**parsed,**values}
        identifier=values.get('id') or values.get('code')
        if not identifier:
            identifier='item-'+hashlib.sha256((sheet+'\0'+values['name']+'\0'+str(number)).encode()).hexdigest()[:12]
        item.update(id=identifier,name=values['name'],title=values['name'],raw_name=values['name'],sheet=values.get('sheet') or sheet)
        for field in LIST_FIELDS:
            val=item.get(field)
            if isinstance(val,str):
                try: parsed_list=json.loads(val)
                except (ValueError,TypeError):parsed_list=None
                item[field]=parsed_list if isinstance(parsed_list,list) else [v.strip() for v in val.replace('、','|').replace(',','|').split('|') if v.strip()]
        for field in JSON_FIELDS:
            raw=item.get(field)
            if isinstance(raw,str) and raw:
                try:item[field]=json.loads(raw)
                except (ValueError,TypeError):
                    issues.append({'sheet':sheet,'row':number,'code':identifier,'reason':field+' JSON 无法解析，原文保留在自定义字段'})
                    item[field]={};item.setdefault('extra_fields',{})[field+'_raw']=raw
        extras=item.pop('record_extra',{})
        if isinstance(extras,dict):
            for key,value in extras.items():
                if key not in values and key not in ('id','name','title','raw_name'):item[key]=value
        prior_extra=item.get('extra_fields') if isinstance(item.get('extra_fields'),dict) else {}
        item['extra_fields']={**prior_extra,**{h:_value(row[i]) for i,h in enumerate(headers) if i not in resolved.values() and i<len(row) and h}}
        if isinstance(item.get('sheet'),str) and ' / ' in item['sheet']:
            item['category_sheets']=[v.strip() for v in item['sheet'].split(' / ') if v.strip()];item['sheet']=item['category_sheets'][0]
        output.append(item)
    return output

def import_table(data,filename='import.xlsx',mapping=None):
    mapping=mapping or {};meta={'parse_issues':[],'collections':[],'html_settings':{}};records=[];raw_book={}
    if str(filename).lower().endswith(('.csv','.tsv')):
        text=data.decode('utf-8-sig') if isinstance(data,bytes) else str(data)
        rows=list(csv.reader(io.StringIO(text),delimiter='\t' if str(filename).lower().endswith('.tsv') else ','))
        if rows:raw_book['作品']=rows
        if rows:records=_rows(rows[1:],[str(h).strip() for h in rows[0]],mapping,'作品',meta['parse_issues'])
    else:
        try:from openpyxl import load_workbook
        except ImportError as exc:raise ValueError('读取 XLSX 需要 openpyxl；也可使用 CSV') from exc
        workbook=load_workbook(io.BytesIO(data),data_only=True,read_only=True)
        try:
            for worksheet in workbook:
                rows=list(worksheet.values)
                if not rows:continue
                raw_book[worksheet.title]=[[_value(value) for value in row] for row in rows]
                if worksheet.title in ('HTML设置','HTML 设置','设置'):
                    meta['html_settings'].update({str(r[0]):_value(r[1]) for r in rows[1:] if len(r)>1 and r[0]});continue
                if worksheet.title in ('合集','Collections'):
                    headers=[str(v or '').strip() for v in rows[0]]
                    meta['collections'] += [{h:_value(row[i]) for i,h in enumerate(headers) if h and i<len(row)} for row in rows[1:] if any(row)];continue
                if worksheet.title in ('说明','README','来源配置','目录定位','分区','项目配置'):continue
                header_index=next((i for i,r in enumerate(rows[:20]) if any(str(v or '').strip() in HEADERS['name']+[str(mapping.get('name',''))] for v in r)),0)
                headers=[str(v or '').strip() for v in rows[header_index]]
                records+=_rows(rows[header_index+1:],headers,mapping,worksheet.title,meta['parse_issues'])
        finally:workbook.close()
    seen=set()
    for item in records:
        if item['id'] in seen:meta['parse_issues'].append({'sheet':item.get('sheet'),'code':item['id'],'reason':'目录 ID 重复，请在导入确认表处理'})
        seen.add(item['id'])
    meta['_workbook']=raw_book
    return meta,records

def align_stable_ids(records,previous):
    """Use unambiguous explicit identity. Missing previous rows are left for UI review."""
    records=deepcopy(records)
    for record in records:
        if any(p.get('id')==record['id'] for p in previous):continue
        code=record.get('code')
        matches=[p for p in previous if code and p.get('code')==code]
        if len(matches)==1:record['id']=matches[0]['id']
    return records

def ui_records(records):
    output=[]
    for record in records:
        item=deepcopy(record)
        item.update(source_record=deepcopy(record.get('source_record') or record), name=record.get('name') or record.get('raw_name') or record.get('title',''),
                    author=record.get('author') or record.get('circle',''),genre=record.get('genre') or record.get('main_genre',''),
                    english=record.get('en_title',''),date=record.get('date') or record.get('publish_date',''),
                    updated=bool(record.get('updated') or record.get('is_update')),size=record.get('size_mb',0))
        output.append(item)
    return output
