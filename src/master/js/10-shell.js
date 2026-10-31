// 目录母版 · 外框：顶栏、工作区切换、保存 / 导出 / 预览
appRoot.className = 'app';
appRoot.innerHTML = `
  <header class="topbar">
    <div class="brand" id="brand"></div>
    <span class="badge" title="直接双击打开的母版。抓资料、扫合集等联网功能要用小助手模式（M3）。">文件模式</span>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="actions">
      <button id="undoBtn" title="撤销（Ctrl+Z）">↶ 撤销</button>
      <button id="redoBtn" title="重做（Ctrl+Y）">↷ 重做</button>
      <button id="previewBtn">预览分发版</button>
      <button id="exportBtn">导出分发版</button>
      <button id="saveBtn" class="primary">保存母版</button>
    </div>
  </header>
  <nav class="tabs" role="tablist" aria-label="工作区">
    <button role="tab" data-tab="list" aria-selected="true">名单</button>
    <button role="tab" data-tab="collections" aria-selected="false">合集</button>
    <button role="tab" data-tab="settings" aria-selected="false">设置</button>
    <button role="tab" data-tab="rankings" aria-selected="false">榜单</button>
    <button role="tab" data-tab="lists" aria-selected="false">月度名单</button>
    <button role="tab" data-tab="health" aria-selected="false">体检 <span class="tab-count" id="healthCount"></span></button>
    <button role="tab" data-tab="xlsx" aria-selected="false">Excel 导入导出</button>
  </nav>
  <div class="work">
    <section class="pane" id="pane-list" data-pane="list"></section>
    <section class="pane" id="pane-collections" data-pane="collections" hidden></section>
    <section class="pane scroll" id="pane-settings" data-pane="settings" hidden></section>
    <section class="pane scroll" id="pane-rankings" data-pane="rankings" hidden></section>
    <section class="pane scroll" id="pane-lists" data-pane="lists" hidden></section>
    <section class="pane scroll" id="pane-health" data-pane="health" hidden></section>
    <section class="pane scroll" id="pane-xlsx" data-pane="xlsx" hidden></section>
    <section class="preview" id="preview" hidden>
      <div class="preview-bar">
        <button id="closePreview">← 返回编辑</button>
        <button id="deskBtn" aria-pressed="true">电脑宽度</button>
        <button id="phoneBtn" aria-pressed="false">手机宽度</button>
        <span class="note">这就是导出后的分发版。在预览里点任意作品，右边就能直接改；改完预览会自动刷新，回到原来的位置。预览里的收藏、主题只存在内存里。</span>
      </div>
      <div class="preview-body">
        <div class="frame-wrap" id="frameWrap"><iframe id="frame" title="分发版预览" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div>
        <aside class="preview-edit" id="previewEdit"><p class="count">在左边的预览里点一部作品（卡片或名称），这里就能改它。</p></aside>
      </div>
    </section>
  </div>
  <div class="dialog-layer" id="dialogLayer" hidden></div>`;

let statusTimer;
function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = 'status ' + kind;
}
function refreshStatus(lastLabel) {
  $('undoBtn').disabled = !history.done.length;
  $('redoBtn').disabled = !history.undone.length;
  $('undoBtn').title = history.done.length ? `撤销：${history.done[history.done.length - 1].label}（Ctrl+Z）` : '没有可撤销的操作';
  $('redoBtn').title = history.undone.length ? `重做：${history.undone[history.undone.length - 1].label}（Ctrl+Y）` : '没有可重做的操作';
  const n = unsaved();
  if (n) setStatus(`${lastLabel ? lastLabel + '。' : ''}有 ${n} 步修改没保存，保存母版后下次打开才会保留。`, 'dirty');
  else if (lastLabel) setStatus(`${lastLabel}。和上次保存时一样，没有未保存的修改。`, 'ok');
}
function refreshBrand() {
  $('brand').innerHTML = `${esc(meta.input_name || meta.title || '目录')}<small>母版 · ${cards.length} 部 · 数据日期 ${esc(meta.update_date || '未填')}</small>`;
  document.title = (meta.input_name || meta.title || '目录') + ' · 母版';
}
onChange(info => { refreshBrand(); refreshStatus(info && info.label); });
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);

// 工作区切换
const tabHandlers = {};
function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
  if (tabHandlers[name]) tabHandlers[name]();
}
document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) showTab(b.dataset.tab);
});

// 全局快捷键：撤销 / 重做 / 保存（输入框里按 Ctrl+Z 交给输入框自己处理）
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  // 名单表格的隐藏输入框在没进入编辑时不算输入框，Ctrl+Z 照样撤销
  const a = document.activeElement;
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(a?.tagName || '') && !(a.dataset.gridProxy && !a.classList.contains('editing'));
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); $('saveBtn').click(); return; }
  if (inField) return;
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

// ---------- 对话框 ----------
function openDialog(html, {wide = false} = {}) {
  const layer = $('dialogLayer');
  layer.innerHTML = `<div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  layer.hidden = false;
  const first = layer.querySelector('input,textarea,select,button');
  if (first) first.focus();
  return layer.firstElementChild;
}
function closeDialog() { $('dialogLayer').hidden = true; $('dialogLayer').innerHTML = ''; }
$('dialogLayer').addEventListener('click', e => {
  if (e.target === $('dialogLayer') || e.target.closest('[data-close]')) closeDialog();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('dialogLayer').hidden) closeDialog(); });

// ---------- 生成文件 ----------
function fill(template, values) {
  return template.replace(new RegExp(Object.keys(values).join('|'), 'g'), m => values[m]);
}
async function sha256Hex(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return 'x' + (h >>> 0).toString(16);
  }
}
// ---------- 本期变化：和上一期发布时的样子比较 ----------
// 同一个数据日期反复导出时，都和「上一期」比，不会因为重导一次就把变化清空
function publishSnapshot() {
  const items = {};
  for (const r of cards) items[r.id] = [r.code, r.name, r.version || '', r.quark_url || '', r.quark_location_url || '', r.baidu_url || '', fingerprint(r.notes || '')];
  return items;
}
function changeBase() {
  const h = project.publishHistory;
  if (!h || !h.current) return null;
  return h.current.date === meta.update_date ? h.previous : h.current;
}
function computeChanges() {
  const base = changeBase();
  if (!base) return {first: true};
  const now = publishSnapshot(), added = [], updated = [], removed = [];
  for (const [id, v] of Object.entries(now)) {
    const old = base.items[id];
    if (!old) { added.push(id); continue; }
    const fields = [];
    if (old[1] !== v[1]) fields.push('名称');
    if (old[2] !== v[2]) fields.push('版本');
    if (old[3] !== v[3] || old[4] !== v[4] || old[5] !== v[5]) fields.push('下载入口');
    if (old[6] !== v[6]) fields.push('说明');
    if (fields.length) updated.push({id, fields});
  }
  for (const [id, v] of Object.entries(base.items)) if (!now[id]) removed.push({code: v[0], name: v[1]});
  return {since: base.date || '', added, updated, removed};
}
function recordPublish() {
  const h = project.publishHistory || {};
  const previous = h.current && h.current.date === meta.update_date ? h.previous : h.current;
  project.publishHistory = {previous: previous || null, current: {date: meta.update_date || '', at: new Date().toISOString(), items: publishSnapshot()}};
  markDirty();
}
function publicRankings() {
  return (project.rankings || []).filter(rk => rk.published).map(rk => ({
    id: rk.id, title: rk.title, period: rk.period, note: rk.note, tiers: rk.tiers,
    image: rk.imageId ? (project.rankingImages || {})[rk.imageId] || '' : '', regions: rk.imageId ? rk.regions || [] : [],
  }));
}
// 上榜作品的封面压成小图放进分发版：读者打开时不用联网，也不会去别的网站取图
const readerCoverCache = new Map();
async function rankingCovers(list, ready = {}) {
  const ids = [...new Set(list.flatMap(rk => rk.tiers.flatMap(t => t.items.map(it => it.id))).filter(id => byId.has(id)))];
  const out = {};
  await Promise.all(ids.map(async id => {
    if (ready[id]) { out[id] = ready[id]; return; }
    const r = byId.get(id), key = id + '|' + coverSrc(r);
    if (!readerCoverCache.has(key)) {
      const img = await loadCoverImage(r);
      let data = '';
      if (img) {
        const s = Math.min(1, 200 / Math.min(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        try { data = c.toDataURL('image/webp', 0.7); if (!data.startsWith('data:' + 'image/webp')) data = c.toDataURL('image/jpeg', 0.75); } catch { data = ''; }
      }
      readerCoverCache.set(key, data);
    }
    if (readerCoverCache.get(key)) out[id] = readerCoverCache.get(key);
  }));
  return out;
}
async function buildReader(options = {}) {
  // 公开数据只有看板数据和全局设置；制作备注、修改记录、Excel 基准都不在里面
  const publicMeta = Object.assign({}, meta, {total_records: views.length,reader_edition:new Date().toISOString(),
    collections: project.collections.map(c => ({label: c.label, baidu: c.baidu, quark: c.quark, quark_folders: c.quark_folders || {}})),
    changes: computeChanges(), rankings: publicRankings(), sources: sourceChoices().map(({id,name,enabled,detail_url,official})=>({id,name,enabled,detail_url,official})),
    // 用户图片和已启用来源返回的图片；来源配置与制作备注不对外导出。
    card_covers: project.covers || {}, steam_covers: project.steamCovers || {}, cover_off: Object.keys(project.coverOff || {})});
  let offline = null;
  if (options.offlineCovers) {
    offline = await collectOfflineCovers(options.onOfflineProgress);
    publicMeta.card_covers = Object.assign({}, publicMeta.card_covers, offline.covers);
    if (options.onOfflineComplete) options.onOfflineComplete(offline);
  }
  publicMeta.ranking_covers = await rankingCovers(publicMeta.rankings, offline?.covers);
  publicMeta.month_lists = publicMonthLists();
  const ui = JSON.stringify(meta.ui_config || {});
  // 外观设置改过才换 revision：读者的浏览器会据此重新套用默认主题等
  if (ui !== loadedUiJson) publicMeta.ui_config_revision = (await sha256Hex(ui)).slice(0, 16);
  // 每张卡带上名称的拼音，让读者可以用全拼或首字母搜
  const withPinyin = views.map(readerTagRecord).map(v => (!v.canonical_id || v.canonical_id === v.id) ? Object.assign({}, v, {search_py: searchPinyin(v)}) : v);
  const title = esc(meta.input_name || meta.title || '__PRODUCT_NAME__');
  return fill(readerTemplate.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`), {
    __UI_META__: scriptJson(await CatalogImages.protect(publicMeta)),
    __UI_RECORDS__: scriptJson(await packCompressed(withPinyin)),
  });
}
async function buildMaster() {
  const data = Object.assign({}, project, {
    programVersion: PROGRAM_VERSION,
    savedAt: new Date().toISOString(),
    meta,
    catalog: await packCompressed(views.map(readerTagRecord)),
  });
  return fill(masterShell, {
    __MASTER_STYLE__: $('master-style').textContent,
    __MASTER_SHELL__: scriptJson(masterShell),
    __READER_TEMPLATE__: scriptJson(readerTemplate),
    __PROJECT_DATA__: scriptJson(await CatalogImages.protect(data)),
    __MASTER_APP__: $('master-app').textContent,
  });
}

// 保存：Chrome/Edge 可以写回所选文件；不支持时改为下载一个新文件
const handles = {};
const canPick = typeof window.showSaveFilePicker === 'function';
const masterFileName = decodeURIComponent(location.pathname.split('/').pop() || '') || ((meta.input_name || '目录') + '-母版.html');
function download(data, name, type = 'text/html;charset=utf-8') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function writeFile(kind, data, suggestedName, accept = {'text/html': ['.html']}, description = 'HTML 文件') {
  if (canPick) {
    try {
      if (!handles[kind]) handles[kind] = await window.showSaveFilePicker({suggestedName, types: [{description, accept}]});
      const w = await handles[kind].createWritable();
      await w.write(data instanceof Blob ? data : new Blob([data]));
      await w.close();
      return {written: true, name: handles[kind].name};
    } catch (error) {
      if (error.name === 'AbortError') return {cancelled: true};
      handles[kind] = null;
      throw error;
    }
  }
  download(data, suggestedName);
  return {written: false, name: suggestedName};
}
// 导出的文件会去哪：开着小助手写进文件夹；Chrome / Edge 会问存到哪里；其他浏览器直接下载
function exportWhere(name, folder = '分发') {
  if (HELPER && !helperLost) return `会存到文件夹里的「${folder}/${name}」，同名文件会被替换。`;
  return canPick ? '会问你存到哪里；之后再导出同一份会直接覆盖你选的那个文件。' : `会下载到浏览器的下载文件夹，文件名「${name}」。`;
}
async function busy(button, label, task) {
  const old = button.textContent;
  document.querySelectorAll('.actions button').forEach(b => b.disabled = true);
  button.textContent = label;
  try { await task(); }
  catch (error) { setStatus('没有完成：' + (error.message || error), 'error'); }
  finally {
    button.textContent = old;
    document.querySelectorAll('.actions button').forEach(b => b.disabled = false);
    $('undoBtn').disabled = !history.done.length;
    $('redoBtn').disabled = !history.undone.length;
  }
}
const nowTime = () => new Date().toLocaleTimeString('zh-CN', {hour12: false});
async function saveMasterFile() {
  const html = await buildMaster();
  const r = await writeFile('master', html, masterFileName);
  if (r.cancelled) return setStatus(unsaved() ? `已取消保存，仍有 ${unsaved()} 步修改没保存。` : '已取消保存。', unsaved() ? 'dirty' : '');
  markSaved();
  if(typeof markTodoSaved==='function')markTodoSaved();
  setStatus(r.written ? `已写入母版文件：${r.name}（${nowTime()}）` : `已开始下载新母版：${r.name}。请在浏览器下载记录里确认已保存，下次打开这个新文件。`, 'ok');
  return r;
}
$('saveBtn').addEventListener('click', () => busy($('saveBtn'), '正在保存…', saveMasterFile));
$('exportBtn').addEventListener('click', () => {
  const problems = blockingProblems();
  if (problems.length) {
    showTab('health');
    return setStatus(`有 ${problems.length} 个问题必须先处理才能导出，见「体检」。`, 'error');
  }
  openReaderExportDialog();
});
async function exportReaderFile(options = {}) {
  let offline = null;
  if (options.offlineCovers) {
    openDialog('<h3>准备离线封面</h3><p class="count" id="offlineCoverProgress">正在读取已有封面…</p><progress id="offlineCoverBar" max="1" value="0" style="width:100%"></progress><p class="count">完成后继续导出；取不到的会列出来。</p>');
    options.onOfflineProgress = state => {
      const text = `封面 ${state.done} / ${state.total}，失败 ${state.failed} 部`;
      setStatus(text);
      if ($('offlineCoverProgress')) $('offlineCoverProgress').textContent = text;
      if ($('offlineCoverBar')) { $('offlineCoverBar').max = state.total || 1; $('offlineCoverBar').value = state.done; }
    };
    options.onOfflineComplete = result => { offline = result; };
  }
  const html = await buildReader(options);
  const r = await writeFile('reader', html, (meta.input_name || meta.title || '目录') + '.html');
  if (r.cancelled) { if (offline) closeDialog(); return setStatus('已取消导出。'); }
  recordPublish();
  if(typeof markTodoExported==='function')markTodoExported();
  const note = ` 本期变化已按这次导出记下，请保存母版。`;
  const imageNote = offline ? `离线封面 ${Object.keys(offline.covers).length} 部，失败 ${offline.failed.length} 部${offline.failed.length ? '（失败的仍需联网）' : ''}。` : '';
  setStatus((r.written ? `已写入分发版：${r.name}（${nowTime()}）。` : `已开始下载分发版：${r.name}。`) + imageNote + note, unsaved() ? 'dirty' : 'ok');
  if (offline) openDialog(`<h3>分发版已生成</h3><p>${esc(imageNote)}</p><p class="count">${esc(r.name)} · ${(new Blob([html]).size / 1048576).toFixed(1)} MB。${r.written ? '已写入文件。' : '已开始下载，请在浏览器下载记录里确认。'}嵌入的封面已按同一方式编码保存，母版原图没有改动。</p>${offline.failed.length ? `<details><summary>查看没能放进去的 ${offline.failed.length} 部</summary><ul>${offline.failed.map(x => `<li>${esc(x.label)}：${esc(x.error)}</li>`).join('')}</ul></details>` : ''}<div class="dialog-actions"><button data-close>关闭</button></div>`);
  return r;
}

// 预览：和导出用同一个函数生成；最前面多加一段，让预览里的收藏、主题存在内存里
const MEMORY_STORAGE = "(function(){var m=new Map();var s={getItem:function(k){return m.has(k)?m.get(k):null},setItem:function(k,v){m.set(k,String(v))},removeItem:function(k){m.delete(k)},clear:function(){m.clear()},key:function(i){return Array.from(m.keys())[i]||null},get length(){return m.size}};Object.defineProperty(window,'localStorage',{value:s,configurable:true});})();";
$('previewBtn').addEventListener('click', () => busy($('previewBtn'), '正在生成预览…', async () => {
  await loadPreview(false);
  $('preview').hidden = false;
}));
$('closePreview').addEventListener('click', () => { $('preview').hidden = true; $('frame').srcdoc = ''; previewEditId = null; renderPreviewEditor(); });
const setWidth = phone => {
  $('frameWrap').classList.toggle('phone', phone);
  $('deskBtn').setAttribute('aria-pressed', String(!phone));
  $('phoneBtn').setAttribute('aria-pressed', String(phone));
};
$('deskBtn').addEventListener('click', () => setWidth(false));
$('phoneBtn').addEventListener('click', () => setWidth(true));

window.addEventListener('beforeunload', e => { if (unsaved()) { e.preventDefault(); e.returnValue = ''; } });
