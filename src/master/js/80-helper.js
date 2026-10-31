// 目录母版 · 小助手模式：双击「启动目录表」时，页面由本机小助手提供，保存、导出直接写进文件夹，
// 联网的事（抓来源资料、扫夸克合集）和原格式工作簿也交给它。直接双击母版文件时这一段什么都不做。
const HELPER = window.__HELPER__ || null;
let helperLost = false;
async function api(path, body, {raw = false} = {}) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'X-Helper-Token': HELPER.token, ...(raw || body === undefined ? {} : {'Content-Type': 'application/json'})},
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `小助手返回 ${res.status}`);
  return data;
}
function needHelper(button, what) {
  if (HELPER && !helperLost) return true;
  setStatus(`${what}要用小助手：双击文件夹里的「启动目录表」打开母版。`, 'error');
  return false;
}

if (HELPER) {
  const badge = document.querySelector('.badge');
  badge.textContent = '小助手模式';
  badge.title = `由本机小助手打开。保存时写回 ${HELPER.masterName} 并在「备份」文件夹留旧版；导出写进「分发」「表格」文件夹。`;
  const quit = document.createElement('button');
  quit.textContent = '退出制作器';
  quit.title = '关掉小助手（保存好以后再点）';
  $('saveBtn').after(quit);
  quit.addEventListener('click', async () => {
    if (unsaved() && !confirmInline(`还有 ${unsaved()} 步修改没保存，先保存再退出吗？`)) return;
    try { await api('/api/quit', {}); } catch {}
    helperLost = true;
    setStatus('小助手已退出，可以关掉这个页面了。', 'ok');
  });
  const beat = async () => {
    try { await api('/api/heartbeat', {}); if (helperLost) { helperLost = false; setStatus('重新连上小助手了。', 'ok'); } }
    catch { if (!helperLost) { helperLost = true; setStatus('连不上小助手了（窗口可能被关掉）。现在保存会改为下载新文件；重新双击「启动目录表」可以恢复。', 'error'); } }
  };
  beat();
  setInterval(beat, 20000);

  // 保存、导出改为直接写进文件夹
  const fileWrite = writeFile;
  writeFile = async (kind, data, suggestedName, accept, description) => {
    if (helperLost) return fileWrite(kind, data, suggestedName, accept, description);
    const body = data instanceof Blob ? data : new Blob([data]);
    if (kind === 'master') {
      const r = await api('/api/save', body, {raw: true});
      return {written: true, name: r.name + (r.backup ? `（旧版已备份到 备份/${r.backup}）` : '')};
    }
    const r = await api(`/api/${kind === 'xlsx' ? 'export-sheet' : 'export'}?name=${encodeURIComponent(suggestedName)}`, body, {raw: true});
    return {written: true, name: `${r.folder}/${r.name}`};
  };
}
// 对话框里简单的确认（母版不用浏览器自带的 confirm 弹窗，免得被拦）
function confirmInline(text) { return window.confirm(text); }

// ---------- 后台任务：显示日志，结束后回调 ----------
async function runJob(path, payload, title, onDone, onProgress) {
  const inputState=Object.fromEntries((payload.records||[]).map(r=>[r.id,byId.has(r.id)?enrichState(byId.get(r.id)):null]));
  const inputLinks=Object.fromEntries((payload.shares||[]).flatMap(share=>(share.records||[]).map(r=>[r.id,byId.get(r.id)?.quark_url||share.quark])));
  let job;
  try { ({job} = await api(path, payload)); }
  catch (error) { setStatus(`${title}没有开始：${error.message}`, 'error'); return; }
  openDialog(`<h3>${esc(title)}</h3><p class="count" id="jobState">进行中……</p><pre class="job-log" id="jobLog"></pre>
    <div class="dialog-actions"><button data-close>放到后台</button>${path.includes('quark')||path.includes('daily')?'<button id="jobCancel">中断并查看已完成部分</button>':''}<button class="primary" id="jobDone" hidden>查看结果</button></div>`, {wide: true});
  if($('jobCancel'))$('jobCancel').onclick=async()=>{await api(`/api/jobs/${job}/cancel`,{});$('jobCancel').disabled=true;};
  let since = 0, lines = [];
  for (;;) {
    await new Promise(r => setTimeout(r, 1000));
    let v;
    try { v = await api(`/api/jobs/${job}?since=${since}`); } catch (error) { setStatus('查不到任务进度：' + error.message, 'error'); return; }
    since = v.next;
    lines = lines.concat(v.lines).slice(-400);
    const progress=v.progress,text=progress?.text||(progress?.step?`${progress.step} ${progress.done||0}/${progress.total||0}`:'');
    if(progress&&onProgress)onProgress({...progress,text});
    if ($('jobLog')) { $('jobLog').textContent = lines.join('\n'); $('jobLog').scrollTop = 1e9; $('jobState').textContent = `${text||'进行中……'} · 已用 ${v.seconds} 秒`; }
    else if (v.status === 'running') setStatus(`${title}：后台进行中（${v.seconds} 秒）`);
    if (v.status !== 'running') {
      if (v.status === 'error') {
        if ($('jobState')) $('jobState').textContent = '出错了：' + v.error;
        setStatus(`${title}出错：${v.error}`, 'error');
        return;
      }
      if ($('jobState')) {const state=v.result?.status;$('jobState').textContent = `${state==='unconfigured'?'未配置，未执行完整任务':state==='partial'?'部分完成，请查看结果':state==='limited'?'已处理，有来源限制':'处理结束'}，用了 ${v.seconds} 秒。`;}
      if(v.result&&Object.keys(inputState).length)(path.includes('daily')?(v.result.enrich||={}):v.result).inputState=inputState;
      if(v.result&&Object.keys(inputLinks).length){for(const result of path.includes('daily')?[v.result.quark,v.result.quarkHealth]:[v.result])if(result)result.inputLinks=inputLinks;}
      await onDone(v.result);
      return;
    }
  }
}

// ---------- 抓来源资料 ----------
// 最近 7 天收录的：每天加完新作品，查这一档就够了
function recentCards() {
  const last = cards.map(r => r.date || '').filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
  if (!last) return [];
  const from = new Date(new Date(last + 'T00:00:00Z').getTime() - 6 * 86400000).toISOString().slice(0, 10);
  return cards.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && r.date >= from && r.date <= last);
}
function sourceConfig() { return clone(project.sourceConfig || {steam:{enabled:false},bangumi:{enabled:false},custom_sources:[]}); }
function sourceChoices() {
  const c=sourceConfig(), all=[{id:'steam',name:'Steam',enabled:!!c.steam?.enabled,detail_url:'https://store.steampowered.com/app/{id}/',official:true},{id:'bangumi',name:'Bangumi',enabled:!!c.bangumi?.enabled,detail_url:'https://bgm.tv/subject/{id}',official:false}];
  const custom=Array.isArray(c.custom_sources)?c.custom_sources:Object.entries(c.custom_sources||{}).map(([key,value])=>({...value,key}));
  for(const x of custom)if(x.key)all.push({id:String(x.key).toLowerCase(),name:x.name||x.key,enabled:x.enabled===true,detail_url:x.detail_url||'',official:false});
  return all;
}
function enabledSourceKeys() { return sourceChoices().filter(x=>x.enabled).map(x=>x.id); }
function openSourceSettings() {
  const cfg=sourceConfig();
  openDialog(`<h3>资料来源设置</h3><p class="count">默认不联网。这里保存配置；点「抓来源资料」或「今日例行」才会访问已启用来源。自定义来源可导入你有权使用的元数据。</p>
    <label><input id="sourceSteam" type="checkbox" ${cfg.steam?.enabled?'checked':''}> 启用 Steam（需自己的 API key，仅名称与编号索引）</label>
    <div class="field"><label for="sourceKey">Steam API key（只保存在母版，不导入分发版）</label><input id="sourceKey" type="password" autocomplete="off" value="${esc(cfg.steam?.api_key||'')}"></div>
    <label><input id="sourceBangumi" type="checkbox" ${cfg.bangumi?.enabled?'checked':''}> 启用 Bangumi 公开 API</label>
    <details><summary>自定义来源 / 元数据（JSON）</summary><p class="count">数组，每个来源填 key、name、records；记录可含 source_id、name、url、summary、cover_url。只加载你提供的元数据，不会访问未知接口。</p><textarea id="sourceCustom" rows="10">${esc(JSON.stringify(cfg.custom_sources||[],null,2))}</textarea></details>
    <p class="count">封面图片的联网显示另在「设置」里开启。来源和图片许可见 docs/来源许可.md。</p><p id="sourceError" class="t-red"></p>
    <div class="dialog-actions"><button data-close>取消</button><button class="primary" id="sourceSave">保存来源设置</button></div>`,{wide:true});
  $('sourceSave').onclick=()=>{try{const custom=JSON.parse($('sourceCustom').value);if(!Array.isArray(custom)||custom.some(x=>!x.key||!Array.isArray(x.records)))throw Error('自定义来源须为数组，且每项有 key 和 records 数组');const next={...cfg,steam:{...cfg.steam,enabled:$('sourceSteam').checked,api_key:$('sourceKey').value.trim()},bangumi:{...cfg.bangumi,enabled:$('sourceBangumi').checked},custom_sources:custom};commit('修改资料来源',[{kind:'project',path:['sourceConfig'],before:clone(project.sourceConfig),after:next}]);closeDialog();setStatus('来源设置已修改；保存母版后保留，尚未联网。','dirty');}catch(e){$('sourceError').textContent=e.message;}};
}
function openFolderListings() {
  openDialog(`<h3>导入自己的目录清单</h3><p class="count">按合集 ID 填写文件夹清单。可从你有权使用的导出或授权适配器取得；这里离线匹配目录编号和日期，不自动调用网盘的非公开接口。</p><p class="count">格式：{"合集ID":[{"fid":"folder-a","name":"目录编号","path":"/日期/目录编号","has_files":true}]}。查看当前合集 ID：${project.collections.map(c=>esc(c.id+' = '+c.label)).join('；')}</p>
    <textarea id="folderJson" rows="12">${esc(JSON.stringify(project.folderListings||{},null,2))}</textarea><p id="folderError" class="t-red"></p><div class="dialog-actions"><button data-close>取消</button><button id="folderSave" class="primary">保存目录清单</button></div>`,{wide:true});
  $('folderSave').onclick=()=>{try{const next=JSON.parse($('folderJson').value);if(!next||Array.isArray(next)||typeof next!=='object'||Object.values(next).some(v=>!Array.isArray(v)&&!Array.isArray(v.folders)))throw Error('填写按合集 ID 分组的文件夹数组');commit('导入目录清单',[{kind:'project',path:['folderListings'],before:clone(project.folderListings),after:next}]);closeDialog();setStatus('目录清单已导入，可以扫描定位；记得保存母版。','dirty');}catch(e){$('folderError').textContent=e.message;}};
}
function enrichRecords(list) {
  return list.map(r => Object.assign({}, r.source_record, {
    id: r.id, code: r.code, title: r.name, raw_name: r.name, source:r.source, source_id:r.source_id, source_id_origin:r.source_id_origin, source_ids:r.source_ids, aliases:r.aliases,
    web_info: r.web_info, source_checks: r.source_checks, region_locked: r.region_locked, tags: r.tags, play_tags: r.play_tags, _is_new: r._is_new,
  }));
}
function enrichState(record){return JSON.stringify([record.source,record.source_id,record.name,record.author,record.genre,record.platform,record.translation,record.tags,record.web_info,record.notes]);}
function currentEnrichResult(result={}){if(!result.inputState)return result;return {...result,changed:Object.fromEntries(Object.entries(result.changed||{}).filter(([id])=>byId.has(id)&&enrichState(byId.get(id))===result.inputState[id]))};}
function enrichChanges(result) {
  result=currentEnrichResult(result);
  return Object.entries(result.changed || {}).flatMap(([id, now]) => {
    const r = byId.get(id);
    return r ? ['web_info', 'source_checks', 'source_ids', 'summary', 'maker', 'cover_url', 'region_locked', 'tags', 'play_tags'].filter(key => Object.prototype.hasOwnProperty.call(now, key)).map(key => fieldChange(r, key, now[key])) : [];
  });
}
const enrichBtn = document.createElement('button');
enrichBtn.textContent = '抓来源资料';
enrichBtn.title = '按你启用的资料来源补链接和元数据';
$('detailBtn').before(enrichBtn);
const sourceSettingsBtn=document.createElement('button');sourceSettingsBtn.textContent='来源设置';enrichBtn.after(sourceSettingsBtn);sourceSettingsBtn.onclick=openSourceSettings;
enrichBtn.addEventListener('click', () => {
  if (!needHelper(enrichBtn, '抓来源资料')) return;
  openDialog(`<h3>抓来源资料</h3>
    <div class="grid2">
      <div class="field"><label>来源</label><div class="checks">${sourceChoices().map(x=>`<label><input type="checkbox" data-source-choice="${esc(x.id)}" ${x.enabled?'checked':'disabled'}> ${esc(x.name)}${x.enabled?'':'（未启用）'}</label>`).join('')}</div></div>
      <div class="field"><label for="e_scope">范围</label><select id="e_scope"><option value="recent">最近 7 天收录的（${recentCards().length} 部）</option><option value="selected">选中的行（${grid.selected.size} 部）</option><option value="view">当前筛选结果（${grid.rows.length} 部）</option><option value="all">全部作品（${cards.length} 部）</option></select></div>
      <div class="field"><label for="e_mode">方式</label><select id="e_mode"><option value="missing">只补还没有的</option><option value="all">全部重新查</option></select></div>
      <div class="field"><label for="e_limit">这次最多查几部</label><input id="e_limit" type="number" min="1" value="50"></div>
      <label class="wide"><input type="checkbox" id="e_retry"> 以前查过但没找到的，也再查一次</label>
    </div>
    <p class="count">网站有频率限制，一次别查太多；被限制的会标出来，过一阵再查。人工填的内容不会被覆盖，查不到也不会清空已有资料。</p>
    <div class="dialog-actions"><button data-close>取消</button><button class="primary" id="e_go">开始</button></div>`);
  $('e_go').addEventListener('click', () => {
    const scope = $('e_scope').value;
    const list = scope === 'all' ? cards : scope === 'view' ? grid.rows : scope === 'recent' ? recentCards() : targetRows();
    const sources = [...document.querySelectorAll('[data-source-choice]:checked')].map(x=>x.dataset.sourceChoice);
    if (!list.length || !sources.length) return alertInline($('e_limit'), '先选作品和来源。');
    const records = enrichRecords(list);
    const options = {records, sources, sourceConfig:sourceConfig(), mode: $('e_mode').value, retry: $('e_retry').checked, limit: +$('e_limit').value || null};
    closeDialog();
    runJob('/api/enrich', options,
      `抓来源资料（${list.length} 部）`, result => {
        const changes = enrichChanges(result);
        const n = commit(`抓来源资料（${Object.keys(result.changed).length} 部有变化）`, changes);
        // 这次查的作品现在各网站的结果：找到 / 没找到 / 被限流（被限流的过一阵再查）
        const tally = {};
        for (const r of list) for (const [site, c] of Object.entries(r.source_checks || {})) {
          if (!sources.includes(site.toLowerCase())) continue;
          const t = tally[site] || (tally[site] = {matched: 0, genuine_not_found: 0, blocked: 0, other: 0});
          t[['access_denied','rate_limited','cooldown'].includes(c.status)?'blocked':c.status in t ? c.status : 'other']++;
        }
        const withLink = list.filter(r => (r.web_info || {}).url).length;
        setStatus(`${result.status==='unconfigured'?'资料来源未配置':result.status==='partial'?'资料处理部分完成':'资料处理结束'}：${Object.keys(result.changed).length} 部有变化（改动 ${n} 处，可以撤销）。这次查的 ${list.length} 部里 ${withLink} 部有来源链接；`
          + Object.entries(tally).map(([site, t]) => `${site} 找到 ${t.matched}、没找到 ${t.genuine_not_found}${t.blocked ? `、被限流 ${t.blocked}（过一阵再查）` : ''}`).join('；'), n ? 'dirty' : 'ok');
      });
  });
});

// ---------- 扫夸克合集 ----------
const QUARK_FIELDS = ['raw_title', 'title', 'name', 'orig_title', 'en_title', 'aliases', 'category_raw', 'category', 'date_short', 'date_label', 'code', 'id',
  'size_str','size_mb','quark_url','quark_location_manual', 'quark_location_status', 'quark_location_url', 'quark_real_path', 'quark_folder_fid'];
function openQuarkScan() {
  if(!requireQuark())return;
  if (!needHelper(null, '扫描夸克合集')) return;
  const withCards = project.collections.filter(c => c.quark).map(c => ({c, n: cards.filter(r => r.quark_url === c.quark).length})).filter(x => x.n);
  openDialog(`<h3>扫描夸克合集</h3>
    <p class="count">只读匹配你导入的目录清单：按日期和目录编号找到作品文件夹。先用「导入目录清单」提供你有权使用的数据；也可在详情中手填定位。</p>
    <div class="checks col-checks">${withCards.map(({c, n}) => `<label><input type="checkbox" data-scan-col="${c.id}" checked> ${esc(c.label)}（${n} 部）</label>`).join('')}</div>
    <div class="dialog-actions"><button id="q_none">全不选</button><button data-close>取消</button><button class="primary" id="q_go">开始扫描</button></div>`, {wide: true});
  $('q_none').addEventListener('click', () => document.querySelectorAll('[data-scan-col]').forEach(b => { b.checked = false; }));
  $('q_go').addEventListener('click', () => {
    const chosen = withCards.filter(({c}) => document.querySelector(`[data-scan-col="${c.id}"]`).checked).map(x => x.c);
    if (!chosen.length) return alertInline($('q_go'), '至少选一个合集。');
    const shares = chosen.map(c => ({id: c.id, label: c.label, quark: c.quark,
      records: cards.filter(r => r.quark_url === c.quark).map(r => Object.fromEntries(QUARK_FIELDS.map(k => [k, r[k] ?? ''])))}));
    closeDialog();
    runJob('/api/quark-scan', {shares, allCodes: cards.map(r => r.code), ...quarkOptions()}, `扫描夸克合集（${chosen.length} 个）`, result => showQuarkResult(result));
  });
}
function quarkChanges(result) {
  const changes = typeof quarkSizeChanges==='function'?quarkSizeChanges(result):[];
  for (const s of result.summary || []) {
    const c = project.collections.find(x => x.id === s.collection);
    if (c && !s.error && s.dates) changes.push({kind: 'collection', id: c.id, key: 'quark_folders', before: clone(c.quark_folders), after: s.dates});
  }
  for (const [id, x] of Object.entries(result.records || {})) {
    const r = byId.get(id);
    if (!r || (r.quark_location_manual && r.quark_location_url)) continue;
    if(result.inputLinks&&result.inputLinks[id]!==r.quark_url)continue;
    const col=project.collections.find(c=>c.quark===r.quark_url),summary=(result.summary||[]).find(item=>item.collection===col?.id);
    if(x.status==='not_found'&&(result.cancelled||summary?.complete===false))continue;
    if(!['matched','ambiguous','not_found'].includes(x.status)){changes.push(fieldChange(r,'quark_scan_status',x.status),fieldChange(r,'quark_location_note',x.error||x.reason||'目录扫描未完成'));continue;}
    changes.push(fieldChange(r, 'quark_location_status', x.status), fieldChange(r, 'quark_location_url', x.status === 'matched' ? x.url : ''),
      fieldChange(r, 'quark_real_path', x.status === 'matched' ? x.path : ''), fieldChange(r, 'quark_folder_fid', x.status === 'matched' ? x.fid : ''),
      fieldChange(r, 'quark_candidates', x.status === 'ambiguous' ? x.candidates : undefined), fieldChange(r, 'quark_location_note', x.reason || undefined), fieldChange(r, 'quark_checked_at', result.checkedAt));
  }
  return changes;
}
function showQuarkResult(result) {
  const rows = result.summary.map(s => {
    const c = project.collections.find(x => x.id === s.collection);
    return `<tr><td>${esc(c ? c.label : s.collection)}</td>${s.error ? `<td colspan="4" class="t-red">${esc(s.error)}</td>` :
      `<td class="num">${s.matched}</td><td class="num">${s.ambiguous}</td><td class="num">${s.not_found}</td><td class="num">${Object.keys(s.dates || {}).length}</td><td>${(s.extraCodes||[]).length ? `${s.extraCodes.length} 个：<span class="mono">${esc(s.extraCodes.slice(0, 40).join('、'))}${s.extraCodes.length > 40 ? '……' : ''}</span>` : '无'}</td>`}</tr>`;
  }).join('');
  openDialog(`<h3>扫描结果</h3><p class="count">可补大小 ${Object.keys(result.sizes||{}).length} 条。${result.cancelled?'已中断，下次可继续。':''}</p>
    <div class="table-wrap"><table class="col-table"><thead><tr><th>合集</th><th>已定位</th><th>有歧义</th><th>未找到</th><th>日期文件夹</th><th>网盘里有、目录里没有的编号</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="count">「应用」后，已定位的作品会记下直达链接（分发版会让读者直接进入作品文件夹）；有歧义、未找到的会在「体检」里列出。扫描失败的合集不会改动已有结果。</p>
    <div class="dialog-actions"><button data-close>不应用</button><button class="primary" id="q_apply">应用定位结果</button></div>`, {wide: true});
  $('q_apply').addEventListener('click', () => {
    const n = commit('应用夸克定位结果', quarkChanges(result));
    closeDialog();
    setStatus(`已应用夸克定位结果（改动 ${n} 处，可以撤销）。`, n ? 'dirty' : 'ok');
  });
}
// 把按钮放进合集页
const _renderCollections = renderCollections;
renderCollections = function () {
  _renderCollections();
  const head = $('pane-collections').querySelector('.pane-head');
  const b = document.createElement('button');
  b.textContent = '扫描夸克合集';
  b.title = HELPER ? '用小助手只读扫描夸克分享目录，找到每部作品的文件夹' : '要用小助手：双击「启动目录表」打开母版';
  head.insertBefore(b, head.querySelector('#colAdd'));
  const importButton=document.createElement('button');importButton.textContent='导入目录清单';importButton.onclick=openFolderListings;head.insertBefore(importButton,b);
  b.addEventListener('click', openQuarkScan);
  const located = cards.filter(r => r.quark_location_status === 'matched').length;
  if (located) head.insertAdjacentHTML('afterend', `<p class="count">已定位 ${located} / ${cards.filter(r => r.quark_url).length} 部（上次扫描：${esc((cards.find(r => r.quark_checked_at) || {}).quark_checked_at || '')}）。</p>`);
};
tabHandlers.collections = renderCollections;

// ---------- 原格式工作簿（五张表） ----------
const RAW_KEYS = ['raw_title', 'raw_tags', 'raw_name', 'title', 'perks', 'cheats', 'play_tags', 'theme_tags', 'types', 'date', 'publish_date',
  'date_short', 'date_label', 'month_batch', 'zone_sub', 'category', 'legacy_ids'];
function enhanceLegacySection() {
  const sec = $('legacySection');
  if (!sec || !HELPER) return;
  sec.innerHTML = `<h3>导入其他格式工作簿</h3>
    <p class="count">选择你自己的工作簿，小助手按通用列名读取；有需要可在 CSV 导入时映射陌生列名。结果按目录编号比较，确认后一次应用，可以撤销，不删除未出现的作品。</p>
    <label class="file-btn primary-like">选择原格式工作簿<input type="file" id="legacyFile" accept=".xlsx" hidden></label>`;
  $('legacyFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fileBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const sources = views.map(v => Object.assign({}, v.source_record, {id: v.id}));
    runJob('/api/legacy-import', {fileName: file.name, fileBase64, sources}, `读取 ${file.name}`, result => {
      closeDialog();
      if(result.workbook?.['作品']) {showTab('xlsx');previewTableMapping(result.workbook,file.name);}
      else {pendingImport = analyzeLegacy(result, file.name);showTab('xlsx');}
    });
  });
}
function settingTextFrom(metaObj, s) {
  const v = getPath(metaObj, s.paths[0]);
  if (s.type === 'bool') return v === false ? '否' : '是';
  if (s.type === 'select') return (s.options.find(o => o[0] === v) || [, v ?? ''])[1];
  if (s.type === 'steps') return (v || []).map(x => `${x.title || ''}｜${x.body || ''}`).join('\n//\n');
  if (s.type === 'image' && String(v || '').startsWith('data:')) return '（本地图片，已内嵌）';
  return v == null ? '' : String(v);
}
function analyzeLegacy(result, fileName) {
  const res = {fileName, legacy: true, auto: [], conflicts: [], unsure: [], keptMaster: 0, added: [], missing: 0, unknownIds: [],
    collections: [], settings: [], tableRows: {}, sourceUpdates: [], rawChanges: []};
  const newIds = new Set(result.views.map(v => v.id));
  const cols = WORK_COLUMNS.filter(([, k]) => k !== 'private');
  for (const nv of result.views) {
    const r = byId.get(nv.id);
    if (!r) {
      const rec = Object.assign({}, nv, {_is_new: true});
      rec.search = searchText(rec);
      res.added.push({record: rec, use: true});
      continue;
    }
    if (!same(r.source_record, nv.source_record)) res.sourceUpdates.push({id: r.id, after: nv.source_record});
    for (const key of RAW_KEYS) if (!same(r[key], nv[key])) res.rawChanges.push(fieldChange(r, key, nv[key]));
    if (nv.canonical_id && nv.canonical_id !== nv.id) continue;   // 被合并的副本：只更新原始资料
    const base = result.base[nv.id];
    for (const [label, key] of cols) {
      const t = normText(key, recordCell(nv, key)), m = normText(key, recordCell(r, key));
      if (t === m) continue;
      const item = {r, key, label, table: t, master: m, use: 'table'};
      if (!base) { res.unsure.push(item); continue; }
      const b = normText(key, recordCell(key==='source_record'?{...base,source_record:r.source_record}:base, key));
      if (t === b) { res.keptMaster++; continue; }
      if (m === b) { res.auto.push(item); continue; }
      item.use = 'master';
      res.conflicts.push(item);
    }
  }
  res.missing = cards.filter(c => !newIds.has(c.id)).length;
  for (const s of SETTING_LIST) {
    const t = settingTextFrom(result.meta, s), m = settingTextFrom(meta, s);
    if (t === m || t === '（本地图片，已内嵌）' || getPath(result.meta, s.paths[0]) === undefined) continue;
    const value = getPath(result.meta, s.paths[0]);
    if (settingInvalid(s, value)) continue;
    // 工作簿里的设置不知道是哪边后改的，默认不采用，需要的勾上
    res.settings.push({s, table: t, master: m, value, use: false});
  }
  if ((result.parseIssues||[]).length) res.unknownIds = result.parseIssues.map(i => `${i.sheet} 第${i.row}行（${i.reason}）`);
  return res;
}
