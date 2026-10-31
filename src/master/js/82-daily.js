// 目录母版 · 今日例行：只读抓取，选图后一次应用、保存。
function dailyPayload() {
  const recent = recentCards(), urls = new Set(recent.map(r => r.quark_url).filter(Boolean));
  const shares = project.collections.filter(c => c.quark && urls.has(c.quark)).map(c => ({
    id: c.id, label: c.label, quark: c.quark, oldDates: clone(c.quark_folders || {}),
    records: cards.filter(r => r.quark_url === c.quark).map(r => Object.fromEntries([...QUARK_FIELDS, 'quark_location_status', 'quark_location_url'].map(k => [k, r[k] ?? '']))),
  }));
  const records = enrichRecords(recent).map(r => ({...r, has_cover: !!coverStore()[r.id], cover_off: !!coverOffStore()[r.id]}));
  return {shares:moduleEnabled('quark')?shares:[],allShares:moduleEnabled('quark')?project.collections:[],latestTableUrl:moduleEnabled('quark')?meta.latest_catalog_url:'',allCodes: cards.map(r => r.code), records, sites: clone(refSitesOf()).filter(site=>site.enabled!==false), sources:enabledSourceKeys(), sourceConfig:sourceConfig(),...quarkOptions()};
}

// ---------- 今日例行按钮 ----------
const dailyBtn = document.createElement('button');
dailyBtn.id = 'dailyBtn';
dailyBtn.textContent = '今日例行';
dailyBtn.title = '扫描近 7 天作品所在的夸克合集、按已启用来源补资料、找预览图，汇总后应用并保存';
$('saveBtn').before(dailyBtn);
let pendingDaily = null;
dailyBtn.addEventListener('click', async () => {
  if (pendingDaily) return showDailyResult();
  const input = dailyPayload();
  const local=localFillReport();
  if(!input.sources.length&&!input.sites.length&&!moduleEnabled('quark')){pendingDaily={result:{sources:[],status:'unconfigured'},count:input.records.length,input,local};return showDailyResult();}
  if (!needHelper(dailyBtn, '今日例行')) return;
  await busy(dailyBtn, '今日例行中…', async () => {
    await runJob('/api/daily-routine', input, `今日例行（${input.records.length} 部，${input.shares.length} 个合集）`, result => {
      pendingDaily = {result, count: input.records.length, input,local};
      showDailyResult();
    },progress=>{dailyBtn.textContent=`今日例行 · ${progress.text||progress.step||'处理中'}`;});
  });
  dailyBtn.textContent = pendingDaily ? '今日例行 · 查看结果' : '今日例行';
});

function showDailyResult() {
  if (!pendingDaily) return;
  const {result, count} = pendingDaily, q = result.quark || {}, enrich = result.enrich || {}, ref = result.refCovers || {}, stats = ref.stats || {};
  const oldRecords = new Map(pendingDaily.input.shares.flatMap(s => s.records).map(r => [r.id, r]));
  let newly = 0, existing = 0, newDates = 0, existingDates = 0;
  for (const [id, x] of Object.entries(q.records || {})) {
    if (x.status !== 'matched') continue;
    const old = oldRecords.get(id) || {};
    if (old.quark_location_status === 'matched' && old.quark_location_url === x.url) existing++;
    else newly++;
  }
  for (const summary of q.summary || []) {
    const old = pendingDaily.input.shares.find(s => s.id === summary.collection)?.oldDates || {};
    for (const [date, url] of Object.entries(summary.dates || {})) {
      if (old[date] === url) existingDates++; else newDates++;
    }
  }
  const fields = ['new_matched', 'existing', 'not_found', 'blocked', 'recent_skipped', 'unrequested', 'other'];
  const rows = (result.sources || []).map(site => {
    const t = (result.tally || {})[site] || {};
    return `<tr><th>${esc(site)}</th>${fields.map(key => `<td>${t[key] || 0}</td>`).join('')}</tr>`;
  }).join('');
  const blocked = result.blockedCount || 0;
  const unrequested = Object.values(result.tally || {}).reduce((n, t) => n + (t.unrequested || 0), 0);
  const skipped = Object.values(result.tally || {}).reduce((n, t) => n + (t.recent_skipped || 0), 0);
  const errors = Object.entries(result.errors || {}).map(([step, error]) => `${({quark: '夸克扫描', enrich: '来源资料', refCovers: '预览图'})[step] || step}：${error}`);
  for (const s of q.summary || []) if (s.error) errors.push(`${project.collections.find(c => c.id === s.collection)?.label || s.collection}：${s.error}`);
  const box=openDialog(`<h3>今日例行汇总</h3>${!(result.sources||[]).length?'<p class="count">没有启用资料来源，本次未联网补资料。<button id="dailySettings">前往设置</button></p>':''}
    <label><input id="dailyLocal" type="checkbox" ${pendingDaily.applyLocal===false?'':'checked'} ${pendingDaily.applied?'disabled':''}>回填已有来源资料 ${pendingDaily.local?.length||0} 个空白字段</label><details><summary>查看回填明细</summary>${(pendingDaily.local||[]).map(item=>`<p class="count">${esc(byId.get(item.id)?.name||item.id)} · ${esc(fieldLabel(item.key))}：${esc(item.value)}</p>`).join('')||'<p>暂无可回填内容。</p>'}</details>
    ${typeof quarkHealthHtml==='function'&&result.quarkHealth?quarkHealthHtml(result.quarkHealth):''}
    ${typeof shareChecksHtml==='function'&&result.shareChecks?shareChecksHtml(result.shareChecks):''}
    <p>夸克新定位 <b>${newly}</b> 部，原来已定位 <b>${existing}</b> 部；新日期文件夹 <b>${newDates}</b> 个，原来已有 <b>${existingDates}</b> 个。</p>
    <p class="count">来源资料：近 7 天收录的 ${count} 部作品当前结果（已有的资料照常保留）。</p>
    <p class="count">跳过 ${skipped} 部 3 天内查过的。</p>
    <div class="table-wrap" style="overflow-x:auto"><table class="col-table" style="min-width:680px"><thead><tr><th>来源</th><th>新找到</th><th>原来就有</th><th>没找到</th><th>被限流</th><th>跳过（3 天内查过）</th><th>未请求</th><th>其他失败</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${blocked || unrequested ? `<p class="t-red">${blocked ? `被限流 ${blocked} 部` : '本轮查询提前结束'}${unrequested ? `，后续 ${unrequested} 次查询未请求` : ''}，过一阵再点一次今日例行。夸克扫描结果可以照常应用。</p>` : ''}
    <h4>预览图</h4><p>${ref.skipped ? esc(ref.skipped) : `对上 <b>${stats.matched || 0}</b> 部，下载失败 <b>${stats.downloadFailed || 0}</b> 部，没找到 <b>${stats.notFound || 0}</b> 部。`}
    ${(ref.candidates || []).length ? `<button id="dailyViewCovers" ${pendingDaily.applied ? 'disabled' : ''}>查看并选择</button>` : ''}</p>
    ${(ref.siteFailures||[]).map(site=>`<p class="count">${esc(site.site||site.siteId||'参考网站')}：本次 ${(site.count||0)+(site.skipped||0)} 条${site.blocked?'被拦截或跳过':'没连上'}，下次例行可继续补。</p>`).join('')}
    ${stats.networkFailed&&!(ref.siteFailures||[]).length?`<p class="count">本次 ${stats.networkFailed} 条预览图没连上，未计入「没找到」。</p>`:''}
    ${pendingDaily.selection ? `<p class="count">已暂存 ${pendingDaily.selection.covers.length} 张预览图${pendingDaily.selection.failed ? `，${pendingDaily.selection.failed} 张压缩失败，保留原图` : ''}；随下方「应用并保存」一起写入。</p>` : ''}
    ${errors.length ? `<p class="t-red">${errors.map(esc).join('<br>')}</p><p class="count">成功的那一步仍可应用；失败的部分保留原资料。</p>` : ''}
    <p class="count">${pendingDaily.applied ? '结果已应用，等待保存。' : '现在还没改母版。'}点「应用并保存」后，夸克、来源资料和选中的预览图记作一次修改，可按 Ctrl+Z 撤销；保存也会保存你本次其他未保存的修改。</p>
    <p id="dailySaveError" class="t-red" role="status"></p>
    <div class="dialog-actions"><button id="dailyDiscard">${pendingDaily.applied ? '关闭' : '不应用'}</button><button id="dailyApply">${pendingDaily.applied ? '重试保存' : '应用并保存'}</button><button class="primary" id="dailyApplyExport">应用、保存并导出</button></div>`, {wide: true});
  $('dailyLocal').onchange=event=>{pendingDaily.applyLocal=event.target.checked;};
  $('dailyDiscard').onclick = () => { pendingDaily = null; dailyBtn.textContent = '今日例行'; closeDialog(); };
  if($('dailySettings'))$('dailySettings').onclick=()=>{closeDialog();showTab('settings');};
  if(typeof bindQuarkHealth==='function')bindQuarkHealth(box,result.quarkHealth);
  if(typeof bindShareReplacements==='function')bindShareReplacements(box,result.shareChecks||[]);
  if ($('dailyViewCovers')) $('dailyViewCovers').onclick = () => showRefCoverResult(ref, {
    staged: true, selection: pendingDaily.selection,
    onCancel: showDailyResult,
    onConfirm: selection => { pendingDaily.selection = selection; showDailyResult(); },
  });
  const applyDaily = async withExport => {
    const button = $(withExport?'dailyApplyExport':'dailyApply');
    $('dailyApply').disabled=$('dailyApplyExport').disabled=$('dailyDiscard').disabled=true;
    button.textContent = '正在保存…';
    try {
    // 保存失败时仍留在内存里；再点只重试保存，不重复应用。
    if (!pendingDaily.applied) {
      const current=currentEnrichResult(enrich);
      const reference = refSelectionChanges(pendingDaily.selection || {}, current.changed || {});
      const clueIds = new Set(reference.filter(c => c.kind === 'field' && c.key === 'web_info').map(c => c.id));
      const official = enrichChanges(current).filter(c => c.key !== 'web_info' || !clueIds.has(c.id));
      commit('今日例行：定位、来源资料和本地回填', [...quarkChanges(q), ...official, ...reference,...($('dailyLocal').checked?localFillChanges(pendingDaily.local||[]):[])]);
      pendingDaily.applied = true;
    }
      const saved = await saveMasterFile();
      if (!saved || saved.cancelled) throw new Error('母版尚未保存，请重试');
      if(withExport){if(blockingProblems().length)throw Error('母版已保存，导出前请处理体检中的必改项');const exported=await exportReaderFile();if(!exported||exported.cancelled)throw Error('母版已保存，分发版尚未导出');await saveMasterFile();}
      pendingDaily = null;
      dailyBtn.textContent = '今日例行';
      closeDialog();
    } catch (error) {
      if ($('dailySaveError')) $('dailySaveError').textContent = `未能保存：${error.message}。结果已应用，可重试保存，也可先关闭后撤销。`;
      $('dailyApply').disabled=$('dailyApplyExport').disabled=$('dailyDiscard').disabled=false;
      button.textContent = withExport?'重试保存并导出':'重试保存';
      setStatus(`今日例行已应用，但保存失败：${error.message}`, 'error');
    }
  };
  $('dailyApply').onclick=()=>applyDaily(false);$('dailyApplyExport').onclick=()=>applyDaily(true);
}
