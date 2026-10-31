// 资料编号与手动补全；可用多个来源，人工指定优先。
function parseManualId(text) {
  text=String(text||'').trim();
  let m=text.match(/https?:\/\/store\.steampowered\.com\/app\/(\d+)/i);
  if(m)return {valid:true,site:'Steam',source:'steam',source_id:m[1],appid:m[1],code:'steam:'+m[1],text:'steam:'+m[1],url:`https://store.steampowered.com/app/${m[1]}/`};
  m=text.match(/https?:\/\/(?:bgm\.tv|bangumi\.tv|chii\.in)\/subject\/(\d+)/i);
  if(m)return {valid:true,site:'Bangumi',source:'bangumi',source_id:m[1],code:'bangumi:'+m[1],text:'bangumi:'+m[1],url:`https://bgm.tv/subject/${m[1]}`};
  m=text.match(/(?:^|\s)([a-z][\w-]*):([^\s]+)/i);
  if(m&&!/^https?$/i.test(m[1])){const source=m[1].toLowerCase(),valid=!['steam','bangumi'].includes(source)||/^\d+$/.test(m[2]);return {valid,site:source,source,source_id:m[2],code:source+':'+m[2],text:source+':'+m[2],message:valid?'':'Steam / Bangumi 编号应为数字；原文仍可保存，不会改成名称搜索。'};}
  return {valid:false,text,code:text,message:'填写「来源:编号」，例如 steam:编号、bangumi:编号，或粘贴资料网址。原文仍可保存。'};
}
function sourceDetailUrl(text) {
  const p=parseManualId(text);if(!p.valid)return '';
  if(p.url)return p.url;
  if(p.source==='steam')return `https://store.steampowered.com/app/${encodeURIComponent(p.source_id)}/`;
  if(p.source==='bangumi')return `https://bgm.tv/subject/${encodeURIComponent(p.source_id)}`;
  const config=[...(typeof sourceChoices==='function'?sourceChoices():[]),...(meta.sources||[])].find(x=>String(x.id||x.key).toLowerCase()===p.source);
  return config?.detail_url ? config.detail_url.replace('{id}',encodeURIComponent(p.source_id)) : '';
}
function detailSourceId(r) {
  if(r.source_id)return `${r.source||'custom'}:${r.source_id}`;
  const w=r.web_info||{};
  for(const x of [w,...(w.links||[])]){
    if(x.source_id)return `${x.site||x.source||'custom'}:${x.source_id}`;
    if(x.appid)return 'steam:'+x.appid;
    if(x.bangumi_id)return 'bangumi:'+x.bangumi_id;
  }
  return '';
}
const manualIdIdentity=r=>detailSourceId(r).toLowerCase();
const hasOfficialId=r=>!!(detailSourceId(r)||(r.web_info||{}).url);
function manualIdWarnings(r,text,drafts){
  const p=parseManualId(text), messages=p.valid?[]:[p.message];
  if(!p.valid)return messages;
  const other=cards.filter(x=>x.id!==r.id&&(drafts.has(x.id)?parseManualId(drafts.get(x.id)).code.toLowerCase():manualIdIdentity(x))===p.code.toLowerCase());
  if(other.length)messages.push(`同一资料编号也用于 ${other.map(x=>x.code).join('、')}，请确认。`);
  return messages;
}
function matchManualIds(text,eligible){
  const matched=[],unmatched=[];
  for(const line of String(text||'').split(/\r?\n/).filter(x=>x.trim())){
    const m=line.trim().match(/^(\S+?)[\s,，]+(.+)$/), found=m?eligible.filter(r=>r.code.toLowerCase()===m[1].toLowerCase()):[];
    if(found.length===1)matched.push({record:found[0],text:parseManualId(m[2]).text});else unmatched.push(line+'（目录编号没有唯一对应）');
  }
  return {matched,unmatched};
}
function manualIdChanges(r,text){
  text=String(text||'').trim();
  const p=parseManualId(text),w=clone(r.web_info||{}),old=String(r.source||w.site||w.source||'').toLowerCase(),next=p.source||'custom';
  const replace=text?next:old;
  let links=[w,...(w.links||[])].filter(x=>x.url&&String(x.site||x.source||'').toLowerCase()!==replace).map(x=>{const y=clone(x);delete y.links;return y;});
  const ids=clone(r.source_ids||{}),checks=clone(r.source_checks||{});
  for(const key of Object.keys(ids))if(key.toLowerCase()===replace)delete ids[key];
  for(const key of Object.keys(checks))if(key.toLowerCase()===replace)delete checks[key];
  if(text)ids[next]=p.source_id||text;
  const changes=[fieldChange(r,'source',text?next:''),fieldChange(r,'source_id',text?(p.source_id||text):''),fieldChange(r,'source_id_origin',text?'manual':undefined),fieldChange(r,'source_ids',ids),fieldChange(r,'source_checks',checks)];
  for(const key of ['url','source','site','origin','source_id','appid','bangumi_id','name','maker','region_locked'])delete w[key];
  if(text){const info={source:p.site||'custom',site:next,source_id:p.source_id||text,origin:'manual',url:sourceDetailUrl(p.code)};if(p.source==='steam')info.appid=p.source_id;if(p.source==='bangumi')info.bangumi_id=p.source_id;Object.assign(w,info);if(info.url)links.push(info);}
  else Object.assign(w,links[0]||{});
  const seen=new Set();w.links=links.filter(x=>!seen.has(String(x.source).toLowerCase()+'|'+x.url)&&seen.add(String(x.source).toLowerCase()+'|'+x.url));changes.push(fieldChange(r,'web_info',w));return changes;
}

// ---------- 补编号窗口 ----------
function openManualIds(scope = 'recent', fixedRecords = null) {
  const scoped = Array.isArray(fixedRecords) ? [...fixedRecords] : null;
  const drafts = new Map(), savedIds = new Set();
  let shown = [];
  openDialog(`<h3>补编号</h3><p class="count">贴「来源:编号」或 Steam / Bangumi 资料网址。${scoped ? '只列这次体检里没封面的作品。' : '只列还没有 资料编号或链接的作品。'}</p>
    <div class="field"><label for="mi_scope">范围</label><select id="mi_scope"><option value="recent">最近 7 天</option><option value="view">当前筛选</option><option value="all">全部</option>${scoped ? `<option value="health">体检没封面的（${scoped.length} 部）</option>` : ''}</select></div>
    <details><summary>批量粘贴</summary><p class="count">每行「目录编号 资料编号或网址」，用空格、Tab 或逗号分开；会自动对号填到下面。</p>
    <textarea id="mi_bulk" rows="4" placeholder="DEMO-0001 custom:demo-01&#10;DEMO-0002 custom:demo-02"></textarea><pre id="mi_unmatched" class="t-red" hidden></pre></details>
    <p class="count" id="mi_count"></p><div id="mi_rows" style="max-height:48vh;overflow:auto"></div>
    <p class="count" id="mi_status" aria-live="polite">保存后可用顶部「撤销」恢复；格式和重复提示不会阻止保存。</p>
    <div class="dialog-actions" style="flex-wrap:wrap"><button data-close>关闭</button><button id="mi_fetch" ${!HELPER || helperLost ? 'disabled title="用小助手打开母版后可按编号补资料"' : ''}>按编号补资料</button><button class="primary" id="mi_save">保存编号</button></div>`, {wide: true});
  $('mi_scope').value = scoped ? 'health' : scope;
  if (scoped) { $('mi_scope').disabled = true; $('mi_scope').closest('.field').insertAdjacentHTML('beforeend', '<p class="count">仅补这次体检列出的作品，已有其他资料也可补编号。</p>'); }
  function rowHtml(r) {
    return `<div data-mi-row="${esc(r.id)}" style="border-bottom:1px solid var(--line);padding:10px 0"><div style="display:flex;gap:10px;align-items:center"><span data-mi-cover style="width:76px;height:50px;flex:none"></span><div style="min-width:0;flex:1"><b class="mono">${esc(r.code || r.id)}</b> <span>${esc(r.name)}</span><input data-mi-id="${esc(r.id)}" aria-label="${esc(r.code || r.id)} 来源编号" value="${esc(drafts.get(r.id) || '')}" placeholder="来源:编号 或资料网址"><div class="count t-red" data-mi-warning></div></div></div></div>`;
  }
  function updateRows() {
    const base = scoped || ($('mi_scope').value === 'all' ? cards : $('mi_scope').value === 'view' ? grid.rows : recentCards());
    shown = [...new Map([...base.filter(r => scoped || !hasOfficialId(r)), ...cards.filter(r => drafts.has(r.id))].map(r => [r.id, r])).values()];
    $('mi_rows').innerHTML = shown.length ? shown.map(rowHtml).join('') : '<p class="empty">这个范围没有需要补编号的作品。</p>';
    refreshHints();
  }
  function refreshHints() {
    for (const el of $('mi_rows').querySelectorAll('[data-mi-row]')) {
      const r = byId.get(el.dataset.miRow), text = drafts.get(r.id) || '', p = parseManualId(text);
      const warnings = text ? manualIdWarnings(r, text, drafts) : [];
      el.querySelector('[data-mi-warning]').textContent = warnings.join(' ');
      el.querySelector('input').style.borderColor = warnings.length ? 'var(--bad)' : '';
      const url = ''; // 封面由已启用来源返回，不按编号偷偷联网。
      const holder = el.querySelector('[data-mi-cover]');
      if (holder.dataset.url !== url) {
        holder.dataset.url = url;
        holder.innerHTML = url ? `<img src="${esc(url)}" alt="编号封面" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:contain">` : '';
        const img = holder.querySelector('img');
        if (img) img.onerror = () => { holder.textContent = '暂未取到图'; };
      }
    }
    $('mi_count').textContent = `${shown.length} 部待补 · 已填写 ${[...drafts.values()].filter(Boolean).length} 部`;
  }
  $('mi_scope').onchange = updateRows;
  $('mi_rows').oninput = e => {
    if (!e.target.dataset.miId) return;
    drafts.set(e.target.dataset.miId, e.target.value.trim());
    refreshHints();
  };
  $('mi_rows').addEventListener('change', e => {
    if (!e.target.dataset.miId) return;
    const p = parseManualId(e.target.value);
    if (e.target.value.trim()) { e.target.value = p.text; drafts.set(e.target.dataset.miId, p.text); refreshHints(); }
  });
  $('mi_bulk').oninput = () => {
    const result = matchManualIds($('mi_bulk').value, (scoped || cards).filter(r => scoped || !hasOfficialId(r) || drafts.has(r.id)));
    for (const x of result.matched) drafts.set(x.record.id, x.text);
    $('mi_unmatched').hidden = !result.unmatched.length;
    $('mi_unmatched').textContent = result.unmatched.join('\n');
    updateRows();
  };
  function saveDrafts() {
    const changed = [];
    for (const [id, text] of drafts) {
      if (!text || !byId.has(id)) continue;
      changed.push(...manualIdChanges(byId.get(id), text));
      savedIds.add(id);
    }
    const n = commit('手动补来源编号', changed);
    $('mi_status').textContent = n ? `已填入 ${savedIds.size} 部。关闭窗口后，在右侧详情顶部查看或修改；最后点「保存母版」。` : '编号没有变化。';
    setStatus(n ? `已填入 ${savedIds.size} 部编号，可在右侧详情顶部查看；请再点「保存母版」。` : '编号没有变化。', n ? 'dirty' : 'ok');
    return n;
  }
  $('mi_save').onclick = saveDrafts;
  $('mi_fetch').onclick = () => {
    saveDrafts();
    const list = [...savedIds].map(id => byId.get(id)).filter(Boolean);
    if (!list.length) { $('mi_status').textContent = '先填编号并保存。'; return; }
    if (!needHelper(null, '按编号补资料')) return;
    closeDialog();
    runJob('/api/enrich-ids', {records: enrichRecords(list), sourceConfig: sourceConfig()}, `按编号补资料（${list.length} 部）`, result => {
      const n = commit('按手填编号补资料', enrichChanges(result));
      setStatus(`${result.status==='unconfigured'?'来源未配置，未取回资料':'按编号处理结束'}：${Object.keys(result.changed || {}).length} 部状态有变化，可以撤销。${result.note || ''}`, n ? 'dirty' : result.status==='unconfigured'?'error':'ok');
    });
  };
  updateRows();
}
const manualIdsBtn = document.createElement('button');
manualIdsBtn.id = 'manualIdsBtn';
manualIdsBtn.textContent = '补编号';
manualIdsBtn.title = '人工贴来源编号或网址，不做名称搜索';
enrichBtn.after(manualIdsBtn);
manualIdsBtn.addEventListener('click', () => openManualIds());
