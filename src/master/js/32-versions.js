// 目录母版 · 同一部作品的其他版本：新增「更新」作品时列出旧版本，旁边一个「删除」按钮，删不删由人决定；
// 删掉的旧版本可以把作者、来源资料、封面、分区、榜单 / 名单里的位置交给新版本。也给详情栏和表格用的「删除」。

// 一个名称的几种写法：去掉「更新」等前缀；整名、按 / 拆开的每段、第一个词、去掉日文后的中文部分、别名
function nameVariants(name, aliases = []) {
  const base = String(name || '').replace(/^(更新|新作|补档|恢复|修复版|问题修复|BUG更新)\s*/i, '').replace(/^『/, '');
  const words = base.split(/\s+/).filter(Boolean);
  return {base, words, parts: [base, ...base.split(/[\/／\\]/), ...words.map((_, i) => words.slice(0, i + 1).join(' ')), words.filter(w => !KANA.test(w)).join(''), ...aliases].filter(Boolean)};
}
// 找同一部作品的其他版本：名称的某种写法完全一样，或者一个是另一个的开头（都至少 6 个字）
function findOtherVersions(name, aliases = [], exclude = new Set()) {
  const {base, words} = nameVariants(name, aliases);
  const key = p => normalizeSearch(p);
  const q = [...new Set([base, ...base.split(/[\/／\\]/), words[0] || '', words.filter(w => !KANA.test(w)).join(''), ...aliases].map(key).filter(v => v.length >= 3))];
  if (!q.length) return [];
  const hits = [];
  for (const r of cards) {
    if (exclude.has(r.id)) continue;
    const v = nameVariants(r.name, r.aliases || []);
    const vs = [...new Set([v.base, ...v.base.split(/[\/／\\]/), v.words[0] || '', v.words.filter(w => !KANA.test(w)).join(''), ...(r.aliases || [])].map(key).filter(x => x.length >= 3))];
    if (vs.some(a => q.some(b => a === b || (Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a)))))) hits.push(r);
  }
  return hits.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 10);
}

// 删除一部作品：它在各分区的每一行（合并卡的副本）一起删；按位置从后往前删，撤销时能原样插回去
function removeCardChanges(r) {
  return views.map((v, index) => ({v, index})).filter(({v}) => v.id === r.id || v.canonical_id === r.id)
    .sort((a, b) => b.index - a.index).map(({v, index}) => ({kind: 'remove', index, record: v}));
}
function deleteCards(list, label) {
  const changes = list.flatMap(removeCardChanges);
  if (!changes.length) return 0;
  commit(label, changes);
  setStatus(`${label}。按 Ctrl+Z 可以撤销。`, 'dirty');
  return changes.length;
}
const versionLine = r => `<span class="mono">${esc(r.code)}</span> ${esc(r.name)} <span class="count">${esc([r.version, r.date, sectionsOf(r).join(' / ')].filter(Boolean).join(' · '))}</span>`;

// 新版本沿用被删旧版的资料：作者、来源资料、自选封面、分区、制作备注，以及榜单 / 名单里的位置
function inheritFromOld(record, olds) {
  const changes = [];
  for (const old of olds) {
    if (!record.author && old.author) { record.author = old.author; record.circle = old.author; }
    if (!record.web_info && old.web_info) { record.web_info = clone(old.web_info); if (old.source_checks) record.source_checks = clone(old.source_checks); }
    const sheets = [...new Set([record.sheet, ...sectionsOf(old)])];
    if (sheets.length > 1) { record.category_sheets = sheets; record.category_zones = sheets.map(s => sheetZone.get(s)).filter(Boolean); }
    const cover = (project.covers || {})[old.id];
    if (cover && !(project.covers || {})[record.id]) changes.push({kind: 'project', path: ['covers', record.id], before: undefined, after: cover});
    if (privateNotes[old.id] && !privateNotes[record.id]) changes.push({kind: 'private', id: record.id, before: '', after: privateNotes[old.id]});
  }
  // 榜单 / 名单里指向旧版的位置改成新版（几个旧版一起换，只记一步）
  const ids = new Set(olds.map(o => o.id));
  const rk = clone(project.rankings || []), ml = clone(project.monthLists || []);
  let nRk = 0, nMl = 0;
  rk.forEach(x => x.tiers.forEach(t => t.items.forEach(it => { if (ids.has(it.id)) { it.id = record.id; nRk++; } })));
  ml.forEach(x => x.lines.forEach(l => { if (ids.has(l.id)) { l.id = record.id; nMl++; } }));
  if (nRk) changes.push({kind: 'project', path: ['rankings'], before: clone(project.rankings), after: rk});
  if (nMl) changes.push({kind: 'project', path: ['monthLists'], before: clone(project.monthLists), after: ml});
  record.search = searchText(record);
  return changes;
}

// 详情栏「找其他版本」：任何作品都能查一下目录里还有没有它的别的版本
function openVersionsDialog(r) {
  const render = () => {
    const list = findOtherVersions(r.name, r.aliases || [], new Set([r.id]));
    const box = openDialog(`<h3>${esc(r.code)} 的其他版本</h3>
      <p class="count">按名称找到的、看起来是同一部作品的其他条目（新的在前）。确认是旧版本再删；删除可以撤销。</p>
      <div class="version-list">${list.map(o => `<div class="version-row">${coverHtml(o, 'xs')}<div class="version-main">${versionLine(o)}</div><button data-del-version="${esc(o.id)}">删除</button></div>`).join('') || '<p class="count">没找到其他版本。</p>'}</div>
      <div class="dialog-actions"><button data-close>关闭</button></div>`, {wide: true});
    box.querySelectorAll('[data-del-version]').forEach(b => b.onclick = () => {
      const o = byId.get(b.dataset.delVersion);
      if (o) deleteCards([o], `删除旧版本：${o.code} ${shortName(o)}`);
      render();
    });
  };
  render();
}
