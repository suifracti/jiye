#!/usr/bin/env python3
"""公开前检查：工作树、暂存区、全部 Git 历史、HTML 数据和 ZIP 内层。

仅用标准库，不执行被扫描脚本。检查源码、完整 Git 历史、ZIP 附件及可解码数据。
"""
import base64
from bisect import bisect_right
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import urllib.parse
import zipfile
import zlib

MAX_BYTES = 256 * 1024 * 1024
# 固定依赖包、包内上游文件和原许可证的公开作者邮箱可保留。
# 内容一旦改变即重新检查；不按目录或扩展名整体豁免。
UPSTREAM_EMAIL_HASHES = {
    '010e3fd9c354132507947a3e63719debef12ffa7b229de798d83b87a1db7507c',
    '0497ee6846cd92419ada56c091ab675ab6896ad3bfdcf88eec4dcda2cdfd5a4d',
    '0527fee5192ab4567451d1296533600661571f6ebf9e8f4e0f60b63a4a4fd2e8',
    '0e97d7ea909ed0fbe03d88bc8b6f58677cee1b07bd3353ce361cd2405915204e',
    '18041441b3f558925f903bc7af644a4d84b1cd746a4998748b4fffd82e767a6b',
    '18a77c4e1f4a71ca60b9dbbba809e98cd324f3e1470d091689b87754a8c65588',
    '196c42414c16e804874988783b8a356bf1d012d32e99efbc6e360e94920c46ec',
    '1e2e1ede7eeaf30a80ece546420dec67a02716e25d3a7c638e4deb0c21e973a1',
    '1e6c90014b4912815c296ee64bb6f6280af47e6d4c5d80e86232dfc5defe764c',
    '23f80ca9830dd89435da1710f26deda8f81e5409287e74540210c72627a4ad96',
    '2ed7ccda80e9e28ab5877902a9a325586c8a7b7b3e6731d944565bee082e216c',
    '31aff8dca815a05904b5d3020fbdd5bdb596b6a07a36f31728996f28e06dab24',
    '36d775e2c2fa5bbda86ddc7c6ea632414df04f7a403b9e17587c99088d29cd7b',
    '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f',
    '49df86fe76ed8fd97bb11a485286b49f5f5ebe953383648976a39c9de6f0524d',
    '4e24680bce514188c85ae91323691dcb0364990da0d6319558519e50cbb5a43c',
    '526d977236cc63895902977f216bf3ca93a4233489240656b295eafb6f518d07',
    '5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2',
    '5366924c1c96d9c9f82f95967fbf73244d4b4930f39103d7e7ba2b01046e0a46',
    '58b3e50104db6bf9d76e3d8106f9f477d34109a887d547ee086b0289e6a4e224',
    '5c47df970d2e8cc41239754ff167056fcecb1089f876736e51dab5d89f980300',
    '5dee7b9fff3e6d0abe20601b9e62f3a14cd048167ee0b80781131dc81dec9469',
    '75495fe0e079ab00d49be740d3c710a0b94e3f74f9648cb7cc9f768fc7f52319',
    '7681b4d88ac96763bb89f018d1c658feeca782d8bfc6d223b06d2ef125780579',
    '7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa',
    '7e2cdd954b44b1be1fac1c354f774dab5f5becfce59688e62338427b125c62bf',
    '82ac94eb74fa0eb500355219bc585228716759ed255c385c5e32dd28ddbaf03f',
    '854fe7549eb4b2ac478935a38ae2ca1b774c6fdc3d87f0263fbd697ff86d7149',
    '8957182a9c385bfd9f3f790921de2ddc614cf91f99edbed4e9e5446a46504e32',
    '8d723cf908852e0ae02d6ad4451a0214ce7c7a09aa6d9a4a7fc48024583f8494',
    '9099ef451fe61d8feef9e02894902b88fdc8ee404e3f8b7412b150878c973803',
    '935cf13e19f8c31b497d20b05d73623431a226b230c3599bc30fa3348979bc68',
    '957e154ad7f350d2b48edad5b2fb213c436eec4ff3422ae0964c91b73183c048',
    'a299bb19533678f42fa4dcca4fe5b9eaefb4c8ff25892f56264c69ce91bfb44d',
    'a341519a00befc3b86dfddf5938915fed52ded1ad5aab518c57d0b3c8969e835',
    'a7146c08f89fe5b04541ab507cdb59ff7b44534d4ba3c668a426c6450a03434e',
    'a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310',
    'aaea8a20db7a7a96d4bef74ad724c4a02595a9c47659f6cbd6f145af0c97aa78',
    'ae139e43ac0d1fa8f0ef71b8236e3656d6e6c8cf1fbdd355c0eb0e8c9949e935',
    'b02f580daa0b390b2228d2a8186ef119be658c89cc64d0bd909550786ed993f2',
    'b96680c6bcad9e9403711ec0977866325e8e5aab93b56e83c3df6280ae72a82a',
    'cdf82faa904e557b847a0ac6e97b4274945615fdbd319a28bcaa1f70f740636f',
    'd1f4225df2cd877dbf130d5668a021dce3f94118455ff5ec952061c30afc9ce7',
    'd53b1e8ad2cdb815fb2cb604ed3123372f5a28c6f447571244aca36fc62a286f',
    'dfa08b46ce09089b7e6bc139784d5609a07770bab66df8d37938ca9bd508e436',
    'e69caeadb409777bce26f78622653558bbb86f08479b412399eaa0e6fd1e44f1',
    'eca5d3df23b762c846801194b6c971aae4eb288e1fc2914752b3a6c2df5aebfb',
    'eff52743773eb550fcc6ce3efc37c85724502233b6b002a35496d828bd7b280a',
    'f9acdbcf3383a52353f8d7db3cbda3d3701b1cf7ac3053985fdac766c29e7808',
}
# 官方 CPython 标准库的格式字符串教程含 Windows 路径示例；只按原文件指纹识别。
UPSTREAM_PATH_HASHES = {'c6aac1246e54f152b587fa6ed1448a550f75333d39350b16bd081728df3e6940'}
SKIP_DIRS = {'.git', '__pycache__', 'node_modules', '.venv', 'venv', '.pytest_cache'}
SHARES = re.compile(r'https?://(?:pan\.quark\.cn/s/|pan\.baidu\.com/(?:s/|share/)|www\.aliyundrive\.com/s/|www\.alipan\.com/s/|(?:www\.)?123pan\.com/s/|cloud\.189\.cn/(?:t/|web/share\?))[A-Za-z0-9_?=&%./+-]+', re.I)
EMAIL = re.compile(r'(?<![\w.+-])[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')
LOCAL_PATH = re.compile(r'(?:/(?:Users|home)/[A-Za-z0-9_.\u3400-\u9fff-]+/[^\s"\'<>]*|[A-Za-z]:[\\/]+Users[\\/]+[^\s"\'<>]+)')
CREDENTIAL = re.compile(r'''(?:\b(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|authorization|cookie|secret|password)\b\s*["']?\s*[:=]\s*["']([^"'\s]{8,})["']|\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,})|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)''', re.I)
PARAMETER = re.compile(r'''["'](?:pwd_id|fid|share_id|stoken|share_pwd|extract_code)["']\s*:\s*["']([A-Za-z0-9_+/=-]{8,})["']''', re.I)
DEMO = re.compile(r'^(?:(?:panlu|jiye)[-_]?demo|demo|example|sample|test|fixture|placeholder|fake|your[-_]|<|\$\{|\^|\\)', re.I)
IMAGE = re.compile(r'^data:(image/[\w.+-]+);base64,([\s\S]+)$')
IMAGE_INLINE = re.compile(r'(?:data:image/[\w.+-]+;base64,[A-Za-z0-9+/=]+|(?:enc[12]|img2):[A-Za-z0-9_.+/=-]+)')
JSON_DECODER = json.JSONDecoder()


def image_bytes(value):
    """读取普通 data URI、img2 压缩与旧 enc1（仅迁移解码）。"""
    match = IMAGE.match(value)
    if match:
        return base64.b64decode(match[2])
    if not value.startswith(('enc1:', 'enc2:', 'img2:')):
        return None
    text = value[5:].replace('.', '')
    packed = base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))
    if value.startswith('enc1:'):
        key = b'catalog-images-v1'
        packed = bytes(b ^ key[i % len(key)] for i, b in enumerate(packed))
    raw = inflate(packed)
    # 压缩图片带 MIME 长度；另兼容直接压缩的 data URI。
    if raw.startswith(b'data:'):
        return image_bytes(raw.decode('utf-8'))
    size = raw[0]
    if not raw[1:1 + size].startswith(b'image/'):
        raise ValueError('图片 MIME 头不正确')
    return raw[1 + size:]


def inflate(raw):
    decompressor = zlib.decompressobj()
    out = decompressor.decompress(raw, MAX_BYTES + 1)
    if len(out) > MAX_BYTES or decompressor.unconsumed_tail:
        raise ValueError('解压内容超过检查上限')
    if not decompressor.eof:
        raise ValueError('压缩数据不完整')
    return out


def unpack(value):
    if value.get('codec') in {'deflate-base64', 'zlib-base64'}:
        value = json.loads(inflate(base64.b64decode(value['data'])).decode('utf-8'))
    if isinstance(value, dict) and value.get('format') == 'catalog-shared-v1' and 'strings' in value:
        strings, keys = value['strings'], value.get('keys')
        def decode(item):
            if isinstance(item, str):
                return strings[int(item[2:])] if item.startswith('~@') else item[1:] if item.startswith('~~') else item
            if isinstance(item, list):
                return [decode(x) for x in item]
            if isinstance(item, dict):
                return {(keys[int(k)] if keys else k): decode(x) for k, x in item.items()}
            return item
        return decode(value['data'])
    return value


class Scanner:
    def __init__(self):
        self.findings = []
        self.counts = {'files': 0, 'history_blobs': 0, 'decoded': 0, 'archives': 0, 'images': 0}
        self._reported = set()
        self._seen_bytes = set()
        self._upstream_labels = set()


    def hit(self, label, line, reason):
        key = (label, line, reason)
        if key not in self._reported:
            self._reported.add(key)
            self.findings.append(key)

    def text(self, text, label, *, skip_email=False, skip_path=False):
        newlines = [m.start() for m in re.finditer('\\n', text)]
        for pattern, reason in ((SHARES, '真实分享链接'), (LOCAL_PATH, '本机绝对路径'), (EMAIL, '个人邮箱'), (CREDENTIAL, '凭据'), (PARAMETER, '真实访问参数')):
            if pattern is None or skip_email and pattern is EMAIL or skip_path and pattern is LOCAL_PATH:
                continue
            for match in pattern.finditer(text):
                if pattern is EMAIL:
                    address = match[0].lower()
                    domain = address.rsplit('@', 1)[1]
                    # GitHub 隐私邮箱与标准示例地址不是私人联系方式。
                    if domain == 'users.noreply.github.com' or domain in {'example.com', 'example.org', 'example.net'}:
                        continue
                    # 已分发依赖的版权/作者元数据保留；私人清单仍正常匹配。
                    if any(label == item or label.startswith(item + '!') for item in self._upstream_labels):
                        continue
                if pattern in (CREDENTIAL, PARAMETER):
                    value = match[1] if match.lastindex else match[0]
                    if DEMO.match(value) or re.search(r'(?:^|[-_])(?:demo|example|sample|fixture|fake|test)(?:$|[-_0-9])', value, re.I) or value in {'application/json', 'credentials', 'same-origin', 'include', 'omit', 'folder-a', 'folder-b'}:
                        continue
                line = bisect_right(newlines, match.start()) + 1
                self.hit(label, line, reason)

    def walk(self, value, label, depth=0):
        if depth > 24:
            self.hit(label, 1, '嵌套过深，未完成检查')
            return
        if isinstance(value, dict):
            if value.get('codec') in {'deflate-base64', 'zlib-base64'} or value.get('format') == 'catalog-shared-v1' and 'strings' in value:
                try:
                    restored = unpack(value)
                    self.counts['decoded'] += 1
                    self.walk(restored, label + ':decoded', depth + 1)
                except (ValueError, KeyError, IndexError, TypeError, zlib.error) as error:
                    self.hit(label, 1, '压缩数据无法解码: ' + type(error).__name__)
                return
            for key, item in value.items():
                self.walk(item, label + '/' + str(key), depth + 1)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                self.walk(item, label + '/' + str(index), depth + 1)
        elif isinstance(value, str):
            self.text(value, label)
            if value.startswith(('data:image/', 'enc1:', 'enc2:', 'img2:')):
                try:
                    raw = image_bytes(value)
                    self.counts['images'] += 1
                    self.binary(raw, label + ':image', depth + 1)
                except (ValueError, IndexError, zlib.error) as error:
                    self.hit(label, 1, '图片无法解码: ' + type(error).__name__)
            elif '<script' in value or 'window.__' in value or value.lstrip().startswith(('{', '[')):
                self.decode_text(value, label + ':nested', depth + 1)

    def decode_text(self, text, label, depth=0):
        starts = [m.end() for m in re.finditer(r'<script\b[^>]*type=["\']application/json["\'][^>]*>|(?:window\.)?__(?:GAME_RECORDS|GLOBAL_META|CATALOG_IMAGES|PANLU_RECORDS|PANLU_META|JIYE_RECORDS|JIYE_META)__\s*=\s*', text, re.I)]
        stripped = text.lstrip()
        if re.match(r'(?:\{\s*["}]|\[\s*[\]{"0-9-])', stripped):
            starts.insert(0, len(text) - len(stripped))
        for start in starts:
            try:
                body = text[start:].lstrip()
                if body.startswith('__') or not body.startswith(('{', '[', '"')):
                    continue  # 源码模板占位，不是产物数据。
                value, _ = JSON_DECODER.raw_decode(body)
                self.walk(value, label + ':json', depth + 1)
            except (ValueError, RecursionError) as error:
                self.hit(label, text.count('\n', 0, start) + 1, '嵌入 JSON 无法解码: ' + type(error).__name__)
        for match in IMAGE_INLINE.finditer(text):
            self.walk(match[0], label + ':embedded-image', depth + 1)

    def binary(self, raw, label, depth=0):
        if raw is None:
            return
        filename = label.rsplit('!', 1)[-1].split('@', 1)[0].lower()
        if Path(filename).suffix in {'.xlsx', '.xls', '.csv', '.tsv', '.sqlite', '.db', '.jsonl', '.docx', '.pdf'} and not re.search(r'(?:demo|test|fixture|template|模板|示例|样例)', filename):
            self.hit(label, 1, '未标明演示或模板的数据附件')
        sha = hashlib.sha256(raw).hexdigest()
        if sha in UPSTREAM_EMAIL_HASHES:
            self._upstream_labels.add(label)
        # 同一 Git blob/图片只解一次。
        if sha in self._seen_bytes:
            return
        self._seen_bytes.add(sha)
        if depth > 24 or len(raw) > MAX_BYTES:
            self.hit(label, 1, '附件过大或嵌套过深，未完成检查')
            return
        if raw.startswith(b'PK\x03\x04'):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    self.counts['archives'] += 1
                    for item in archive.infolist():
                        if item.is_dir():
                            continue
                        inner = label + '!' + item.filename
                        self.text(item.filename, inner + ':filename')
                        if item.file_size > MAX_BYTES:
                            self.hit(inner, 1, '附件超过检查上限')
                            continue
                        self.binary(archive.read(item), inner, depth + 1)
            except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
                self.hit(label, 1, 'ZIP 无法解包: ' + type(error).__name__)
            return
        # 图片/编译文件只检查可读元数据；压缩容器已在上面逐项展开。
        if b'\0' in raw[:8192]:
            text = '\n'.join(m[0].decode('ascii') for m in re.finditer(rb'[\x20-\x7e]{12,}', raw))
        else:
            text = raw.decode('utf-8', errors='replace')
        self.text(text, label, skip_path=sha in UPSTREAM_PATH_HASHES)
        if re.search(r'%[0-9a-f]{2}', text, re.I):
            self.text(urllib.parse.unquote(text), label + ':url-decoded', skip_email=sha in UPSTREAM_EMAIL_HASHES, skip_path=sha in UPSTREAM_PATH_HASHES)
        self.decode_text(text, label, depth)


def git(root, *args, check=True):
    return subprocess.run(['git', '-C', str(root), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check).stdout


def scan_path(path, history=True):
    """扫描目录或单独发布附件；不需要目标已有提交。"""
    root = Path(path).resolve()
    scanner = Scanner()
    if not root.exists():
        scanner.hit(str(root), 1, '扫描目标不存在')
        return scanner
    repository = root.is_dir() and (root / '.git').exists()
    if root.is_file():
        files = [root]
    elif repository:
        # 已跟踪文件不受 ignore 影响；新文件只扫描真正的提交候选。
        try:
            names = set(git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split(b'\0'))
            files = sorted(root / name.decode('utf-8', 'surrogateescape') for name in names if name)
            files = [path for path in files if path.is_file()]
        except (OSError, subprocess.CalledProcessError) as error:
            scanner.hit('git', 1, 'Git 候选文件无法完整读取: ' + type(error).__name__)
            return scanner
    else:
        # 独立发布目录/初始化前目录没有 Git 清单，逐个扫描全部文件。
        files = sorted(p for p in root.rglob('*') if p.is_file() and not set(p.relative_to(root).parts) & SKIP_DIRS)
    for file in files:
        label = str(file.relative_to(root)) if root.is_dir() else file.name
        scanner.text(label, label + ':filename')
        if file.is_symlink() and not file.resolve().is_relative_to(root):
            scanner.hit(label, 1, '外部符号链接未检查')
            continue
        scanner.counts['files'] += 1
        try:
            scanner.binary(file.read_bytes(), label)
        except OSError as error:
            scanner.hit(label, 1, '文件无法读取: ' + type(error).__name__)
    if repository:
        try:
            # 暂存区可能和工作树不同；二者都检查。
            for row in git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not row:
                    continue
                meta, filename = row.split(b'\t', 1)
                mode, oid, stage = meta.split()
                label = 'index:' + filename.decode('utf-8', 'replace')
                if mode == b'160000':
                    scanner.hit(label, 1, '子模块内容未检查')
                else:
                    scanner.binary(git(root, 'cat-file', 'blob', oid.decode()), label)
            if history:
                revisions = git(root, 'rev-list', '--all', check=False).splitlines()
                if revisions:
                    # 邮箱逐个 blob 按精确文件指纹检查；汇总补丁没有文件豁免上下文。
                    scanner.text(git(root, 'log', '--all', '--format=fuller', '--no-patch').decode('utf-8', 'replace'), 'history:commits')
                    scanner.text(git(root, 'log', '-p', '--all', '--format=fuller', '--no-ext-diff').decode('utf-8', 'replace'), 'history:git-log', skip_email=True)
                    objects = git(root, 'rev-list', '--objects', '--all').splitlines()
                    for row in objects:
                        fields = row.split(b' ', 1)
                        oid = fields[0].decode()
                        if git(root, 'cat-file', '-t', oid).strip() != b'blob':
                            continue
                        name = fields[1].decode('utf-8', 'replace') if len(fields) > 1 else oid
                        scanner.counts['history_blobs'] += 1
                        scanner.binary(git(root, 'cat-file', 'blob', oid), 'history:' + name + '@' + oid[:10])
        except (OSError, subprocess.CalledProcessError) as error:
            scanner.hit('git', 1, 'Git 内容无法完整读取: ' + type(error).__name__)
    return scanner

