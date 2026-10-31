"""Small provider-independent text parser; explicit table columns always win."""
import re

def parse_size_mb(size_str):
    match=re.search(r'(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB|T|G|M|K)\b',str(size_str or ''),re.I)
    if not match:return 0.0
    unit=match.group(2).upper()[0]
    return round(float(match.group(1))*{'T':1024*1024,'G':1024,'M':1,'K':1/1024}[unit],6)


VERSION_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9])(?:version|ver|v)\s*\.?\s*(\d+(?:\.\d+)*(?:[-_][A-Za-z0-9]+)?)", re.I)


def extract_version_tokens(text, allow_bare=False):
    return [match.group(0).strip() for match in VERSION_TOKEN_RE.finditer(str(text or ''))]


def split_name_fields(text):
    """Only split explicit separators; never guess a work's language or subject."""
    parts = list(dict.fromkeys(part.strip() for part in re.split(r'\s+[|｜/]\s+', str(text or '')) if part.strip()))
    return (parts[0] if parts else '', '', '', parts[1:])


def extract_raw_name(raw_title, fallback_parts=()):
    return str(raw_title or '').strip() or next((str(v).strip() for v in fallback_parts if str(v).strip()), '')


def _split_tag_blob(blob):
    if isinstance(blob, (tuple,list)):
        return list(dict.fromkeys(str(value).strip() for value in blob if str(value).strip()))
    return list(dict.fromkeys(v.strip().lstrip('#') for v in re.split(r'[,，;；/|｜\n]+', str(blob or '')) if v.strip()))


def extract_game_details(raw_title, raw_notes='', default_cat='', sheet_name='目录', row_idx=0, split_names=True):
    # Kept as a compatibility API name for existing clients.
    raw=str(raw_title or '').strip()
    if not raw:return None
    versions=extract_version_tokens(raw)
    size=re.search(r'(?<!\w)(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB|G|M|K)\b', raw, re.I)
    author=re.search(r'(?:^|\s)[@＠]([^#|｜]+)',raw)
    tags=re.findall(r'(?:^|\s)#([^#\s]+)',raw)
    title=raw
    if author:title=title.replace(author.group(0),' ')
    if size:title=title.replace(size.group(0),' ')
    title=VERSION_TOKEN_RE.sub(' ', title)
    title=re.sub(r'(?:^|\s)#[^#\s]+',' ',title).strip()
    title=re.sub(r'\s+',' ',title)
    name,orig,english,aliases=split_name_fields(title) if split_names else (title,'','',[])
    name=name or raw
    return {'title':name,'name':name,'raw_name':raw,'orig_title':orig,'en_title':english,'aliases':aliases,
            'author':author.group(1).strip() if author else '', 'circle':author.group(1).strip() if author else '',
            'version':versions[0] if versions else '', 'translation':'默认','platform':'','genre':str(default_cat or ''),
            'main_genre':str(default_cat or ''),'tags':tags,'play_tags':[],'theme_tags':[],'types':[],
            'size_str':size.group(0).strip() if size else '', 'size_mb':parse_size_mb(size.group(0)) if size else 0,
            'notes':str(raw_notes or '').strip(),'cheats':[],'perks':[],'query_name':name}


def extract_structured_details(name, version=None, tags=None, **kwargs):
    item=extract_game_details(name,split_names=False,**{k:v for k,v in kwargs.items() if k!='split_names'})
    if item is None:return None
    # Explicit fields must not be interpreted as title suffixes.
    item.update(title=str(name).strip(),name=str(name).strip(),raw_name=str(name).strip(),query_name=str(name).strip(),
                aliases=[],orig_title='',en_title='',source_schema='structured')
    if version is not None:item['version']=str(version).strip()
    if tags is not None:item['tags']=_split_tag_blob(tags);item['raw_tags']=' / '.join(item['tags'])
    return item
