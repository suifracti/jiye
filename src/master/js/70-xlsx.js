// 目录母版 · Excel 导入导出
// 导出：作品 / 合集 / HTML设置 / 说明 四张表，作品表第一列是机器管理的 ID。
// 导入：按 ID 对回，和「上次导出时的样子」做三方比较：只改了表格的直接采用，只改了母版的保留，两边都改了列成冲突让你选。
// 表格里没有的作品不会被删除。zip 读写用浏览器自带的 deflate-raw，不依赖外部库。

// ---------- zip ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function zipFiles(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name), raw = enc.encode(text), crc = crc32(raw);
    const body = await streamBytes(raw, new CompressionStream('deflate-raw'));
    const local = new Uint8Array(30 + nameBytes.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true); lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, body.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cen = new Uint8Array(46 + nameBytes.length), cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); cen.set(nameBytes, 46);
    parts.push(local, body); central.push(cen);
    offset += local.length + body.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
async function unzip(buffer) {
  const bytes = new Uint8Array(buffer), dv = new DataView(buffer), dec = new TextDecoder();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('这不是有效的 xlsx 文件');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('xlsx 文件目录损坏');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true), name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const dataStart = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
    const data = bytes.subarray(dataStart, dataStart + csize);
    out[name] = method === 0 ? data : method === 8 ? await streamBytes(data, new DecompressionStream('deflate-raw')) : null;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------- xlsx 写 ----------
const xmlEsc = v => String(v ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const colName = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
function sheetXml(rows, widths) {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>` +
    rows.map((row, i) => `<row r="${i + 1}">${row.map((v, j) => `<c r="${colName(j)}${i + 1}" t="inlineStr" s="${i === 0 ? 2 : 1}"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`).join('')}</row>`).join('') +
    `</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${colName(rows[0].length - 1)}${rows.length}"/>` : ''}</worksheet>`;
}
async function buildWorkbook(sheets) {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    // 样式 1：文本格式（防止 Excel 把 1.10 变成 1.1）、顶端对齐、自动换行；样式 2：再加粗，用于表头
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows, s.widths); });
  return zipFiles(files);
}

// ---------- xlsx 读 ----------
async function readWorkbook(buffer) {
  const files = await unzip(buffer), dec = new TextDecoder(), parse = name => files[name] ? new DOMParser().parseFromString(dec.decode(files[name]), 'application/xml') : null;
  const wb = parse('xl/workbook.xml'), rels = parse('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('这不是有效的 xlsx 文件');
  const target = {};
  for (const r of rels.getElementsByTagName('Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
  const shared = [];
  const ss = parse('xl/sharedStrings.xml');
  if (ss) for (const si of ss.getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  const result = {};
  for (const sh of wb.getElementsByTagName('sheet')) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const doc = parse('xl/' + target[rid]);
    if (!doc) continue;
    const rows = [];
    for (const row of doc.getElementsByTagName('row')) {
      const r = +row.getAttribute('r') - 1, line = [];
      for (const c of row.getElementsByTagName('c')) {
        const ref = c.getAttribute('r') || '', letters = ref.replace(/\d+/g, '');
        let col = 0; for (const ch of letters) col = col * 26 + ch.charCodeAt(0) - 64;
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        line[col - 1] = t === 's' ? shared[+v] ?? '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map(x => x.textContent).join('') : t === 'b' ? (v === '1' ? '是' : '否') : v;
      }
      rows[r] = Array.from(line, x => x ?? '');
    }
    result[sh.getAttribute('name')] = Array.from(rows, x => x || []);
  }
  return result;
}

// ---------- 母版 ↔ 表格 ----------
const WORK_COLUMNS = [
  ['编号', 'code'], ['名称', 'name'], ['版本', 'version'], ['作者', 'author'], ['分类', 'genre'], ['载体', 'platform'],
  ['版本类型', 'translation'], ['标签', 'tags'], ['大小', 'size_str'], ['更新', 'updated'], ['批次', 'category_raw'],
  ['分区', 'sections'], ['备注', 'notes'], ['下载链接1', 'baidu_url'], ['下载链接2', 'quark_url'], ['制作备注', 'private'],
  // 后加的列放在最后：以前导出的表格导回时，前面各列的位置不变
  ['收录日期', 'date'], ['更新内容', 'update_summary'], ['版本发布日期', 'version_date'],
  ['资料来源','source'],['资料编号','source_id'],['编号来源','source_id_origin'],['多来源编号JSON','source_ids'],
  ['别名JSON','aliases'],['特性JSON','perks'],['附加代码JSON','cheats'],['类型JSON','types'],['附加标记JSON','play_tags'],['主题标签JSON','theme_tags'],
  ['资料JSON','web_info'],['来源状态JSON','source_checks'],['封面网址','cover_url'],['人工字段JSON','manual_fields'],
  ['自定义字段JSON','extra_fields'],['原始记录JSON','source_record'],['扩展资料JSON','record_extra'],
];
const WORK_WIDTHS = [14, 14, 50, 22, 16, 8, 10, 12, 30, 9, 6, 16, 22, 50, 40, 40, 30, 12, 30, 12];
const TABLE_JSON_FIELDS = new Set(['source_ids','web_info','source_checks','extra_fields','source_record','record_extra','manual_fields','aliases','perks','cheats','types','play_tags','theme_tags']);
const TABLE_ARRAY_FIELDS = new Set(['manual_fields','aliases','perks','cheats','types','play_tags','theme_tags']);
const TABLE_HEADER_ALIASES = {ID:['目录ID','目录 ID','稳定ID'],名称:['作品名称','标题'],编号:['目录编号'],作者:['作者／制作组','制作组','作者'],分类:['类型'],载体:['平台'],版本类型:['语言'],下载链接1:['百度链接'],下载链接2:['夸克链接'],批次:['归档批次'],收录日期:['加入日期'],资料编号:['来源编号'],资料来源:['来源']};
const tableJson = value => JSON.stringify(value ?? (Array.isArray(value) ? [] : {}));
function tableFieldValue(key,text) {
  if (!TABLE_JSON_FIELDS.has(key)) return parseFieldValue(key,text);
  if (!String(text ?? '').trim()) return TABLE_ARRAY_FIELDS.has(key) ? [] : {};
  let value;
  try { value=JSON.parse(text); } catch { throw new Error(`${key} 需要有效的 JSON，未应用任何修改`); }
  if (TABLE_ARRAY_FIELDS.has(key) ? !Array.isArray(value) : !value || typeof value!=='object' || Array.isArray(value)) throw new Error(`${key} 的 JSON 类型不正确`);
  return value;
}
function extraRecordFields(record) {
  const used=new Set(['id','search',...WORK_COLUMNS.map(([,key])=>key)]);
  return Object.fromEntries(Object.entries(record).filter(([key])=>!used.has(key)));
}
function tableColumns(book,mapping={}) {
  const known=['作品','合集','HTML设置','说明','来源配置','目录定位','分区','项目配置'];
  const rows=book['作品'] || Object.entries(book).find(([name,rows])=>!known.includes(name)&&rows.length)?.[1];
  if (!rows?.length) throw new Error('没有找到作品表或 CSV 内容');
  const head=rows[0].map(h=>String(h??'').trim()),canonical=head.map(label=>{
    const explicit=Object.entries(mapping).find(([,original])=>original===label)?.[0];
    if(explicit)return explicit==='id'?'ID':WORK_COLUMNS.find(([,key])=>key===explicit)?.[0]||explicit;
    const standard=Object.entries(TABLE_HEADER_ALIASES).find(([name,aliases])=>name===label||aliases.includes(label))?.[0]||label;
    const field=standard==='ID'?'id':WORK_COLUMNS.find(([name])=>name===standard)?.[1];
    return field&&Object.prototype.hasOwnProperty.call(mapping,field)&&!mapping[field]?'未映射：'+label:standard;
  });
  if (!canonical.includes('名称')) throw new Error('没有名称列，请先设置列映射');
  const hasID=canonical.includes('ID');
  let normalized=rows.map((row,index)=>index===0?[...(hasID?[]:['ID']),...canonical]:[...(hasID?[]:['']),...row]);
  const headers=normalized[0],knownHeaders=new Set(['ID',...WORK_COLUMNS.map(([label])=>label)]),unmapped=headers.map((label,index)=>({label,index})).filter(x=>x.label&&!knownHeaders.has(x.label));
  if(unmapped.length){
    let extraIndex=headers.indexOf('自定义字段JSON');
    if(extraIndex<0){extraIndex=headers.length;headers.push('自定义字段JSON');}
    normalized.slice(1).forEach(row=>{
      let extra={};if(row[extraIndex])try{extra=JSON.parse(row[extraIndex]);}catch{throw new Error('自定义字段JSON 无法解析');}
      for(const {label,index} of unmapped)if(row[index]!==undefined)extra[label.replace(/^未映射：/,'')]=row[index];
      row[extraIndex]=JSON.stringify(extra);
    });
  }
  return {...book,'作品':normalized};
}
function parseCsv(text) {
  text=String(text).replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"') {if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||cell==='')quoted=!quoted;else cell+=ch;}
    else if(ch===','&&!quoted){row.push(cell);cell='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(quoted)throw new Error('CSV 引号没有闭合');
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  return rows;
}
function csvText(rows){return '\uFEFF'+rows.map(row=>row.map(cell=>'"'+String(cell??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');}
function auxiliaryCell(kind,path,value,label){return {kind,path,value:clone(value),text:JSON.stringify(value)??'',label};}
function workbookAuxiliary(){
  const entries=[auxiliaryCell('meta',[],meta,'完整HTML设置JSON'),auxiliaryCell('project',['sourceConfig'],project.sourceConfig||{},'来源配置'),auxiliaryCell('project',['folderListings'],project.folderListings||{},'目录定位')];
  const omitted=new Set(['meta','catalog','excelBase','sourceConfig','folderListings','covers','rankingImages','steamCovers','readerTemplate','masterShell','collections']);
  for(const [key,value]of Object.entries(project))if(!omitted.has(key))entries.push(auxiliaryCell('project',[key],value,key));
  for(const collection of project.collections)for(const [key,value]of Object.entries(collection))entries.push({kind:'collection',id:collection.id,path:[key],value:clone(value),text:JSON.stringify(value)??'',label:collection.id+' / '+key});
  return entries;
}
const auxKey=item=>[item.kind,item.id||'',...(item.path||[])].join('/');
function analyzeAuxiliary(res,item,before){
  if(same(item.value,before))return;
  const baseline=project.excelBase?.aux?.[auxKey(item)];
  const tableFP=fingerprint(JSON.stringify(item.value)??''),masterFP=fingerprint(JSON.stringify(before)??'');
  if(baseline&&tableFP===baseline){res.keptMaster++;return;}
  item.before=clone(before);item.master=JSON.stringify(before)??'';item.table=JSON.stringify(item.value)??'';
  item.conflict=Boolean(baseline&&masterFP!==baseline);item.use=!item.conflict;
  res.auxiliary.push(item);
}
function jsonCell(text,label){try{return JSON.parse(text||'null');}catch{throw new Error(`${label} 需要有效的 JSON，未应用任何修改`);}}
function importAuxiliary(book,res){
  for(const row of (book['来源配置']||[]).slice(1))if(row[0]==='sourceConfig'){
    const item=auxiliaryCell('project',['sourceConfig'],jsonCell(row[1],'来源配置'),'来源配置');analyzeAuxiliary(res,item,project.sourceConfig||{});
  }
  for(const row of (book['目录定位']||[]).slice(1))if(row[0]){
    const key=String(row[0]),item=auxiliaryCell('project',['folderListings',key],jsonCell(row[1],'目录定位'),`目录定位 / ${key}`);
    analyzeAuxiliary(res,item,(project.folderListings||{})[key]);
  }
  for(const row of (book['项目配置']||[]).slice(1))if(row[0]&&!['__proto__','constructor','prototype','meta','catalog','collections','sourceConfig','folderListings','excelBase'].includes(String(row[0]))){
    const key=String(row[0]),item=auxiliaryCell('project',[key],jsonCell(row[1],key),key);analyzeAuxiliary(res,item,project[key]);
  }
  const raw=(book['HTML设置']||[]).find(row=>row[0]==='完整HTML设置JSON');
  if(raw){
    const value=jsonCell(raw[1],'完整HTML设置JSON');if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('完整HTML设置JSON 应为对象');
    const baseline=project.excelBase?.aux?.['meta/'];
    // A text-cell edit does not make the untouched full JSON row override it.
    if(!baseline||fingerprint(JSON.stringify(value))!==baseline){
      for(const key of new Set([...Object.keys(meta),...Object.keys(value)]))if(!['__proto__','constructor','prototype'].includes(key))analyzeAuxiliary(res,auxiliaryCell('meta',[key],value[key],'HTML设置 / '+key),meta[key]);
    }
  }
  const memberships={};for(const row of (book['分区']||[]).slice(1))if(row[0]&&row[1])(memberships[String(row[0])]||=[]).push(String(row[1]));
  for(const [id,sheets]of Object.entries(memberships)){
    const record=byId.get(id);if(!record)continue;const desired=[...new Set(sheets)].join(' / '),current=sectionsOf(record).join(' / ');
    if(desired!==current&&!res.auto.concat(res.unsure,res.conflicts).some(item=>item.r.id===id&&item.key==='sections'))res.unsure.push({r:record,key:'sections',label:'分区关系',table:desired,master:current,use:'table'});
  }
}

// 文字比较前统一：去首尾空白、统一换行；标签按空格重排
function normText(key, text) {
  let s = String(text ?? '').replace(/\r\n?/g, '\n');
  if(TABLE_JSON_FIELDS.has(key))return JSON.stringify(tableFieldValue(key,s));
  s = key === 'notes' || key === 'private' ? s.replace(/\s+$/, '') : s.trim();
  if (key === 'tags') s = s.split(/[\s,，、]+/).filter(Boolean).join(' ');
  if (key === 'sections') s = s.split(/\s*[\/、,，]\s*/).filter(Boolean).join(' / ');
  if (key === 'updated') s = /^(是|1|true|✓|√|y|yes|更新)$/i.test(s) ? '是' : '';
  return s;
}
const recordCell = (r, key) => key === 'private' ? (privateNotes[r.id] || '') : key === 'sections' ? sectionsOf(r).join(' / ') : key==='record_extra'?JSON.stringify(extraRecordFields(r)):TABLE_JSON_FIELDS.has(key)?JSON.stringify(r[key]??(TABLE_ARRAY_FIELDS.has(key)?[]:{})):fieldText(r, key);
// 基准只存每格的短指纹，不存全文，母版不会因此变大很多
function fingerprint(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + s.length.toString(36); }

async function exportWorkbook() {
  const work = [['ID', ...WORK_COLUMNS.map(c => c[0])]];
  const base = {};
  for (const r of cards) {
    const cells = WORK_COLUMNS.map(([, key]) => normText(key, recordCell(r, key)));
    work.push([r.id, ...cells]);
    base[r.id] = cells.map(fingerprint).join(',');
  }
  const cols = [['ID', '合集名称', '下载链接1', '下载链接2', '作品数']].concat(project.collections.map(c => [c.id, c.label, c.baidu, c.quark, String(collectionMembers(c).filter(r => !r.canonical_id || r.canonical_id === r.id).length)]));
  const settings = [['配置项', '设置值']].concat(SETTING_LIST.map(s => [s.label, settingText(s)]),[['完整HTML设置JSON',JSON.stringify(meta)]]);
  const auxiliary=workbookAuxiliary(),aux=Object.fromEntries(auxiliary.map(item=>[auxKey(item),fingerprint(item.text)]));
  for(const [key,value]of Object.entries(project.folderListings||{}))aux['project//folderListings/'+key]=fingerprint(JSON.stringify(value));
  for(const [key,value]of Object.entries(meta))aux['meta//'+key]=fingerprint(JSON.stringify(value));
  for(const setting of SETTING_LIST)aux['setting/'+setting.label]=fingerprint(settingText(setting));
  const readme = [['说明'], ['这是从母版导出的表格，可以在 Excel / WPS 里批量修改，再从母版的「Excel 导入导出」导回。'],
    ['「作品」表第一列 ID 是母版用来对回作品的，请不要改、不要删。新增作品可以在末尾加一行，ID 留空。'],
    ['表格里删掉的行，导回时不会删除母版里的作品。'], ['「合集」改链接后导回，用到这个合集的作品会一起改。'],
    ['「HTML设置」写着「（本地图片，已内嵌）」的格子不用改，导回时会跳过。'], [`导出时间：${new Date().toLocaleString('zh-CN', {hour12: false})}，共 ${cards.length} 部作品。`]];
  const blob = await buildWorkbook([
    {name: '作品', rows: work, widths: WORK_COLUMNS.map(([,key],i)=>WORK_WIDTHS[i+1]||32)},
    {name: '合集', rows: cols.map((row,i)=>[...row,i===0?'合集完整JSON':JSON.stringify(project.collections[i-1])]), widths: [16, 22, 60, 50, 8,60]},
    {name: 'HTML设置', rows: settings, widths: [24, 80]},
    {name: '说明', rows: readme.concat([['来源配置和项目配置可能包含使用者自己的设置；请自行决定向谁提供表格。CSV 仅含作品表。']]), widths: [100]},
    {name:'来源配置',rows:[['配置名','JSON'],['sourceConfig',JSON.stringify(project.sourceConfig||{})]],widths:[24,100]},
    {name:'目录定位',rows:[['合集ID','文件夹JSON'],...Object.entries(project.folderListings||{}).map(([id,value])=>[id,JSON.stringify(value)])],widths:[24,100]},
    {name:'分区',rows:[['目录ID','分区名'],...cards.flatMap(record=>sectionsOf(record).map(sheet=>[record.id,sheet]))],widths:[24,36]},
    {name:'项目配置',rows:[['配置名','JSON'],...auxiliary.filter(item=>item.kind==='project'&&!['sourceConfig','folderListings'].includes(item.path[0])).map(item=>[item.path[0],item.text])],widths:[30,100]},
  ]);
  return {blob, base, aux};
}

let pendingImport = null;
function renderXlsx() {
  const base = project.excelBase;
  const name = `${meta.input_name || '目录'}-母版表格.xlsx`;
  $('pane-xlsx').innerHTML = `<div class="pane-inner">
    <div class="pane-head"><h2>Excel 导入导出</h2></div>
    <p class="count">想在 Excel / WPS 里一次改很多行时用：先导出一份，改完再导回来。导回时会先列出所有改动，你确认后才写进母版。</p>
    <div class="export-cards">
    <section class="export-card"><b>① 导出表格</b>
      <p class="count">一份 xlsx，里面主要表：<b>作品</b>（一行一部，第一列 ID 用来对回作品，别改别删）、<b>合集</b>、<b>HTML设置</b>及来源、分区与目录定位等关系表。</p>
      <p class="count">${esc(exportWhere(name, '表格'))}</p>
      <p class="count">${base ? `上次导出：${new Date(base.exportedAt).toLocaleString('zh-CN', {hour12: false})}。` : '还没有从这个母版导出过表格。'}导出后记得<b>保存母版</b>，导回时才分得清哪边改过。</p>
      <div><button id="xlsxExport" class="primary">导出 Excel 表格</button> <button id="csvExport">导出作品 CSV</button></div><p class="count">CSV 仅含作品表；完整设置、合集、图片及关系请用 XLSX / 母版保存。</p></section>
    <section class="export-card"><b>② 导回改过的表格</b>
      <p class="count">选上面导出、在 Excel 里改过并保存的那份文件：</p>
      <ul class="count tight"><li>只有表格改了的地方：直接采用</li><li>母版和表格都改了的地方：列出来让你选</li><li>表格末尾新加的行（ID 留空）：作为新作品加进来，母版里已有同名的默认不加</li><li>表格里删掉的行：<b>不会</b>删除作品</li></ul>
      <div><label class="file-btn primary-like">选择 xlsx / csv 文件<input type="file" id="xlsxFile" accept=".xlsx,.csv" hidden></label></div>
      <div id="xlsxResult"></div></section>
    </div>
    <section class="section" id="legacySection"><h3>小助手批量导入</h3>
      <p class="count">任意列名的 XLSX / CSV 可通过列映射导入；识别标题、版本、平台和标签，并保留未映射列。复杂表格可启动小助手后读取，再在确认表统一应用。未出现的作品不会删除。</p></section>
  </div>`;
  if (typeof enhanceLegacySection === 'function') enhanceLegacySection();
  $('xlsxExport').addEventListener('click', () => busy($('xlsxExport'), '正在导出…', async () => {
    const {blob, base: newBase, aux} = await exportWorkbook();
    const r = await writeFile('xlsx', blob, name, {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']}, 'Excel 表格');
    if (r.cancelled) return setStatus('已取消导出表格。');
    project.excelBase = {exportedAt: new Date().toISOString(), rows: newBase, aux};
    markDirty();
    renderXlsx();
    setStatus((r.written ? `已写入表格：${r.name}。` : `已开始下载表格：${r.name}。`) + '记得保存母版，导回时才能分辨哪边改过。', 'dirty');
  }));
  $('csvExport').addEventListener('click',()=>busy($('csvExport'),'正在导出…',async()=>{
    const rows=[['ID',...WORK_COLUMNS.map(([label])=>label)],...cards.map(record=>[record.id,...WORK_COLUMNS.map(([,key])=>normText(key,recordCell(record,key)))])];
    await writeFile('csv',new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'}),`${meta.input_name||'目录'}-作品.csv`,{'text/csv':['.csv']},'作品CSV');
    setStatus('已导出作品 CSV；它不包含完整项目设置。');
  }));
  $('xlsxFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const book=/\.csv$/i.test(file.name)?{'作品':parseCsv(await file.text())}:await readWorkbook(await file.arrayBuffer());
      previewTableMapping(book,file.name);
    } catch (error) {
      $('xlsxResult').innerHTML = `<p class="inline-alert">读不出这个文件：${esc(error.message)}</p>`;
    }
    e.target.value = '';
  });
  if (pendingImport) renderImportResult();
}

function analyzeImport(book, fileName, mapping={}) {
  book=tableColumns(book,mapping);
  const work = book['作品'];
  if (!work || !work.length) throw new Error('找不到「作品」表。请用母版导出的表格。');
  const head = work[0].map(h => String(h).trim());
  const idCol = head.indexOf('ID');
  if (idCol < 0) throw new Error('「作品」表第一行没有 ID 列。请用母版导出的表格。');
  const colIndex = WORK_COLUMNS.map(([label]) => head.indexOf(label));
  const base = project.excelBase?.rows || {};
  const res = {fileName, auto: [], conflicts: [], unsure: [], keptMaster: 0, added: [], missing: 0, unknownIds: [], collections: [], settings: [], auxiliary: [], tableRows: {}};
  const seen = new Set();
  for (const line of work.slice(1)) {
    if (!line || line.every(v => !String(v??'').trim())) continue;
    const id = String(line[idCol] || '').trim();
    const r = id ? byId.get(id) : null;
    if (id && seen.has(id)) throw new Error('作品表内 ID 重复：'+id);
    if (id) seen.add(id);
    if (!r) {
      const get = label => String(line[head.indexOf(label)] ?? '').trim();
      if (get('名称')) {
        // 没有 ID 的行：母版里已经有同名作品的（比如同一份表格导回第二次），默认不添加
        const cells = Object.fromEntries(WORK_COLUMNS.map(([label, key], i) => [key, colIndex[i] >= 0 ? normText(key, line[colIndex[i]]) : TABLE_JSON_FIELDS.has(key)?JSON.stringify(TABLE_ARRAY_FIELDS.has(key)?[]:{}):'']));
        cells._id=id;
        const exists = cards.some(c => normText('name', c.name) === cells.name && (!cells.version || normText('version', c.version) === cells.version));
        res.added.push({cells, use: !exists, exists});
      }
      continue;
    }
    seen.add(r.id);
    res.tableRows[r.id] = WORK_COLUMNS.map(([, key], i) => colIndex[i] >= 0 ? normText(key, line[colIndex[i]]) : normText(key, recordCell(r, key)));
    const fps = (base[r.id] || '').split(',');
    WORK_COLUMNS.forEach(([label, key], i) => {
      if (colIndex[i] < 0) return;
      const t = normText(key, line[colIndex[i]]), m = normText(key, recordCell(r, key));
      if (t === m) return;
      const b = base[r.id] ? fps[i] : null;
      const item = {r, key, label, table: t, master: m, use: 'table'};
      if (b == null) { res.unsure.push(item); return; }
      if (fingerprint(t) === b) { res.keptMaster++; return; }        // 表格没改，母版改过 → 保留母版
      if (fingerprint(m) === b) { res.auto.push(item); return; }     // 只有表格改了 → 采用
      item.use = 'master'; res.conflicts.push(item);                 // 两边都改了 → 默认保留母版，让你选
    });
  }
  res.missing = cards.filter(r => !seen.has(r.id)).length;
  importAuxiliary(book,res);
  for (const line of (book['合集'] || []).slice(1)) {
    const col = project.collections.find(c => c.id === String(line[0] || '').trim());
    if (!col) {if(line[0]){const collection=line[5]?jsonCell(line[5],'合集完整JSON'):{id:String(line[0]),label:String(line[1]||''),baidu:String(line[2]||''),quark:String(line[3]||'')};const existing=res.auxiliary.find(item=>item.kind==='project'&&item.path[0]==='collections');if(existing){existing.value.push(collection);existing.table=JSON.stringify(existing.value);existing.label='新增合集';}else analyzeAuxiliary(res,auxiliaryCell('project',['collections'],[...project.collections,collection],'新增合集 '+line[1]),project.collections);}continue;}
    if(line[5]){const full=jsonCell(line[5],'合集完整JSON');for(const [key,value]of Object.entries(full))if(!['id','label','baidu','quark','__proto__','constructor','prototype'].includes(key))analyzeAuxiliary(res,{...auxiliaryCell('collection',[key],value,col.label+' / '+key),id:col.id},col[key]);}
    [['label', 1], ['baidu', 2], ['quark', 3]].forEach(([key, i]) => {
      const t = String(line[i] ?? '').trim();
      if (t !== (col[key]||'') && !(key !== 'label' && t && !/^https?:\/\/\S+$/.test(t))) {const baseline=project.excelBase?.aux?.['collection/'+col.id+'/'+key],tableFP=fingerprint(JSON.stringify(t)),masterFP=fingerprint(JSON.stringify(col[key]));if(baseline&&tableFP===baseline){res.keptMaster++;return;}res.collections.push({col,key,table:t,master:col[key],use:!baseline||masterFP===baseline,conflict:Boolean(baseline&&masterFP!==baseline)});}
    });
  }
  for (const line of (book['HTML设置'] || []).slice(1)) {
    const s = SETTING_LIST.find(x => x.label === String(line[0] || '').trim());
    if (!s) continue;
    const t = String(line[1] ?? '').replace(/\r\n?/g, '\n').trim();
    if (t === '（本地图片，已内嵌）' || t === settingText(s).trim()) continue;
    const value = settingFromText(s, t);
    if (settingInvalid(s, value)) continue;
    const baseline=project.excelBase?.aux?.['setting/'+s.label],master=settingText(s),tableFP=fingerprint(t),masterFP=fingerprint(master);
    if(baseline&&tableFP===baseline){res.keptMaster++;continue;}
    const conflict=Boolean(baseline&&masterFP!==baseline);
    res.settings.push({s,table:t,master,value,use:!conflict,conflict});
  }
  return res;
}

function renderImportResult() {
  const x = pendingImport, short = s => esc(String(s).length > 60 ? String(s).slice(0, 60) + '…' : s) || '<i>空</i>';
  const row = (item, i, kind) => `<tr><td><button class="link" data-reveal="${esc(item.r.id)}">${esc(item.r.code)}</button></td><td>${item.label}</td><td>${short(item.master)}</td><td>${short(item.table)}</td>
    <td>${kind === 'conflict' ? `<label><input type="radio" name="cf${i}" data-kind="${kind}" data-i="${i}" value="master" ${item.use === 'master' ? 'checked' : ''}> 母版</label> <label><input type="radio" name="cf${i}" data-kind="${kind}" data-i="${i}" value="table" ${item.use === 'table' ? 'checked' : ''}> 表格</label>`
      : `<label><input type="checkbox" data-kind="${kind}" data-i="${i}" ${item.use === 'table' ? 'checked' : ''}> 采用表格</label>`}</td></tr>`;
  const table = (list, kind, title, note) => list.length ? `<h4>${title}（${list.length}）</h4>${note ? `<p class="count">${note}</p>` : ''}<div class="table-wrap"><table class="diff"><thead><tr><th>编号</th><th>列</th><th>母版现在</th><th>表格里</th><th></th></tr></thead><tbody>${list.slice(0, 300).map((it, i) => row(it, i, kind)).join('')}</tbody></table></div>${list.length > 300 ? `<p class="count">只列出前 300 处；其余按默认处理。</p>` : ''}` : '';
  $('xlsxResult').innerHTML = `<div class="import-summary">
    <p><b>${esc(x.fileName)}</b>：直接采用 ${x.auto.length} 处 · 冲突 ${x.conflicts.length} 处 · 待确认 ${x.unsure.length} 处 · 新增 ${x.added.length} 部 · 保留母版改动 ${x.keptMaster} 处 · 合集 ${x.collections.length} 处 · 设置 ${x.settings.length} 项</p>
    ${x.missing ? `<p class="count">表格里没有的 ${x.missing} 部作品保持不变（不会删除）。</p>` : ''}
    ${x.unknownIds.length ? `<p class="inline-alert">${x.unknownIds.length} 行的 ID 在母版里找不到，已跳过：${esc(x.unknownIds.slice(0, 10).join('、'))}</p>` : ''}
    ${table(x.conflicts, 'conflict', '母版和表格都改过', '默认保留母版，需要用表格的请选「表格」。')}
    ${table(x.unsure, 'unsure', '和母版不同（这个母版没有导出记录，分不清哪边改的）', '默认采用表格；不想要的取消勾选。')}
    ${table(x.auto, 'auto', '只有表格改了', '默认采用。')}
    ${x.added.length ? `<h4>新增作品（${x.added.length}）</h4><ul>${x.added.map((a, i) => `<li><label><input type="checkbox" data-kind="added" data-i="${i}" ${a.use ? 'checked' : ''}> ${esc(a.record ? a.record.code : a.cells.code || '（编号自动生成）')} ${esc(a.record ? a.record.name : a.cells.name)}${a.exists ? ' <span class="count">（母版里已有同名作品，默认不添加）</span>' : ''}</label></li>`).join('')}</ul>` : ''}
    ${x.collections.length ? `<h4>合集（${x.collections.length}）</h4><ul>${x.collections.map((c, i) => `<li><label><input type="checkbox" data-kind="col" data-i="${i}" ${c.use?'checked':''}> ${esc(c.col.label)} · ${{label: '名称', baidu: '百度', quark: '夸克'}[c.key]}：${short(c.master)} → ${short(c.table)}</label></li>`).join('')}</ul>` : ''}
    ${x.settings.length ? `<h4>设置（${x.settings.length}）</h4><ul>${x.settings.map((s, i) => `<li><label><input type="checkbox" data-kind="set" data-i="${i}" ${s.use?'checked':''}> ${esc(s.s.label)}${s.conflict?'（两边都修改）':''}：${short(s.master)} → ${short(s.table)}</label></li>`).join('')}</ul>` : ''}
    ${(x.auxiliary||[]).length?`<h4>关系与完整设置（${x.auxiliary.length}）</h4><ul>${x.auxiliary.map((item,i)=>`<li><label><input type="checkbox" data-kind="aux" data-i="${i}" ${item.use?'checked':''}> ${esc(item.label)}${item.conflict?'（两边都修改，默认保留母版）':''}：${short(item.master)} → ${short(item.table)}</label></li>`).join('')}</ul>`:''}
    <div class="dialog-actions"><button id="impCancel">放弃</button><button class="primary" id="impApply">应用这些修改</button></div></div>`;
  const box = $('xlsxResult');
  box.addEventListener('change', e => {
    const el = e.target, i = +el.dataset.i, kind = el.dataset.kind;
    if (kind === 'conflict') x.conflicts[i].use = el.value;
    else if (kind === 'unsure' || kind === 'auto') x[kind][i].use = el.checked ? 'table' : 'master';
    else if (kind === 'added') x.added[i].use = el.checked;
    else if (kind === 'col') x.collections[i].use = el.checked;
    else if (kind === 'set') x.settings[i].use = el.checked;
    else if(kind==='aux')x.auxiliary[i].use=el.checked;
  });
  box.addEventListener('click', e => { const b = e.target.closest('[data-reveal]'); if (b) revealRecord(b.dataset.reveal); });
  $('impCancel').addEventListener('click', () => { pendingImport = null; renderXlsx(); });
  $('impApply').addEventListener('click', applyImport);
}

function applyImport() {
  const x = pendingImport, changes = [];
  const apply = item => {
    if (item.key === 'private') changes.push({kind: 'private', id: item.r.id, before: privateNotes[item.r.id] || '', after: item.table});
    else if (item.key === 'sections') {
      const want = item.table.split(' / ').filter(Boolean);
      if (!want.includes(item.r.sheet)) want.unshift(item.r.sheet);
      const sheets = want.filter((s, i) => want.indexOf(s) === i);
      changes.push(fieldChange(item.r, 'category_sheets', sheets.length > 1 ? sheets : undefined), fieldChange(item.r, 'category_zones', sheets.length > 1 ? sheets.map(s => sheetZone.get(s)) : undefined));
    } else if(item.key==='record_extra'){for(const [key,value]of Object.entries(tableFieldValue(item.key,item.table)))if(!['id','__proto__','constructor','prototype'].includes(key))changes.push(fieldChange(item.r,key,value));}
    else changes.push(...fieldChanges(item.r, item.key, tableFieldValue(item.key, item.table)));
  };
  [...x.auto, ...x.unsure, ...x.conflicts].filter(it => it.use === 'table').forEach(apply);
  const taken = new Set(views.map(v => v.code));
  for (const a of x.added.filter(a => a.use && a.record)) changes.push({kind: 'add', index: insertIndexFor(a.record.sheet), record: a.record});
  for (const u of x.sourceUpdates || []) changes.push({kind: 'source', id: u.id, before: byId.get(u.id)?.source_record, after: u.after});
  changes.push(...(x.rawChanges || []));
  for (const a of x.added.filter(a => a.use && !a.record)) {
    const c = a.cells, sheet = (c.sections.split(' / ').find(Boolean)) || SECTIONS[0] || '作品';
    const m = (c.category_raw||'').match(/(\d{1,2})\.(\d{1,2})/);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(c.date||'')?c.date:m ? `${new Date().getFullYear()}-${pad(+m[1])}-${pad(+m[2])}` : todayStr();
    let code = c.code;
    if (!code || taken.has(code)) code = nextCode(PREFIX_FOR(sheet), date);
    while (taken.has(code)) code = code + 'x';
    taken.add(code);
    const col = (c.baidu_url || c.quark_url) ? null : collectionForBatch(c.category_raw || batchFor(date));
    const record = newRecord({
      code, name: c.name, version: c.version, author: c.author, genre: c.genre, platform: c.platform, translation: c.translation,
      tags: parseFieldValue('tags', c.tags), size_str: c.size_str, updated: c.updated === '是', notes: c.notes, sheet, date,
      batch: c.category_raw || batchFor(date), baidu_url: c.baidu_url || col?.baidu || '', quark_url: c.quark_url || col?.quark || '', collectionLabel: col?.label || '',
    });
    for(const [,key]of WORK_COLUMNS)if(!['private','sections','record_extra'].includes(key)&&c[key]!==undefined&&!(key==='date'&&!c[key]))record[key]=tableFieldValue(key,c[key]);
    Object.assign(record,tableFieldValue('record_extra',c.record_extra||'{}'));
    record.code=code;record.id=c._id||code;record.tags=[...new Set([...baseTags(record),...(record.tags||[])])];
    record.category_sheets=[...new Set((c.sections||sheet).split(' / ').filter(Boolean))];
    record.source_record=Object.keys(record.source_record||{}).length?record.source_record:{...record};delete record.source_record.source_record;
    record.search=searchText(record);changes.push({kind:'add',index:insertIndexFor(sheet),record});
    if(c.private)changes.push({kind:'private',id:record.id,before:'',after:c.private});
  }
  for (const c of x.collections.filter(c => c.use)) {
    changes.push({kind: 'collection', id: c.col.id, key: c.key, before: c.col[c.key], after: c.table});
    if (c.key !== 'label') {
      const field = c.key === 'baidu' ? 'baidu_url' : 'quark_url';
      for (const r of views) if (c.master && r[field] === c.master) changes.push(fieldChange(r, field, c.table));
    }
  }
  for (const s of x.settings.filter(s => s.use)) changes.push(...settingChanges(s.s, s.value));
  for(const item of x.auxiliary||[])if(item.use){const change={kind:item.kind,path:item.path,before:clone(item.before),after:clone(item.value)};if(item.kind==='collection'){change.id=item.id;change.key=item.path[0];}changes.push(change);}
  if(!x.legacy){
    const nextBase=clone(project.excelBase||{exportedAt:new Date().toISOString(),rows:{},aux:{}});nextBase.rows=nextBase.rows||{};nextBase.aux=nextBase.aux||{};
    for(const [id,cells]of Object.entries(x.tableRows))nextBase.rows[id]=cells.map(fingerprint).join(',');
    for(const item of x.auxiliary||[])nextBase.aux[auxKey(item)]=fingerprint(JSON.stringify(item.value)??'');
    for(const item of x.settings||[])nextBase.aux['setting/'+item.s.label]=fingerprint(item.table);
    for(const item of x.collections||[])nextBase.aux['collection/'+item.col.id+'/'+item.key]=fingerprint(JSON.stringify(item.table));
    changes.push({kind:'project',path:['excelBase'],before:clone(project.excelBase),after:nextBase});
  }
  const n = commit(`导回表格 ${x.fileName}`, changes);
  if (x.legacy) {
    const shown = [...x.auto, ...x.unsure, ...x.conflicts].filter(it => it.use === 'table').length + x.added.filter(a => a.use).length + x.settings.filter(s => s.use).length;
    pendingImport = null; renderXlsx();
    setStatus(`已导入原格式工作簿：${shown} 处内容有变化（另外同步了 ${(x.sourceUpdates || []).length} 条作品的原始记录）。整次导入可以按 Ctrl+Z 一步撤销。`, n ? 'dirty' : '');
    return;
  }
  pendingImport = null;
  renderXlsx();
  setStatus(`已导回表格：改动 ${n} 处。整次导回可以按 Ctrl+Z 一步撤销。`, n ? 'dirty' : '');
}
tabHandlers.xlsx = renderXlsx;

function previewTableMapping(book,fileName){
  const rows=book['作品']||Object.values(book).find(rows=>rows.length);
  if(!rows?.length)throw new Error('表格内容为空');
  const headers=rows[0].map(value=>String(value??'').trim());
  const known=new Set(['ID',...WORK_COLUMNS.map(([label])=>label)]),canonical=tableColumnsForPreview(headers);
  if(/\.xlsx$/i.test(fileName)&&book['作品']&&canonical.includes('ID')&&canonical.includes('名称')&&canonical.every(header=>known.has(header))){pendingImport=analyzeImport(book,fileName);renderImportResult();return;}
  const fields=[['目录ID','id'],...WORK_COLUMNS];
  openDialog(`<h3>导入列映射</h3><p class="count">确认名称和目录 ID 对应的列。未映射列会保留在自定义字段中；本步不修改母版。CSV 只导入作品表。</p><div class="table-wrap"><table><thead><tr><th>母版字段</th><th>表格列</th></tr></thead><tbody>${fields.map(([label,key])=>`<tr><td>${esc(label)}</td><td><select data-map-field="${key}"><option value="">不映射</option>${headers.map((header,i)=>`<option value="${i}" ${(key==='id'?canonical[i]==='ID':canonical[i]===label)?'selected':''}>${esc(header||`第 ${i+1} 列`)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div><div class="dialog-actions"><button id="mapCancel">取消</button><button id="mapContinue" class="primary">查看改动</button></div>`);
  $('mapCancel').onclick=closeDialog;
  $('mapContinue').onclick=()=>{
    try{
      const mapping={},chosen=new Set();for(const select of document.querySelectorAll('[data-map-field]')){mapping[select.dataset.mapField]=select.value!==''?headers[+select.value]:null;if(select.value!==''&&chosen.has(select.value))throw new Error('同一表格列不能映射到多个字段');if(select.value!=='')chosen.add(select.value);}
      pendingImport=analyzeImport(book,fileName,mapping);closeDialog();renderImportResult();
    }catch(error){alertInline($('mapContinue'),error.message);}
  };
}
function tableColumnsForPreview(headers){return headers.map(label=>Object.entries(TABLE_HEADER_ALIASES).find(([standard,aliases])=>standard===label||aliases.includes(label))?.[0]||label);}
function refreshImportedSections(){
  const names=[...new Set(views.flatMap(record=>[record.sheet,...(record.category_sheets||[])]).filter(Boolean))];
  for(const name of names)if(!sheetZone.has(name))sheetZone.set(name,'sheet-'+sheetZone.size);
  SECTIONS.splice(0,SECTIONS.length,...sheetZone.keys());
}
onChange(refreshImportedSections);
