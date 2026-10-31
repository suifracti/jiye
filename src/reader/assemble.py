# -*- coding: utf-8 -*-
"""
把 src/reader/ 下的源码拼成看板模板（带 __UI_META__ / __UI_RECORDS__ 两个数据占位）。

kanban.py 生成分发版、tools/build_master.py 生成母版，都从这里取模板，保证两边是同一套看板。
"""
import importlib.util
import json
import os
import re

_product_spec = importlib.util.spec_from_file_location("product", os.path.join(os.path.dirname(__file__), "../shared/product.py"))
_product = importlib.util.module_from_spec(_product_spec)
_product_spec.loader.exec_module(_product)

READER_DIR = os.path.dirname(os.path.abspath(__file__))
_INCLUDE = re.compile(r"/\*@include ([\w.-]+)\*/")


def _read(name):
    if name == "image-codec.js":
        name = "../shared/image-codec.js"
    with open(os.path.join(READER_DIR, name), encoding="utf-8", newline="") as f:
        text = _product.apply_identity(f.read())
    if name == "reader-images.js":
        spec = importlib.util.spec_from_file_location("image_codec", os.path.join(READER_DIR, "../shared/image_codec.py"))
        codec = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(codec)
        prefix, data = text.split("=", 1)
        return prefix + "=" + json.dumps(codec.protect(json.loads(data.strip().rstrip(";"))), separators=(",", ":")) + ";"
    return text


def reader_template():
    return _INCLUDE.sub(lambda m: _read(m.group(1)), _read("reader.shell.html"))
