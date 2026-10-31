"""参考网站预览图。所有结果先返回确认表，不直接修改目录。"""
import base64
import copy
import html
import json
import os
import ssl
import re
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from html.parser import HTMLParser
from src.sources.http import public_open, validate_public_url, retry_request


class SiteBlocked(RuntimeError):
    pass


def clean_title(value):
    text = html.unescape(re.sub(r'<[^>]*>', '', str(value or ''))).strip()
    for _ in range(3):
        old = text
        text = re.sub(r'^\s*(?:更新|新版|首发|重发)\s*[:：]?\s*', '', text)
        text = re.sub(r'^\s*(?:\[[^\]]*\]|【[^】]*】)\s*', '', text)
        if text == old: break
    text = re.sub(r'(?:\s*(?:中文版?|修订版|完整版))+$', '', text)
    for _ in range(2):
        text = re.sub(r'\s*(?:\d+(?:\.\d+)?\s*[GMK]B|(?:ver(?:sion)?\.?\s*|v)\d[\w.\-]*)\s*$', '', text, flags=re.I)
    return re.sub(r'\s+', ' ', text).strip(' /|｜-— ')


def _name_parts(value):
    """只在独立语言段之间切开，VTuber出道指南这类混合词保持原样。"""
    tokens = clean_title(value).split()
    han = lambda t: bool(re.search(r'[\u3400-\u9fff]', t))
    kana = lambda t: bool(re.search(r'[\u3040-\u30ff]', t))
    # 这几个日本新字体可分出没有假名的原名，如「転生居酒屋」。
    japanese = lambda t: kana(t) or bool(re.search(r'[転払込売栄楽験対図実応専険発帰経続関観覚読働]', t))
    latin = lambda t: bool(re.search(r'[A-Za-z]', t)) and not han(t) and not kana(t)
    english_at = next((i for i, t in enumerate(tokens) if latin(t)
                       and (i + 1 == len(tokens) or latin(tokens[i + 1]) or japanese(tokens[i + 1]))), len(tokens))
    ja_at = next((i for i, t in enumerate(tokens) if japanese(t)), len(tokens))
    # 日文主名可以全是汉字，后面才接带假名的副标题；保留前面的中文主名。
    if ja_at < len(tokens) and ja_at >= 2 and ja_at < english_at and han(tokens[ja_at - 1]) and not japanese(tokens[ja_at - 1]):
        ja_at -= 1
    # 中文 / 英文 / 全汉字日文依次并排时，英文之后的第一段是原名。
    if ja_at == len(tokens) and english_at < len(tokens):
        ja_at = next((i for i in range(english_at + 1, len(tokens)) if han(tokens[i])), len(tokens))
    zh_end = min(english_at, ja_at)
    zh = ' '.join(tokens[:zh_end]) if any(han(t) for t in tokens[:zh_end]) else ''
    ja = ''
    if ja_at < len(tokens):
        ja_tokens = [tokens[ja_at]]
        # 相邻的纯汉字原名通常是别名，不把它们拼成一个检索词。
        for token in tokens[ja_at + 1:]:
            if latin(token) or not kana(token): break
            ja_tokens.append(token)
        ja = ' '.join(ja_tokens)
    en = ' '.join(tokens) if tokens and not any(han(t) or kana(t) for t in tokens) else ''
    return zh.strip(), ja.strip(), en.strip()


def query_names(record, k=None):
    values = []
    for field in ('name', 'title', 'raw_name', 'orig_title', 'en_title'):
        value = record.get(field)
        if value:
            values.extend(re.split(r'[/|｜]', str(value)))
    values.extend(record.get('aliases') or [])
    parts = [_name_parts(value) for value in values]
    chinese = next((zh for zh, _, _ in parts if zh), '')
    japanese = next((ja for _, ja, _ in parts if ja), '')
    ordered = [v for v in (chinese, japanese) if v]
    # 没有中日文时才用英文；有中文但没有日文，不浪费第二次去搜整串英文。
    if not ordered:
        ordered = [next((en for _, _, en in parts if en), '')]
    return list(dict.fromkeys(v for v in ordered if v))[:2]


def title_confidence(record, title, k=None):
    norm = lambda s: ''.join(c for c in s.casefold() if c.isalnum())
    title = clean_title(title)
    target = norm(title)
    best = None
    for name in query_names(record, k):
        key = norm(name)
        if not key or len(key) < 3: continue
        if key == target: return 'exact'
        # 续作：作品名后面紧跟着数字（「…学校里2」）才算另一部；帖子标题后面的版本号、大小不算
        def sequel_after(at):
            nxt = target[at:at + 1]
            return nxt.isdigit() and not key[-1:].isdigit()
        if target.startswith(key):
            if not sequel_after(len(key)): best = 'prefix'
        elif len(key) >= 4 and key in target and best is None:
            if not sequel_after(target.index(key) + len(key)): best = 'partial'
    return best


class PageParser(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.images, self.official, self.links = url, [], [], []
        self.og = ''
        self.anchor = None
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('script', 'style'): self.skip += 1
        if tag == 'meta' and (a.get('property') or a.get('name')) == 'og:image': self.og = urllib.parse.urljoin(self.url, a.get('content', ''))
        if tag == 'img':
            src = a.get('data-src') or a.get('data-original') or a.get('data-lazy-src') or a.get('src') or ''
            if not src and a.get('srcset'): src = a['srcset'].split(',')[0].strip().split(' ')[0]
            width, height = re.match(r'\d+', a.get('width', '')), re.match(r'\d+', a.get('height', ''))
            if (width and int(width[0]) < 200) or (height and int(height[0]) < 100): return
            if re.search(r'avatar|emoji|smilies|gravatar|loading|spinner|logo|icon', src, re.I): return
            src = urllib.parse.urljoin(self.url, html.unescape(src))
            if src.startswith(('http://', 'https://')) and src not in self.images: self.images.append(src)
        if tag == 'a':
            url = urllib.parse.urljoin(self.url, a.get('href', ''))
            self.anchor = {'url': url, 'title': ''}
            steam = re.search(r'https?://store\.steampowered\.com/app/(\d+)', url, re.I)
            info = {'source': 'Steam', 'appid': steam[1], 'url': 'https://store.steampowered.com/app/' + steam[1] + '/'} if steam else None
            if info and info not in self.official: self.official.append(info)

    def handle_data(self, data):
        if self.anchor and not self.skip: self.anchor['title'] += data

    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.skip = max(0, self.skip - 1)
        if tag == 'a' and self.anchor:
            if self.anchor['title'].strip(): self.links.append(self.anchor)
            self.anchor = None


def parse_page(content, url, use_og=False):
    p = PageParser(url)
    p.feed(content)
    images = ([p.og] if use_og and p.og else []) + p.images
    return {'images': list(dict.fromkeys(images)), 'official': p.official, 'links': p.links}


def image_size(data):
    try:
        if data.startswith(b'\x89PNG'): return struct.unpack('>II', data[16:24])
        if data.startswith((b'GIF87a', b'GIF89a')): return struct.unpack('<HH', data[6:10])
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            if data[12:16] == b'VP8X': return (1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little'))
            if data[12:16] == b'VP8 ' and data[23:26] == b'\x9d\x01\x2a': return struct.unpack('<HH', data[26:30])
            if data[12:16] == b'VP8L':
                bits = int.from_bytes(data[21:25], 'little')
                return (1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff))
        if data.startswith(b'\xff\xd8'):
            i = 2
            while i + 9 < len(data):
                if data[i] != 255: i += 1; continue
                tag = data[i + 1]; i += 2
                if tag in (0xd8, 0xd9): continue
                length = int.from_bytes(data[i:i + 2], 'big')
                if tag in (0xc0, 0xc1, 0xc2, 0xc3):
                    h, w = struct.unpack('>HH', data[i + 3:i + 7]); return w, h
                if length < 2: break
                i += length
    except (ValueError, struct.error, IndexError): pass
    return None


class RefClient:
    def __init__(self,cancelled=None):
        self.cancelled=cancelled
        self.last = {}
        self.ssl_context = ssl.create_default_context()
        # python.org 的 Mac 安装可能尚未配置 CA；读取系统证书，继续验证 HTTPS。
        if not ssl.get_default_verify_paths().cafile:
            for cafile in ('/etc/ssl/cert.pem', '/opt/homebrew/etc/openssl@3/cert.pem'):
                if os.path.isfile(cafile):
                    self.ssl_context.load_verify_locations(cafile=cafile)
                    break

    def read(self, url, referer=None, paced=True):
        if not str(url).startswith(('http://', 'https://')): raise ValueError('网址要以 http:// 或 https:// 开头')
        host = urllib.parse.urlsplit(url).netloc
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': referer or url, 'Accept': '*/*'})
        def once():
            if paced:
                wait=1.5-(time.monotonic()-self.last.get(host,0))
                if wait>0:time.sleep(wait)
            self.last[host]=time.monotonic()
            with public_open(req, timeout=20, context=self.ssl_context) as response:
                data = response.read(12 * 1024 * 1024 + 1)
                if len(data) > 12 * 1024 * 1024: raise ValueError('图片或页面超过 12 MB，换下一张')
                return data, response.geturl(), response.headers.get_content_type()
        try:return retry_request(once,self.cancelled)
        except urllib.error.HTTPError as error:
            if error.code in (401,403,429):
                code=error.code;error.close();raise SiteBlocked('HTTP '+str(code)) from None
            raise

    def json(self, url): return json.loads(self.read(url)[0].decode('utf-8-sig'))
    def page(self, url):
        data, final, _ = self.read(url)
        return data.decode('utf-8', 'replace'), final
    def image(self, url, referer):
        data, _, mime = self.read(url, referer)
        size = image_size(data)
        if size and max(size) < 200: raise ValueError('图片小于 200 像素')
        # 认不出尺寸的格式也要防占位图、小图标：真封面不会小于 4 KB
        if len(data) < 4096: raise ValueError('图片太小（不到 4 KB），多半是占位图')
        if not mime.startswith('image/'):
            if data.startswith(b'\xff\xd8'): mime = 'image/jpeg'
            elif data.startswith(b'\x89PNG'): mime = 'image/png'
            elif data[:4] == b'RIFF': mime = 'image/webp'
            else: raise ValueError('返回的不是图片')
        return 'data:' + mime + ';base64,' + base64.b64encode(data).decode('ascii')


def check_site(site, client=None):
    client = client or RefClient()
    result = copy.deepcopy(site)
    at = datetime.now().isoformat(timespec='seconds')
    try:
        _, final = client.page(site['url'])
        parts = urllib.parse.urlsplit(final)
        base = urllib.parse.urlunsplit((parts.scheme, parts.netloc, '', '', '')).rstrip('/')
        result['finalUrl'] = base + '/'
        try:
            posts = client.json(base + '/wp-json/wp/v2/posts?per_page=1&_fields=id,title,link,content')
            if not isinstance(posts, list): raise ValueError('没有返回文章列表')
            result.update(type='wordpress', apiBase=base + '/wp-json/wp/v2/posts')
            result['lastCheck'] = {'status': 'ok', 'message': 'WordPress 接口可用', 'at': at}
        except SiteBlocked: raise
        except Exception:
            result['type'] = 'web'
            result['lastCheck'] = {'status': 'ok' if '{q}' in site.get('searchTemplate', '') else 'needs_template', 'message': '网页可访问，请填含 {q} 的搜索网址模板' if '{q}' not in site.get('searchTemplate', '') else '网页可访问，按模板尽力搜索', 'at': at}
    except Exception as error:
        result['lastCheck'] = {'status': 'blocked' if isinstance(error, SiteBlocked) else 'failed', 'message': str(error), 'at': at}
    return result


def search_posts(site, query, client, record, k):
    if site.get('type', 'wordpress') == 'wordpress':
        base = site.get('apiBase') or (site.get('finalUrl') or site['url']).rstrip('/') + '/wp-json/wp/v2/posts'
        url = base + '?' + urllib.parse.urlencode({'search': query, 'per_page': 5, '_fields': 'id,date,title,link,content'})
        posts = client.json(url)
        if not isinstance(posts, list): raise ValueError('接口没有返回文章列表，请重新检测网站')
        return [{'title': p.get('title', {}).get('rendered', ''), 'url': p.get('link', ''), 'body': p.get('content', {}).get('rendered', '')} for p in posts]
    template = site.get('searchTemplate', '')
    if '{q}' not in template: return []
    page, url = client.page(template.replace('{q}', urllib.parse.quote(query)))
    links = parse_page(page, url)['links']
    # 只进入文字能对上、且同站的帖子；每次最多五条。
    host = urllib.parse.urlsplit(url).netloc
    hits, seen = [], set()
    for link in links:
        if urllib.parse.urlsplit(link['url']).netloc != host or link['url'] in seen: continue
        if not title_confidence(record, link['title'], k): continue
        seen.add(link['url'])
        body, final = client.page(link['url'])
        hits.append({'title': link['title'], 'url': final, 'body': body, 'web': True})
        if len(hits) >= 5: break
    return hits


def download_candidate(post, client, start=0):
    parsed = parse_page(post['body'], post['url'], post.get('web', False))
    errors = []
    for index, url in enumerate(parsed['images']):
        if index < start: continue
        try:
            image = client.image(url, post['url'])
            return {'image': image, 'imageIndex': index, 'imageUrl': url, 'official': parsed['official'], 'downloadErrors': errors}
        except SiteBlocked: raise
        except Exception as error: errors.append(str(error))
    return {'image': '', 'downloadErrors': errors or ['帖子里没找到可用大图']}


def find_covers(records, sites, client=None, k=None, job=None):
    client=client or RefClient(cancelled=(lambda:job.cancelled) if job else None);sites=copy.deepcopy(sites)
    stats={'checked':0,'matched':0,'downloadFailed':0,'notFound':0,'networkFailed':0}
    candidates=[];failed=[];stopped=set();consecutive={};failures={};network_failures=[];started=time.monotonic()
    for index,record in enumerate(records):
        if job and job.cancelled:break
        if job:job.progress={'text':f'参考网站 {index+1}/{len(records)}','done':index,'total':len(records)}
        stats['checked']+=1;found=None;had_match=False;image_errors=[];unavailable=False;queried=False
        for site in sites:
            key=site.get('id') or site.get('url','')
            if not site.get('enabled',True):continue
            if key in stopped:
                failures[key]['skipped']+=1;unavailable=True;continue
            if site.get('lastCheck',{}).get('status') in ('blocked','needs_template'):unavailable=True;continue
            try:
                seen=set();queried=True
                for query in query_names(record,k):
                    if job and job.cancelled:break
                    posts=search_posts(site,query,client,record,k)
                    posts=sorted(posts,key=lambda post:{'exact':0,'prefix':1,'partial':2,None:3}[title_confidence(record,post['title'],k)])
                    for post in posts:
                        if post['url'] in seen:continue
                        seen.add(post['url']);confidence=title_confidence(record,post['title'],k)
                        if not confidence:continue
                        had_match=True;picture=download_candidate(post,client)
                        if not picture['image']:
                            image_errors.extend(picture.get('downloadErrors',[]));continue
                        found=dict(picture,id=record['id'],site=site.get('name') or site.get('url'),siteId=key,url=post['url'],
                                   title=html.unescape(re.sub('<[^>]+>','',post['title'])),confidence=confidence)
                        break
                    if found:break
                consecutive[key]=0
                if found:break
            except Exception as error:
                unavailable=True;consecutive[key]=consecutive.get(key,0)+1
                entry=failures.setdefault(key,{'site':site.get('name') or site.get('url'),'siteId':key,'count':0,'skipped':0,'blocked':False})
                entry['count']+=1
                blocked=isinstance(error,SiteBlocked)
                if blocked or consecutive[key]>=5:stopped.add(key);entry['blocked']=blocked
                site['lastCheck']={'status':'blocked' if blocked else 'failed','message':'访问受限' if blocked else '这次未能读取，下次可重试','at':datetime.now().isoformat(timespec='seconds')}
                network_failures.append({'id':record['id'],'siteId':key,'reason':site['lastCheck']['message']})
        if found:candidates.append(found);stats['matched']+=1
        elif unavailable or not queried:stats['networkFailed']+=1
        elif had_match:
            stats['downloadFailed']+=1
            failed.append({'id':record['id'],'code':record.get('code',''),'title':record.get('title') or record.get('name',''),'errors':list(dict.fromkeys(image_errors))})
        else:stats['notFound']+=1
    return {'candidates':candidates,'failed':failed,'sites':sites,'stats':stats,'siteFailures':list(failures.values()),
            'networkFailures':network_failures,'cancelled':bool(job and job.cancelled),'seconds':round(time.monotonic()-started,1)}


def job_ref_covers(job, payload, k=None):
    records = payload.get('records') or []
    limit = max(1, min(int(payload.get('limit') or 100), 2000))
    return find_covers(records[:limit], payload.get('sites') or [], k=k, job=job)


def job_ref_check(job, payload):
    client = RefClient()
    sites = []
    for site in payload.get('sites') or []:
        if job.cancelled: break
        checked = check_site(site, client)
        sites.append(checked)
        print(f"{site.get('name')}：{checked['lastCheck']['message']}")
    return {'sites': sites}


def job_ref_next(job, payload):
    client = RefClient()
    source = payload['source']
    page, url = client.page(source['url'])
    images = parse_page(page, url, True)['images']
    index = images.index(source['imageUrl']) if source.get('imageUrl') in images else int(source.get('imageIndex', 0))
    picture = download_candidate({'body': page, 'url': url, 'web': True}, client, index + 1)
    if not picture.get('image'): raise ValueError('这篇帖子的后面没有可用图片了')
    return dict(picture, url=url)
