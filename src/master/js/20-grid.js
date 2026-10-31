// 目录母版 · 名单表格：像 Excel 一样连续录入、粘贴多行、向下填充、批量改、查找替换
const GRID_COLUMNS = [
  {key: 'code', label: '目录编号', width: 112, mono: true},
  {key: 'source_id', label: '资料编号', width: 124, mono: true, readonly: true},
  {key: 'name', label: '名称', width: 320},
  {key: 'version', label: '版本', width: 170},
  {key: 'author', label: '作者', width: 130},
  {key: 'genre', label: '类型', width: 70},
  {key: 'platform', label: '平台', width: 84},
  {key: 'translation', label: '语言', width: 92},
  {key: 'tags', label: '标签', width: 210},
  {key: 'size_str', label: '大小', width: 72},
  {key: 'updated', label: '更新', width: 52},
  {key: 'category_raw', label: '批次', width: 118},
  {key: 'sections', label: '分区', width: 150, readonly: true},
  {key: 'notes', label: '备注', width: 240},
];
let COLUMNS=GRID_COLUMNS,totalWidth=0,BATCH_FIELDS=[],FIND_FIELDS=[];
const ROW_H = 34;
const grid = {
  rows: [], active: {row: 0, col: 2}, selected: new Set(), anchor: 0,
  sort: null, query: '', section: '', quick: '', editing: null, detailOpen: true,
};
const cellText = (r, key) => key === 'source_id' ? detailSourceId(r) : key === 'sections' ? sectionsOf(r).join(' / ') : key === 'tags' ? extraTags(r).join(' ') : fieldText(r, key);
const codeDateMismatch = () => false;
const QUICK = {
  edited: ['改过的', r => touched.has(r.id)],
  noAuthor: ['缺作者', r => !r.author],
  noSize: ['缺大小', r => !r.size_str],
  added: ['母版里新增的', r => r._added_in_master],
};

$('pane-list').innerHTML = `
  <div class="grid-toolbar">
    <input id="gridSearch" type="search" placeholder="搜名称、编号、版本、作者…（空格分隔多个词）" aria-label="搜索名单">
    <select id="gridSection" aria-label="分区"><option value="">全部分区</option>${SECTIONS.map(s => `<option>${esc(s)}</option>`).join('')}</select>
    <select id="gridQuick" aria-label="快捷筛选"><option value="">全部</option>${Object.entries(QUICK).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <span class="count" id="gridCount"></span>
    <span class="spacer"></span>
    <button id="addBtn" class="primary">＋ 新增作品</button>
    <button id="batchBtn" disabled>批量修改</button>
    <button id="findBtn">查找替换</button>
    <button id="fillBtn" disabled title="把选中第一行这一列的内容填到其他选中行（Ctrl+D）">向下填充</button>
    <button id="delBtn" disabled title="删除选中的作品（各分区里的这一部一起删；可以撤销）">删除</button>
    <button id="detailBtn" aria-pressed="true">详情栏</button>
  </div>
  <div class="grid-main">
    <div class="grid-wrap" id="gridWrap" tabindex="0" aria-label="名单表格。方向键移动，回车编辑，Ctrl+V 粘贴，Ctrl+D 向下填充">
      <div class="grid-head" id="gridHead"></div>
      <div class="grid-body" id="gridBody"><div class="grid-spacer" id="gridSpacer"></div></div>
    </div>
    <aside class="detail" id="detail"></aside>
  </div>
  <div class="grid-hint">点格子选中，回车或双击编辑，Tab / 回车跳格；按住 Shift 或 Ctrl 点击多选行。从 Excel 复制一块后，在起始格按 Ctrl+V 粘贴；只粘一格时会填到所有选中行。</div>`;

function configureGridColumns(){
  COLUMNS=GRID_COLUMNS.filter(c=>fieldVisible(c.key)).map(c=>({...c,label:fieldLabel(c.key,c.label)}));
  if(!COLUMNS.length)COLUMNS=[GRID_COLUMNS[0]];
  BATCH_FIELDS=COLUMNS.filter(c=>!c.readonly&&c.key!=='code');FIND_FIELDS=COLUMNS.filter(c=>!c.readonly);
  if(grid.sort&&grid.sort.col>=COLUMNS.length)grid.sort=null;
  grid.active.col=Math.min(grid.active.col,COLUMNS.length-1);
  totalWidth=44+COLUMNS.reduce((sum,c)=>sum+c.width,0);
  $('gridHead').style.width=$('gridSpacer').style.width=totalWidth+'px';
  $('gridHead').innerHTML='<div class="gh rownum">#</div>'+COLUMNS.map((c,i)=>`<button class="gh" data-sort="${i}" style="width:${c.width}px" title="点击排序">${esc(c.label)}<span class="sort-mark"></span></button>`).join('');
}
configureGridColumns();

function computeRows() {
  const q = grid.query.split(/\s+/).map(normalizeSearch).filter(Boolean);
  let rows = cards.filter(r => {
    if (grid.section && !sectionsOf(r).includes(grid.section)) return false;
    if (grid.quick && !QUICK[grid.quick][1](r)) return false;
    if (!q.length) return true;
    const hay = normalizeSearch((r.search || '') + ' ' + r.code + ' ' + detailSourceId(r)) + ' ' + searchPinyin(r);
    return q.every(t => hay.includes(t));
  });
  if (grid.sort) {
    const {col, dir} = grid.sort, key = COLUMNS[col].key;
    rows = rows.map((r, i) => [r, i]).sort((a, b) => {
      const x = cellText(a[0], key), y = cellText(b[0], key);
      return (x === y ? a[1] - b[1] : x.localeCompare(y, 'zh-CN', {numeric: true})) * dir;
    }).map(p => p[0]);
  }
  grid.rows = rows;
  grid.active.row = Math.min(grid.active.row, Math.max(0, rows.length - 1));
  for (const id of [...grid.selected]) if (!byId.has(id)) grid.selected.delete(id);
  $('gridCount').textContent = `${rows.length} / ${cards.length} 部` + (grid.selected.size > 1 ? ` · 已选 ${grid.selected.size}` : '');
  $('gridSpacer').style.height = rows.length * ROW_H + 'px';
  document.querySelectorAll('[data-sort]').forEach((b, i) => {
    b.querySelector('.sort-mark').textContent = grid.sort && grid.sort.col === i ? (grid.sort.dir > 0 ? ' ↑' : ' ↓') : '';
  });
  $('batchBtn').disabled = grid.selected.size < 1;
  $('fillBtn').disabled = grid.selected.size < 2;
  $('delBtn').disabled = grid.selected.size < 1;
}
function renderGrid() {
  const body = $('gridBody');
  const top = body.scrollTop, height = body.clientHeight || 600;
  const first = Math.max(0, Math.floor(top / ROW_H) - 8), last = Math.min(grid.rows.length, Math.ceil((top + height) / ROW_H) + 8);
  let html = '';
  for (let i = first; i < last; i++) {
    const r = grid.rows[i];
    const sel = grid.selected.has(r.id), changed = touched.has(r.id);
    html += `<div class="gr${sel ? ' sel' : ''}${changed ? ' changed' : ''}" style="top:${i * ROW_H}px;width:${totalWidth}px" data-row="${i}">` +
      `<div class="gc rownum" data-col="-1">${i + 1}</div>` +
      COLUMNS.map((c, j) => {
        const act = grid.active.row === i && grid.active.col === j;
        const text = cellText(r, c.key);
        return `<div class="gc${c.mono ? ' mono' : ''}${c.readonly ? ' ro' : ''}${act ? ' act' : ''}" data-col="${j}" style="width:${c.width}px" title="${esc(text.length > 40 ? text.slice(0, 300) : '')}">${esc(text.split('\n')[0])}</div>`;
      }).join('') + '</div>';
  }
  body.querySelectorAll('.gr').forEach(n => n.remove());
  body.insertAdjacentHTML('beforeend', html);
  if (typeof placeProxy === 'function') placeProxy();
}
$('gridBody').addEventListener('scroll', () => {
  $('gridHead').style.transform = `translateX(${-$('gridBody').scrollLeft}px)`;
  requestAnimationFrame(renderGrid);
});
function refreshGrid() { computeRows(); renderGrid(); renderDetail(); }
const activeRecord = () => grid.rows[grid.active.row];
function scrollToActive() {
  const body = $('gridBody'), y = grid.active.row * ROW_H;
  if (y < body.scrollTop) body.scrollTop = y;
  else if (y + ROW_H > body.scrollTop + body.clientHeight) body.scrollTop = y + ROW_H - body.clientHeight;
  let x = 44;
  for (let j = 0; j < grid.active.col; j++) x += COLUMNS[j].width;
  const w = COLUMNS[grid.active.col].width;
  if (x < body.scrollLeft + 44) body.scrollLeft = Math.max(0, x - 44);
  else if (x + w > body.scrollLeft + body.clientWidth) body.scrollLeft = x + w - body.clientWidth;
}
function moveTo(row, col, {extend = false, keepSelection = false} = {}) {
  row = Math.max(0, Math.min(grid.rows.length - 1, row));
  col = Math.max(0, Math.min(COLUMNS.length - 1, col));
  grid.active = {row, col};
  if (extend) selectRange(grid.anchor, row);
  else if (!keepSelection) { grid.selected = new Set(grid.rows[row] ? [grid.rows[row].id] : []); grid.anchor = row; }
  scrollToActive();
  computeRows(); renderGrid(); renderDetail();
}
function selectRange(a, b) {
  grid.selected = new Set(grid.rows.slice(Math.min(a, b), Math.max(a, b) + 1).map(r => r.id));
}
// 选中某部作品（体检、导入结果里点编号时用）
function revealRecord(id) {
  showTab('list');
  grid.query = ''; grid.section = ''; grid.quick = '';
  $('gridSearch').value = ''; $('gridSection').value = ''; $('gridQuick').value = '';
  computeRows();
  const i = grid.rows.findIndex(r => r.id === id);
  if (i >= 0) moveTo(i, grid.active.col);
  focusGrid();
}

// 键盘输入都进到一个跟着当前格走的隐藏输入框里：直接打字、中文输入法都能开始编辑，粘贴、复制也从这里接
const proxy = document.createElement('textarea');
proxy.className = 'grid-proxy';
proxy.dataset.gridProxy = '1';
proxy.setAttribute('aria-label', '当前单元格');
proxy.spellcheck = false;
$('gridBody').append(proxy);
function focusGrid() { proxy.focus({preventScroll: true}); }
function placeProxy() {
  let x = 44;
  for (let j = 0; j < grid.active.col; j++) x += COLUMNS[j].width;
  const c = COLUMNS[grid.active.col];
  proxy.style.left = x + 'px';
  proxy.style.top = grid.active.row * ROW_H + 'px';
  proxy.style.width = (grid.editing && c.key === 'notes' ? Math.max(c.width, 420) : c.width) + 'px';
  proxy.style.height = (grid.editing && c.key === 'notes' ? 180 : ROW_H) + 'px';
}
$('gridWrap').addEventListener('focus', focusGrid);

// 鼠标
$('gridBody').addEventListener('mousedown', e => {
  const cell = e.target.closest('.gc'), rowEl = e.target.closest('.gr');
  if (e.target === proxy && grid.editing) return;
  if (!rowEl || !cell) return;
  const row = +rowEl.dataset.row, col = +cell.dataset.col;
  commitEdit();
  if (e.shiftKey) { grid.active = {row, col: col < 0 ? grid.active.col : col}; selectRange(grid.anchor, row); }
  else if (e.ctrlKey || e.metaKey) {
    const id = grid.rows[row].id;
    grid.selected.has(id) ? grid.selected.delete(id) : grid.selected.add(id);
    grid.active = {row, col: col < 0 ? grid.active.col : col}; grid.anchor = row;
  } else {
    grid.active = {row, col: col < 0 ? grid.active.col : col};
    grid.selected = new Set([grid.rows[row].id]); grid.anchor = row;
  }
  computeRows(); renderGrid(); renderDetail();
  e.preventDefault();
  focusGrid();
});
$('gridBody').addEventListener('dblclick', e => { if (e.target.closest('.gc')) startEdit(); });
$('gridHead').addEventListener('click', e => {
  const b = e.target.closest('[data-sort]');
  if (!b) return;
  const col = +b.dataset.sort;
  grid.sort = !grid.sort || grid.sort.col !== col ? {col, dir: 1} : grid.sort.dir > 0 ? {col, dir: -1} : null;
  refreshGrid();
});

// 单元格编辑。keepTyped：从打字 / 输入法进入编辑时，保留已经打进去的内容
function startEdit(keepTyped = false) {
  const r = activeRecord(), c = COLUMNS[grid.active.col];
  if (!r || c.readonly) {
    if (c && c.readonly) setStatus('「分区」请在右侧详情栏里勾选。');
    proxy.value = '';
    return false;
  }
  grid.editing = {id: r.id, key: c.key};
  proxy.classList.add('editing');
  proxy.dataset.typeKey = TYPE_KEYS.includes(c.key) ? c.key : '';
  placeProxy();
  if (!keepTyped) { proxy.value = cellText(r, c.key); proxy.select(); }
  if (proxy.dataset.typeKey) typePickShow(proxy);
  return true;
}
function commitEdit() {
  const ed = grid.editing;
  if (!ed) return;
  grid.editing = null;
  proxy.dataset.typeKey = '';
  typePickHide();
  const text = proxy.value;
  proxy.value = '';
  proxy.classList.remove('editing');
  placeProxy();
  const r = byId.get(ed.id);
  if (r) applyCellValue(r, ed.key, text);
}
function cancelEdit() { grid.editing = null; proxy.dataset.typeKey = ''; typePickHide(); proxy.value = ''; proxy.classList.remove('editing'); placeProxy(); }
function applyCellValue(r, key, text, label) {
  const value = parseFieldValue(key, text);
  if (key === 'code' && value !== r.code && views.some(v => v.code === value)) setStatus(`提醒：编号 ${value} 已经有别的作品在用。`, 'dirty');
  return commit(label || `改${FIELD_LABEL[key]}：${r.code}`, fieldChanges(r, key, value));
}
let composing = false;
proxy.addEventListener('compositionstart', () => { composing = true; if (!grid.editing) startEdit(true); });
proxy.addEventListener('compositionend', () => { composing = false; });
proxy.addEventListener('input', () => { if (!grid.editing && proxy.value) startEdit(true); });
proxy.addEventListener('blur', () => { if (grid.editing) commitEdit(); });

// 键盘
proxy.addEventListener('keydown', e => {
  if (composing || e.isComposing) return;
  const {row, col} = grid.active, mod = e.ctrlKey || e.metaKey;
  if (grid.editing) {
    const notes = grid.editing.key === 'notes';
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (e.key === 'Enter' && !(notes && (e.altKey || e.shiftKey))) { e.preventDefault(); commitEdit(); moveTo(row + 1, col); }
    else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); moveTo(row, col + (e.shiftKey ? -1 : 1)); }
    return;
  }
  const go = (dr, dc) => { e.preventDefault(); moveTo(row + dr, col + dc, {extend: e.shiftKey && dr !== 0}); };
  if (e.key === 'ArrowDown') go(1, 0);
  else if (e.key === 'ArrowUp') go(-1, 0);
  else if (e.key === 'ArrowRight') go(0, 1);
  else if (e.key === 'ArrowLeft') go(0, -1);
  else if (e.key === 'PageDown') go(Math.floor($('gridBody').clientHeight / ROW_H), 0);
  else if (e.key === 'PageUp') go(-Math.floor($('gridBody').clientHeight / ROW_H), 0);
  else if (e.key === 'Tab') go(0, e.shiftKey ? -1 : 1);
  else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearCells(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); fillDown(); }
  else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); grid.selected = new Set(grid.rows.map(r => r.id)); computeRows(); renderGrid(); }
  else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFindReplace(); }
  // 其他按键（普通打字）不拦，打进隐藏输入框后由 input 事件开始编辑
});
function targetRows() {
  const ids = grid.selected.size ? grid.selected : new Set([activeRecord()?.id]);
  return grid.rows.filter(r => ids.has(r.id));
}
function clearCells() {
  const c = COLUMNS[grid.active.col];
  if (c.readonly) return;
  const rows = targetRows();
  commit(`清空${c.label}（${rows.length} 部）`, rows.flatMap(r => fieldChanges(r, c.key, parseFieldValue(c.key, ''))));
}
function fillDown() {
  const c = COLUMNS[grid.active.col], rows = targetRows();
  if (c.readonly || rows.length < 2) return setStatus('先用 Shift 选中多行，再向下填充。');
  const value = clone(rows[0][c.key]);
  commit(`向下填充${c.label}（${rows.length - 1} 部）`, rows.slice(1).flatMap(r => fieldChanges(r, c.key, value)));
}
$('fillBtn').addEventListener('click', fillDown);
$('delBtn').addEventListener('click', () => {
  const rows = targetRows();
  if (!rows.length) return;
  if (!confirmInline(`删除这 ${rows.length} 部作品？\n${rows.slice(0, 5).map(r => r.code + ' ' + shortName(r)).join('\n')}${rows.length > 5 ? '\n……' : ''}\n\n它们在各个分区里都会删掉，可以按 Ctrl+Z 撤销。`)) return;
  deleteCards(rows, `删除 ${rows.length} 部作品`);
});

// 复制、粘贴（Excel 复制出来是制表符分隔的文字）
function parseTsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const tsvCell = s => /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
$('gridWrap').addEventListener('copy', e => {
  if (grid.editing) return;
  const c = COLUMNS[grid.active.col];
  e.clipboardData.setData('text/plain', targetRows().map(r => tsvCell(cellText(r, c.key))).join('\n'));
  e.preventDefault();
  setStatus(`已复制 ${targetRows().length} 格。`);
});
$('gridWrap').addEventListener('paste', e => {
  if (grid.editing) return;
  e.preventDefault();
  const data = parseTsv(e.clipboardData.getData('text/plain'));
  if (!data.length) return;
  pasteBlock(data);
});
function pasteBlock(data) {
  const changes = [];
  let skipped = 0, cellsDone = 0;
  const single = data.length === 1 && data[0].length === 1;
  const startRow = grid.active.row, startCol = grid.active.col;
  const targets = single && grid.selected.size > 1 ? targetRows().map(r => [r, startCol, data[0][0]])
    : data.flatMap((line, i) => line.map((text, j) => [grid.rows[startRow + i], startCol + j, text]));
  for (const [r, col, text] of targets) {
    const c = COLUMNS[col];
    if (!r || !c || c.readonly) { skipped++; continue; }
    changes.push(...fieldChanges(r, c.key, parseFieldValue(c.key, text)));
    cellsDone++;
  }
  const n = commit(`粘贴 ${cellsDone} 格`, changes);
  setStatus(`粘贴了 ${cellsDone} 格（实际改动 ${n} 处）` + (skipped ? `，跳过 ${skipped} 格（只读列或超出最后一行）` : '') + '。可以按 Ctrl+Z 撤销。', n ? 'dirty' : '');
}

// 工具栏
let searchTimer;
$('gridSearch').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { grid.query = e.target.value.trim().toLocaleLowerCase(); grid.active.row = 0; refreshGrid(); $('gridBody').scrollTop = 0; }, 150);
});
$('gridSection').addEventListener('change', e => { grid.section = e.target.value; grid.active.row = 0; refreshGrid(); });
$('gridQuick').addEventListener('change', e => { grid.quick = e.target.value; grid.active.row = 0; refreshGrid(); });
$('detailBtn').addEventListener('click', () => {
  grid.detailOpen = !grid.detailOpen;
  $('detail').hidden = !grid.detailOpen;
  $('detailBtn').setAttribute('aria-pressed', String(grid.detailOpen));
  renderGrid();
});

// 右侧详情：当前行的全部内容，长备注、分区、制作备注在这里改
function renderDetail() {
  const r = activeRecord();
  if (!grid.detailOpen) return;
  if (!r) { $('detail').innerHTML = '<p class="empty">没有符合条件的作品。</p>'; return; }
  if ($('detail').dataset.id === r.id && $('detail').contains(document.activeElement)) return;
  $('detail').dataset.id = r.id;
  const col = collectionOf(r);
  const sourceIdentity = detailSourceId(r);
  $('detail').innerHTML = `
    <div class="detail-head"><span class="mono">${esc(r.code)}</span>${touched.has(r.id) ? '<span class="edited">已改</span>' : ''}</div>
    <h3>${esc(r.name)}</h3>
    <div class="row-inline detail-tools"><button id="d_versions">找其他版本</button><button id="d_delete">删除这部</button></div>
    <div class="field" ${fieldVisible('source_id')?'':'hidden'}><label for="d_source_ref">${esc(fieldLabel('source_id','资料编号'))}（来源:编号）</label>
      <input id="d_source_ref" value="${esc(sourceIdentity)}" placeholder="例：steam:编号、bangumi:编号，或资料网址" autocomplete="off">
      <span class="count">资料来源中的作品编号，和下面的目录编号分开。补过的编号会显示在这里，可直接修改。</span>
      <span id="d_source_ref_link">${!!sourceDetailUrl(sourceIdentity) ? `<a href="${esc(sourceDetailUrl(sourceIdentity))}" target="_blank" rel="noopener">打开资料页面 ↗</a>` : ''}</span>
    </div>
    <div class="detail-cover">${coverHtml(r, 'md')}<span class="count">${esc(coverKind(r) || '还没有封面')} · 点图换封面</span></div>
    <div class="detail-form">
      ${detailInput(r, 'name', '名称', 'wide')}
      ${detailInput(r, 'code', '目录编号')}${detailInput(r, 'version', '版本')}
      ${detailInput(r, 'author', '作者', 'wide')}
      ${detailInput(r, 'genre', '类型')}${detailInput(r, 'platform', '平台')}
      ${detailInput(r, 'translation', '语言')}${detailInput(r, 'size_str', '大小')}
      ${detailInput(r, 'tags', '标签（类型、平台、语言会自动带上）', 'wide')}
      ${detailInput(r, 'category_raw', '归档批次', 'wide', '填写自己使用的归档标签，例如月份、专题或书架名称。用于分类和查找，不会推断网盘目录或移动文件。')}
      ${detailInput(r, 'date', '加入／更新名单日期', 'wide', '你哪天把这一版加入或更新到名单，就填哪天；用于名单按日期排序。', 'date')}
    </div>
    <fieldset class="detail-update" ${fieldVisible('updated')?'':'hidden'}><legend><label><input type="checkbox" data-d-field="updated" ${r.updated ? 'checked' : ''}> 标记为版本更新</label></legend>
      <p class="count">已有作品出了新版时勾选，读者会看到「更新」标记。只添加新作品时不用勾。</p>
      <div class="detail-form">
        ${detailInput(r, 'update_summary', '本次更新内容', 'wide', '简单写新版改了什么，例如「升级到 v1.05，补充索引、修正文档」。读者会在卡片上看到。')}
        ${detailInput(r, 'version_date', '作品版本发布日期（选填）', 'wide', '作者发布这个作品版本的日期；不知道就留空。', 'date')}
      </div>
      <p class="count">例如：作品 10 月 20 日发新版，你 10 月 23 日更新名单，上面填 10 月 23 日，这里填 10 月 20 日。</p>
    </fieldset>
    <div class="field" ${fieldVisible('notes')?'':'hidden'}><label for="d_notes">${esc(fieldLabel('notes','备注'))}（读者可见）</label><textarea id="d_notes" rows="8">${esc(r.notes || '')}</textarea></div>
    <div class="field"><label>分区</label><div class="checks">${SECTIONS.map(s => {
      const on = sectionsOf(r).includes(s), primary = s === r.sheet;
      return `<label><input type="checkbox" data-section="${esc(s)}" ${on ? 'checked' : ''} ${primary ? 'disabled title="作品原本所在的分区"' : ''}> ${esc(s)}</label>`;
    }).join('')}</div></div>
    <div class="field private-field"><label for="d_private">制作备注（只留在母版，不会导出）</label><textarea id="d_private" rows="3">${esc(privateNotes[r.id] || '')}</textarea></div>
    <div class="field">${detailInput(r, 'quark_url', '夸克链接')}${detailInput(r, 'baidu_url', '百度链接')}</div>
    <dl class="readonly">
      <dt>合集</dt><dd>${esc(col ? col.label : '未归入合集')}</dd>
      <dt>原始名称</dt><dd>${esc(r.raw_title || '')}</dd>
      <dt>原始标签</dt><dd>${esc(r.raw_tags || '')}</dd>
    </dl>`;
  $('d_notes').addEventListener('change', e => setField(r, 'notes', e.target.value, `改备注：${r.code}`));
  $('d_source_ref').addEventListener('change', e => {
    const text = e.target.value.trim(), p = parseManualId(text);
    const warnings = text ? manualIdWarnings(r, text, new Map()) : [];
    const n = commit(`改资料编号：${r.code}`, manualIdChanges(r, text));
    e.target.value = detailSourceId(r);
    $('d_source_ref_link').innerHTML = sourceDetailUrl(p.code) ? `<a href="${esc(sourceDetailUrl(p.code))}" target="_blank" rel="noopener">打开资料页面 ↗</a>` : '';
    refreshCovers([r.id]);
    $('detail').querySelector('.detail-cover .count').textContent = (coverKind(r) || '还没有封面') + ' · 点图换封面';
    setStatus([n ? '编号已修改，可撤销。最后点「保存母版」保留到文件。' : '编号没有变化。', ...warnings].join(' '), n ? 'dirty' : '');
  });
  $('detail').querySelectorAll('[data-d-field]').forEach(el => el.addEventListener('change', () =>
    applyCellValue(r, el.dataset.dField, el.type === 'checkbox' ? (el.checked ? '是' : '') : el.value)));
  $('d_versions').onclick = () => openVersionsDialog(r);
  $('d_delete').onclick = () => { if (confirmInline(`删除 ${r.code} ${shortName(r)}？各个分区里都会删掉，可以按 Ctrl+Z 撤销。`)) deleteCards([r], `删除 ${r.code} ${shortName(r)}`); };
  $('d_private').addEventListener('change', e => commit(`改制作备注：${r.code}`, [{kind: 'private', id: r.id, before: privateNotes[r.id] || '', after: e.target.value.trim() ? e.target.value : ''}]));
  $('detail').querySelectorAll('[data-section]').forEach(b => b.addEventListener('change', () =>
    commit(`${b.checked ? '加入' : '移出'}${b.dataset.section}：${r.code}`, sectionChanges(r, b.dataset.section, b.checked))));
}

// 详情栏里的一格：直接改，改完和在表格里改一样（能撤销）
function detailInput(r, key, label, cls = '', hint = '', type = 'text', prefix = 'd_') {
  if(!fieldVisible(key))return '';
  label=fieldLabel(key,label);
  const id = prefix + key;
  return `<div class="field ${cls}"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" data-d-field="${key}" value="${esc(cellText(r, key))}"${TYPE_KEYS.includes(key) ? ` data-type-key="${key}"` : ''} autocomplete="off">${hint ? `<span class="count">${esc(hint)}</span>` : ''}</div>`;
}

// 批量修改
BATCH_FIELDS = COLUMNS.filter(c => !c.readonly && c.key !== 'code');
$('batchBtn').addEventListener('click', () => {
  const rows = targetRows();
  const dlg = openDialog(`
    <h3>批量修改 ${rows.length} 部作品</h3>
    <div class="grid2">
      <div class="field"><label for="b_mode">做什么</label><select id="b_mode">
        <option value="set">把某一列设为</option><option value="tagAdd">加标签</option><option value="tagDel">删标签</option>
        <option value="secAdd">加入分区</option><option value="secDel">移出分区</option></select></div>
      <div class="field" id="b_fieldWrap"><label for="b_field">哪一列</label><select id="b_field">${BATCH_FIELDS.map(c => `<option value="${c.key}">${c.label}</option>`).join('')}</select></div>
      <div class="field wide" id="b_valueWrap"><label for="b_value">内容</label><input id="b_value"></div>
      <div class="field wide" id="b_secWrap" hidden><label for="b_sec">分区</label><select id="b_sec">${SECTIONS.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
    </div>
    <p class="count" id="b_preview"></p>
    <div class="dialog-actions"><button data-close>取消</button><button class="primary" id="b_apply">应用</button></div>`);
  const sync = () => {
    const mode = $('b_mode').value;
    $('b_fieldWrap').hidden = mode !== 'set';
    $('b_secWrap').hidden = !mode.startsWith('sec');
    $('b_valueWrap').hidden = mode.startsWith('sec');
    $('b_preview').textContent = `会影响选中的 ${rows.length} 部作品，应用后可以撤销。`;
  };
  dlg.addEventListener('change', sync); sync();
  $('b_apply').addEventListener('click', () => {
    const mode = $('b_mode').value, value = $('b_value').value, sec = $('b_sec').value;
    let changes = [], label;
    if (mode === 'set') {
      const key = $('b_field').value;
      changes = rows.flatMap(r => fieldChanges(r, key, parseFieldValue(key, value)));
      label = `批量设${FIELD_LABEL[key]}（${rows.length} 部）`;
    } else if (mode === 'tagAdd' || mode === 'tagDel') {
      const tags = parseFieldValue('tags', value);
      changes = rows.map(r => {
        const now = r.tags || [];
        const next = mode === 'tagAdd' ? [...now, ...tags.filter(t => !now.includes(t))] : now.filter(t => !tags.includes(t));
        return fieldChange(r, 'tags', next);
      });
      label = `批量${mode === 'tagAdd' ? '加' : '删'}标签（${rows.length} 部）`;
    } else {
      changes = rows.filter(r => !(mode === 'secDel' && r.sheet === sec)).flatMap(r => sectionChanges(r, sec, mode === 'secAdd'));
      label = `批量${mode === 'secAdd' ? '加入' : '移出'}${sec}（${rows.length} 部）`;
    }
    const n = commit(label, changes);
    closeDialog();
    setStatus(`${label}：实际改动 ${n} 处。可以按 Ctrl+Z 撤销。`, n ? 'dirty' : '');
    focusGrid();
  });
});

// 查找替换
FIND_FIELDS = COLUMNS.filter(c => !c.readonly);
function openFindReplace() {
  openDialog(`
    <h3>查找替换</h3>
    <div class="grid2">
      <div class="field"><label for="f_find">查找</label><input id="f_find"></div>
      <div class="field"><label for="f_repl">替换为</label><input id="f_repl"></div>
      <div class="field"><label for="f_field">在哪一列</label><select id="f_field"><option value="">所有可编辑的列</option>${FIND_FIELDS.map(c => `<option value="${c.key}">${c.label}</option>`).join('')}</select></div>
      <div class="field"><label for="f_scope">范围</label><select id="f_scope"><option value="view">当前筛选结果（${grid.rows.length} 部）</option><option value="selected">选中的行（${grid.selected.size} 部）</option><option value="all">全部作品（${cards.length} 部）</option></select></div>
      <label class="wide"><input type="checkbox" id="f_case"> 区分大小写</label>
    </div>
    <div class="find-result" id="f_result"></div>
    <div class="dialog-actions"><button data-close>关闭</button><button id="f_go">查找</button><button class="primary" id="f_apply" disabled>全部替换</button></div>`, {wide: true});
  let found = [];
  const run = () => {
    const needle = $('f_find').value, keys = $('f_field').value ? [$('f_field').value] : FIND_FIELDS.map(c => c.key);
    const scope = $('f_scope').value === 'all' ? cards : $('f_scope').value === 'selected' ? targetRows() : grid.rows;
    const flags = $('f_case').checked ? 'g' : 'gi';
    found = [];
    if (needle) {
      const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      for (const r of scope) for (const key of keys) {
        const text = fieldText(r, key);
        if (re.test(text)) found.push({r, key, text, next: text.replace(re, () => $('f_repl').value)});
        re.lastIndex = 0;
      }
    }
    $('f_result').innerHTML = !needle ? '' : !found.length ? '<p class="count">没有找到。</p>' :
      `<p class="count">找到 ${found.length} 处。替换后：</p><ul>${found.slice(0, 30).map(f => `<li><button class="link" data-reveal="${esc(f.r.id)}">${esc(f.r.code)}</button> ${FIELD_LABEL[f.key]}：${esc(f.next.slice(0, 80))}</li>`).join('')}${found.length > 30 ? `<li>……还有 ${found.length - 30} 处</li>` : ''}</ul>`;
    $('f_apply').disabled = !found.length;
  };
  $('f_go').addEventListener('click', run);
  ['f_find', 'f_repl'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') run(); }));
  $('f_result').addEventListener('click', e => { const b = e.target.closest('[data-reveal]'); if (b) { closeDialog(); revealRecord(b.dataset.reveal); } });
  $('f_apply').addEventListener('click', () => {
    const n = commit(`替换「${$('f_find').value}」为「${$('f_repl').value}」（${found.length} 处）`,
      found.flatMap(f => fieldChanges(f.r, f.key, parseFieldValue(f.key, f.next))));
    closeDialog();
    setStatus(`已替换 ${found.length} 处（实际改动 ${n} 处）。可以按 Ctrl+Z 撤销。`, n ? 'dirty' : '');
  });
}
$('findBtn').addEventListener('click', openFindReplace);

onChange(() => { configureGridColumns(); if (!$('pane-list').hidden) { computeRows(); renderGrid(); renderDetail(); } });
tabHandlers.list = () => { computeRows(); renderGrid(); renderDetail(); };
window.addEventListener('resize', () => requestAnimationFrame(renderGrid));
