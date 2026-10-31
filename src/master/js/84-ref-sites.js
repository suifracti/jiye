// 参考网站只提供预览图和线索；由人确认后，一次写入且可以撤销。
const DEFAULT_REF_SITES = [];
const refSitesOf = () => project.refSites === undefined ? DEFAULT_REF_SITES : project.refSites;
const refSourceOf = id => (project.coverSources || {})[id];
const refImageUrl = value => window.CatalogImages ? CatalogImages.url(value) : value;
const refConfidenceLabel = {exact: '名字完全一样', prefix: '开头一样', partial: '只有一部分一样'};
function setRefSites(next, label) {
  return commit(label, [{kind: 'project', path: ['refSites'], before: clone(project.refSites), after: clone(next)}]);
}
function refProjectChange(key, id, value) {
  return {kind: 'project', path: [key, id], before: clone((project[key] || {})[id]), after: clone(value)};
}
function updateRefSite(id, patch) {
  setRefSites(refSitesOf().map(s => s.id === id ? {...s, ...patch} : clone(s)), '改参考网站');
}
function applyRefChecks(checked, label = '检测参考网站') {
  const map = new Map((checked || []).map(s => [s.id, s]));
  const next = refSitesOf().map(s => {
    const hit = map.get(s.id);
    return hit && hit.url === s.url ? {...s, finalUrl: hit.finalUrl, apiBase: hit.apiBase, type: hit.type, lastCheck: hit.lastCheck} : clone(s);
  });
  setRefSites(next, label);
  if (!$('pane-refSites').hidden) renderRefSites();
}

function renderRefSites() {
  const sites = refSitesOf();
  $('pane-refSites').innerHTML = `<div class="pane-inner"><div class="pane-head"><h2>参考网站</h2><span class="spacer"></span><button id="refCheck">检测网站</button><button id="refAdd">＋ 添加网站</button><button class="primary" id="refFind">找预览图</button></div>
    <p class="count">按从上到下的顺序找图；失效的站会标红并跳过。图片先给你确认，应用后压成小图存进母版，不引用原外链图片。网站和封面修改都可撤销，最后记得保存母版。</p>
    <div class="table-wrap"><table class="col-table"><thead><tr><th>启用</th><th>名称 / 网址</th><th>类型 / 搜索模板</th><th>上次检测结果</th><th>顺序 / 操作</th></tr></thead><tbody>${sites.map((s, i) => {
      const check = s.lastCheck || {}, bad = ['failed', 'blocked', 'needs_template'].includes(check.status);
      return `<tr data-ref-row="${esc(s.id)}"><td><input type="checkbox" data-ref-enabled ${s.enabled !== false ? 'checked' : ''} aria-label="启用 ${esc(s.name)}"></td><td><input data-ref-field="name" value="${esc(s.name)}" aria-label="网站名称"><input data-ref-field="url" value="${esc(s.url)}" aria-label="网站网址">${s.finalUrl && s.finalUrl !== s.url ? `<small class="count">实际地址：${esc(s.finalUrl)}</small>` : ''}</td><td>${s.type === 'wordpress' ? 'WordPress 接口<small class="count">网站自带的公开搜索接口，直接按名字搜帖子，不用填搜索网址</small>' : `网页搜索（尽力而为）<input data-ref-field="searchTemplate" value="${esc(s.searchTemplate || '')}" placeholder="搜索网址（含 {q}）" aria-label="搜索网址模板"><small class="count">在这个网站上随便搜一个词，复制结果页网址，把搜的词换成 {q}。例：https://example.com/?s={q}</small>`}</td><td class="${bad ? 't-red' : 'count'}">${esc(check.message || '还没检测，点右边「检测」确认能用')}${check.at ? `<br><small>${esc(check.at)}</small>` : ''}</td><td><button data-ref-up ${i ? '' : 'disabled'} aria-label="上移">↑</button><button data-ref-down ${i + 1 < sites.length ? '' : 'disabled'} aria-label="下移">↓</button><button data-ref-check>检测</button><button data-ref-delete>删除</button></td></tr>`;
    }).join('') || '<tr><td colspan="5">还没有网站，点「添加网站」。</td></tr>'}</tbody></table></div></div>`;
  $('refFind').onclick = openRefCoverSearch;
  $('refCheck').onclick = () => checkRefSites(sites);
  $('refAdd').onclick = openAddRefSite;
  $('pane-refSites').onchange = e => {
    const row = e.target.closest('[data-ref-row]');
    if (!row) return;
    const site = refSitesOf().find(s => s.id === row.dataset.refRow);
    if (!site) return;
    if (e.target.hasAttribute('data-ref-enabled')) updateRefSite(site.id, {enabled: e.target.checked});
    else if (e.target.dataset.refField) {
      const field = e.target.dataset.refField, value = e.target.value.trim(), patch = {[field]: value};
      if (field === 'url') Object.assign(patch, {finalUrl: '', apiBase: '', lastCheck: {status: 'needs_template', message: '网址改过，请重新检测'}});
      if (field === 'searchTemplate' && site.type === 'web') patch.lastCheck = {status: value.includes('{q}') ? 'unchecked' : 'needs_template', message: value.includes('{q}') ? '模板已改，可检测后找图' : '请填含 {q} 的搜索网址模板'};
      updateRefSite(site.id, patch);
    }
    renderRefSites();
  };
  $('pane-refSites').onclick = e => {
    const row = e.target.closest('[data-ref-row]');
    if (!row) return;
    const next = clone(refSitesOf()), i = next.findIndex(s => s.id === row.dataset.refRow);
    if (i < 0) return;
    if (e.target.hasAttribute('data-ref-check')) { checkRefSites([next[i]]); return; }
    if (e.target.hasAttribute('data-ref-delete')) next.splice(i, 1);
    else if (e.target.hasAttribute('data-ref-up') && i) [next[i - 1], next[i]] = [next[i], next[i - 1]];
    else if (e.target.hasAttribute('data-ref-down') && i + 1 < next.length) [next[i + 1], next[i]] = [next[i], next[i + 1]];
    else return;
    setRefSites(next, '调整参考网站'); renderRefSites();
  };
}
function checkRefSites(sites) {
  if (!needHelper(null, '检测参考网站')) return;
  if (!sites.length) return;
  runJob('/api/ref-sites-check', {sites: clone(sites)}, `检测参考网站（${sites.length} 个）`, result => {
    applyRefChecks(result.sites);
    const bad = result.sites.filter(s => s.lastCheck.status !== 'ok').length;
    closeDialog(); setStatus(`网站检测完成：${result.sites.length - bad} 个可用，${bad} 个需处理。`, bad ? 'error' : 'dirty');
  });
}
function openAddRefSite() {
  openDialog(`<h3>添加参考网站</h3><div class="field"><label for="refName">名称</label><input id="refName"></div><div class="field"><label for="refUrl">网址</label><input id="refUrl" placeholder="https://…"></div><p class="count">小助手会跟随跳转并检测 WordPress 接口；普通网页可以之后补搜索网址模板。</p><div class="dialog-actions"><button data-close>取消</button><button id="refSaveSite" class="primary">添加并检测</button></div>`);
  $('refSaveSite').onclick = () => {
    const name = $('refName').value.trim(), url = $('refUrl').value.trim();
    if (!name || !/^https?:\/\//i.test(url)) return alertInline($('refUrl'), '填名称和 http:// 或 https:// 网址。');
    const site = {id: 'ref' + Date.now().toString(36), name, url, enabled: true, type: 'web'};
    setRefSites([...clone(refSitesOf()), site], '添加参考网站');
    closeDialog(); renderRefSites();
    if (HELPER && !helperLost) checkRefSites([site]);
    else setStatus('网站已添加；用小助手打开后点「检测」。', 'dirty');
  };
}
function refMissingCover(r) { return !coverStore()[r.id] && !autoCoverUrl(r) && !coverOffStore()[r.id]; }
function openRefCoverSearch(fixedRecords) {
  if (!needHelper(null, '找预览图')) return;
  const fixed = Array.isArray(fixedRecords) ? [...fixedRecords] : null;
  openDialog(`<h3>找预览图</h3><div class="grid2"><div class="field"><label for="refScope">范围（只查没封面的）</label><select id="refScope" ${fixed ? 'disabled' : ''}>${fixed ? `<option value="health">体检没封面的（${fixed.length} 部）</option>` : '<option value="recent">最近 7 天收录的</option><option value="view">当前筛选</option><option value="selected">选中的行</option><option value="all">全部没封面的</option>'}</select></div><div class="field"><label for="refLimit">这次最多查几部</label><input id="refLimit" type="number" min="1" value="100"></div></div><p class="count">每个网站每次请求间隔 1.5 秒；每部最多试中文主名、日文名两个写法。找到后先确认，已有封面不覆盖。</p><div class="dialog-actions"><button data-close>取消</button><button id="refGo" class="primary">开始找图</button></div>`);
  $('refGo').onclick = () => {
    const scope = $('refScope').value, base = fixed || (scope === 'all' ? cards : scope === 'view' ? grid.rows : scope === 'selected' ? targetRows() : recentCards());
    const records = base.filter(refMissingCover), sites = refSitesOf().filter(s => s.enabled !== false);
    if (!records.length || !sites.length) return alertInline($('refGo'), !records.length ? '这个范围没有缺封面的作品。' : '先添加并启用网站。');
    const limit = Math.max(1, +$('refLimit').value || 100);
    closeDialog();
    runJob('/api/ref-covers', {records: enrichRecords(records), sites: clone(sites), limit}, `找预览图（最多 ${Math.min(records.length, limit)} 部）`, showRefCoverResult);
  };
}
function refOfficialChanges(r, chosen) {
  if (!chosen.length) return [];
  const w = clone(r.web_info || {}), links = [w, ...(w.links || [])].filter(x => x.url).map(x => { const v = clone(x); delete v.links; return v; });
  for (const clue of chosen) if (!links.some(x => x.url === clue.url)) links.push({...clue, origin: 'reference'});
  const after = w.url ? {...w, links} : {...chosen[0], origin: 'reference', links};
  return [fieldChange(r, 'web_info', after)];
}
async function refShrink(data) {
  const blob = await (await fetch(refImageUrl(data))).blob();
  // 列表里封面只显示约 100 像素宽、详情最大约 500 像素：压到 320 像素够看，一张约 10～15 KB（480 像素时约 30 KB）
  return shrinkImage(new File([blob], 'reference-cover', {type: blob.type}), 320, 0.72);
}
function refSelectionChanges(selection, updated = {}) {
  const changes = [];
  for (const item of selection.covers || []) {
    const r = byId.get(item.id);
    if (r && refMissingCover({...r, ...(updated[r.id] || {})})) changes.push(refProjectChange('covers', r.id, item.image), refProjectChange('coverSources', r.id, item.source));
  }
  for (const item of selection.clues || []) {
    const r = byId.get(item.id);
    if (r) {
      const merged = {...r, ...(updated[r.id] || {})};
      for (const c of refOfficialChanges(merged, item.official)) changes.push({...c, before: clone(r[c.key])});
    }
  }
  return changes;
}
function showRefCoverResult(result, options = {}) {
  // 检测状态也由应用按钮一起保存，放弃结果不会改目录。
  const candidates = result.candidates || [], stats = result.stats || {};
  openDialog(`<h3>确认预览图</h3><p class="count">查了 ${stats.checked || 0} 部 · 对上 ${stats.matched || 0} · 下载失败 ${stats.downloadFailed || 0} · 没找到 ${stats.notFound || 0} · 用时 ${result.seconds || 0} 秒。只有「名字完全一样」默认勾选，其余请看图和原帖再决定。</p>
    ${candidates.length > 1 ? `<p><button data-ref-pickall="all">全选</button> <button data-ref-pickall="prefix">勾上「完全一样」和「开头一样」</button> <button data-ref-pickall="none">全不选</button></p>` : ''}
    ${(result.sites || []).filter(s => ['failed', 'blocked', 'needs_template'].includes(s.lastCheck?.status)).map(s => `<p class="t-red">${esc(s.name)}：${esc(s.lastCheck.message)}</p>`).join('')}
    ${(result.failed || []).length ? `<details><summary>查看失败原因（${result.failed.length} 部）</summary>${result.failed.map(f => `<p class="count"><b>${esc(f.code || f.id)} ${esc(f.title)}</b><br>${(f.errors || []).map(error => esc(error)).join('<br>') || '没找到可下载的大图'}</p>`).join('')}</details>` : ''}
    <div style="max-height:60vh;overflow:auto">${candidates.map((c, i) => {
      const r = byId.get(c.id);
      const selected = options.selection;
      return `<div style="display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:12px 0"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-ref-pick="${i}" ${(selected ? selected.covers.some(x => x.id === c.id) : c.confidence === 'exact') ? 'checked' : ''}><img src="${esc(refImageUrl(c.image))}" alt="预览图" style="width:150px;height:110px;object-fit:contain"></label><div style="flex:1;min-width:180px"><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title)}</a><p>${esc(r?.code || c.id)} ${esc(r?.name || '')}<br><b>${esc(refConfidenceLabel[c.confidence] || '请确认')}</b> · ${esc(c.site)}</p>${(c.official || []).map((info, j) => `<label class="count" style="display:block"><input type="checkbox" data-ref-clue="${i}:${j}" ${selected?.clues.some(x => x.id === c.id && x.official.some(o => o.url === info.url)) ? 'checked' : ''}> 顺便找到来源线索：${esc(info.source)} ${esc(info.source_id || info.appid || '')}</label>`).join('')}</div></div>`;
    }).join('') || '<p class="empty">这次没有可用的预览图。</p>'}</div><p id="refApplyState" class="count"></p>${options.staged ? '<p class="count">确认后先暂存，回到今日例行点「应用并保存」才会写入。</p>' : ''}<div class="dialog-actions"><button id="refCancel" ${options.staged ? '' : 'data-close'}>${options.staged ? '返回汇总' : '不应用'}</button><button id="refApply" class="primary">${options.staged ? '确认选择，返回汇总' : '应用选中的结果'}</button></div>`, {wide: true});
  if (options.staged) $('refCancel').onclick = options.onCancel;
  document.querySelectorAll('[data-ref-pickall]').forEach(b => b.onclick = () => {
    const mode = b.dataset.refPickall;
    candidates.forEach((c, i) => { const box = document.querySelector(`[data-ref-pick="${i}"]`); if (box) box.checked = mode === 'all' || (mode === 'prefix' && ['exact', 'prefix'].includes(c.confidence)); });
  });
  $('refApply').onclick = async () => {
    const button = $('refApply'); button.disabled = $('refCancel').disabled = true;
    const selection = {covers: [], clues: []}, at = new Date().toISOString(); let applied = 0, kb = 0, failed = 0;
    try {
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i], r = byId.get(c.id);
        if (!r) continue;
        if (document.querySelector(`[data-ref-pick="${i}"]`)?.checked && refMissingCover(r)) {
          try {
            $('refApplyState').textContent = `正在压缩第 ${i + 1} 张……`;
            const image = await refShrink(c.image);
            selection.covers.push({id: r.id, image, source: {site: c.site, siteId: c.siteId, url: c.url, at, imageIndex: c.imageIndex, imageUrl: c.imageUrl}});
            applied++; kb += image.length * 0.75 / 1024;
          } catch { failed++; }
        }
        const clues = (c.official || []).filter((x, j) => document.querySelector(`[data-ref-clue="${i}:${j}"]`)?.checked);
        if (clues.length) selection.clues.push({id: r.id, official: clues});
      }
      if (options.staged) {
        options.onConfirm({...selection, failed});
        return;
      }
      const changes = refSelectionChanges(selection);
      const siteMap = new Map((result.sites || []).map(s => [s.id, s]));
      const sites = refSitesOf().map(s => { const hit = siteMap.get(s.id); return hit && hit.url === s.url ? {...s, ...hit} : clone(s); });
      changes.push({kind: 'project', path: ['refSites'], before: clone(project.refSites), after: sites});
      commit(`应用参考网站预览图（${applied} 张）`, changes);
      closeDialog(); if (!$('pane-refSites').hidden) renderRefSites();
      setStatus(`已应用 ${applied} 张预览图，压缩后共约 ${Math.round(kb)} KB${failed ? `；${failed} 张压缩失败` : ''}。可以撤销，记得保存母版。`, 'dirty');
    } catch (error) { if ($('refApplyState')) $('refApplyState').textContent = error.message; }
    finally { button.disabled = false; if ($('refCancel')) $('refCancel').disabled = false; }
  };
}

// 自己换图或恢复自动图时，旧的帖子来源一起撤掉；撤销也一起恢复。
const _setCoverWithRef = setCover;
setCover = function (id, value, label) {
  if (!refSourceOf(id)) return _setCoverWithRef(id, value, label);
  commit(label, [refProjectChange('covers', id, value || undefined), refProjectChange('coverSources', id, undefined)]);
  refreshCovers([id]);
};

// 给原来的封面窗口补来源和同帖换图入口，沿用它的文件/粘贴功能。
const _openCoverWithRef = openCoverDialog;
openCoverDialog = function (id) {
  _openCoverWithRef(id);
  const source = refSourceOf(id), side = document.querySelector('.cover-dialog-side');
  if (!source || !coverStore()[id] || !side) return;
  side.insertAdjacentHTML('afterbegin', `<p class="count">这张图来自 <a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.site)}（帖子链接）</a></p><div class="row-inline"><button id="refNextImage">换一张（同帖下一张）</button><button id="refRemoveImage">不用这张</button></div>`);
  $('refRemoveImage').onclick = () => {
    commit('不用参考网站封面', [refProjectChange('covers', id, undefined), refProjectChange('coverSources', id, undefined)]);
    openCoverDialog(id);
  };
  $('refNextImage').onclick = () => {
    if (!needHelper(null, '换同帖下一张图')) return;
    runJob('/api/ref-image-next', {source: clone(source)}, '找同帖下一张图', result => {
      openDialog(`<h3>换同帖下一张图</h3><img src="${esc(refImageUrl(result.image))}" alt="下一张预览图" style="max-width:100%;max-height:55vh;object-fit:contain"><div class="dialog-actions"><button data-close>不用</button><button class="primary" id="refUseNext">用这张</button></div>`);
      $('refUseNext').onclick = async () => {
        $('refUseNext').disabled = true;
        try {
          const image = await refShrink(result.image);
          commit('换参考网站封面', [refProjectChange('covers', id, image), refProjectChange('coverSources', id, {...source, imageIndex: result.imageIndex, imageUrl: result.imageUrl, at: new Date().toISOString()})]);
          openCoverDialog(id);
        } catch (error) { setStatus('图片压缩失败：' + error.message, 'error'); if ($('refUseNext')) $('refUseNext').disabled = false; }
      };
    });
  };
};
const refTab = document.createElement('button');
refTab.setAttribute('role', 'tab'); refTab.dataset.tab = 'refSites'; refTab.setAttribute('aria-selected', 'false'); refTab.textContent = '参考网站';
document.querySelector('[data-tab="rankings"]').after(refTab);
const refPane = document.createElement('section'); refPane.className = 'pane scroll'; refPane.id = 'pane-refSites'; refPane.dataset.pane = 'refSites'; refPane.hidden = true;
document.querySelector('.work').append(refPane);
tabHandlers.refSites = renderRefSites;
onChange(info => { if (!refPane.hidden && (info?.changes || []).some(c => c.kind === 'project' && c.path[0] === 'refSites')) renderRefSites(); });
