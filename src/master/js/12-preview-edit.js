// 目录母版 · 预览分发版时也能改：在预览里点任意作品（卡片、名称、榜单、名单里的条目），右边出现它的编辑栏；
// 改的就是母版（能撤销），改完自动重新生成预览，并回到原来的搜索、滚动位置和打开的详情。
let previewEditId = null, previewTimer = 0, previewLoading = false;
const PREVIEW_TAG = 'scr' + 'ipt';

async function loadPreview(keep) {
  const frame = $('frame');
  let state = null;
  if (keep) {
    try {
      const d = frame.contentDocument;
      state = {y: frame.contentWindow.scrollY, q: (d.getElementById('search') || {}).value || '', detail: d.getElementById('modal')?.open ? previewEditId : null};
    } catch { state = null; }
  }
  previewLoading = true;
  const html = (await buildReader()).replace('<head>', () => `<head><${PREVIEW_TAG}>${MEMORY_STORAGE}</${PREVIEW_TAG}>`);
  frame.onload = () => { previewLoading = false; hookPreview(); if (state) restorePreview(state); };
  frame.srcdoc = html;
}
// 看板的数据要解码一会儿：等卡片出来再恢复位置
function whenPreviewReady(fn, tries = 50) {
  const d = $('frame').contentDocument;
  if (d && d.querySelector('article.card')) return fn(d);
  if (tries > 0) setTimeout(() => whenPreviewReady(fn, tries - 1), 100);
}
function restorePreview(s) {
  whenPreviewReady(d => {
    if (s.q) { const el = d.getElementById('search'); el.value = s.q; el.dispatchEvent(new Event('input', {bubbles: true})); }
    setTimeout(() => {
      $('frame').contentWindow.scrollTo(0, s.y);
      if (s.detail) d.querySelector(`[data-detail="${CSS.escape(s.detail)}"]`)?.click();
    }, s.q ? 400 : 50);
  });
}
function hookPreview() {
  const d = $('frame').contentDocument;
  if (!d) return;
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-detail],[data-detail-open],article.card[data-id]');
    if (!b) return;
    const id = b.dataset.detail || b.dataset.detailOpen || b.dataset.id;
    if (byId.has(id) && id !== previewEditId) { previewEditId = id; renderPreviewEditor(); }
  }, true);
  // 鼠标移到卡片上时提示一下：点了右边就能改
  const st = d.createElement('style');
  st.textContent = 'article.card{cursor:pointer}article.card:hover{outline:2px dashed rgba(45,106,79,.45);outline-offset:2px}';
  d.head.append(st);
}

function renderPreviewEditor() {
  const box = $('previewEdit');
  const r = previewEditId ? byId.get(previewEditId) : null;
  if (!r) { box.innerHTML = '<p class="count">在左边的预览里点一部作品（卡片或名称），这里就能改它。</p>'; return; }
  const P = 'pe_';
  box.innerHTML = `
    <div class="detail-head"><span class="mono">${esc(r.code)}</span>${touched.has(r.id) ? '<span class="edited">已改</span>' : ''}<span class="spacer"></span><button id="pe_reveal" title="回到名单，选中这一行">在名单里打开</button></div>
    <h3>${esc(r.name)}</h3>
    <div class="detail-cover">${coverHtml(r, 'md')}<span class="count">${esc(coverKind(r) || '还没有封面')} · 点图换封面</span></div>
    <div class="detail-form">
      ${detailInput(r, 'name', '名称', 'wide', '', 'text', P)}
      ${detailInput(r, 'version', '版本', '', '', 'text', P)}${detailInput(r, 'author', '作者', '', '', 'text', P)}
      ${detailInput(r, 'genre', '类型', '', '', 'text', P)}${detailInput(r, 'platform', '平台', '', '', 'text', P)}
      ${detailInput(r, 'translation', '语言', '', '', 'text', P)}${detailInput(r, 'size_str', '大小', '', '', 'text', P)}
      ${detailInput(r, 'tags', '标签', 'wide', '', 'text', P)}
      ${detailInput(r, 'code', '目录编号', '', '', 'text', P)}${detailInput(r, 'date', '加入／更新名单日期', '', '', 'date', P)}
    </div>
    <fieldset class="detail-update"><legend><label><input type="checkbox" data-d-field="updated" ${r.updated ? 'checked' : ''}> 这是一次更新</label></legend>
      <div class="detail-form">
        ${detailInput(r, 'update_summary', '更新了什么', 'wide', '', 'text', P)}
        ${detailInput(r, 'version_date', '版本发布日期', 'wide', '', 'date', P)}
      </div>
    </fieldset>
    <div class="field"><label for="pe_notes">备注 / 更新日志（读者能看到）</label><textarea id="pe_notes" rows="6">${esc(r.notes || '')}</textarea></div>
    <div class="field"><label>分区</label><div class="checks">${SECTIONS.map(s => `<label><input type="checkbox" data-pe-section="${esc(s)}" ${sectionsOf(r).includes(s) ? 'checked' : ''} ${s === r.sheet ? 'disabled' : ''}> ${esc(s)}</label>`).join('')}</div></div>
    <p class="count">改的就是母版，Ctrl+Z 能撤销（先点一下右边这栏）；改完左边会自动刷新。</p>`;
  box.querySelectorAll('[data-d-field]').forEach(el => el.addEventListener('change', () =>
    applyCellValue(r, el.dataset.dField, el.type === 'checkbox' ? (el.checked ? '是' : '') : el.value)));
  $('pe_notes').addEventListener('change', e => setField(r, 'notes', e.target.value, `改备注：${r.code}`));
  box.querySelectorAll('[data-pe-section]').forEach(b => b.addEventListener('change', () =>
    commit(`${b.checked ? '加入' : '移出'}${b.dataset.peSection}：${r.code}`, sectionChanges(r, b.dataset.peSection, b.checked))));
  $('pe_reveal').onclick = () => { $('closePreview').click(); revealRecord(r.id); };
}
// 预览开着时，母版有任何改动（包括撤销）就重新生成预览；连着改几格只刷新一次
onChange(() => {
  if ($('preview').hidden) return;
  if (!$('previewEdit').contains(document.activeElement)) renderPreviewEditor();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { if (!$('preview').hidden) loadPreview(true); }, 600);
});
