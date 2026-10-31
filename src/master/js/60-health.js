// 目录母版 · 体检：列出需要处理的问题。每一条写清楚为什么，要改的那一格可以直接在这里改，点编号跳到名单里那一行。
// 红：不处理就不能导出；黄：建议看一眼；灰：资料不全，或者只是让你心里有数
const safeUrl = u => !u || /^https?:\/\/\S+$/.test(u);
const batchOf = r => r.category_raw || r.date || '';
const shortDate = d => { const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${+m[1]}.${m[2]}` : String(d || ''); };
// 统计已有封面资料；不把显示开关或临时网络失败当成资料丢失。
function coverHealthSummary() {
  const sources = {'资料来源': 0, '手填编号': 0, '参考网站': 0, '自己选的图': 0};
  const missing = [];
  for (const r of cards) {
    let source;
    if ((project.covers || {})[r.id]) source = (project.coverSources || {})[r.id] ? '参考网站' : '自己选的图';
    else if (autoCoverUrl(r)) {
      if (r.source_id_origin === 'manual' || (r.web_info || {}).source === 'manual') source = '手填编号';
      else source = '资料来源';
    }
    if (source) sources[source]++; else missing.push(r);
  }
  return {sources, missing, has: cards.length - missing.length};
}
function coverHealthHtml() {
  const report = coverHealthSummary(), title = '没封面', n = healthShown.get(title) || 50;
  const check = {why: () => '还没有图片或可算出的来源封面地址'};
  return `<section class="section" aria-label="封面体检"><h3>封面</h3>
    <p>有封面 <b id="coverHasCount">${report.has}</b> 部 · 没封面 <b id="coverNoneCount">${report.missing.length}</b> 部</p>
    <p class="count">${Object.entries(report.sources).map(([name, count]) => `${esc(name)} ${count} 部`).join(' · ')}</p>
    <p class="count">按已有图片或可算出的封面地址统计，未联网检查图源能否打开。关闭封面显示不影响资料统计。</p>
    <details class="check gray" data-hc="没封面" ${healthOpen.has(title) ? 'open' : ''}><summary>没封面的作品 · ${report.missing.length} 部</summary>
      <div class="row-inline" style="padding:8px 12px;flex-wrap:wrap"><button data-cover-manual ${report.missing.length ? '' : 'disabled'}>补编号</button><button data-cover-ref ${report.missing.length ? '' : 'disabled'}>找预览图</button><span class="count">只处理下面这些作品；主动关掉封面的作品不自动找图。</span></div>
      <div class="hc-list">${report.missing.slice(0, n).map(r => healthRow(check, r)).join('')}${report.missing.length > n ? '<button data-hc-more="没封面">再显示 50 条</button>' : ''}</div>
    </details></section>`;
}
function healthChecks() {
  const byCode = new Map();
  for (const r of cards) if (r.code) byCode.set(r.code, [...(byCode.get(r.code) || []), r]);
  const ids = new Map();
  for (const r of views) ids.set(r.id, (ids.get(r.id) || 0) + 1);
  const dupSameBatch = r => (byCode.get(r.code) || []).filter(o => batchOf(o) === batchOf(r)).length > 1;
  const dupOtherBatch = r => (byCode.get(r.code) || []).length > 1 && !dupSameBatch(r);
  const sharers = r => (byCode.get(r.code) || []).filter(o => o !== r);
  return [
    {level: 'red', title: '名称是空的', hint: '读者看不到这部作品叫什么。', field: 'name', list: cards.filter(r => !String(r.name || '').trim())},
    {level: 'red', title: '内部 ID 重复', hint: '会让收藏和合并出错，通常是新增时编号撞了。改一下其中一部的编号。', field: 'code', list: views.filter(r => ids.get(r.id) > 1)},
    {level: 'red', title: '链接不是 http / https', hint: '分发版里不允许其他协议的链接。', list: cards.filter(r => !safeUrl(r.baidu_url) || !safeUrl(r.quark_url)),
      why: r => `百度：${r.baidu_url || '空'}；夸克：${r.quark_url || '空'}`},
    {level: 'yellow', title: '同一批次里编号重复', field: 'code', group: r => r.code,
      hint: '同一个日期文件夹里有两部作品用了同一个编号，读者打开文件夹按编号找时会混。常见原因：同一部作品放在两个分区，名称写法不一样，没被认成同一部——这种可以把名称改成一样；真是两部不同的作品，就改其中一部的编号。',
      list: cards.filter(dupSameBatch), why: r => `${r.sheet} · ${r.date || '未填收录日期'} · ${batchOf(r)}；同批次有其他作品使用这个编号`},
    {level: 'gray', title: '不同日期撞了编号', field: 'code', group: r => r.code,
      hint: '不同批次可复用编号；请结合批次或链接确认是否为同一条内容。',
      list: cards.filter(dupOtherBatch), why: r => `${r.sheet} · ${r.date || '未填收录日期'} · ${batchOf(r)}；同号的还有 ${sharers(r).map(o => batchOf(o)).join('、')}`},
    {level: 'yellow', title: '没有网盘链接', hint: '读者只能浏览，找不到下载入口。到「合集」页给它的批次配上链接，或在这里填。', field: 'quark_url', list: cards.filter(r => !r.baidu_url && !r.quark_url)},
    {level: 'yellow', title: '链接不属于任何合集', hint: '可能是单独填的链接，或合集链接改过后漏改。', list: cards.filter(r => (r.baidu_url || r.quark_url) && !collectionOf(r)), why: r => r.quark_url || r.baidu_url},
    {level: 'yellow', title: '只有一个网盘的链接', hint: '百度、夸克缺了一个。', field: r => r.baidu_url ? 'quark_url' : 'baidu_url', list: cards.filter(r => !!r.baidu_url !== !!r.quark_url),
      why: r => r.baidu_url ? '缺夸克' : '缺百度'},
    {level: 'yellow', title: '夸克定位有歧义', hint: '合集里有不止一个同编号的文件夹，读者会被带到合集。可在「合集」页的扫描结果里看候选路径。', list: cards.filter(r => r.quark_location_status === 'ambiguous')},
    {level: 'gray', title: '夸克还没定位', hint: '需要小助手扫描夸克合集；没定位的作品，读者点按钮会打开整个合集再按编号找。', list: cards.filter(r => r.quark_url && r.quark_location_status !== 'matched')},
    {level: 'gray', title: '缺少作者信息', hint: '可以在这里直接填，或用「抓来源资料」补。', field: 'author', list: cards.filter(r => !r.author)},
    {level: 'gray', title: '没有来源资料', hint: '贴来源编号或网址即可，不需要按名称搜索。', manualIds: true, list: cards.filter(r => !hasOfficialId(r))},
    {level: 'gray', title: '没填大小', hint: '', field: 'size_str', list: cards.filter(r => !r.size_str)},
    {level: 'gray', title: '没填版本', hint: '', field: 'version', list: cards.filter(r => !r.version)},
  ];
}
function blockingProblems() { return healthChecks().filter(c => c.level === 'red').flatMap(c => c.list); }
const healthShown = new Map();   // 每一项展开看了多少条
const healthOpen = new Set();
function healthRow(c, r) {
  const field = typeof c.field === 'function' ? c.field(r) : c.field;
  return `<div class="hc-row"><button class="link mono" data-reveal="${esc(r.id)}" title="跳到名单里这一行">${esc(r.code || r.id)}</button>
    <span class="hc-name" title="${esc(r.name)}">${esc(r.name || shortName(r))}</span>
    <span class="hc-why">${esc(c.why ? c.why(r) : `${r.sheet} · ${batchOf(r)}`)}</span>
    ${field ? `<input class="hc-edit" data-hc-id="${esc(r.id)}" data-hc-field="${field}" value="${esc(fieldText(r, field))}" placeholder="${esc(FIELD_LABEL[field] || field)}" aria-label="${esc(FIELD_LABEL[field] || field)}"${TYPE_KEYS.includes(field) ? ` data-type-key="${field}"` : ''}>` : '<span></span>'}</div>`;
}
function renderHealth() {
  const checks = healthChecks();
  const red = checks.filter(c => c.level === 'red').reduce((s, c) => s + c.list.length, 0);
  const yellow = checks.filter(c => c.level === 'yellow').reduce((s, c) => s + c.list.length, 0);
  $('pane-health').innerHTML = `<div class="pane-inner">
    <div class="pane-head"><h2>体检</h2></div>
    <p class="count">${red ? `<b class="t-red">${red} 个必须处理</b>（不处理不能导出）· ` : '没有必须处理的问题 · '}${yellow} 个建议看一眼。每一条后面写着原因；要改的那一格可以直接改，点编号跳到名单里那一行。</p>
    ${coverHealthHtml()}${tagCleanupHtml()}${localFillHtml()}
    ${checks.map((c, ci) => {
      const n = healthShown.get(c.title) || 50, open = healthOpen.has(c.title) || (c.level === 'red' && c.list.length);
      let body = '';
      if (c.list.length) {
        if (c.group) {
          const groups = new Map();
          for (const r of c.list) groups.set(c.group(r), [...(groups.get(c.group(r)) || []), r]);
          body = [...groups.entries()].slice(0, n).map(([k, rs]) => `<div class="hc-group"><div class="hc-group-title">${esc(k)} · ${rs.length} 部用了这个编号</div>${rs.map(r => healthRow(c, r)).join('')}</div>`).join('')
            + (groups.size > n ? `<button data-hc-more="${esc(c.title)}">再显示 50 组（共 ${groups.size} 组）</button>` : '');
        } else {
          body = c.list.slice(0, n).map(r => healthRow(c, r)).join('')
            + (c.list.length > n ? `<button data-hc-more="${esc(c.title)}">再显示 50 条（共 ${c.list.length} 条）</button>` : '');
        }
      }
      return `<details class="check ${c.level}" data-hc="${esc(c.title)}" ${open ? 'open' : ''}>
      <summary><span class="dot"></span>${esc(c.title)} <b>${c.list.length}</b>${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}</summary>
      ${c.manualIds ? '<div class="row-inline" style="padding:8px 12px"><button data-manual-ids>补编号</button></div>' : ''}
      ${c.list.length ? `<div class="hc-list">${body}</div>` : ''}
    </details>`;
    }).join('')}
  </div>`;
}
$('pane-health').addEventListener('click', e => {
  if (e.target.closest('[data-cover-manual]')) return openManualIds('health', coverHealthSummary().missing);
  if (e.target.closest('[data-cover-ref]')) return openRefCoverSearch(coverHealthSummary().missing);
  if (e.target.closest('[data-manual-ids]')) return openManualIds('all');
  const b = e.target.closest('[data-reveal]');
  if (b) return revealRecord(b.dataset.reveal);
  const more = e.target.closest('[data-hc-more]');
  if (more) { healthShown.set(more.dataset.hcMore, (healthShown.get(more.dataset.hcMore) || 50) + 50); renderHealth(); }
});
$('pane-health').addEventListener('toggle', e => {
  const d = e.target.closest && e.target.closest('details[data-hc]');
  if (d) { if (d.open) healthOpen.add(d.dataset.hc); else healthOpen.delete(d.dataset.hc); }
}, true);
$('pane-health').addEventListener('change', e => {
  const el = e.target.closest('[data-hc-field]');
  if (!el) return;
  const r = byId.get(el.dataset.hcId);
  if (r) applyCellValue(r, el.dataset.hcField, el.value);
});
function refreshHealthCount() {
  const red = blockingProblems().length;
  $('healthCount').textContent = red ? String(red) : '';
  $('healthCount').className = 'tab-count' + (red ? ' red' : '');
}
tabHandlers.health = renderHealth;
onChange(() => { refreshHealthCount(); if (!$('pane-health').hidden && !$('pane-health').contains(document.activeElement)) renderHealth(); });
