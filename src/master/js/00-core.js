// 目录母版 · 核心：数据格式、项目状态、修改记录（撤销 / 重做）
// 所有改动都走 commit()，这样撤销、标记「已改」、未保存计数都在一处处理。
'use strict';
const PROGRAM_VERSION = '__PRODUCT_VERSION__';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const appRoot = $('app');

function fatal(message) {
  appRoot.className = 'fatal';
  appRoot.textContent = message;
  throw new Error(message);
}
if (typeof DecompressionStream !== 'function' || typeof CompressionStream !== 'function') {
  fatal('这个浏览器不支持数据压缩功能，母版打不开。请用新版 Chrome 或 Edge 打开。');
}

// ---------- 数据格式：与 kanban.py 的 _pack_catalog / _unpack_catalog 对应 ----------
async function streamBytes(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function inflate(b64) {
  return new TextDecoder().decode(await streamBytes(base64ToBytes(b64), new DecompressionStream('deflate')));
}
async function deflate(text) {
  return bytesToBase64(await streamBytes(new TextEncoder().encode(text), new CompressionStream('deflate')));
}
function unpack(packed) {
  const strings = packed.strings, keys = packed.keys;
  const decode = v => {
    if (typeof v === 'string') return v.startsWith('~@') ? strings[+v.slice(2)] : v.startsWith('~~') ? v.slice(1) : v;
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[keys ? keys[+k] : k] = decode(x);
      return out;
    }
    return v;
  };
  const [sources, deltas] = decode(packed.data);
  if (sources.length !== deltas.length) throw new Error('作品数据不完整');
  return sources.map((s, i) => Object.assign({}, s, deltas[i], {source_record: s}));
}
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || !a || !b || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]));
}
function pack(list) {
  const sources = list.map(v => v.source_record);
  const deltas = list.map((v, i) => {
    const s = sources[i], d = {};
    for (const k of Object.keys(v)) {
      if (k === 'source_record') continue;
      if (!Object.prototype.hasOwnProperty.call(s, k) || !same(s[k], v[k])) d[k] = v[k];
    }
    return d;
  });
  const payload = [sources, deltas];
  const counts = new Map();
  const visit = v => {
    if (typeof v === 'string') counts.set(v, (counts.get(v) || 0) + 1);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(payload);
  const enc = new TextEncoder();
  const strings = [];
  for (const [s, n] of counts) {
    const len = enc.encode(s).length;
    if (len >= 12 && n > 1 && (len - 8) * (n - 1) > 12) strings.push(s);
  }
  const index = new Map(strings.map((s, i) => [s, i]));
  const keys = [], keyIndex = new Map();
  const field = k => {
    if (!keyIndex.has(k)) { keyIndex.set(k, keys.length); keys.push(k); }
    return String(keyIndex.get(k));
  };
  const encode = v => {
    if (typeof v === 'string') return index.has(v) ? '~@' + index.get(v) : v.startsWith('~') ? '~' + v : v;
    if (Array.isArray(v)) return v.map(encode);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[field(k)] = encode(x);
      return out;
    }
    return v;
  };
  return {format: 'catalog-shared-v1', strings, keys, data: encode(payload)};
}
async function packCompressed(list) {
  return {format: 'catalog-shared-v1', codec: 'deflate-base64', data: await deflate(JSON.stringify(pack(list)))};
}
// 放进 script 标签里的 JSON：把 < 转义，避免内容提前结束脚本标签
const scriptJson = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// 和 kanban.py 的 _ui_records 里生成 search 字段的规则一致
function searchText(r) {
  const join = a => (a || []).join(' ');
  return [
    r.raw_title, r.raw_tags, join(r.types), join(r.perks), join(r.cheats),
    (r.source_variants || []).map(v => v.raw_title || '').join(' '),
    r.name, r.code, r.english, r.orig_title, join(r.aliases), r.version, r.author, join(r.tags),
    r.platform, r.translation, r.notes, r.category, r.sheet,
  ].filter(Boolean).map(String).join(' ');
}

// ---------- 搜索：全角半角、片假名平假名、大小写、空格和常见符号都不区分；再加上拼音 ----------
// 和看板（reader-app.js）里的 normalizeSearch 规则一致
function normalizeSearch(s) {
  return String(s || '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\u3000・·•〜～~\-_—–:：;；,，.。!！?？'"“”‘’「」『』【】\[\]()（）<>《》\/\\|♡☆★♪]+/g, '');
}
// 作品名的拼音（全拼 + 首字母）：先用母版里预先算好的（按词组判断多音字），没有再用单字表
function searchPinyin(r) {
  const names = [String(r.name || '').replace(/^更新\s*/, ''), ...(r.aliases || [])].filter(Boolean);
  return names.map(n => (project.pinyin && project.pinyin[n]) || pinyinKey(n)).filter(Boolean).join(' ');
}

// ---------- 读入母版数据 ----------
const masterShell = JSON.parse($('master-shell').textContent);
const readerTemplate = JSON.parse($('reader-template').textContent);
const project = await CatalogImages.restore(JSON.parse($('project-data').textContent));
let views;
try {
  views = unpack(JSON.parse(await inflate(project.catalog.data)));
} catch (error) {
  fatal('母版里的数据读不出来：' + error.message);
}
const meta = project.meta;
const privateNotes = project.privateNotes || (project.privateNotes = {});
const editLog = project.editLog || (project.editLog = []);
const byId = new Map(views.map(v => [v.id, v]));
const loadedUiJson = JSON.stringify(meta.ui_config || {});
let cards = [];
function refreshCards() { cards = views.filter(v => !v.canonical_id || v.canonical_id === v.id); }
refreshCards();

// 分区：sheet 名 ↔ 看板里的 zone（sheet-0 / sheet-1 …）
const sheetZone = new Map();
for (const v of views) if (v.sheet && !sheetZone.has(v.sheet)) sheetZone.set(v.sheet, v.zone);
const SECTIONS = sheetZone.size?[...sheetZone.keys()]:['目录'];
const sectionsOf = r => r.category_sheets || [r.sheet];

// ---------- 修改记录 ----------
// 一次操作 = 一组 change：{kind:'field', id, key, before, after} / {kind:'meta', path, before, after} / {kind:'add'|'remove', record, index}
const history = {done: [], undone: []};
// 未保存：自上次保存以来做过的操作数（撤销回到保存时的状态就算没有未保存修改）
let savedOp = null, extraDirty = 0;
function unsaved() {
  const i = savedOp ? history.done.indexOf(savedOp) : -1;
  const ops = savedOp && i < 0 ? history.done.length + 1 : history.done.length - (i + 1);
  return ops + extraDirty;
}
function markSaved() { savedOp = history.done[history.done.length - 1] || null; extraDirty = 0; }
function markDirty() { extraDirty++; }
const touched = new Set();          // 本次打开以来改过的作品
const listeners = new Set();        // 数据变了之后要刷新的界面
const onChange = fn => listeners.add(fn);

function getPath(obj, path) { return path.reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (o[path[i]] == null || typeof o[path[i]] !== 'object') o[path[i]] = typeof path[i + 1] === 'number' ? [] : {};
    o = o[path[i]];
  }
  if (value === undefined) delete o[path[path.length - 1]];
  else o[path[path.length - 1]] = value;
}
function applyChange(c, forward) {
  if (c.kind === 'field') {
    const r = byId.get(c.id);
    if (!r) return;
    const v = clone(forward ? c.after : c.before);
    if (v === undefined) delete r[c.key]; else r[c.key] = v;
    if (c.key !== 'search') r.search = searchText(r);
    touched.add(r.id);
  } else if (c.kind === 'meta') {
    setPath(meta, c.path, clone(forward ? c.after : c.before));
  } else if (c.kind === 'private') {
    const v = forward ? c.after : c.before;
    if (v) privateNotes[c.id] = v; else delete privateNotes[c.id];
  } else if (c.kind === 'project') {
    setPath(project, c.path, clone(forward ? c.after : c.before));
  } else if (c.kind === 'source') {
    // 原始记录（上次从工作簿读到的样子）：原格式工作簿导回时更新，下次导回用它当比较基准
    const r = byId.get(c.id);
    if (r) r.source_record = forward ? c.after : c.before;
  } else if (c.kind === 'collection') {
    const col = project.collections.find(x => x.id === c.id);
    if (col) col[c.key] = forward ? c.after : c.before;
  } else if ((c.kind === 'add') === forward) {
    views.splice(Math.min(c.index, views.length), 0, c.record);
    byId.set(c.record.id, c.record);
    touched.add(c.record.id);
  } else {
    const i = views.indexOf(c.record);
    if (i >= 0) views.splice(i, 1);
    byId.delete(c.record.id);
  }
}
function notify(info) { refreshCards(); listeners.forEach(fn => fn(info)); }
// 记下一次操作并立刻生效。changes 里只放真正有变化的项。
// 卡片标签 = 分类、平台、版本类型 + 其余标签（和 kanban.py 一样）。这三项或标签改了，就按改完后的样子重排一次，
// 免得看板上还挂着改之前的分类。表格里的「标签」列只显示、只改其余标签。
const BASE_TAG_KEYS = ['genre', 'platform', 'translation'];
const baseTags = r => BASE_TAG_KEYS.map(k => String(r[k] || '').trim()).filter(Boolean);
const extraTags = r => { const base = baseTags(r); return (r.tags || []).filter(t => !base.includes(t)); };
function syncBaseTags(changes) {
  const hit = new Map();
  for (const c of changes) if (c.kind === 'field' && (c.key === 'tags' || BASE_TAG_KEYS.includes(c.key)) && byId.has(c.id))
    (hit.get(c.id) || hit.set(c.id, {}).get(c.id))[c.key] = c.after;
  if (!hit.size) return changes;
  const out = changes.filter(c => !(c.kind === 'field' && c.key === 'tags' && hit.has(c.id)));
  for (const [id, next] of hit) {
    const r = byId.get(id), after = {...r, ...next};
    const extra = 'tags' in next ? (next.tags || []).filter(t => !baseTags(after).includes(t)) : extraTags(r);
    out.push(fieldChange(r, 'tags', [...new Set([...baseTags(after), ...extra])]));
  }
  return out;
}
function commit(label, changes) {
  changes = syncBaseTags(changes).filter(c => c.kind === 'add' || c.kind === 'remove' || !same(c.before, c.after));
  if (!changes.length) return 0;
  changes.forEach(c => applyChange(c, true));
  history.done.push({label, changes, at: new Date().toISOString()});
  history.undone.length = 0;
  if (history.done.length > 300) history.done.shift();
  for (const c of changes) {
    if (c.kind === 'field') editLog.push({id: c.id, field: c.key, from: c.before, to: c.after, at: new Date().toISOString()});
  }
  if (editLog.length > 1000) editLog.splice(0, editLog.length - 1000);
  notify({label, changes});
  return changes.length;
}
function undo() {
  const op = history.done.pop();
  if (!op) return;
  [...op.changes].reverse().forEach(c => applyChange(c, false));
  history.undone.push(op);
  notify({label: '撤销：' + op.label, changes: op.changes});
}
function redo() {
  const op = history.undone.pop();
  if (!op) return;
  op.changes.forEach(c => applyChange(c, true));
  history.done.push(op);
  notify({label: '重做：' + op.label, changes: op.changes});
}
// 便捷：改一部作品的一个字段
const fieldChange = (r, key, after) => ({kind: 'field', id: r.id, key, before: clone(r[key]), after: clone(after)});
function setField(r, key, value, label) { return commit(label || `改${FIELD_LABEL[key] || key}`, [fieldChange(r, key, value)]); }
function setMeta(path, value, label) { return commit(label || '改设置', [{kind: 'meta', path, before: clone(getPath(meta, path)), after: clone(value)}]); }

// 可在表格里编辑的字段
const FIELD_LABEL = new Proxy({
  code: '编号', name: '名称', version: '版本', author: '作者', genre: '类型', platform: '平台',
  translation: '语言', tags: '标签', updated: '更新标记', notes: '备注', size_str: '大小',
  category_raw: '批次', baidu_url: '百度链接', quark_url: '夸克链接',
  date: '收录日期', update_summary: '更新内容', version_date: '版本发布日期',
  source_id: '资料编号', source: '资料来源',
},{get:(labels,key)=>typeof fieldLabel==='function'?fieldLabel(key,labels[key]):labels[key]});
// 文字 → 字段值（标签按空格、逗号、顿号分开；更新标记认「是 / 1 / ✓」）
function parseFieldValue(key, text) {
  text = String(text ?? '');
  if (key === 'tags') return text.split(/[\s,，、]+/).filter(Boolean);
  if (key === 'updated') return /^(是|1|true|✓|√|y|yes|更新)$/i.test(text.trim());
  return text.trim() === '' && key !== 'notes' ? '' : (key === 'notes' ? text : text.trim());
}
function fieldText(r, key) {
  const v = r[key];
  if (key === 'tags') return (v || []).join(' ');
  if (key === 'updated') return v ? '是' : '';
  return v == null ? '' : String(v);
}
// 改「更新标记」时，同时改 is_update，与 kanban.py 一致
function fieldChanges(r, key, value) {
  const list = [fieldChange(r, key, value)];
  if (key === 'updated') list.push(fieldChange(r, 'is_update', value));
  if (key === 'author') list.push(fieldChange(r, 'circle', value));
  if (key === 'genre') list.push(fieldChange(r, 'main_genre', value));
  // 收录日期：连同看板上显示的几种写法一起改
  if (key === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, mo, d] = value.split('-');
    list.push(fieldChange(r, 'publish_date', value), fieldChange(r, 'date_short', `${+mo}/${d}`), fieldChange(r, 'date_label', `${y}年${+mo}月${+d}日`));
  }
  if (key === 'size_str') {
    const m = String(value).match(/(\d+(?:\.\d+)?)\s*([GMT])/i);
    const mb = m ? +m[1] * ({g: 1024, m: 1, t: 1048576}[m[2].toLowerCase()]) : 0;
    list.push(fieldChange(r, 'size_mb', mb), fieldChange(r, 'size', mb));
  }
  return list;
}

// ---------- 合集：每对百度 / 夸克链接算一个合集 ----------
function collectionLabel(categoryRaw) {
  const s = String(categoryRaw || '');
  const m = s.match(/^(\d{4})[-年/.](\d{1,2})/);
  return m ? `${m[1]}年${+m[2]}月` : (s || '未命名合集');
}
function ensureCollections() {
  if (Array.isArray(project.collections) && project.collections.length) return;
  const groups = new Map();
  for (const r of views) {
    if (!r.baidu_url && !r.quark_url) continue;
    const key = (r.baidu_url || '') + '\n' + (r.quark_url || '');
    if (!groups.has(key)) groups.set(key, {baidu: r.baidu_url || '', quark: r.quark_url || '', labels: new Map()});
    const g = groups.get(key), label = collectionLabel(r.category_raw);
    g.labels.set(label, (g.labels.get(label) || 0) + 1);
  }
  project.collections = [...groups.values()].map((g, i) => ({
    id: 'C' + String(i + 1).padStart(2, '0'),
    label: [...g.labels].sort((a, b) => b[1] - a[1])[0][0],
    baidu: g.baidu,
    quark: g.quark,
  }));
}
ensureCollections();
const collectionOf = r => project.collections.find(c => c.baidu === (r.baidu_url || '') && c.quark === (r.quark_url || ''))
  || project.collections.find(c => (r.quark_url && c.quark === r.quark_url) || (r.baidu_url && c.baidu === r.baidu_url));

// ---------- 新增作品 ----------
const pad = n => String(n).padStart(2, '0');
// 编号：自定义前缀与递增序号，不依赖日期或内容类别。
function nextCode(prefix,date){
  const base=String(prefix||'ITEM').trim(),taken=new Set(views.map(r=>r.code));
  for(let number=1;;number++){const code=base+'-'+String(number).padStart(4,'0');if(!taken.has(code))return code;}
}

function newRecord(fields) {
  const [y, mo, d] = fields.date.split('-');
  const sheet = fields.sheet, zone = sheetZone.get(sheet) || 'sheet-0';
  const sample = views.find(v => v.sheet === sheet) || views[0] || {};
  const r = {
    id: fields.code, code: fields.code, title: fields.name, name: fields.name, raw_name: fields.name,
    raw_title: [fields.name, fields.version, fields.raw_tags].filter(Boolean).join(' '),
    raw_tags: fields.raw_tags || '', version: fields.version || '',
    genre: fields.genre || '', main_genre: fields.genre || '', platform: fields.platform || '',
    // 标签 = 分类、平台、版本类型 + 其余标签，和 kanban.py 生成的一样
    translation: fields.translation || (typeof versionTypes==='function'?versionTypes()[0]?.name:'') || '默认', tags: [...new Set([fields.genre, fields.platform, fields.translation, ...(fields.tags || [])].filter(Boolean))],
    play_tags: fields.play_tags || [], theme_tags: fields.theme_tags || [], types: fields.types || [],
    perks: fields.perks || [], cheats: fields.cheats || [], aliases: fields.aliases || [], author: fields.author || '', circle: fields.author || '',
    notes: fields.notes || '', updated: !!fields.updated, is_update: !!fields.updated,
    update_summary: fields.update_summary || '', version_date: fields.version_date || '',
    size_str: fields.size_str || '', size_mb: fields.size_mb || 0, size: fields.size_mb || 0,
    date: fields.date, publish_date: fields.date, date_short: `${+mo}/${d}`, date_label: `${y}年${+mo}月${+d}日`,
    month_batch: `${y}年${+mo}月`, zone_sub: `${y}年${+mo}月`,
    category_raw: fields.batch, category: `${y.slice(2)}年 · ${+mo}/${d}`,
    sheet, zone, zone_icon: sample.zone_icon || '✦', sheet_type: 'default', source_schema: 'structured',
    baidu_url: fields.baidu_url || '', quark_url: fields.quark_url || '',
    inherited_links: fields.collectionLabel ? {baidu_url: '网盘链接:' + fields.collectionLabel, quark_url: '网盘链接:' + fields.collectionLabel} : {},
    en_title: fields.en_title || '', english: fields.en_title || '', orig_title: fields.orig_title || '', region_locked: false,
    is_heji: false,
    palette: sample.palette || ['#dfe4ee', '#5c7098'], symbol: sample.symbol || '✳',
    row_num: 0, _is_new: true, _added_in_master: true,
  };
  r.search = searchText(r);
  r.source_record = Object.assign({}, r);
  delete r.source_record.source_record;
  return r;
}
// 新作品放在同一分区的最前面（和表格里新行在最上面一致）
function insertIndexFor(sheet) {
  const i = views.findIndex(v => v.sheet === sheet);
  return i < 0 ? 0 : i;
}

// ---------- 分区（推荐）：改 category_sheets / category_zones ----------
function sectionChanges(r, sheet, on) {
  const sheets = [...sectionsOf(r)];
  if (on && !sheets.includes(sheet)) sheets.push(sheet);
  if (!on) { const i = sheets.indexOf(sheet); if (i >= 0) sheets.splice(i, 1); }
  const zones = sheets.map(s => sheetZone.get(s)).filter(Boolean);
  const list = [fieldChange(r, 'category_sheets', sheets.length > 1 ? sheets : undefined),
                fieldChange(r, 'category_zones', sheets.length > 1 ? zones : undefined)];
  return list;
}
