// 目录母版 · 新增作品：粘贴发布文字自动拆字段，编号自动生成，合集按批次自动选
// 拆字段只取常用的几项（版本、大小、平台、版本类型、分类、标签、名称），拆完让人确认，不确定的留空。
function parseReleaseText(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  const out = {name: '', version: '', size_str: '', size_mb: 0, platform: '', translation: '', genre: '', tags: [], raw_tags: '', updated: false, perks: [], author: ''};
  // 两个可选符号（和小助手的规则一样）：「@作者」；「名称 | 其余」指定名称到哪里为止
  s = s.replace(/(?:^|\s)[@＠]\s*(.+?)(?=\s+[#\[【|｜]|$)/, (m, a) => { out.author = a.trim(); return ' '; }).trim();
  const fixed = s.match(/^(.*?\S)\s+[|｜]\s+(.*)$/);
  if (fixed) s = fixed[1] + ' ' + fixed[2];
  if (!s) return out;
  if (/^(更新|新版本类型|补档|恢复)\s/.test(s)) out.updated = s.startsWith('更新');
  // 大小：[6.90G]、[载体3.50G]、【资料/10.6G】、[300M]
  const size = s.match(/[\[【(（][^\]】)）]*?(\d+(?:\.\d+)?)\s*([GMT])B?\s*[\]】)）]/i) || s.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*([GM])B?(?=\s|$)/i);
  if (size) {
    const unit = size[2].toUpperCase();
    out.size_str = size[1] + unit;
    out.size_mb = +size[1] * ({G: 1024, M: 1, T: 1048576}[unit]);
  }
  out.translation=versionTypes()[0]?.name||'默认';
  // 只认用户配置的字段建议，不按目录用途猜测。
  for(const key of ['genre','platform','translation']) {
    const choices=key==='translation'?versionTypes().map(item=>item.name):(meta.ui_config?.type_options?.[key]||[]);
    const hits=choices.filter(value=>value&&s.includes('#'+value));
    if(hits.length===1)out[key]=hits[0];
  }
  // 标签：#xxx，和 [a/b/c] 里的词
  const hashTags = [...s.matchAll(/#([^\s#]+)/g)].map(m => m[1]);
  const bracket = [...s.matchAll(/[\[【]([^\]】]+)[\]】]/g)].map(m => m[1]).filter(t => !/\d\s*[GMT]B?$/i.test(t));
  const bracketTags = bracket.flatMap(t => t.split(/[\/、,，\s]+/)).filter(Boolean);
  out.tags = [...new Set([...hashTags, ...bracketTags])].filter(t => t.length <= 12);
  out.raw_tags = [...hashTags.map(t => '#' + t), ...bracket.map(t => `[${t}]`)].join(' ');
  // 版本：v1.0.2、Ver1.05、ver 1.08、体験版 / 正式版
  const ver = s.match(/(?:^|\s)((?:v|ver\.?|Ver\.?|V)\s?\d+(?:\.\d+)*[a-z]?)(?=[\s\]】+]|$)/) || s.match(/(体験版|体验版|正式版|完整版|试玩版)/);
  // 名称：版本、标签、方括号之前的部分
  const cut = [ver ? s.indexOf(ver[1]) : -1, s.search(/\s#/), s.search(/[\[【]/)].filter(i => i > 0);
  out.name = (cut.length ? s.slice(0, Math.min(...cut)) : s).trim();
  if (ver) {
    const after = s.slice(s.indexOf(ver[1])).split(/\s#|[\[【]/)[0].trim();
    out.version = after;
  }
  if (fixed) out.name = fixed[1].trim();
  return out;
}

// 新增作品预览里要人看一眼的格子：原文没写分类 / 版本类型，或名称太短、像标签、还带着版本号
function needsLook(dr,k){
  if(!fieldVisible(k))return '';
  if (k === 'genre' && !dr.genre) return '原文没有配置的分类，可直接填写';
  if (k === 'translation' && !dr.translation) return '可以选择已配置的版本类型';
  if (k === 'name') {
    const n = String(dr.name || '').replace(/^更新\s*/, '');
    if (n.length < 3 || /^(标签|分类|版本)$/i.test(n) || /(^|\s)(v|ver\.?)\s?\d|#/i.test(n)) return '名称可能拆错了：在原文的名称后面加「 | 」再试，或直接改';
  }
  return '';
}
const PREFIX_FOR = sheet => /网友/.test(sheet) ? 'E' : 'F';
function batchFor(date) { return date; }
// 同一个月份标签最常用的合集
function collectionForBatch(batch) {
  if(!moduleEnabled('downloads'))return null;
  return project.collections.find(c=>c.label===batch||c.id===batch)||null;
}

function todayStr() { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; }

$('addBtn').addEventListener('click', openAddDialog);
function openAddDialog() {
  const date = todayStr();
  openDialog(`
    <h3>新增作品</h3>
    <div class="seg" role="tablist"><button data-mode="paste" class="on" role="tab">粘贴发布文字</button><button data-mode="form" role="tab">直接填写</button></div>
    <p class="count" id="n_modeHint">可以一次粘贴多行发布文字，每行一部。拆出来的结果在下面表格里确认、修改后再添加。</p>
    <div class="grid2">
      <div class="field"><label for="n_sheet">分区</label><select id="n_sheet">${SECTIONS.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label for="n_date">加入／更新名单日期</label><input id="n_date" type="date" value="${date}"><span class="count">你把这一版加入或更新到名单的日期，用于按日期排序。</span></div>
      <div class="field"><label for="n_prefix">编号前缀</label><input id="n_prefix" value="ITEM" maxlength="4"></div>
      <div class="field"><label for="n_batch">归档批次</label><input id="n_batch" value="${batchFor(date)}">
        <span class="count">批次是你自己的归档标签，可填写月份、专题或留空；不会推断网盘目录，也不会移动文件。</span></div>
      <div class="field wide"><label for="n_col">合集（网盘链接）</label><select id="n_col">${project.collections.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}<option value="">不设链接</option></select></div>
      <div class="field wide" id="n_formBox" hidden><div class="detail-form">
        <div class="field wide"><label for="f_name">名称</label><input id="f_name" data-f="name" autocomplete="off" placeholder="例：更新 星河手记（更新的作品在前面写「更新」）"></div>
        <div class="field"><label for="f_version">版本</label><input id="f_version" data-f="version" autocomplete="off"></div>
        <div class="field"><label for="f_author">作者</label><input id="f_author" data-f="author" autocomplete="off"></div>
        <div class="field"><label for="f_genre">类型</label><input id="f_genre" data-f="genre" data-type-key="genre" autocomplete="off" placeholder="输入类型"></div>
        <div class="field"><label for="f_platform">平台</label><input id="f_platform" data-f="platform" data-type-key="platform" autocomplete="off" value=""></div>
        <div class="field"><label for="f_translation">语言</label><input id="f_translation" data-f="translation" data-type-key="translation" autocomplete="off" placeholder="默认"></div>
        <div class="field"><label for="f_size">大小</label><input id="f_size" data-f="size_str" autocomplete="off" placeholder="例：1.2G"></div>
        <div class="field wide"><label for="f_tags">标签（空格分开）</label><input id="f_tags" data-f="tags" autocomplete="off"></div>
        <div class="field wide"><label><input type="checkbox" id="f_updated" data-f="updated"> 标记为版本更新</label><span class="count">已有作品出了新版时勾选，读者会看到「更新」标记。</span></div>
        <div class="field wide"><label for="f_sum">本次更新内容（读者可见，选填）</label><input id="f_sum" data-f="update_summary" placeholder="例：升级到 v1.05，补充索引、修正文档" autocomplete="off"></div>
        <div class="field"><label for="f_vdate">作品版本发布日期（选填）</label><input id="f_vdate" type="date" data-f="version_date"><span class="count">作者或作者发布这个版本的日期，不知道就留空。</span></div>
        <div class="field wide"><label for="f_notes">备注 / 更新日志（读者能看到）</label><textarea id="f_notes" rows="3" data-f="notes"></textarea></div>
      </div></div>
      <div class="field wide" id="n_pasteBox"><label for="n_text">发布文字（每行一部）</label><textarea id="n_text" rows="4" placeholder="直接粘贴发布文字，例：星河手记 v1.0 中文版 #参考 #专题 载体 [1.2G]"></textarea>
        <p class="count">一般直接粘贴就行。两个可选的符号：名称拆得不对时，在名称后面加「 | 」（前后带空格）；想顺手填作者就加「@作者」，例：<code>虚构书名 | v1.0 #阅读 @示例作者</code></p></div>
    </div>
    <p class="count" id="n_rule"></p>
    <div class="new-preview" id="n_preview"></div>
    <div class="new-versions" id="n_versions"></div>
    <div class="dialog-actions"><button data-close>取消</button><button class="primary" id="n_add" disabled>添加</button></div>`, {wide: true});
  for(const input of document.querySelectorAll('#n_formBox [data-f]')){const key=input.dataset.f,field=input.closest('.field');if(!field)continue;field.hidden=!fieldVisible(key);const label=field.querySelector('label');if(label&&!label.contains(input)&&FIELD_LABEL[key])label.textContent=fieldLabel(key,FIELD_LABEL[key]);}
  $('n_col').closest('.field').hidden=!moduleEnabled('downloads');$('n_col').value='';
  let drafts = [], mode = 'paste';
  // 每一行（按原文）删掉了哪些旧版本、要不要沿用旧版资料；更新的作品填的「更新了什么」「版本发布日期」
  const replaced = new Map(), keepOld = new Map(), updInfo = new Map();
  // 直接填写：表单就是一部作品
  const formDraft = code => {
    const v = k => { const el = document.querySelector(`#n_formBox [data-f="${k}"]`); return el.type === 'checkbox' ? el.checked : el.value.trim(); };
    const name = v('name');
    if (!name) return null;
    const size = v('size_str').match(/(\d+(?:\.\d+)?)\s*([GMT])/i);
    return {code, line: '__form__', name, version: v('version'), author: v('author'), genre: v('genre'), platform: v('platform'), translation: v('translation'),
      tags: parseFieldValue('tags', v('tags')), size_str: size ? size[1] + size[2].toUpperCase() : v('size_str'), size_mb: size ? +size[1] * ({G: 1024, M: 1, T: 1048576}[size[2].toUpperCase()]) : 0,
      updated: v('updated') || /^更新/.test(name), update_summary: v('update_summary'), version_date: v('version_date'), notes: $('f_notes').value, perks: [], raw_tags: ''};
  };
  document.querySelector('.seg').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    mode = b.dataset.mode;
    document.querySelectorAll('.seg [data-mode]').forEach(x => x.classList.toggle('on', x === b));
    $('n_formBox').hidden = mode !== 'form'; $('n_pasteBox').hidden = mode === 'form';
    $('n_rule').hidden = mode === 'form';
    $('n_modeHint').textContent = mode === 'form' ? `一条一条填。${fieldLabel('genre')}、${fieldLabel('platform')}、${fieldLabel('translation')}可输入文字或拼音首字母，↑↓ 换，Tab 确认。` : '可以一次粘贴多行发布文字，每行一部。拆出来的结果在下面表格里确认、修改后再添加。';
    render();
    (mode === 'form' ? $('f_name') : $('n_text')).focus();
  });
  $('n_formBox').addEventListener('input', () => render());
  $('n_formBox').addEventListener('change', () => render());
  // 开着小助手时用 kanban.py 的规则拆（和 Excel 导入一样准）；没开时用浏览器里的简化规则
  const parsed = new Map(), useHelper = HELPER && !helperLost;
  $('n_rule').textContent = useHelper ? '按 Excel 导入时同一套规则拆分。' : '现在用的是简化的拆分规则；用文件夹里的「启动目录表」打开母版，会按 Excel 导入时同一套规则拆，更准。';
  let parseTimer = 0;
  const askHelper = () => {
    if (!useHelper) return;
    clearTimeout(parseTimer);
    parseTimer = setTimeout(async () => {
      const lines = [...new Set($('n_text').value.split('\n').map(l => l.trim()).filter(l => l && !parsed.has(l)))];
      if (!lines.length) return;
      try {
        const {items} = await api('/api/parse-release', {lines});
        lines.forEach((l, i) => parsed.set(l, items[i]));
        render();
      } catch (error) { $('n_rule').textContent = '小助手没有回应，先用简化规则拆：' + error.message; }
    }, 250);
  };
  const syncBatch = () => {
    $('n_batch').value = batchFor($('n_date').value || todayStr());
    const col = collectionForBatch($('n_batch').value);
    if (col) $('n_col').value = col.id;
  };
  const render = () => {
    const prefix = $('n_prefix').value.trim() || 'F', d = $('n_date').value || todayStr();
    const taken = new Set(views.map(v => v.code));
    let code = nextCode(prefix, d);
    if (mode === 'form') {
      const f = formDraft(code);
      drafts = f ? [f] : [];
      $('n_preview').innerHTML = f ? `<p class="count">编号：<b class="mono">${esc(code)}</b>（接着当天已有的号往下排）</p>` : '';
      $('n_add').disabled = !drafts.length;
      renderVersions();
      return;
    }
    drafts = $('n_text').value.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const p = Object.assign(parseReleaseText(line), parsed.get(line) || {});
      const draft = Object.assign(p, {code, line}, updInfo.get(line) || {});
      taken.add(code);
      // 下一部的编号：在当前基础上找下一个空号
      const base = prefix + d.replace(/-/g, '').slice(2) + 'R';
      for (let n = 2; ; n++) { const c = base + n; if (!taken.has(c) && c !== code) { code = c; break; } }
      return draft;
    });
    const cols = [['code', '编号'], ['name', '名称'], ['version', '版本'], ['author', '作者'], ['platform', '平台'], ['translation', '版本类型'], ['genre', '分类'], ['size_str', '大小'], ['tags', '标签']].filter(([key])=>fieldVisible(key)).map(([key,label])=>[key,fieldLabel(key,label)]);
    $('n_preview').innerHTML = drafts.length ? `<table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th>更新</th></tr></thead><tbody>${drafts.map((dr, i) => `<tr>${cols.map(([k]) =>
      `<td><input data-i="${i}" data-k="${k}"${TYPE_KEYS.includes(k) ? ` data-type-key="${k}"` : ''} value="${esc(k === 'tags' ? dr.tags.join(' ') : dr[k])}"${needsLook(dr, k) ? ` class="look" title="${esc(needsLook(dr, k))}"` : ''}></td>`).join('')}<td><input type="checkbox" data-i="${i}" data-k="updated" ${dr.updated ? 'checked' : ''}></td></tr>`).join('')}</tbody></table>
      <p class="count">编号会接着当天已有的号往下排；有重复会在添加前提示。</p>` : '';
    const looks = drafts.filter(dr => cols.some(([k]) => needsLook(dr, k))).length;
    if (looks) $('n_preview').insertAdjacentHTML('beforeend', `<p class="count"><span class="look-dot"></span> ${looks} 行有标黄的格子：原文里没写分类或版本类型，或名称可能拆错。直接改格子，或在原文里补「#分类 #版本类型」、在名称后加「 | 」。</p>`);
    $('n_add').disabled = !drafts.length;
    renderVersions();
  };
  // 「更新」开头的作品：列出目录里的旧版本，旁边「删除」；不是更新但目录里已有同名的，提醒一下
  const renderVersions = () => {
    const blocks = drafts.map((dr, i) => {
      const isUpdate = dr.updated || /^更新/.test(dr.name || '');
      const gone = replaced.get(dr.line) || [];
      const others = findOtherVersions(dr.name, dr.aliases || [], new Set(gone.map(o => o.id)));
      if (isUpdate && (others.length || gone.length)) {
        return `<div class="version-block"><b>${esc(dr.code)} ${esc(String(dr.name).replace(/^更新\s*/, ''))}</b> 是更新，目录里可能的旧版本：
          <div class="version-list">${others.map(o => `<div class="version-row">${coverHtml(o, 'xs')}<div class="version-main">${versionLine(o)}</div><button data-del-old="${i}" data-id="${esc(o.id)}">删除</button></div>`).join('')}
          ${gone.map(o => `<div class="version-row gone"><div class="version-main">已删除：${versionLine(o)}</div></div>`).join('')}</div>
          ${gone.length ? `<label class="count"><input type="checkbox" data-keep-old="${i}" ${keepOld.get(dr.line) !== false ? 'checked' : ''}> 新版本沿用删掉的旧版的作者、来源资料、封面、分区，以及榜单 / 名单里的位置</label>` : ''}
          ${mode === 'paste' ? updateInputs(dr, i) : ''}</div>`;
      }
      const same = others;
      if (!isUpdate && same.length) return `<div class="version-block warn"><b>${esc(dr.code)}</b> 目录里已经有名称很像的作品：<div class="version-list">${same.map(o => `<div class="version-row">${coverHtml(o, 'xs')}<div class="version-main">${versionLine(o)}</div></div>`).join('')}</div>
        <p class="count">如果这是新版本，在原文前面加「更新」，就能在这里顺手删旧版本；如果是重复添加，可以取消这一行。</p></div>`;
      return isUpdate && mode === 'paste' ? `<div class="version-block"><b>${esc(dr.code)} ${esc(String(dr.name).replace(/^更新\s*/, ''))}</b> 是更新，目录里没找到旧版本。${updateInputs(dr, i)}</div>` : '';
    }).join('');
    $('n_versions').innerHTML = blocks;
  };
  const updateInputs = (dr, i) => `<div class="detail-form upd-inputs">
      <div class="field wide"><label>本次更新内容（读者可见）</label><input data-upd="${i}" data-uk="update_summary" value="${esc(dr.update_summary || '')}" autocomplete="off"></div>
      <div class="field"><label>作品版本发布日期（选填）</label><input type="date" data-upd="${i}" data-uk="version_date" value="${esc(dr.version_date || '')}"><span class="count">作者或作者发布这个版本的日期，不知道就留空。</span></div></div>`;
  $('n_versions').addEventListener('input', e => {
    const el = e.target.closest('[data-upd]');
    if (!el) return;
    const dr = drafts[+el.dataset.upd];
    if (!dr) return;
    dr[el.dataset.uk] = el.value.trim();
    updInfo.set(dr.line, Object.assign(updInfo.get(dr.line) || {}, {[el.dataset.uk]: el.value.trim()}));
  });
  $('n_versions').addEventListener('click', e => {
    const b = e.target.closest('[data-del-old]');
    if (!b) return;
    const dr = drafts[+b.dataset.delOld], old = byId.get(b.dataset.id);
    if (!dr || !old) return;
    deleteCards([old], `删除旧版本：${old.code} ${shortName(old)}`);
    replaced.set(dr.line, [...(replaced.get(dr.line) || []), old]);
    renderVersions();
  });
  $('n_versions').addEventListener('change', e => {
    const c = e.target.closest('[data-keep-old]');
    if (c) keepOld.set(drafts[+c.dataset.keepOld].line, c.checked);
  });
  $('n_date').addEventListener('change', () => { syncBatch(); render(); });
  $('n_sheet').addEventListener('change', () => { $('n_prefix').value = PREFIX_FOR($('n_sheet').value); render(); });
  $('n_prefix').addEventListener('input', render);
  $('n_text').addEventListener('input', () => { render(); askHelper(); });
  $('n_batch').addEventListener('change', () => { const col = collectionForBatch($('n_batch').value); if (col) $('n_col').value = col.id; });
  $('n_preview').addEventListener('input', e => {
    const el = e.target.closest('[data-i]');
    if (!el) return;
    const dr = drafts[+el.dataset.i], k = el.dataset.k;
    dr[k] = k === 'tags' ? parseFieldValue('tags', el.value) : k === 'updated' ? el.checked : el.value.trim();
    if (k === 'updated' || k === 'name') renderVersions();
  });
  syncBatch();
  $('n_add').addEventListener('click', () => {
    const codes = drafts.map(d => d.code);
    const clash = codes.filter((c, i) => !c || codes.indexOf(c) !== i || views.some(v => v.code === c || v.id === c));
    if (clash.length) return alertInline($('n_preview'), `编号重复或为空：${[...new Set(clash)].join('、') || '（空）'}，请改一下再添加。`);
    if (drafts.some(d => !d.name)) return alertInline($('n_preview'), '有一行没有名称，请补上。');
    const sheet = $('n_sheet').value, col = project.collections.find(c => c.id === $('n_col').value);
    let index = insertIndexFor(sheet);
    const changes = drafts.map(d => ({kind: 'add', index: index++, record: newRecord({
      code: d.code, name: d.name, version: d.version, platform: d.platform, translation: d.translation, genre: d.genre,
      tags: d.tags, raw_tags: d.raw_tags, perks: d.perks, play_tags: d.play_tags, theme_tags: d.theme_tags, cheats: d.cheats, types: d.types,
      author: d.author, notes: d.notes, update_summary: d.update_summary, version_date: d.version_date, aliases: d.aliases, en_title: d.en_title, orig_title: d.orig_title, size_str: d.size_str, size_mb: (d.size_str.match(/(\d+(?:\.\d+)?)\s*([GMT])/i) || [])[1] ? d.size_mb : 0,
      updated: d.updated, sheet, date: $('n_date').value || todayStr(), batch: $('n_batch').value.trim(),
      baidu_url: col ? col.baidu : '', quark_url: col ? col.quark : '', collectionLabel: col ? col.label : '',
    })}));
    // 删掉了旧版本的：新版本沿用旧版的资料（同一步，撤销时一起撤）
    const extra = drafts.flatMap((d, i) => (replaced.get(d.line) || []).length && keepOld.get(d.line) !== false ? inheritFromOld(changes[i].record, replaced.get(d.line)) : []);
    commit(`新增 ${changes.length} 部作品`, [...changes, ...extra]);
    closeDialog();
    revealRecord(changes[0].record.id);
    setStatus(`已新增 ${changes.length} 部（${codes.join('、')}）。可以按 Ctrl+Z 撤销。`, 'dirty');
  });
}
function alertInline(where, text) {
  let el = where.parentElement.querySelector('.inline-alert');
  if (!el) { el = document.createElement('p'); el.className = 'inline-alert'; where.after(el); }
  el.textContent = text;
}
