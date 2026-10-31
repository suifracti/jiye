#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
目录小助手：和母版一起启动的本机服务，只监听 127.0.0.1。

  - 用 http://127.0.0.1:随机端口 打开母版（页面和接口同源，带会话令牌）
  - 保存母版：写回文件，并把旧文件备份到「备份」文件夹（保留 30 份）
  - 导出分发版 / 表格：写进「分发」/「表格」文件夹
  - 可选来源取资料、导入分享目录、按列映射读取工作簿
  - 收不到页面心跳一段时间后自动退出；同一时间只开一个

    python server.py [--root 目录] [--master 母版.html] [--no-browser]
"""
import argparse
import base64
import contextlib
import copy
import io
import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HELPER_DIR = os.path.dirname(os.path.abspath(__file__))
# 便携版 Python 不会把脚本所在文件夹放进 sys.path，这里手动加：助手代码、第三方库、源码根目录
for p in (HELPER_DIR, os.path.join(HELPER_DIR, "lib"), os.path.dirname(HELPER_DIR), os.path.dirname(os.path.dirname(HELPER_DIR))):
    if p not in sys.path:
        sys.path.append(p)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from src.shared.product import NAME, ENGLISH_NAME, VERSION
BACKUP_KEEP = 30
FIRST_BEAT_TIMEOUT = 180   # 打开后这么久都没有页面连上，就退出
BEAT_TIMEOUT = 75          # 页面心跳停了这么久（标签页关了），就退出
INSTANCE_FILE = os.path.join(HELPER_DIR, ".instance.json")
FILE_LOG = None


def file_log(text):
    if FILE_LOG is not None:
        try:
            FILE_LOG.write(text)
        except OSError as error:
            # 日志写不了时仍让保存、导出等操作照常完成；不走 stdout，避免 Tee 递归。
            try:
                sys.__stderr__.write(f"无法写入小助手日志：{error}\n")
            except Exception:
                pass


def log(*parts):
    message = " ".join(str(part) for part in parts)
    print(datetime.now().strftime("%H:%M:%S"), message, flush=True)
    # 任务期间 stdout 已经由 Tee → Job 写入文件，不再重复写一份。
    if not isinstance(sys.stdout, Tee):
        file_log(message)


# ---------------------------------------------------------------- 参考网站（独立模块，按需加载）
def job_ref_covers(job, payload):
    from ref_sites import job_ref_covers as run
    return run(job, payload)


def job_ref_check(job, payload):
    from ref_sites import job_ref_check as run
    return run(job, payload)


def job_ref_next(job, payload):
    from ref_sites import job_ref_next as run
    return run(job, payload)


# ---------------------------------------------------------------- 文件
def safe_name(name, default):
    name = os.path.basename(str(name or "").strip()) or default
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or default
    return name


def write_atomic(path, data):
    tmp = f"{path}.tmp_{os.getpid()}_{int(time.time() * 1000)}"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    # Windows 上文件可能被杀毒软件或其他程序短暂占用，重试几次
    for attempt in range(8):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 7:
                os.remove(tmp)
                raise
            time.sleep(0.2 * (attempt + 1))


def backup_master(master_path, backup_dir):
    if not os.path.isfile(master_path):
        return None
    os.makedirs(backup_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(master_path))[0]
    target = os.path.join(backup_dir, f"{stem}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.html")
    shutil.copy2(master_path, target)
    backups = sorted((f for f in os.listdir(backup_dir) if f.startswith(stem + "-") and f.endswith(".html")), reverse=True)
    for old in backups[BACKUP_KEEP:]:
        try:
            os.remove(os.path.join(backup_dir, old))
        except OSError:
            pass
    return target


# ---------------------------------------------------------------- 后台任务
class Job:
    def __init__(self, kind):
        self.id = secrets.token_hex(4)
        self.kind = kind
        self.status = "running"
        self.lines = []
        self.result = None
        self.error = None
        self.started = time.time()
        self.cancelled = False
        self.progress = {}
        self.pending = ""
        self.output_lock = threading.Lock()

    def write(self, text):
        # print 会把标签、值、换行分成多次 write；整行拼好再脱敏、落盘。
        with self.output_lock:
            self.pending += str(text)
            while "\n" in self.pending:
                line, self.pending = self.pending.split("\n", 1)
                self._line(line)

    def _line(self, line):
        if line.strip():
            self.lines.append(line.rstrip())
            del self.lines[:-2000]
            file_log(line)

    def flush(self):
        with self.output_lock:
            if self.pending:
                self._line(self.pending)
                self.pending = ""

    def view(self, since=0):
        return {"id": self.id, "kind": self.kind, "status": self.status, "lines": self.lines[since:], "next": len(self.lines),
                "result": self.result if self.status != "running" else None, "error": self.error,
                "seconds": int(time.time() - self.started), "progress": self.progress}


class Tee(io.TextIOBase):
    """任务运行期间，任务打印的内容同时写进任务日志和控制台。"""
    def __init__(self, job, original):
        self.job, self.original = job, original

    def write(self, s):
        self.job.write(s)
        try:
            self.original.write(s)
        except Exception:
            pass
        return len(s)

    def flush(self):
        # 不提前落盘半行：敏感字段和值可能分别 write / flush，任务结束再收尾。
        try:
            self.original.flush()
        except Exception:
            pass


JOBS = {}
JOB_LOCK = threading.Lock()


def start_job(kind, fn, *args):
    with JOB_LOCK:
        if any(j.status == "running" for j in JOBS.values()):
            raise RuntimeError("还有任务在进行，请等它结束")
        job = Job(kind)
        JOBS[job.id] = job

    def run():
        tee = Tee(job, sys.__stdout__)
        try:
            with contextlib.redirect_stdout(tee):
                job.result = fn(job, *args)
            job.status = "done"
        except Exception as error:
            job.error = f"{type(error).__name__}: {error}"
            tee.write(traceback.format_exc())
            job.status = "error"
        finally:
            job.flush()
            tee.flush()
        log(f"任务 {kind} 结束：{job.status}")

    threading.Thread(target=run, daemon=True).start()
    return job


def job_running():
    return any(j.status == "running" for j in JOBS.values())


# ---------------------------------------------------------------- Metadata jobs
WEB_KEYS = ('web_info','source_checks','source_ids','source','source_id','source_id_origin',
            'name','summary','maker','cover_url','tags','play_tags','region_locked')

def registry_for_payload(payload, sources=None):
    from src.sources import default_registry, source_key
    config=copy.deepcopy(payload.get('sourceConfig') or {})
    return default_registry(config)

def selected_sources(payload):
    from src.sources import source_key
    config=payload.get('sourceConfig') or {}
    enabled=[key for key in ('steam','bangumi') if (config.get(key) or {}).get('enabled') is True]
    custom=config.get('custom_sources') or []
    if isinstance(custom,dict):custom=[dict(value,key=key) for key,value in custom.items()]
    enabled += [entry['key'] for entry in custom if isinstance(entry,dict) and entry.get('key') and entry.get('enabled') is True]
    requested=payload.get('sources',enabled) or []
    return list(dict.fromkeys(source_key(key) for key in requested if source_key(key) in enabled))


def job_enrich(job,payload):
    from src.sources import enrich_record, manual_id_source
    records=copy.deepcopy(payload.get('records') or []);sources=selected_sources(payload)
    if not sources:return {'changed':{},'stats':{},'status':'unconfigured','note':'未启用资料来源，未联网'}
    registry=registry_for_payload(payload,sources)
    for adapter in registry.sources.values():adapter.cancelled=lambda:job.cancelled
    changed={};stats={};failures={};consecutive={};stopped=set()
    limit=max(1,int(payload.get('limit') or len(records) or 1));records=records[:limit]
    for index,record in enumerate(records):
        if job.cancelled:break
        job.progress={'text':f'来源资料 {index+1}/{len(records)}','done':index,'total':len(records)}
        before=copy.deepcopy(record)
        # One failed record never disables a source for the remainder of a run.
        for source in sources:
            if job.cancelled:break
            manual_source=manual_id_source(record)
            if manual_source and source!=manual_source:continue
            if source in stopped:
                failures[source]['skipped']+=1;continue
            prior=copy.deepcopy((record.get('source_checks') or {}).get(source))
            enrich_record(record,registry,sources=[source],refresh=payload.get('mode') in ('refresh','all'),retry_not_found=bool(payload.get('retry')))
            check=(record.get('source_checks') or {}).get(source) or {}
            if check==prior:continue
            state=check.get('status','unchecked');stats[state]=stats.get(state,0)+1
            if state in ('network_error','source_error','invalid_response','access_denied','rate_limited','cooldown'):
                failure=failures.setdefault(source,{'source':source,'count':0,'skipped':0,'blocked':False})
                failure['count']+=1;consecutive[source]=consecutive.get(source,0)+1
                if state in ('access_denied','rate_limited','cooldown') or consecutive[source]>=5:
                    stopped.add(source);failure['blocked']=state in ('access_denied','rate_limited','cooldown')
            else:consecutive[source]=0
        if record!=before:changed[record['id']]={key:record[key] for key in WEB_KEYS if key in record}
    stats['requests']=sum(source.requests for source in registry.sources.values())
    stats['networkFailed']=sum(value['count'] for value in failures.values())
    print(f'资料处理完成：{len(changed)} 条有变化，{stats["networkFailed"]} 次读取失败')
    return {'changed':changed,'stats':stats,'sourceFailures':list(failures.values()),'cancelled':bool(job.cancelled),
            'status':'cancelled' if job.cancelled else 'partial' if failures else 'ok',
            'note':'成功结果可应用；读取失败保留现有资料，下次可重试' if failures else ''}

def job_enrich_ids(job,payload):
    from src.sources import manual_id_source
    daily=copy.deepcopy(payload);records=[];sources=[]
    for record in daily.get('records') or []:
        source=manual_id_source(record)
        if not source and record.get('source') and record.get('source_id'):
            record['source_id_origin']='manual';source=str(record['source']).lower()
        if source:records.append(record);sources.append(source)
    daily.update(records=records,sources=list(dict.fromkeys(sources)),mode='refresh')
    response=job_enrich(job,daily)
    response['note']='按人工编号取详情；失败保留现有内容，不退回名称搜索'+('；'+response['note'] if response.get('note') else '')
    return response


# ---------------------------------------------------------------- 新增作品：拆发布文字
# 两个可选的符号，原文里本来都没有：
#   名称 | 其余     「|」前面原样当名称（自动拆错时用）
#   @作者          一直到下一个 #、[、【、| 或行尾
RELEASE_AUTHOR_RE = re.compile(r"(?:^|\s)[@＠]\s*(.+?)(?=\s+[#\[【|｜]|$)")
RELEASE_NAME_RE = re.compile(r"^(.*?\S)\s+[|｜]\s+(.*)$")


def parse_release(line):
    from src.importers import core as k
    line = str(line).strip()
    author = ""
    m = RELEASE_AUTHOR_RE.search(line)
    if m:
        author = m.group(1).strip()
        line = (line[:m.start()] + " " + line[m.end():]).strip()
    fixed_name = ""
    m = RELEASE_NAME_RE.match(line)
    if m:
        fixed_name, line = m.group(1).strip(), m.group(1).strip() + " " + m.group(2).strip()
    with contextlib.redirect_stdout(io.StringIO()):
        d = k.extract_game_details(line)
    base = {d.get("main_genre"), d.get("platform"), d.get("translation")}
    name = fixed_name or d.get("raw_name") or d.get("title") or line
    # 母版里「更新」作品的名称带着「更新 」前缀（看板显示时会去掉），这里保持一致
    if not fixed_name and d.get("is_update") and re.match(r"\s*更新", line) and not name.startswith("更新"):
        name = "更新 " + name
    return {
        "author": author,
        "name": name, "version": d.get("version") or "", "genre": d.get("main_genre") or "", "platform": d.get("platform") or "",
        "translation": d.get("translation") or "", "size_str": d.get("size_str") or "", "size_mb": d.get("size_mb") or 0,
        "tags": [t for t in dict.fromkeys((d.get("play_tags") or []) + (d.get("tags") or [])) if t and t not in base],
        "play_tags": d.get("play_tags") or [], "theme_tags": d.get("theme_tags") or [], "perks": d.get("perks") or [],
        "cheats": d.get("cheats") or [], "types": d.get("types") or [], "aliases": d.get("aliases") or [],
        "en_title": d.get("en_title") or "", "orig_title": d.get("orig_title") or "", "source_id": "",
        "updated": bool(d.get("is_update")),
    }


# ---------------------------------------------------------------- Optional cover lookup
def job_steam_covers(job,payload):
    registry=registry_for_payload(payload,['steam']);covers={};notes=[]
    for identifier in [str(a) for a in payload.get('appids') or [] if str(a).isdigit()][:300]:
        if job.cancelled:break
        response=registry.detail('steam',identifier)
        info=response.get('info') or {};cover=info.get('cover_url') or info.get('cover')
        if cover:covers[identifier]=cover
        else:notes.append('官方目录接口没有封面；请导入有权使用的 JSON 图片资料或手选图片')
    return {'covers':covers,'note':'；'.join(dict.fromkeys(notes)),'status':'limited' if notes else 'ok'}


# ---------------------------------------------------------------- Optional read-only share jobs
def job_quark_scan(job,payload):
    from folder_jobs import run_folders
    return run_folders(job,payload)

def job_quark_sizes(job,payload):
    from folder_jobs import run_folders
    return run_folders(job,payload,'sizes')

def job_quark_checks(job,payload):
    from folder_jobs import run_folders
    return run_folders(job,payload,'checks')

# ---------------------------------------------------------------- Daily routine
def daily_source_url(record,site):
    from src.sources import source_info
    return source_info(record.get('web_info'),site).get('url')

def daily_missing_cover(record):
    return not any(record.get(k) for k in ('has_cover','cover_off','cover','cover_url')) and not (record.get('web_info') or {}).get('cover_url')

def job_daily_routine(job,payload):
    daily=copy.deepcopy(payload);records=daily.get('records') or [];sources=selected_sources(daily)
    before=copy.deepcopy(records)
    result={'quark':None,'quarkHealth':None,'shareChecks':[],'enrich':None,'refCovers':None,'sources':sources,'tally':{},'errors':{}}
    from folder_jobs import enabled, check_shares, run_folders, ScanCache, CACHE_PATH
    if enabled(daily) and not job.cancelled:
        try:
            result['shareChecks']=check_shares(job,daily)
            # The page supplies the last seven days; never scan older members of those collections.
            recent_ids={record['id'] for record in records}
            for share in daily.get('shares') or []:
                share['records']=[record for record in share.get('records') or [] if record.get('id') in recent_ids]
            daily['shares']=[share for share in daily.get('shares') or [] if share.get('records')]
            result['quark']=run_folders(job,daily,keep_cache=True)
            if not job.cancelled:result['quarkHealth']=run_folders(job,daily,'checks',keep_cache=True)
            if result['quark'].get('status')=='partial':result['errors']['quark']='部分分享未完整读取，下次继续'
            health=result.get('quarkHealth') or {}
            summaries=result['quark'].get('summary',[])+health.get('summary',[])
            if not job.cancelled and all(row.get('complete') for row in summaries):ScanCache(CACHE_PATH).forget_completed()
        except Exception as error:result['errors']['quark']=type(error).__name__+'：分享读取失败，保留现有内容'
    if sources and not job.cancelled:
        try:
            result['enrich']=job_enrich(job,daily)
            for record in records:record.update(result['enrich'].get('changed',{}).get(record['id'],{}))
            if result['enrich'].get('status')=='partial':result['errors']['enrich']='部分来源读取失败，成功结果可应用'
        except Exception as error:result['errors']['enrich']=type(error).__name__+'：资料读取失败'
    sites=[site for site in daily.get('sites') or [] if site.get('enabled',True) and (site.get('lastCheck') or {}).get('status') not in ('blocked','needs_template')]
    if not sites:result['refCovers']={'status':'unconfigured','skipped':'未配置可用的参考网站，未联网找图','candidates':[],'stats':{}}
    elif not job.cancelled:
        try:
            from ref_sites import find_covers
            result['refCovers']=find_covers([r for r in records if daily_missing_cover(r)],sites,job=job)
            if result['refCovers'].get('stats',{}).get('networkFailed'):result['errors']['refCovers']='部分参考网站没连上，未算作没找到'
        except Exception as error:result['errors']['refCovers']=type(error).__name__+'：参考网站读取失败'
    prior={record['id']:record for record in before}
    for source in sources:
        counts=dict.fromkeys(('new_matched','existing','not_found','blocked','recent_skipped','unrequested','other'),0)
        for record in records:
            check=(record.get('source_checks') or {}).get(source) or {};status=check.get('status','unrequested');old=prior.get(record['id'],{})
            old_check=(old.get('source_checks') or {}).get(source) or {};unchanged=check==old_check
            if daily_source_url(old,source) or old_check.get('status')=='matched':key='existing'
            elif status=='matched':key='new_matched'
            elif status=='genuine_not_found':key='recent_skipped' if unchanged else 'not_found'
            elif unchanged:key='unrequested'
            elif status in ('access_denied','rate_limited','cooldown'):key='blocked'
            elif status in ('unrequested','disabled','unconfigured','configuration_required'):key='unrequested'
            else:key='other'
            counts[key]+=1
        result['tally'][source]=counts
    result['blockedCount']=sum(counts.get('blocked',0) for counts in result['tally'].values())
    configured=bool(sources or sites or enabled(daily))
    result['status']='cancelled' if job.cancelled else 'partial' if result['errors'] else 'ok' if configured else 'unconfigured'
    result['cancelled']=bool(job.cancelled)
    return result

# ---------------------------------------------------------------- Generic workbook/CSV import
def job_legacy_import(job,payload):
    from src.importers.column_mapping import import_table,align_stable_ids,ui_records
    data=base64.b64decode(payload['fileBase64'])
    meta,records=import_table(data,filename=payload.get('fileName','import.xlsx'),mapping=payload.get('columnMapping') or {})
    workbook=meta.pop('_workbook',{})
    previous=payload.get('sources') or [];records=align_stable_ids(records,previous)
    return {'meta':meta,'views':ui_records(records),'base':{v['id']:{k:value for k,value in v.items() if k!='source_record'} for v in ui_records(previous)},
            'parseIssues':meta.get('parse_issues') or [],'workbook':workbook}


# ---------------------------------------------------------------- HTTP
class Helper:
    def __init__(self, root, master):
        self.root, self.master = root, master
        self.token = secrets.token_urlsafe(24)
        self.port = None
        self.last_beat = None
        self.started = time.time()
        self.stop = threading.Event()

    def page(self):
        with open(self.master, encoding="utf-8") as f:
            html = f.read()
        info = json.dumps({"token": self.token, "version": VERSION, "masterName": os.path.basename(self.master),
                           "root": self.root}, ensure_ascii=False).replace("<", "\\u003c")
        inject = f"<script>window.__HELPER__={info};</script>"
        return html.replace("<head>", "<head>" + inject, 1) if "<head>" in html else inject + html


def make_handler(helper):
    class Handler(BaseHTTPRequestHandler):
        server_version = ENGLISH_NAME + "Helper/" + VERSION

        def log_message(self, fmt, *args):
            pass

        def send(self, code, body, ctype="application/json; charset=utf-8"):
            data = body if isinstance(body, bytes) else (json.dumps(body, ensure_ascii=False) if not isinstance(body, str) else body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def allowed(self, need_token=True):
            # 只接受本机地址的 Host（防 DNS rebinding），带了 Origin 的必须是同源，接口还要带令牌
            host = (self.headers.get("Host") or "").lower()
            if host not in (f"127.0.0.1:{helper.port}", f"localhost:{helper.port}"):
                return False
            origin = self.headers.get("Origin")
            if origin and origin not in (f"http://127.0.0.1:{helper.port}", f"http://localhost:{helper.port}"):
                return False
            return not need_token or secrets.compare_digest(self.headers.get("X-Helper-Token", ""), helper.token)

        def body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 200 * 1024 * 1024:
                raise ValueError("内容太大")
            return self.rfile.read(n)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path in ("/", "/index.html"):
                if not self.allowed(need_token=False):
                    return self.send(403, {"error": "只接受本机访问"})
                return self.send(200, helper.page(), "text/html; charset=utf-8")
            if not self.allowed():
                return self.send(403, {"error": "令牌不对"})
            if path == "/api/ping":
                return self.send(200, {"ok": True, "version": VERSION, "master": os.path.basename(helper.master)})
            if path.startswith("/api/jobs/"):
                job = JOBS.get(path.rsplit("/", 1)[1])
                if not job:
                    return self.send(404, {"error": "没有这个任务"})
                since = int((self.path.split("since=") + ["0"])[1].split("&")[0] or 0)
                return self.send(200, job.view(since))
            self.send(404, {"error": "没有这个地址"})

        def do_POST(self):
            if not self.allowed():
                return self.send(403, {"error": "令牌不对"})
            path = self.path.split("?")[0]
            try:
                if path == "/api/heartbeat":
                    helper.last_beat = time.time()
                    return self.send(200, {"ok": True})
                if path == "/api/offline-cover":
                    from offline_covers import download_cover
                    payload = json.loads(self.body().decode("utf-8"))
                    return self.send(200, {"data": download_cover(payload.get("url"))})
                if path == "/api/parse-release":
                    # 新增作品：用和表格导入相同的离线规则拆发布文字（不联网，很快）
                    lines = json.loads(self.body().decode("utf-8")).get("lines", [])[:200]
                    return self.send(200, {"items": [parse_release(str(line)) for line in lines]})
                if path == "/api/quit":
                    self.send(200, {"ok": True})
                    helper.stop.set()
                    return
                if path == "/api/save":
                    data = self.body()
                    if b'id="project-data"' not in data[:4_000_000] and b'id="project-data"' not in data:
                        return self.send(400, {"error": "这不是母版内容，没有保存"})
                    backup = backup_master(helper.master, os.path.join(helper.root, "备份"))
                    write_atomic(helper.master, data)
                    log(f"已保存母版（{len(data) // 1024} KB）" + (f"，备份 {os.path.basename(backup)}" if backup else ""))
                    return self.send(200, {"ok": True, "name": os.path.basename(helper.master), "backup": os.path.basename(backup) if backup else None})
                if path in ("/api/export", "/api/export-sheet"):
                    folder = "分发" if path == "/api/export" else "表格"
                    query = dict(p.split("=", 1) for p in (self.path.split("?", 1) + [""])[1].split("&") if "=" in p)
                    from urllib.parse import unquote
                    name = safe_name(unquote(query.get("name", "")), "导出.html" if folder == "分发" else "表格.xlsx")
                    out_dir = os.path.join(helper.root, folder)
                    os.makedirs(out_dir, exist_ok=True)
                    target = os.path.join(out_dir, name)
                    write_atomic(target, self.body())
                    log(f"已导出 {folder}/{name}")
                    return self.send(200, {"ok": True, "name": name, "folder": folder, "path": target})
                if path in ("/api/enrich", "/api/enrich-ids", "/api/quark-scan", "/api/quark-sizes", "/api/quark-checks", "/api/daily-routine", "/api/legacy-import", "/api/steam-covers", "/api/ref-covers", "/api/ref-sites-check", "/api/ref-image-next"):
                    payload = json.loads(self.body().decode("utf-8"))
                    fn = {"/api/daily-routine": job_daily_routine, "/api/enrich": job_enrich, "/api/enrich-ids": job_enrich_ids, "/api/quark-scan": job_quark_scan, "/api/quark-sizes": job_quark_sizes, "/api/quark-checks": job_quark_checks, "/api/legacy-import": job_legacy_import, "/api/steam-covers": job_steam_covers, "/api/ref-covers": job_ref_covers, "/api/ref-sites-check": job_ref_check, "/api/ref-image-next": job_ref_next}[path]
                    job = start_job(path.rsplit("/", 1)[1], fn, payload)
                    return self.send(200, {"job": job.id})
                if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                    job = JOBS.get(path.split("/")[3])
                    if job:
                        job.cancelled = True
                    return self.send(200, {"ok": True})
                self.send(404, {"error": "没有这个地址"})
            except Exception as error:
                log("出错：", error)
                self.send(500, {"error": f"{type(error).__name__}: {error}"})

    return Handler


def existing_instance():
    """已经有一个小助手在运行：返回它的地址。"""
    try:
        with open(INSTANCE_FILE, encoding="utf-8") as f:
            info = json.load(f)
        req = urllib.request.Request(f"http://127.0.0.1:{info['port']}/api/ping", headers={"X-Helper-Token": info["token"]})
        with urllib.request.urlopen(req, timeout=2) as resp:
            if json.load(resp).get("ok"):
                return f"http://127.0.0.1:{info['port']}/"
    except Exception:
        return None
    return None


def find_master(root):
    candidates = [os.path.join(root, f) for f in os.listdir(root) if f.lower().endswith(".html") and "母版" in f]
    return max(candidates, key=os.path.getmtime) if candidates else None


def main():
    global FILE_LOG
    parser = argparse.ArgumentParser(description=NAME + "小助手")
    parser.add_argument("--root", default=os.path.dirname(HELPER_DIR), help="母版所在的文件夹（默认是助手文件夹的上一层）")
    parser.add_argument("--master", help="母版文件；默认用 root 里文件名带「母版」的、最近改过的那个")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()
    root = os.path.abspath(args.root)
    from helper_logs import DailyLog
    FILE_LOG = DailyLog(root)
    try:
        return run_helper(args, root)
    except Exception:
        log("小助手出错：\n" + traceback.format_exc())
        return 1
    finally:
        log("小助手已退出。")


def run_helper(args, root):
    master = os.path.abspath(args.master) if args.master else find_master(root)
    if not master or not os.path.isfile(master):
        log(f"在 {root} 里找不到母版（文件名里要有「母版」两个字）。")
        input("按回车关闭……") if sys.stdin and sys.stdin.isatty() else None
        return 1
    running = existing_instance()
    if running:
        log("小助手已经在运行，直接打开它的页面。")
        if not args.no_browser:
            webbrowser.open(running)
        return 0

    helper = Helper(root, master)
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(helper))
    helper.port = server.server_address[1]
    url = f"http://127.0.0.1:{helper.port}/"
    with open(INSTANCE_FILE, "w", encoding="utf-8") as f:
        json.dump({"port": helper.port, "token": helper.token, "pid": os.getpid()}, f)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"{NAME}小助手 {VERSION} 已启动：{url}")
    log(f"母版：{master}")
    log("关掉浏览器里的母版页面后，这个窗口会自己退出。")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        while not helper.stop.wait(3):
            now = time.time()
            if job_running():
                continue
            if helper.last_beat is None and now - helper.started > FIRST_BEAT_TIMEOUT:
                log("一直没有页面连上，退出。")
                break
            if helper.last_beat is not None and now - helper.last_beat > BEAT_TIMEOUT:
                log("母版页面已经关闭，退出。")
                break
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        try:
            os.remove(INSTANCE_FILE)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
