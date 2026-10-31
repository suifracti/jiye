// 目录母版 · 合集：每个合集的链接只维护一处，改了以后所有用它的作品一起改
function collectionMembers(col) {
  return views.filter(r => (col.baidu && r.baidu_url === col.baidu) || (col.quark && r.quark_url === col.quark));
}
function quarkCandidateUrl(record, candidate) {
  if (!candidate || typeof candidate === 'string') return '';
  if (candidate.url) return candidate.url;
  if (!candidate.fid || !record.quark_url) return '';
  return record.quark_url.split('#')[0] + '#/list/share/' + encodeURIComponent(candidate.fid);
}
function manualQuarkChanges(record, value, path = '') {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('请填夸克文件夹链接。'); }
  if (!/^https?:$/.test(url.protocol) || url.hostname !== 'pan.quark.cn' || !/^\/s\/[^/]+/.test(url.pathname))
    throw new Error('请填 pan.quark.cn 的夸克分享或文件夹链接。');
  const fid = url.hash.match(/\/list\/share\/([^/?#]+)/)?.[1] || '';
  const next = {quark_location_status: 'matched', quark_location_url: url.href,
    quark_real_path: path, quark_folder_fid: fid ? decodeURIComponent(fid) : '',
    quark_location_manual: true, quark_candidates: undefined, quark_location_note: undefined, quark_checked_at: new Date().toISOString()};
  return Object.entries(next).map(([key, after]) => fieldChange(record, key, after));
}
function quarkUnresolvedHtml() {
  const unresolved = cards.filter(r => r.quark_url && r.quark_location_status !== 'matched');
  const manual = cards.filter(r => r.quark_location_manual && r.quark_location_url);
  const rows = list => list.map(r => `<tr data-quark-record="${esc(r.id)}">
    <td><b class="mono">${esc(r.code)}</b><br>${esc(r.name || r.title)}<br><span class="count">${r.quark_location_manual ? '人工指定，扫描保留' : r.quark_location_status === 'ambiguous' ? '有候选，待确认' : r.quark_location_status === 'failed' ? '上次扫描失败' : '还没定位'}${r.quark_location_note ? `<br>${esc(r.quark_location_note)}` : ''}</span></td>
    <td>${(r.quark_candidates || []).length ? (r.quark_candidates || []).map((c, i) => `<p class="count">${esc(typeof c === 'string' ? c : c.path)} ${quarkCandidateUrl(r, c) ? `<button data-quark-candidate="${i}">采用这个文件夹</button>` : '（重新扫描后可点选）'}${c.match === 'name' ? '<br>按作品名找到，请确认' : c.match === 'code_hint' ? '<br>编号写法近似，请确认作品' : ''}</p>`).join('') : '<span class="count">没有候选，可以手填右边的文件夹链接。</span>'}</td>
    <td><input data-quark-link aria-label="夸克文件夹链接" class="mono" value="${esc(r.quark_location_manual ? r.quark_location_url : '')}" placeholder="粘贴夸克文件夹链接"><button data-quark-save>保存人工定位</button><p class="count">${esc(r.quark_real_path || '')}</p></td>
  </tr>`).join('');
  return `<h3>夸克待定位（${unresolved.length} 部）</h3><p class="count">候选路径点选后才采用。手填或点选的定位可撤销，之后扫描会保留；改完记得保存母版。</p>
    ${unresolved.length ? `<div class="table-wrap" style="overflow-x:auto"><table class="col-table" style="min-width:760px"><thead><tr><th>作品</th><th>候选路径</th><th>人工指定</th></tr></thead><tbody>${rows(unresolved)}</tbody></table></div>` : '<p class="count">有夸克链接的作品都已定位。</p>'}
    ${manual.length ? `<details><summary>人工指定的定位（${manual.length} 部，点击查看 / 修改）</summary><div class="table-wrap" style="overflow-x:auto"><table class="col-table" style="min-width:760px"><tbody>${rows(manual)}</tbody></table></div></details>` : ''}`;
}
function bindQuarkLocations() {
  $('pane-collections').querySelectorAll('[data-quark-record]').forEach(row => {
    const record = byId.get(row.dataset.quarkRecord);
    const save = (url, path) => {
      try {
        commit(`人工指定「${record.code}」的夸克文件夹`, manualQuarkChanges(record, url, path));
        setStatus('已保存人工定位，下次扫描会保留。可以撤销；记得保存母版。', 'dirty');
      } catch (e) { alertInline(row.querySelector('[data-quark-link]'), e.message); }
    };
    row.querySelector('[data-quark-save]').onclick = () => save(row.querySelector('[data-quark-link]').value, '');
    row.querySelectorAll('[data-quark-candidate]').forEach(button => button.onclick = () => {
      const candidate = record.quark_candidates[+button.dataset.quarkCandidate];
      save(quarkCandidateUrl(record, candidate), candidate.path || '');
    });
  });
}
function renderCollections() {
  const counted = project.collections.map(c => {
    const members = collectionMembers(c);
    return {c, records: members.length, cards: members.filter(r => !r.canonical_id || r.canonical_id === r.id).length};
  });
  const orphan = cards.filter(r => (r.baidu_url || r.quark_url) && !collectionOf(r)).length;
  const none = cards.filter(r => !r.baidu_url && !r.quark_url).length;
  $('pane-collections').innerHTML = `
    <div class="pane-inner">
      <div class="pane-head"><h2>合集</h2><span class="spacer"></span><button id="colAdd">＋ 新建合集</button><button id="colSizes">补全大小</button><button id="colHealth">检查全部作品</button><button id="colIssues">链接待办</button></div>
      <p class="count">每个合集是一对百度 / 夸克分享链接。改这里的链接，用到它的作品会一起改（可以撤销）。网盘里的路径一般是「月份 / 日期 / 编号」，例如 F10月 / 10.04 / 示例旧编号B。</p>
      ${orphan || none ? `<p class="inline-alert">${orphan ? `${orphan} 部作品的链接不属于任何合集。` : ''}${none ? `${none} 部作品没有网盘链接。` : ''}详见「体检」。</p>` : ''}
      <div class="table-wrap"><table class="col-table">
        <thead><tr><th>合集</th><th>${esc(fieldLabel('baidu_url'))}</th><th>${esc(fieldLabel('quark_url'))}</th><th>作品</th></tr></thead>
        <tbody>${counted.map(({c, cards: n, records}) => `<tr data-col="${c.id}">
          <td><input data-k="label" value="${esc(c.label)}" aria-label="合集名称"></td>
          <td><input data-k="baidu" class="mono" value="${esc(c.baidu)}" aria-label="百度链接"></td>
          <td><input data-k="quark" class="mono" value="${esc(c.quark)}" aria-label="夸克链接"></td>
          <td class="num" title="${records} 行来源记录">${n}</td></tr>`).join('')}</tbody>
      </table></div>
      ${quarkUnresolvedHtml()}
    </div>`;
  $('pane-collections').querySelectorAll('tr[data-col] input').forEach(input => input.addEventListener('change', () => {
    const col = project.collections.find(c => c.id === input.closest('tr').dataset.col), key = input.dataset.k, value = input.value.trim();
    if (key !== 'label' && value && !/^https?:\/\/\S+$/.test(value)) { setStatus('链接要以 http:// 或 https:// 开头。', 'error'); input.value = col[key]; return; }
    if(key==='quark'&&value!==col.quark&&moduleEnabled('quark')){input.value=col.quark;return replaceQuarkShare(col,value);}
    const changes = [{kind: 'collection', id: col.id, key, before: col[key], after: value}];
    if (key !== 'label') {
      const field = key === 'baidu' ? 'baidu_url' : 'quark_url';
      for (const r of views) if (col[key] && r[field] === col[key]) changes.push(fieldChange(r, field, value));
    }
    const n = commit(`改合集「${col.label}」的${{label: '名称', baidu: '百度链接', quark: '夸克链接'}[key]}`, changes);
    setStatus(key === 'label' ? '已改合集名称。' : `已改合集链接，同时更新了 ${n - 1} 行作品记录。可以按 Ctrl+Z 撤销。`, 'dirty');
  }));
  bindQuarkLocations();
  $('colSizes').onclick=()=>openQuarkTask('sizes');$('colHealth').onclick=()=>openQuarkTask('checks');$('colIssues').onclick=openIssueTodos;
  $('colAdd').addEventListener('click', () => {
    openDialog(`<h3>新建合集</h3>
      <div class="field"><label for="c_label">名称</label><input id="c_label" placeholder="例：2026年11月"></div>
      <div class="field"><label for="c_baidu">百度链接</label><input id="c_baidu" class="mono"></div>
      <div class="field"><label for="c_quark">夸克链接</label><input id="c_quark" class="mono"></div>
      <div class="dialog-actions"><button data-close>取消</button><button class="primary" id="c_ok">新建</button></div>`);
    $('c_ok').addEventListener('click', () => {
      const label = $('c_label').value.trim(), baidu = $('c_baidu').value.trim(), quark = $('c_quark').value.trim();
      if (!label) return alertInline($('c_quark'), '请填合集名称。');
      if ([baidu, quark].some(u => u && !/^https?:\/\/\S+$/.test(u))) return alertInline($('c_quark'), '链接要以 http:// 或 https:// 开头。');
      const id = 'C' + String(project.collections.length + 1).padStart(2, '0') + '-' + Date.now().toString(36).slice(-4);
      project.collections.push({id, label, baidu, quark});
      markDirty();
      closeDialog();
      renderCollections();
      setStatus(`已新建合集「${label}」。`, 'dirty');
    });
  });
}
tabHandlers.collections = renderCollections;
onChange(() => { if (!$('pane-collections').hidden) renderCollections(); });
