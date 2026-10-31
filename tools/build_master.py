#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成三合一母版：数据 + 编辑器 + 看板模板，放在一个 HTML 里。

    python3 -I tools/build_master.py --from-html <看板.html> --out <母版.html>
    python3 -I tools/build_master.py --from-master <旧母版.html> --out <新母版.html>   # 升级母版程序，保留数据

数据直接取看板 HTML（或旧母版）里已有的数据块，不重新解析 Excel；看板模板取自 src/reader/。
"""
import argparse
import glob
import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.shared.product import apply_identity

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER_DIR = os.path.join(ROOT, "src", "master")
SCHEMA = "catalog-master-v1"
TOKENS = re.compile(r"__MASTER_STYLE__|__MASTER_SHELL__|__READER_TEMPLATE__|__PROJECT_DATA__|__MASTER_APP__")


def _read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return apply_identity(f.read())


def _image_codec():
    spec = importlib.util.spec_from_file_location("image_codec", os.path.join(ROOT, "src", "shared", "image_codec.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _reader_template():
    spec = importlib.util.spec_from_file_location("reader_assemble", os.path.join(ROOT, "src", "reader", "assemble.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.reader_template()


def _script_json(value):
    # 与 master.js 的 scriptJson 一致：把 < 转义，内容里不会出现 </script>
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def _json_block(html, start, assign, end):
    i = html.index(start) + len(start)
    body = html[i:html.index(end, i)].strip()
    if body.startswith(assign):
        body = body[len(assign):]
    return json.loads(body.lstrip().lstrip("=").strip().rstrip(";"))


def project_from_board(board_path):
    """从 构建器生成的看板 HTML 里取出全局设置和压缩数据块，组成母版项目。"""
    html = _read(board_path)
    meta = _json_block(html, "/*__META_START__*/", "window.__GLOBAL_META__", "/*__META_END__*/")
    catalog = _json_block(html, "/*__RECORDS_START__*/", "window.__GAME_RECORDS__", "/*__RECORDS_END*/")
    if catalog.get("format") != "catalog-shared-v1" or catalog.get("codec") != "deflate-base64":
        raise SystemExit("这个看板的数据格式不是 catalog-shared-v1（deflate-base64），无法生成母版。")
    if not meta.get("collection_key"):
        raise SystemExit("看板里没有 collection_key（目录身份），无法生成母版。")
    return {
        "schema": SCHEMA,
        "catalogId": meta["collection_key"],
        "createdFrom": os.path.basename(board_path),
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "savedAt": None,
        "meta": meta,
        "catalog": catalog,
        "privateNotes": {},
        "editLog": [],
        "pinyin": pinyin_cache(catalog),
    }


def project_from_master(master_path):
    """读旧母版的数据块（不执行其中的脚本），用于升级母版程序。"""
    html = _read(master_path)
    m = re.search(r'<script type="application/json" id="project-data">(.*?)</script>', html, re.S)
    if not m:
        raise SystemExit("这个文件里找不到母版数据块。")
    project = json.loads(m.group(1))
    if project.get("schema") != SCHEMA:
        raise SystemExit(f"母版数据格式是 {project.get('schema')!r}，这个版本只认 {SCHEMA}。")
    # 升级母版程序时顺便刷新拼音缓存（保留以前的，再补上新名字）
    project["pinyin"] = {**(project.get("pinyin") or {}), **pinyin_cache(project["catalog"])}
    return project


# ---------- 拼音缓存：用 pypinyin（按词组判断多音字）给现有作品名算好拼音，母版里新加的名字再用浏览器里的单字表 ----------
def _unpack_names(catalog):
    import base64
    import zlib
    packed = json.loads(zlib.decompress(base64.b64decode(catalog["data"])).decode("utf-8"))
    strings, keys = packed["strings"], packed.get("keys")

    def decode(v):
        if isinstance(v, str):
            return strings[int(v[2:])] if v.startswith("~@") else v[1:] if v.startswith("~~") else v
        if isinstance(v, list):
            return [decode(x) for x in v]
        if isinstance(v, dict):
            return {(keys[int(k)] if keys else k): decode(x) for k, x in v.items()}
        return v

    sources, deltas = decode(packed["data"])
    views = [dict(s, **d) for s, d in zip(sources, deltas)]
    return [v for v in views if not v.get("canonical_id") or v.get("canonical_id") == v.get("id")]


def pinyin_cache(catalog):
    wheels = sorted(glob.glob(os.path.join(ROOT, "tools", "vendor", "pypinyin-*.whl")))
    if not wheels:
        print("提醒：tools/vendor 里没有 pypinyin，拼音搜索只用单字表。")
        return {}
    import tempfile
    import unicodedata
    import zipfile
    tmp = tempfile.mkdtemp(prefix="pypinyin-")
    with zipfile.ZipFile(wheels[-1]) as z:
        z.extractall(tmp)
    sys.path.insert(0, tmp)
    from pypinyin import Style, lazy_pinyin
    han = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]+|[a-z0-9]+")

    def key(text):
        syllables = []
        for seg in han.findall(unicodedata.normalize("NFKC", text).lower()):
            if seg[0].isascii():
                syllables.append(seg)
            else:
                syllables += [p for p in lazy_pinyin(seg, style=Style.NORMAL, v_to_u=False, errors="ignore") if p.isascii() and p.isalpha()]
        return (" ".join(["".join(syllables), "".join(p[0] for p in syllables)])) if syllables else ""

    cache = {}
    for v in _unpack_names(catalog):
        for name in [re.sub(r"^更新\s*", "", str(v.get("name") or ""))] + [str(a) for a in (v.get("aliases") or [])]:
            if name and name not in cache:
                cache[name] = key(name)
    return cache


def project_from_json(path):
    import sys
    if ROOT not in sys.path: sys.path.insert(0,ROOT)
    from src.shared.catalog import pack
    data=json.loads(_read(path))
    if data.get('schema')==SCHEMA:return data
    records=data.pop('records');data.pop('schema',None)
    catalog=pack(records)
    return dict(data,schema=SCHEMA,catalogId=data['meta']['collection_key'],createdFrom='原创演示',createdAt=datetime.now(timezone.utc).isoformat(),savedAt=None,catalog=catalog,pinyin=pinyin_cache(catalog))


def master_app():
    """把 src/master/js/ 下的文件按文件名顺序拼成一个脚本，放在同一个 async 函数里（共用变量）。"""
    js_dir = os.path.join(MASTER_DIR, "js")
    names = sorted(n for n in os.listdir(js_dir) if n.endswith(".js"))
    body = "\n".join(f"// ===== {n} =====\n" + _read(os.path.join(js_dir, n)) for n in names)
    return _read(os.path.join(ROOT, "src", "shared", "image-codec.js")) + "\n(async () => {\n" + body + "\n})().catch(error => {\n  const app = document.getElementById('app');\n  if (app && !app.classList.contains('fatal')) { app.className = 'fatal'; app.textContent = '母版出错了：' + (error && error.message || error); }\n  console.error(error);\n});\n"


def build_master_html(project):
    app = master_app()
    style = _read(os.path.join(MASTER_DIR, "master.css"))
    shell = _read(os.path.join(MASTER_DIR, "master.shell.html"))
    if "\u2028" in app or "\u2029" in app:
        raise SystemExit("src/master 的脚本里有 U+2028/U+2029 字符，请改用 \\u2028 转义。")
    if re.search(r"</script", app, re.I) or re.search(r"</style", style, re.I):
        raise SystemExit("src/master 的脚本 / 样式里不能出现 </script 或 </style。")
    values = {
        "__MASTER_STYLE__": style,
        "__MASTER_SHELL__": _script_json(shell),
        "__READER_TEMPLATE__": _script_json(_reader_template()),
        "__PROJECT_DATA__": _script_json(_image_codec().protect(project)),
        "__MASTER_APP__": app,
    }
    # 一次替换完，替换进去的内容不会再被扫描
    return TOKENS.sub(lambda m: values[m.group(0)], shell)


def write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser(description="生成三合一母版 HTML")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--from-json", help="原创演示或通用 JSON 目录")
    src.add_argument("--from-html", help="构建器生成的看板 HTML")
    src.add_argument("--from-master", help="旧母版 HTML（升级母版程序，数据原样保留）")
    parser.add_argument("--out", required=True, help="输出的母版 HTML")
    args = parser.parse_args()
    project = project_from_json(args.from_json) if args.from_json else project_from_board(args.from_html) if args.from_html else project_from_master(args.from_master)
    out = os.path.abspath(args.out)
    if not out.lower().endswith(".html"):
        raise SystemExit("母版文件必须使用 .html 后缀。")
    if os.path.abspath(args.from_json or args.from_html or args.from_master) == out:
        raise SystemExit("输出不能覆盖输入文件，请换一个文件名。")
    write_atomic(out, build_master_html(project))
    print(f"已生成母版：{out}（目录身份 {project['catalogId']}，{os.path.getsize(out) // 1024} KB）")


if __name__ == "__main__":
    sys.exit(main())
