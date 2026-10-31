// 目录母版 · 类型、平台、语言的快速输入，保留自定义选项和拼音匹配。
// ↑↓ 换一个，Tab / 回车确认（确认后照常跳到下一格）。格子空着时列出全部，常用的在前。
// 用法：给输入框加 data-type-key="genre|platform|translation"；表格的编辑框在开始编辑时自动加上。
const TYPE_KEYS = ['genre', 'platform', 'translation'];
// 拼音首字母对不上的几个缩写
const TYPE_ALIAS = {translation:{},platform:{},genre:{}};
const TYPE_BASE = {translation:['默认'],platform:[],genre:[]};
function typeOptions(key) {
  const n = new Map((key==='translation'?versionTypes().map(item=>item.name):(meta.ui_config?.type_options?.[key] || TYPE_BASE[key] || [])).map(v => [v, 0]));
  for (const r of cards) if (r[key]) n.set(r[key], (n.get(r[key]) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}
function typeMatches(key, text) {
  const opts = typeOptions(key), t = normalizeSearch(text);
  if (!t) return opts;
  const alias = (TYPE_ALIAS[key] || {})[t];
  return opts.map((o, i) => {
    const n = normalizeSearch(o), [full = '', ini = ''] = pinyinKey(o).split(' ');
    const s = n === t ? 0 : o === alias ? 1 : n.startsWith(t) ? 2 : ini.startsWith(t) ? 3 : full.startsWith(t) ? 4 : n.includes(t) ? 5 : 9;
    return [s, i, o];
  }).filter(x => x[0] < 9).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
}
const typePick = {el: null, box: null, list: [], at: 0};
function typePickBox() {
  if (!typePick.box) {
    typePick.box = document.createElement('div');
    typePick.box.className = 'type-pick';
    typePick.box.hidden = true;
    typePick.box.addEventListener('mousedown', e => {
      const b = e.target.closest('[data-pick-i]');
      if (!b) return;
      e.preventDefault();   // 不让输入框失去焦点
      typePick.at = +b.dataset.pickI;
      typePickChoose();
    });
    document.body.append(typePick.box);
  }
  return typePick.box;
}
function typePickShow(el) {
  const key = el.dataset.typeKey;
  if (!TYPE_KEYS.includes(key)) return typePickHide();
  typePick.el = el;
  typePick.list = typeMatches(key, el.value).slice(0, 8);
  typePick.at = 0;
  const box = typePickBox();
  if (!typePick.list.length) { box.hidden = true; return; }
  box.innerHTML = typePick.list.map((o, i) => `<button type="button" data-pick-i="${i}" class="${i === typePick.at ? 'on' : ''}">${esc(o)}<small>${esc(pinyinKey(o).split(' ')[1] || '')}</small></button>`).join('')
    + '<p>↑↓ 换一个 · Tab / 回车确认</p>';
  const rect = el.getBoundingClientRect();
  Object.assign(box.style, {left: Math.min(rect.left, innerWidth - 220) + 'px', top: (rect.bottom + 2) + 'px', minWidth: Math.max(rect.width, 160) + 'px'});
  box.hidden = false;
}
function typePickHide() { if (typePick.box) typePick.box.hidden = true; typePick.el = null; }
function typePickMove(d) {
  if (!typePick.list.length) return;
  typePick.at = (typePick.at + d + typePick.list.length) % typePick.list.length;
  typePick.box.querySelectorAll('[data-pick-i]').forEach((b, i) => b.classList.toggle('on', i === typePick.at));
}
function typePickChoose() {
  const el = typePick.el, v = typePick.list[typePick.at];
  if (!el || v === undefined) return;
  el.value = v;
  el.dispatchEvent(new Event('input', {bubbles: true}));
  typePickHide();
}
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.typeKey) typePickShow(e.target); });
document.addEventListener('focusin', e => { if (e.target.dataset && e.target.dataset.typeKey && !e.target.dataset.gridProxy) typePickShow(e.target); });
document.addEventListener('focusout', e => { if (e.target === typePick.el) setTimeout(typePickHide, 0); });
// 捕获阶段先处理：↑↓ 选候选；Tab / 回车先把候选填进去，再交给原来的处理（提交、跳格）
document.addEventListener('keydown', e => {
  const el = typePick.el;
  if (!el || e.target !== el || typePick.box.hidden || e.isComposing) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); typePickMove(e.key === 'ArrowDown' ? 1 : -1); }
  else if (e.key === 'Enter' || e.key === 'Tab') {
    const exact = typeOptions(el.dataset.typeKey).includes(el.value.trim());
    if (!exact || typePick.at > 0) { const v = typePick.list[typePick.at]; if (v !== undefined) { el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); } }
    typePickHide();
  } else if (e.key === 'Escape') typePickHide();
}, true);
