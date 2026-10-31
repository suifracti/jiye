// 目录母版 · 月度名单（4月名单.txt 这类）：导入时逐行对回目录里的作品，标题行、空行、「*」「#精品」和行尾备注都原样保留；
// 对不上的留着等你选，不会乱绑；导出时可以保持原来的写法，也可以统一写成「批次【编号】名称」。
const LIST_HEADER = /^(?:[A-Za-z0-9+]{2,6}|播片\S{0,6}|播放器\S{0,6}|其他|合集\S{0,8}|精品\S{0,4})$/;
const KANA = /[぀-ヿ]/;
let listSel = null, listOnlyTodo = false, listQuery = '', listMode = 'keep';
const monthListsOf = () => project.monthLists || [];
function setMonthLists(next, label) {
  return commit(label, [{kind: 'project', path: ['monthLists'], before: clone(project.monthLists || []), after: next}]);
}
function editList(fn, label) {
  const next = clone(monthListsOf());
  const ls = next.find(x => x.id === listSel);
  if (!ls) return;
  fn(ls, next);
  setMonthLists(next, label);
  renderLists();
}

// ---------- 解析一行 ----------
function parseListItem(raw) {
  let t = raw.trim(), star = false, note = '';
  if (t.startsWith('*')) { star = true; t = t.slice(1).trim(); }
  const marks = [];
  for (let m; (m = t.match(/\s*(#\S+)$/));) { marks.unshift(m[1]); t = t.slice(0, m.index).trimEnd(); }
  const n = t.match(/\s{2,}(\S.*)$/);
  if (n) { note = n[1]; t = t.slice(0, n.index).trimEnd(); }
  const code = (t.match(/【([A-Za-z][A-Za-z0-9]*\d{4,}[A-Za-z0-9]*)】/) || [])[1] || '';
  const name = t.replace(/^【[^】]*】\s*[\d.]*\s*/, '').replace(/【[A-Za-z][A-Za-z0-9]*\d{4,}[A-Za-z0-9]*】/, '').trim();
  return {type: 'item', raw, star, marks, note, code, name};
}
function parseListText(text, title) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map(raw => !raw.trim() ? {type: 'blank'} : LIST_HEADER.test(raw.trim()) && !raw.includes('【') ? {type: 'header', text: raw.trim()} : parseListItem(raw));
}

// ---------- 对回作品 ----------
let listIndex = null;
function buildListIndex() {
  listIndex = cards.map(r => {
    const base = String(r.name || '').replace(/^(更新|新作|补档|恢复|修复版|问题修复|BUG更新)\s*/i, '').replace(/^『/, '');
    const words = base.split(/\s+/).filter(Boolean);
    // 名称常是「中文名 英文名 日文名」：取前 1、2、3… 个词都算作这部作品的名字
    const lead = words.map((_, i) => words.slice(0, i + 1).join(' '));
    const parts = [base, ...base.split(/[\/／\\]/), ...lead, words.filter(w => !KANA.test(w)).join(''), ...(r.aliases || [])].filter(Boolean);
    const vs = [...new Set(parts.map(normalizeSearch).filter(v => v.length >= 2))];
    return {r, vs, py: [...new Set(parts.map(p => pinyinKey(p).split(' ')[0]).filter(v => v.length >= 6))]};
  });
}
function monthOf(r) { const m = String(r.date || '').match(/^\d{4}-(\d{2})/); return m ? +m[1] : 0; }
// 名单里常用 x、w 代替被屏蔽的字（x爱、造w温泉）：夹在中文中间的单个 x / w 当成任意一个字
const WILD = /(^|[^a-z])[xw](?=[^a-z]|$)/i;
function matchByName(name, month) {
  const n = normalizeSearch(name);
  if (n.length < 2) return null;
  const exact = listIndex.filter(x => x.vs.includes(n));
  if (exact.length === 1) return {status: 'name', id: exact[0].r.id};
  const py = pinyinKey(name).split(' ')[0];
  const pyHit = py.length >= 6 ? listIndex.filter(x => x.py.includes(py)) : [];
  if (!exact.length && pyHit.length === 1) return {status: 'pinyin', id: pyHit[0].r.id};
  let wild = [];
  if (WILD.test(name)) {
    const re = new RegExp('^' + [...n].map((c, i, a) => /[xw]/.test(c) && !/[a-z]/.test(a[i - 1] || '') && !/[a-z]/.test(a[i + 1] || '') ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''));
    wild = listIndex.filter(x => x.vs.some(v => re.test(v)));
    if (wild.length === 1) return {status: 'fuzzy', id: wild[0].r.id};
  }
  let cand = exact.length ? exact : pyHit.length ? pyHit : wild.length ? wild
    : n.length >= 4 ? listIndex.filter(x => x.vs.some(v => v.length >= 4 && (v.startsWith(n) || n.startsWith(v) || v.includes(n)))) : [];
  if (cand.length > 1 && month) {
    const near = cand.filter(x => [month, month - 1, month + 1].includes(monthOf(x.r)));
    if (near.length === 1) return {status: exact.length ? 'name' : 'fuzzy', id: near[0].r.id};
    if (near.length) cand = near;
  }
  if (cand.length === 1) return {status: 'fuzzy', id: cand[0].r.id};
  if (cand.length > 1) return {status: 'ambiguous', candidates: cand.slice(0, 8).map(x => x.r.id)};
  return null;
}
function matchListItem(item, month) {
  if (!listIndex) buildListIndex();
  // 行尾单独的 x（「挑战x」「静谧灯火 x」）像是自己做的记号，对作品时先去掉
  const name = String(item.name || '').replace(/([^a-z\s])\s*x$/i, '$1').replace(/\s+x$/i, '').trim();
  if (item.code) {
    let hit = cards.filter(r => r.code === item.code);
    if (hit.length > 1 && name) {
      const n = normalizeSearch(name);
      const byName = hit.filter(r => normalizeSearch(r.name).includes(n));
      if (byName.length) hit = byName;
    }
    if (hit.length === 1) return {status: 'code', id: hit[0].id};
    if (hit.length > 1) return {status: 'ambiguous', candidates: hit.map(r => r.id)};
  }
  // 行里写了编号、但目录里没有这个编号：就算按名称对上了，也标成「请核对」
  const soft = m => item.code && m && m.status !== 'ambiguous' ? Object.assign(m, {status: 'fuzzy'}) : m;
  const first = soft(matchByName(name, month));
  if (first) return first;
  // 行尾带了一两个词的备注（「附录」「新版」）：去掉最后一个词再试
  const words = name.split(/\s+/);
  for (let k = words.length - 1; k >= 1; k--) {
    const shorter = words.slice(0, k).join(' ');
    if (normalizeSearch(shorter).length < 4) break;
    const m = matchByName(shorter, month);
    if (m) return m.status === 'ambiguous' ? m : Object.assign(m, {status: 'fuzzy'});
  }
  return {status: 'unmatched'};
}
function importListFile(name, text) {
  const title = name.replace(/\.txt$/i, '');
  const month = +((title.match(/(\d{1,2})\s*月/) || [])[1] || 0);
  const lines = parseListText(text, title).map(l => l.type === 'item' ? Object.assign(l, matchListItem(l, month)) : l);
  // 记下原文件的换行、结尾空行和 BOM，「保持原样」导出时逐字节还原
  const body = String(text).replace(/^\ufeff/, ''), eol = /\r\n/.test(body) || !/\n/.test(body) ? '\r\n' : '\n';
  const ending = (body.match(/(?:(?:\r\n|\r|\n)[ \t\u3000]*)*$/) || [''])[0];
  return {id: 'ls' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title, month, importedFrom: name, lines,
    format: {eol, ending, bom: String(text).startsWith('\ufeff')}};
}

// ---------- 导出 ----------
function shortName(r) {
  // 目录里的名称常是「中文名 英文名 日文名 别名」，名单里只写第一个名字
  const base = String(r.name || '').replace(/^(更新|新作|补档|恢复|修复版|问题修复|BUG更新)\s*/i, '').trim();
  const words = base.split(/\s+/).filter(Boolean);
  let out = words[0] || base;
  if (out.length < 3 && words[1] && !/^[A-Za-z]/.test(words[1])) out += ' ' + words[1];
  return out.replace(/[：:]+$/, '') || base;
}
function listLineText(l, mode) {
  if (l.type === 'blank') return '';
  if (l.type === 'header') return l.text;
  const r = l.id ? byId.get(l.id) : null;
  if (!r || (mode === 'keep' && l.raw)) return l.raw || l.name || '';
  return `${l.star ? '*' : ''}${r.category_raw || ''}【${r.code}】${l.name || shortName(r)}${l.note ? '   ' + l.note : ''}${l.marks?.length ? ' ' + l.marks.join(' ') : ''}`;
}
// 分发版里的名单：只带对上的作品编号、分组、* 和 #标记；没对上的行带原文
function publicMonthLists() {
  return monthListsOf().filter(ls => ls.published).map(ls => {
    const groups = [{title: '', items: []}];
    for (const l of ls.lines) {
      if (l.type === 'header') groups.push({title: l.text, items: []});
      else if (l.type === 'item') groups[groups.length - 1].items.push(l.id && byId.has(l.id) ? {id: l.id, star: !!l.star, marks: l.marks || []} : {text: l.raw || l.name || ''});
    }
    return {id: ls.id, title: ls.title, groups: groups.filter(g => g.items.length), text: listText(ls, 'keep')};
  });
}
function listText(ls, mode) {
  const f = ls.format || {}, eol = f.eol || '\r\n';
  return (f.bom ? '\ufeff' : '') + ls.lines.map(l => listLineText(l, mode)).join(eol) + (f.ending ?? eol);
}

// ---------- 界面 ----------
const LIST_STATUS = {code: ['按编号对上', 'ok'], name: ['按名称对上', 'ok'], pinyin: ['按拼音对上', 'ok'], fuzzy: ['模糊对上，请核对', 'warn'],
  chosen: ['已选定', 'ok'], manual: ['母版里加的', 'ok'], ambiguous: ['有几个候选', 'warn'], unmatched: ['没对上', 'bad']};
function listStats(ls) {
  const items = ls.lines.filter(l => l.type === 'item');
  const by = s => items.filter(l => s.includes(l.status)).length;
  return {total: items.length, ok: by(['code', 'name', 'pinyin', 'chosen', 'manual']), fuzzy: by(['fuzzy']), amb: by(['ambiguous']), none: by(['unmatched'])};
}
function renderLists() {
  const all = monthListsOf();
  if (!listSel || !all.some(x => x.id === listSel)) listSel = all[0]?.id || null;
  const ls = all.find(x => x.id === listSel);
  $('pane-lists').innerHTML = `<div class="pane-inner lists">
    <div class="pane-head"><h2>月度名单</h2><span class="spacer"></span>
      <label class="file-btn">导入 TXT<input type="file" id="ls_import" accept=".txt,text/plain" multiple hidden></label>
      <button id="ls_new" class="primary">＋ 新建名单</button></div>
    <p class="count">导入「4月名单.txt」这类文件：每一行按编号、名称、拼音对回目录里的作品，标题行、空行、「*」「#精品」和行尾备注都原样保留。对不上的会留着等你选，不会乱绑。</p>
    <div class="rk-list">${all.map(x => { const st = listStats(x); return `<button class="rk-tab${x.id === listSel ? ' on' : ''}" data-ls="${x.id}">${esc(x.title)}<small>${st.total} 部${st.amb + st.none ? ` · 待处理 ${st.amb + st.none}` : ''}</small></button>`; }).join('') || '<span class="count">还没有名单。</span>'}</div>
    ${ls ? listEditor(ls) : ''}</div>`;
  $('ls_import').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const made = [];
    for (const f of files) made.push(importListFile(f.name, await f.text()));
    setMonthLists([...clone(monthListsOf()), ...made], `导入名单 ${files.map(f => f.name).join('、')}`);
    listSel = made[0].id;
    renderLists();
    const st = made.map(listStats).reduce((a, b) => ({total: a.total + b.total, ok: a.ok + b.ok, fuzzy: a.fuzzy + b.fuzzy, amb: a.amb + b.amb, none: a.none + b.none}));
    setStatus(`导入了 ${made.length} 份名单，共 ${st.total} 部：对上 ${st.ok}，模糊对上 ${st.fuzzy}，有候选 ${st.amb}，没对上 ${st.none}。`, 'dirty');
  });
  $('ls_new').onclick = () => {
    const m = +(String(meta.update_date || '').slice(5, 7)) || new Date().getMonth() + 1;
    const ls2 = {id: 'ls' + Date.now().toString(36), title: `${m}月名单`, month: m, lines: ['分组一', '分组二'].flatMap((h, i) => [...(i ? [{type: 'blank'}] : []), {type: 'header', text: h}])};
    setMonthLists([...clone(monthListsOf()), ls2], '新建名单');
    listSel = ls2.id;
    renderLists();
  };
  $('pane-lists').querySelectorAll('[data-ls]').forEach(b => b.onclick = () => { listSel = b.dataset.ls; renderLists(); });
  if (ls) bindListEditor(ls);
}
function listEditor(ls) {
  const st = listStats(ls);
  const headers = ls.lines.map((l, i) => [l, i]).filter(([l]) => l.type === 'header');
  return `<section class="section">
    <div class="grid2">
      <div class="field"><label for="ls_title">名单名称</label><input id="ls_title" value="${esc(ls.title)}"></div>
      <div class="field"><label>来源</label><div class="count">${ls.importedFrom ? `从「${esc(ls.importedFrom)}」导入` : '在母版里新建'}</div></div>
    </div>
    <p class="count">${st.total} 部：对上 <b>${st.ok}</b>，模糊对上（请核对）<b>${st.fuzzy}</b>，有几个候选 <b>${st.amb}</b>，没对上 <b>${st.none}</b>。</p>
    <div class="row-inline"><label><input type="checkbox" id="ls_pub" ${ls.published ? 'checked' : ''}> 发布到分发版（读者在左侧「月度名单」里看到，能一键加进拿取清单）</label></div>
    <div class="row-inline"><label><input type="checkbox" id="ls_todo" ${listOnlyTodo ? 'checked' : ''}> 只看需要处理的</label><span data-cover-hint></span><span class="spacer"></span><button id="ls_del">删除这份名单</button></div>
  </section>
  <section class="section">
    <h3>导出</h3>
    <div class="export-cards">
      <div class="export-card">
        <b>文字名单 · TXT</b>
        <p class="count">发给别人或存档。<label>写法 <select id="ls_mode"><option value="keep">保持原来每一行的写法</option><option value="code">统一写成「批次【编号】名称」</option></select></label></p>
        <pre class="export-preview" id="ls_preview"></pre>
        <div class="row-inline"><button id="ls_export" class="primary">导出 TXT</button><button id="ls_copy">复制文字</button></div>
        <p class="count">${esc(exportWhere(`${ls.title}.txt`))}</p>
      </div>
      <div class="export-card">
        <b>图片名单 · JPG</b>
        <p class="count">按分组排成封面墙，适合发群。名单里的封面点一下就能换。</p>
        <div class="row-inline"><label><input type="checkbox" id="ls_pngCode" checked> 图上写编号</label><label><input type="checkbox" id="ls_pngMarks" checked> 写 #标记</label></div>
        <div class="row-inline"><button id="ls_png" class="primary">导出图片</button></div>
        <p class="count">${esc(exportWhere(`${ls.title}.jpg`))}</p>
      </div>
    </div>
  </section>
  <section class="section">
    <h3>加作品</h3>
    <div class="rk-add"><input id="ls_q" placeholder="搜名称或编号" autocomplete="off" value="${esc(listQuery)}"><select id="ls_group">${headers.map(([l, i]) => `<option value="${i}">${esc(l.text)}</option>`).join('')}<option value="-1">放到最后</option></select><button id="ls_addHeader">＋ 加一个分组标题</button></div>
    <div class="rk-results" id="ls_results"></div>
  </section>
  <section class="section ls-lines">${ls.lines.map((l, i) => listLineRow(l, i)).join('')}</section>`;
}
function listLineRow(l, i) {
  const tools = `<span class="ls-tools"><button data-up="${i}" title="上移">↑</button><button data-down="${i}" title="下移">↓</button><button data-del="${i}" title="删掉这一行">×</button></span>`;
  if (l.type === 'blank') return listOnlyTodo ? '' : `<div class="ls-blank" title="空行（导出 TXT 时保留）">${tools}</div>`;
  if (l.type === 'header') return `<div class="ls-header"><input data-header="${i}" value="${esc(l.text)}" aria-label="分组标题">${tools}</div>`;
  const todo = ['fuzzy', 'ambiguous', 'unmatched'].includes(l.status);
  if (listOnlyTodo && !todo) return '';
  const r = l.id ? byId.get(l.id) : null, [label, cls] = LIST_STATUS[l.status] || ['', ''];
  let body;
  if (r) body = `<button class="link" data-reveal="${esc(r.id)}">${esc(r.code)}</button> ${esc(shortName(r))} <span class="count">${esc(r.version || '')}</span>${l.status === 'fuzzy' ? ` <button data-unbind="${i}">不是这部</button>` : ''}`;
  else if (l.status === 'ambiguous') body = `<select data-choose="${i}"><option value="">从候选里选一部…</option>${(l.candidates || []).filter(id => byId.has(id)).map(id => { const c = byId.get(id); return `<option value="${esc(id)}">${esc(c.code)} · ${esc(shortName(c))} · ${esc(c.date || c.category || '')}</option>`; }).join('')}<option value="__none">都不是</option></select>`;
  else body = `<input class="ls-bind" data-bind="${i}" placeholder="搜一部作品来对上" autocomplete="off"><div class="rk-results" data-bind-results="${i}"></div>`;
  return `<div class="ls-item ${cls}">
    ${r ? coverHtml(r, 'sm') : '<span class="cover sm empty"><span class="cover-ph">?</span></span>'}
    <span class="ls-badge ${cls}">${label}</span>
    <div class="ls-main"><div class="ls-raw" title="原来的这一行">${esc(l.raw || '（母版里加的）')}</div><div class="ls-match">${body}</div></div>
    <label class="ls-star" title="行首的 *"><input type="checkbox" data-star="${i}" ${l.star ? 'checked' : ''}>*</label>
    <input class="ls-marks" data-marks="${i}" value="${esc([...(l.marks || []), l.note].filter(Boolean).join(' '))}" placeholder="#精品 / 备注" aria-label="标记和备注">
    ${tools}</div>`;
}
function bindListEditor(ls) {
  const pane = $('pane-lists');
  $('ls_title').addEventListener('change', e => editList(x => { x.title = e.target.value.trim() || x.title; }, '改名单名称'));
  $('ls_todo').addEventListener('change', e => { listOnlyTodo = e.target.checked; renderLists(); });
  $('ls_pub').addEventListener('change', e => editList(x => { x.published = e.target.checked; }, e.target.checked ? `发布名单「${ls.title}」` : `取消发布名单「${ls.title}」`));
  $('ls_del').onclick = () => { setMonthLists(monthListsOf().filter(x => x.id !== ls.id).map(clone), `删除名单「${ls.title}」`); listSel = null; renderLists(); };
  $('ls_mode').value = listMode;
  const preview = () => {
    const lines = listText(ls, $('ls_mode').value).split(/\r?\n/);
    $('ls_preview').textContent = lines.slice(0, 12).join('\n') + (lines.length > 13 ? `\n……（共 ${lines.length - 1} 行）` : '');
  };
  preview();
  $('ls_mode').addEventListener('change', () => { listMode = $('ls_mode').value; preview(); });
  $('ls_copy').onclick = async () => { try { await navigator.clipboard.writeText(listText(ls, $('ls_mode').value)); setStatus('名单文字已复制。', 'ok'); } catch { setStatus('浏览器没让复制，请用「导出 TXT」。', 'error'); } };
  $('ls_png').onclick = () => busy($('ls_png'), '正在画图…', () => exportListPng(ls, {code: $('ls_pngCode').checked, marks: $('ls_pngMarks').checked}));
  refreshCoverHints();
  $('ls_export').onclick = async () => {
    const blob = new Blob([listText(ls, $('ls_mode').value)], {type: 'text/plain;charset=utf-8'});
    const r = await writeFile('txt:' + ls.id, blob, `${ls.title}.txt`, {'text/plain': ['.txt']}, '文本文件');
    if (!r.cancelled) setStatus(r.written ? `已写入名单：${r.name}` : `已开始下载名单：${r.name}`, 'ok');
  };
  // 加作品 / 分组标题
  const showResults = () => { $('ls_results').innerHTML = searchCards(listQuery).map(r => `<button data-add="${esc(r.id)}"><span class="mono">${esc(r.code)}</span> ${esc(r.name)}</button>`).join(''); };
  showResults();
  $('ls_q').addEventListener('input', e => { listQuery = e.target.value; showResults(); });
  const insertAt = (x, groupLine) => {
    if (groupLine < 0) return x.lines.length;
    let j = groupLine + 1;
    while (j < x.lines.length && x.lines[j].type === 'item') j++;
    return j;
  };
  $('ls_results').addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const g = +$('ls_group').value;
    editList(x => { x.lines.splice(insertAt(x, g), 0, {type: 'item', raw: '', name: '', code: '', star: false, marks: [], note: '', status: 'manual', id: b.dataset.add}); }, `名单加入：${byId.get(b.dataset.add)?.code}`);
    $('ls_group').value = String(g);
    $('ls_q').focus();
  });
  $('ls_addHeader').onclick = () => editList(x => { x.lines.push({type: 'blank'}, {type: 'header', text: '新分组'}); }, '名单加分组');
  // 每一行
  pane.querySelectorAll('[data-up],[data-down]').forEach(b => b.onclick = () => editList(x => {
    const i = +(b.dataset.up ?? b.dataset.down), j = b.dataset.up !== undefined ? i - 1 : i + 1;
    if (j < 0 || j >= x.lines.length) return;
    [x.lines[i], x.lines[j]] = [x.lines[j], x.lines[i]];
  }, '调整名单顺序'));
  pane.querySelectorAll('[data-del]').forEach(b => b.onclick = () => editList(x => { x.lines.splice(+b.dataset.del, 1); }, '删掉名单的一行'));
  pane.querySelectorAll('[data-header]').forEach(el => el.addEventListener('change', () => editList(x => { x.lines[+el.dataset.header].text = el.value.trim() || '分组'; }, '改分组标题')));
  pane.querySelectorAll('[data-star]').forEach(el => el.addEventListener('change', () => editList(x => { x.lines[+el.dataset.star].star = el.checked; }, '改行首 *')));
  pane.querySelectorAll('[data-marks]').forEach(el => el.addEventListener('change', () => editList(x => {
    const l = x.lines[+el.dataset.marks], parts = el.value.trim().split(/\s+/).filter(Boolean);
    l.marks = parts.filter(p => p.startsWith('#'));
    l.note = parts.filter(p => !p.startsWith('#')).join(' ');
  }, '改标记')));
  pane.querySelectorAll('[data-choose]').forEach(el => el.addEventListener('change', () => editList(x => {
    const l = x.lines[+el.dataset.choose];
    if (el.value === '__none') { l.status = 'unmatched'; l.id = null; }
    else if (el.value) { l.status = 'chosen'; l.id = el.value; }
  }, '选定名单作品')));
  pane.querySelectorAll('[data-unbind]').forEach(b => b.onclick = () => editList(x => { const l = x.lines[+b.dataset.unbind]; l.status = 'unmatched'; l.id = null; }, '取消对上'));
  pane.querySelectorAll('[data-bind]').forEach(el => {
    const out = pane.querySelector(`[data-bind-results="${el.dataset.bind}"]`);
    el.addEventListener('input', () => { out.innerHTML = searchCards(el.value).map(r => `<button data-pick="${esc(r.id)}"><span class="mono">${esc(r.code)}</span> ${esc(r.name)}</button>`).join(''); });
    out.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (b) editList(x => { const l = x.lines[+el.dataset.bind]; l.status = 'chosen'; l.id = b.dataset.pick; }, '对上名单作品');
    });
  });
  pane.querySelectorAll('[data-reveal]').forEach(b => b.onclick = () => revealRecord(b.dataset.reveal));
}
// ---------- 导出图片：按分组排成封面墙 ----------
async function exportListPng(ls, {code = true, marks = true} = {}) {
  const font = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif';
  const W = 1200, pad = 40, cols = 5, gap = 16, tileW = (W - pad * 2 - gap * (cols - 1)) / cols, coverH = Math.round(tileW * 0.75);
  const tileH = coverH + (code ? 22 : 0) + 46 + (marks ? 22 : 0) + 18;
  // 分组：标题行开一组；第一个标题前面的作品算一组没标题的
  const groups = [{title: '', items: []}];
  for (const l of ls.lines) {
    if (l.type === 'header') groups.push({title: l.text, items: []});
    else if (l.type === 'item') groups[groups.length - 1].items.push(l);
  }
  const shown = groups.filter(g => g.items.length);
  const ids = [...new Set(ls.lines.filter(l => l.type === 'item' && l.id && byId.has(l.id)).map(l => l.id))];
  const images = new Map(await Promise.all(ids.map(async id => [id, await loadCoverImage(byId.get(id))])));
  const headH = 116, groupHead = 52;
  const H = headH + shown.reduce((s, g) => s + (g.title ? groupHead : 8) + Math.ceil(g.items.length / cols) * (tileH + gap), 0) + pad;
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), dpr = 2;
  c.width = W * dpr; c.height = H * dpr; ctx.scale(dpr, dpr);
  const box = (x, y, w, h, rr) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, rr); else ctx.rect(x, y, w, h); };
  ctx.fillStyle = '#f3f5f2'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#16241b'; ctx.font = `800 36px ${font}`; ctx.fillText(ls.title, pad, 62);
  const total = ls.lines.filter(l => l.type === 'item').length;
  ctx.fillStyle = '#5b6b60'; ctx.font = `400 17px ${font}`;
  ctx.fillText([meta.input_name || meta.title, meta.update_date && '数据日期 ' + meta.update_date, `共 ${total} 部`].filter(Boolean).join(' · '), pad, 94);
  let y = headH;
  for (const g of shown) {
    if (g.title) {
      ctx.fillStyle = '#2d6a4f'; ctx.fillRect(pad, y + 12, 6, 26);
      ctx.fillStyle = '#16241b'; ctx.font = `800 24px ${font}`; ctx.fillText(g.title, pad + 16, y + 34);
      const tw = ctx.measureText(g.title).width;
      ctx.fillStyle = '#7a8a7f'; ctx.font = `400 15px ${font}`; ctx.fillText(`${g.items.length} 部`, pad + 28 + tw, y + 34);
      y += groupHead;
    } else y += 8;
    g.items.forEach((l, i) => {
      const r = l.id ? byId.get(l.id) : null, x = pad + (i % cols) * (tileW + gap), ty = y + Math.floor(i / cols) * (tileH + gap);
      ctx.save(); ctx.shadowColor = 'rgba(20,40,30,.10)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#fff'; box(x, ty, tileW, tileH, 10); ctx.fill(); ctx.restore();
      ctx.save(); box(x, ty, tileW, tileH, 10); ctx.clip();
      drawCover(ctx, r ? images.get(r.id) : null, r || {palette: ['#d9dfdb', '#9aa79f'], name: l.name || l.raw}, x, ty, tileW, coverH, font);
      ctx.restore();
      if (l.star) {
        ctx.fillStyle = '#f6c343'; ctx.beginPath(); ctx.arc(x + 20, ty + 20, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5a3d00'; ctx.font = `800 17px ${font}`; ctx.textAlign = 'center'; ctx.fillText('★', x + 20, ty + 26); ctx.textAlign = 'left';
      }
      let ty2 = ty + coverH + 24;
      if (code) { ctx.fillStyle = '#2d6a4f'; ctx.font = '700 14px ui-monospace,Consolas,monospace'; ctx.fillText(r ? r.code : (l.code || '没对上'), x + 12, ty2); ty2 += 22; }
      ctx.fillStyle = '#16241b'; ctx.font = `600 16px ${font}`;
      wrapLines(ctx, r ? (l.name || shortName(r)) : (l.name || l.raw || ''), tileW - 24, 2).forEach((t, k) => ctx.fillText(t, x + 12, ty2 + k * 22));
      ty2 += 46;
      if (marks && (l.marks || []).length) { ctx.fillStyle = '#b45309'; ctx.font = `600 13px ${font}`; ctx.fillText(wrapLines(ctx, l.marks.join(' '), tileW - 24, 1)[0] || '', x + 12, ty2); }
    });
    y += Math.ceil(g.items.length / cols) * (tileH + gap);
  }
  // 封面墙用 JPG：同样清晰，文件只有 PNG 的十分之一左右，发群不会被拒
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
  const missing = [...images.values()].filter(v => !v).length;
  const res = await writeFile('img:' + ls.id, blob, `${ls.title}.jpg`, {'image/jpeg': ['.jpg']}, 'JPG 图片');
  if (!res.cancelled) setStatus((res.written ? `已写入名单图：${res.name}` : `已开始下载名单图：${res.name}`) + (missing ? `。${missing} 部没取到封面，用了配色占位，点名单里的封面可以换` : ''), 'ok');
  refreshCoverHints();
}
tabHandlers.lists = renderLists;
onChange(info => {
  if (info?.changes?.some(c => c.kind === 'add' || c.kind === 'remove' || c.key === 'name' || c.key === 'aliases')) listIndex = null;
  if (!$('pane-lists').hidden && /撤销|重做/.test(info?.label || '')) renderLists();
});
