
(async () => {
  await window.__GAME_RECORDS_READY__;
  'use strict';
  const $ = id => document.getElementById(id);
  const sourceData = Array.isArray(window.__GAME_RECORDS__) ? window.__GAME_RECORDS__ : [];
  const data = sourceData.filter(r=>!r.canonical_id || r.canonical_id===r.id);
  // Retain each sheet's own order even when several rows share one card.
  const rowOrder = new Map(), zoneRowOrder = new Map();
  sourceData.forEach((r,index)=>{
    const id=r.canonical_id||r.id;
    if(!rowOrder.has(id))rowOrder.set(id,index);
    if(!zoneRowOrder.has(r.zone))zoneRowOrder.set(r.zone,new Map());
    const positions=zoneRowOrder.get(r.zone);
    const row=Number(r.row_num), position=Number.isFinite(row)&&row>0?row:index;
    if(!positions.has(id)||position<positions.get(id))positions.set(id,position);
  });
  function compareRowOrder(a,b,zone) {
    const positions=zoneRowOrder.get(zone);
    if(positions&&positions.has(a.id)&&positions.has(b.id)){
      const difference=positions.get(a.id)-positions.get(b.id);
      if(difference)return difference;
    }
    return rowOrder.get(a.id)-rowOrder.get(b.id);
  }
  const meta = window.__GLOBAL_META__ && typeof window.__GLOBAL_META__ === 'object' ? window.__GLOBAL_META__ : {};
  const RC=window.JiyeReaderConfig, field=k=>RC.field(meta,k), fieldValue=(r,k)=>field(k).visible?r[k]:'';
  const downloadLinks=r=>RC.downloads(meta,r), topNotice=RC.topNotice(meta);
  const byId = new Map(data.map(r => [r.id, r]));
  data.forEach(r=>[...(r.merged_ids||[]),...(r.legacy_ids||[])].forEach(id=>byId.set(id,r)));
  // 沿用存储命名空间，改名后同一目录的个人数据继续可读。
  const key = 'panlu-reader-v1:' + (meta.collection_key || 'catalog');
  const defaults = {favorites:[], notes:{}, theme:'eye', view:'grid', heroCollapsed:true, size:100, pageSizeSet:false, pageSizeRevision:2};
  let saved = defaults, storageWarning = false;
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value && typeof value === 'object') saved = {...defaults, ...value};
  } catch { storageWarning = true; }
  const favorites = new Set((Array.isArray(saved.favorites) ? saved.favorites : []).filter(id => byId.has(id)).map(id=>byId.get(id).id));
  const notes = Object.create(null);
  if (saved.notes && typeof saved.notes === 'object') {
    for (const [id, note] of Object.entries(saved.notes)) {
      if (typeof note === 'string') {const target=byId.get(id)?.id||id;notes[target]=[notes[target],note.slice(0,5000)].filter(Boolean).join('\n');}
    }
  }
  const state = {
    zone:'all', query:'', genre:'', platform:'', translation:'', tag:'',
    month:'', author:'', updated:false, cheat:false, save:false, uncensored:false, extraMarkers:'', onlyFavorites:false, sort:'recent', page:1,
    size:saved.pageSizeRevision === 2 && saved.pageSizeSet && [12,24,48,96,25,50,100,99999].includes(Number(saved.size)) ? Number(saved.size) : 100,
    // 改版后默认「列表」（一部一行、按批次分段）；「grid」是封面墙
    view: saved.viewRevision === 2 && ['grid','compact'].includes(saved.view) ? saved.view : 'list',
    compare: new Set(), searchNotes: false, onlyNew: '', unseen: false, showHidden: false
  };
  let filtered = [], lastFocus = null, toastTimer = null, heroCollapsed = true;
  let renderToken = 0, renderObserver = null, renderIdle = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sizeText = r => r.size_str || (r.size >= 1024 ? (r.size/1024).toFixed(1) + ' GB' : r.size > 0 ? Math.round(r.size) + ' MB' : '');
  const artWord = r => (r.english || r.orig_title || r.genre || r.code || '').replace(/\n/g, ' ');
  const zoneNames = {all:'全部条目', favorites:'我的收藏', want:'想看', played:'看过', hidden:'不感兴趣'};
  const zoneIcons = {all:'▦', favorites:'♡', want:'☆', played:'✓', hidden:'⊘'};
  sourceData.forEach(r => {
    zoneNames[r.zone] = r.sheet;
    if (!zoneIcons[r.zone]) zoneIcons[r.zone] = r.zone_icon || '◈';
  });
  const genreOrder = meta.ui_config?.type_options?.genre || ['资料','课程','素材','其他'];
  const platformOrder = meta.ui_config?.type_options?.platform || ['通用','Windows','macOS','移动端'];
  const unique = (arr, prefer) => {
    const set = [...new Set(arr.filter(Boolean))];
    if (!prefer) return set.sort((a,b)=>a.localeCompare(b,'zh-CN'));
    return [...prefer.filter(v => set.includes(v)), ...set.filter(v => !prefer.includes(v))];
  };
  const genres = unique(data.map(r => r.genre), genreOrder);
  const platforms = unique(data.flatMap(r => String(r.platform||'').split(/\s*[+/、]\s*/)), platformOrder);
  const configuredVersions=RC.versionTypes(meta);
  for(const r of data){const type=RC.versionType(meta,r);if(!configuredVersions.some(v=>v.name===type.name))configuredVersions.push(type);}
  const LANG_GROUPS=configuredVersions.map(v=>[v.name,v.values]), LANG={};
  const langOf=r=>RC.versionType(meta,r).name, langGroup=langOf;
  function langStamp(r) {const v=RC.versionType(meta,r);return field('translation').visible?`<span class="lang version-badge" style="--version-color:${v.color}" title="${esc(field('translation').label)}">${esc(v.name)}</span>`:'';}
  // 只使用用户明确选择或资料中已有的封面，不按来源编号猜图片地址。
  const showCovers = (meta.ui_config || {}).show_covers !== false, coverOff = new Set(meta.cover_off || []);
  function coverUrl(r) {
    if (coverOff.has(r.id)) return '';
    const own = (meta.card_covers || {})[r.id] || (meta.ranking_covers || {})[r.id];
    const info = r.web_info || {}, candidates = [own, info.cover, info.cover_url, info.image_url, ...(Array.isArray(info.links) ? info.links.flatMap(item => [item?.cover, item?.cover_url, item?.image_url]) : [])];
    for (const value of candidates) {
      if (typeof value !== 'string' || !value) continue;
      if (/^(?:enc1:|img2:|blob:|data:image\/)/.test(value)) return CatalogImages.url(value);
      if (meta.ui_config?.allow_remote_images === true && /^https?:\/\//.test(value)) return value;
    }
    return '';
  }
  function thumbHtml(r, cls = '') {
    const [c1, c2] = Array.isArray(r.palette) && r.palette.length ? r.palette : ['#dfe6e2', '#6b8f7d'], src = showCovers ? coverUrl(r) : '';
    return `<div class="thumb ${cls}" style="--c1:${esc(c1)};--c2:${esc(c2)}" aria-hidden="true">${esc([...splitTitle(r.name).main.replace(/^[\[【(（『「]+/, '')].slice(0, 2).join(''))}${src ? `<img src="${esc(src)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" onerror="this.remove()">` : ''}${langStamp(r)}</div>`;
  }
  const tagFreq = {};
  data.forEach(r => RC.tags(r).forEach(t => { tagFreq[t] = (tagFreq[t]||0) + 1; }));
  // 「更多筛选」里先摆出最常见的 24 个标签，其余点「展开全部」或搜索
  const topTags = Object.entries(tagFreq).filter(([t,n]) => n >= 1 && t.length <= 8).sort((a,b)=>b[1]-a[1]).slice(0,24).map(([t])=>t);
  const authors = unique(data.map(r => r.author).filter(Boolean));
  const authorCounts = new Map();
  for(const r of data)if(r.author)authorCounts.set(r.author,(authorCounts.get(r.author)||0)+1);
  authors.sort((a,b)=>authorCounts.get(b)-authorCounts.get(a)||a.localeCompare(b,'zh-CN'));
  const popularAuthors=[...authorCounts.keys()].sort((a,b)=>authorCounts.get(b)-authorCounts.get(a)||a.localeCompare(b,'zh-CN')).slice(0,8);
  const months = [...new Set(data.map(r => (r.date||'').slice(0,7)).filter(v => /^\d{4}-\d{2}$/.test(v)))].sort().reverse();
  const extraMarkers = Array.isArray(meta.ui_config?.extra_markers) ? meta.ui_config.extra_markers.filter(item => item && item.label).map((item, index) => ({...item, key:String(item.key || 'custom-' + index), tag:item.tag || item.label})) : [];
  function markerMatches(r, marker) {
    return recordTags(r).has(marker.tag) || (r.perks || []).includes(marker.tag) || marker.key === 'cheat' && (r.cheats || []).length > 0;
  }
  const password = topNotice.visible ? topNotice.text : '';
  // 合集：网盘链接 → 合集名称（母版导出时写进 meta.collections）
  const collectionByUrl = new Map();
  for (const c of (Array.isArray(meta.collections) ? meta.collections : [])) {
    if (c && c.quark) collectionByUrl.set(c.quark, c);
    if (c && c.baidu) collectionByUrl.set(c.baidu, c);
  }
  const canonicalId = id => byId.get(id)?.id;
  // 拿取清单：这次准备下载的条目（和收藏分开），以及自己勾的「已拿到」
  const takeList = new Set((Array.isArray(saved.takeList) ? saved.takeList : []).map(canonicalId).filter(Boolean));
  const takenDone = new Set((Array.isArray(saved.takenDone) ? saved.takenDone : []).map(canonicalId).filter(Boolean));
  const takenVersions={...(saved.takenVersions||{})}, takenDates={...(saved.takenDates||{})};
  const takenUpdates=()=>data.filter(r=>takenDone.has(r.id)&&takenVersions[r.id]!==undefined&&String(takenVersions[r.id])!==String(r.version||''));
  // 我的标记：想看 / 看过 / 不感兴趣（不感兴趣的平时不显示，在左边「不感兴趣」里找回来）
  var MARKS = {want: '想看', played: '看过', hidden: '不感兴趣'};
  const marks = Object.create(null);
  for (const [id, m] of Object.entries(saved.marks && typeof saved.marks === 'object' ? saved.marks : {})) { const t = canonicalId(id); if (t && MARKS[m]) marks[t] = m; }
  // 看过：点开过详情的条目，列表里名字变淡；概况里可以「只看没点开过的」
  const viewed = new Set((Array.isArray(saved.viewed) ? saved.viewed : []).map(canonicalId).filter(Boolean));
  // 屏蔽的标签 / 作者：带这些的条目平时不显示
  const blockedTags = new Set((Array.isArray(saved.blockedTags) ? saved.blockedTags : []).filter(t => typeof t === 'string'));
  const blockedAuthors = new Set((Array.isArray(saved.blockedAuthors) ? saved.blockedAuthors : []).filter(t => typeof t === 'string'));
  // 常用筛选：自己存下来的一组筛选条件，顶栏一点就套用
  const presets = (Array.isArray(saved.presets) ? saved.presets : []).filter(p => p && typeof p.name === 'string' && p.state && typeof p.state === 'object').slice(0, 30);
  const blockReason = r => marks[r.id] === 'hidden' ? '不感兴趣' : r.author && blockedAuthors.has(r.author) ? '屏蔽的作者' : [...blockedTags].some(t => recordTags(r).has(t)) ? '屏蔽的标签' : '';
  // 本期变化（母版导出时和上一次发布比较得出）
  const changes = meta.changes && typeof meta.changes === 'object' ? meta.changes : null;
  const editionIds = new Set(changes && !changes.first ? [...(changes.added || []), ...(changes.updated || []).map(u => u.id)].map(canonicalId).filter(Boolean) : []);
  // 你上次来之后：按「编号 + 版本」比较，存在这个浏览器里
  const seenKey = 'panlu-seen-v1:' + (meta.collection_key || 'catalog');
  let sinceInfo = null;
  const sinceIds = new Set();
  try {
    const seen = JSON.parse(localStorage.getItem(seenKey) || 'null');
    const nowMap = {};
    for (const r of data) nowMap[r.id] = String(r.version || '');
    if (seen && seen.items && typeof seen.items === 'object') {
      let added = 0, updated = 0;
      for (const r of data) {
        if (!(r.id in seen.items)) { sinceIds.add(r.id); added++; }
        else if (seen.items[r.id] !== nowMap[r.id]) { sinceIds.add(r.id); updated++; }
      }
      sinceInfo = {at: seen.at, date: seen.date, added, updated};
    }
    if (!seen || seen.date !== meta.update_date || Object.keys(seen.items || {}).length !== data.length) {
      localStorage.setItem(seenKey, JSON.stringify({at: new Date().toISOString().slice(0, 10), date: meta.update_date || '', items: nowMap}));
    }
  } catch {}
  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
  }
  async function copyText(text, ok='已复制', fail='复制失败，请手动选择。') {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch {
      const box = document.createElement('textarea');
      box.value = text; document.body.appendChild(box); box.select();
      const done = document.execCommand('copy'); box.remove();
      toast(done ? ok : fail);
    }
  }
  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify({
        favorites:[...favorites], notes, theme:document.documentElement.dataset.theme,
        view:state.view, viewRevision:2, follow:saved.follow, heroCollapsed, size:state.size, pageSizeSet:true, pageSizeRevision:2, boundLinks, takeList:[...takeList], takenDone:[...takenDone], takenVersions, takenDates, noticeDismissed:saved.noticeDismissed, backdropBlur:saved.backdropBlur, pendingFavorites, legacyMigrated:saved.legacyMigrated, showCounts:saved.showCounts, compact:saved.compact, heroStyle:saved.heroStyle, paletteRevision:saved.paletteRevision, settingsRevision:saved.settingsRevision,
        marks, viewed:[...viewed], blockedTags:[...blockedTags], blockedAuthors:[...blockedAuthors], presets, takeDisk:saved.takeDisk
      }));
    } catch { toast('浏览器未允许本地保存，本次操作仍在当前页面保留。'); }
  }
  function updateHero() {
    document.querySelector('.hero').hidden = heroCollapsed;
    $('heroToggle').textContent = heroCollapsed ? '展开头图 ↓' : '收起头图 ↑';
    $('heroToggle').setAttribute('aria-expanded', String(!heroCollapsed));
  }
  function setTheme(theme) {
    const next = ['light','dark','eye','warm','pink'].includes(theme) ? theme : 'eye';
    document.documentElement.dataset.theme = next;
    document.querySelectorAll('[data-theme-set]').forEach(btn => btn.classList.toggle('active', btn.dataset.themeSet === next));
  }
  let modalScroll=0;
  // 弹窗：drawer 时从右边滑出（条目详情、拿取清单），其余在中间
  function modal(title, content, eyebrow='THE COLLECTION', opts={}) {
    if(!$('modal').open){lastFocus=document.activeElement;modalScroll=scrollY;document.body.classList.add('dialog-open');}
    $('modal').classList.toggle('drawer', !!opts.drawer);
    $('modal').classList.remove('wide');
    $('modalEyebrow').textContent = eyebrow;
    $('modalBody').onclick=null;$('modalBody').onchange=null;
    $('modalBody').innerHTML = `${opts.before || ''}<h2 id="modalTitle">${esc(title)}</h2>${content}`;
    if (!$('modal').open) $('modal').showModal();
    $('closeModal').focus();
  }
  $('modal').addEventListener('close',()=>{document.body.classList.remove('dialog-open');scrollTo({top:modalScroll,behavior:'instant'});if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});});
  $('closeModal').onclick = () => $('modal').close();
  $('modal').addEventListener('click', e => {
    if (e.target === $('modal')) {
      const r = $('modal').getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('modal').close();
    }
  });
  function chips(mount, values, field) {
    $(mount).innerHTML = ['', ...values].map(v => `<button class="chip${(v ? state[field].split('\u001f').includes(v) : !state[field])?' active':''}" data-${field}="${esc(v)}" aria-pressed="${(v ? state[field].split('\u001f').includes(v) : !state[field])}">${esc(v||'全部')}${saved.showCounts && v ? ' ('+data.filter(r=>field==='genre'?r.genre===v:field==='tag'?hasTag(r,v):String(r[field]||'').includes(v)).length+')' : ''}</button>`).join('');
  }
  const tagCache = new WeakMap();
  function recordTags(r) {
    let tags = tagCache.get(r);
    if (!tags) {
      tags = new Set(RC.tags(r));
      tagCache.set(r, tags);
    }
    return tags;
  }
  function hasTag(r,v) { return recordTags(r).has(v) || (r.raw_title||'').includes(v); }
  // 搜索默认不搜更新日志（长日志里的字容易误中）；勾选「含更新日志」时再加上
  function searchBlob(r) {
    return [r.name, r.code, ...RC.sourceIds(r), r.english, r.orig_title, ...(r.aliases||[]), r.version, r.author, ...(r.tags||[]), ...(r.play_tags||[]), ...(r.types||[]),
      r.platform, r.translation, r.category, r.sheet, r.raw_title, r.raw_tags, ...(r.perks||[]), ...(r.cheats||[])].filter(Boolean).join(' ');
  }
  // 搜索不区分全角半角、片假名平假名、大小写、空格和常见符号；还能用拼音全拼或首字母（母版导出时算好的 search_py）
  // 规则和母版（00-core.js）里的 normalizeSearch 一致
  function normalizeSearch(s) {
    return String(s || '').normalize('NFKC').replace(/./gu,c=>window.JiyeSearchMap?.[c]||c).toLocaleLowerCase()
      .replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s\u3000・·•〜～~\-_—–:：;；,，.。!！?？'"“”‘’「」『』【】\[\]()（）<>《》\/\\|♡☆★♪]+/g, '');
  }
  const searchIndex = new Map(data.map(r => [r.id, normalizeSearch(searchBlob(r)) + ' ' + (r.search_py || '')]));
  const notesIndex = new Map(data.map(r => [r.id, normalizeSearch(r.notes)]));
  function nav() {
    const zones = ['all', ...new Set(sourceData.map(r => r.zone)), 'favorites'];
    const hiddenTotal = data.filter(r => blockReason(r)).length;
    const markZones = ['want', 'played', ...(hiddenTotal || state.zone === 'hidden' ? ['hidden'] : [])];
    $('navigation').innerHTML = [...zones, ...markZones].map(zone => {
      const count = zone==='all' ? data.length : zone==='favorites' ? favorites.size : zone==='hidden' ? hiddenTotal : MARKS[zone] ? Object.values(marks).filter(m => m === zone).length : data.filter(r => (r.category_zones||[r.zone]).includes(zone)).length;
      const active = zone===state.zone;
      const icon=meta.ui_config?.category_icons?.[zoneNames[zone]] || zoneIcons[zone] || '▦';
      return `${zone==='want'?'<span class="nav-sub">我的标记</span>':''}<button data-zone="${esc(zone)}" class="nav-item ${active?'active':''}" ${active?'aria-current="page"':''}><span aria-hidden="true" class="${meta.ui_config?.recommended_sections?.includes(zoneNames[zone])?'recommend-icon':''}">${esc(icon)}</span>${esc(zoneNames[zone]||zone)}<b>${count}</b></button>`;
    }).join('');
    $('mbar').innerHTML=window.JiyeReaderMobile.nav({zone:state.zone,favorites:favorites.size,take:takeList.size,downloads:meta.modules?.downloads===true});
    renderCalendar();
    $('pendingFav').textContent = '待匹配收藏 · '+pendingFavorites.length;
    $('total').textContent = data.length;
    $('crumb').textContent = zoneNames[state.zone] || '全部条目';
  }
  var langCounts = new Map(), langBaseTotal = 0, hiddenNow = 0;
  // 按用户提供的批次字段分组，不从名称推断文件夹路径。
  const batchKey = r => r.category_raw || r.category || r.date || '其他';
  const batchDate = new Map();
  for (const r of data) { const k = batchKey(r), d = r.date || ''; if (d > (batchDate.get(k) || '')) batchDate.set(k, d); }
  const folderOf = r => String(r.resource_folder || r.quark_real_path || '');
  const collectionOf = r => collectionByUrl.get(r.quark_url) || collectionByUrl.get(r.baidu_url) || null;
  const quarkFolderUrl = r => safeUrl(r.resource_folder_url || '');
  // 按日期：每月一张小日历，默认只展开最近一个月；颜色越深当天收录越多，点日子跳过去，也能「只看这个月」
  var openMonths = new Set();
  function renderCalendar() {
    const pool = data.filter(r => state.zone === 'favorites' ? favorites.has(r.id) : state.zone === 'hidden' ? blockReason(r) : MARKS[state.zone] ? marks[r.id] === state.zone : state.zone === 'all' || (r.category_zones || [r.zone]).includes(state.zone));
    const days = new Map(), totals = new Map();
    for (const r of pool) {
      const d = String(r.date || '');
      if (/^\d{4}-\d{2}/.test(d)) totals.set(d.slice(0, 7), (totals.get(d.slice(0, 7)) || 0) + 1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) days.set(d, (days.get(d) || 0) + 1);
    }
    const ms = [...totals.keys()].sort().reverse(), picked = state.month.split('\u001f').filter(Boolean);
    if (!openMonths.size && ms[0]) openMonths.add(ms[0]);
    $('calendar').innerHTML = ms.map(m => {
      const [y, mo] = m.split('-').map(Number), open = openMonths.has(m);
      let cells = '';
      if (open) {
        cells = [...'日一二三四五六'].map(w => `<span class="cal-week">${w}</span>`).join('') + '<i></i>'.repeat(new Date(y, mo - 1, 1).getDay());
        for (let d = 1, last = new Date(y, mo, 0).getDate(); d <= last; d++) {
          const key = `${m}-${String(d).padStart(2, '0')}`, c = days.get(key) || 0;
          cells += c ? `<button class="d ${c >= 20 ? 'h3' : c >= 10 ? 'h2' : 'h1'}" data-day="${key}" title="${mo} 月 ${d} 日 · ${c} 部" aria-label="跳到 ${mo} 月 ${d} 日，${c} 部">${d}</button>` : `<i>${d}</i>`;
        }
      }
      return `<div class="mon${open ? ' open' : ''}"><button class="mon-h${picked.includes(m) ? ' on' : ''}" data-mon="${m}" aria-expanded="${open}">${String(y) !== dataYear ? y + ' 年 ' : ''}${mo} 月<span>${totals.get(m)} 部 ${open ? '▴' : '▾'}</span></button>${open ? `<div class="cal-grid">${cells}<button class="secondary cal-only" data-mon-only="${m}">${picked.includes(m) ? '看全部日期' : '只看这个月'}</button></div>` : ''}</div>`;
    }).join('') || '<p class="muted small">这个分区没有收录日期。</p>';
  }
  // 现在的筛选写进网址 # 后面：收藏成书签、或者刷新页面，打开还是这一组筛选；也用于「常用筛选」
  var SNAP = {query:'', zone:'all', genre:'', platform:'', translation:'', tag:'', month:'', author:'', updated:false, cheat:false, save:false, uncensored:false, extraMarkers:'', onlyFavorites:false, unseen:false, sort:'recent'};
  function snapshot() { const o = {}; for (const [k, d] of Object.entries(SNAP)) if (state[k] !== d) o[k] = state[k]; return o; }
  function restoreSnapshot(o) {
    for (const [k, d] of Object.entries(SNAP)) { const v = o[k]; state[k] = typeof d === 'boolean' ? (v === true || v === '1') : typeof v === 'string' ? v : d; }
    if (!zoneNames[state.zone]) state.zone = 'all';
    if (![...$('sort').options].some(o => o.value === state.sort)) state.sort = 'recent';
    $('search').value = state.query; $('sort').value = state.sort;
    for (const [id, k] of [['onlyUpdated','updated'],['onlyCheats','cheat'],['onlySaves','save'],['onlyUncensored','uncensored'],['onlyFavorites','onlyFavorites']]) $(id).checked = state[k];
    for (const input of document.querySelectorAll('[data-extra-marker]')) input.checked = state.extraMarkers.split('\u001f').includes(input.dataset.extraMarker);
    state.page = 1;
  }
  function writeHash() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(snapshot())) p.set(k, v === true ? '1' : v);
    const h = p.toString();
    if (h ? location.hash !== '#' + h : location.hash.includes('=')) try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch {}
  }
  const readHash = () => location.hash.includes('=') ? Object.fromEntries(new URLSearchParams(location.hash.slice(1))) : null;
  addEventListener('hashchange', () => { const o = readHash(); if (o) { restoreSnapshot(o); apply(); } });
  function savePreset() {
    const auto = [...$('activeFilters').querySelectorAll('[data-clear-filter]')].map(b => b.textContent.replace(/×\s*$/, '').replace(/^[^：]*：/, '').trim()).join(' · ');
    const name0 = (state.zone !== 'all' ? zoneNames[state.zone] + ' · ' : '') + auto;
    modal('存为常用筛选', `<p>以后在顶栏「常用」里一点就套用这一组：${esc(name0)}</p><label for="presetName">名字</label><input id="presetName" class="text-input" maxlength="30" value="${esc(name0.slice(0, 30))}"><div class="detail-actions"><button class="primary" id="presetOk">保存</button></div>`, '常用筛选');
    $('presetName').select();
    const ok = () => { const name = $('presetName').value.trim() || name0.slice(0, 30); presets.push({name, state: snapshot()}); persist(); $('modal').close(); render(); toast(`已存为常用：${name}`); };
    $('presetOk').onclick = ok; $('presetName').onkeydown = e => { if (e.key === 'Enter') ok(); };
  }
  function apply() {
    const tokens = state.query.trim().split(/\s+/).map(normalizeSearch).filter(Boolean);
    hiddenNow = 0;
    filtered = data.filter(r => {
      if (state.zone==='favorites' ? !favorites.has(r.id) : state.zone==='hidden' ? !blockReason(r) : MARKS[state.zone] ? marks[r.id]!==state.zone : (state.zone!=='all' && !(r.category_zones||[r.zone]).includes(state.zone))) return false;
      if (state.zone!=='hidden' && !state.showHidden && blockReason(r)) { hiddenNow++; return false; }
      if (state.unseen && viewed.has(r.id)) return false;
      if (field('genre').visible && state.genre && !state.genre.split('\u001f').includes(r.genre)) return false;
      if (field('platform').visible && state.platform && !state.platform.split('\u001f').some(v=>(r.platform||'').includes(v))) return false;
      if (state.tag && !state.tag.split('\u001f').every(v=>hasTag(r,v))) return false;
      if (state.month && !state.month.split('\u001f').some(v=>(r.date||'').startsWith(v) || r.month_batch===v)) return false;
      if (field('author').visible && state.author && !state.author.split('\u001f').includes(r.author)) return false;
      if (state.updated && !r.updated) return false;
      if (state.onlyFavorites && !favorites.has(r.id)) return false;
      if (state.cheat && !markerMatches(r, extraMarkers.find(item => item.key === 'cheat') || {key:'cheat', tag:'补充信息'})) return false;
      if (state.save && !markerMatches(r, extraMarkers.find(item => item.key === 'save') || {tag:'附加文件'})) return false;
      if (state.uncensored && !markerMatches(r, extraMarkers.find(item => item.key === 'uncensored') || {tag:'扩展内容'})) return false;
      if (state.extraMarkers && !state.extraMarkers.split('\u001f').every(key => {const marker = extraMarkers.find(item => item.key === key);return !marker || markerMatches(r, marker);})) return false;
      if (tokens.length && !tokens.every(t => searchIndex.get(r.id).includes(t) || (state.searchNotes && notesIndex.get(r.id).includes(t)))) return false;
      if (state.onlyNew === 'taken' && !takenUpdates().some(x=>x.id===r.id)) return false;
      if (state.onlyNew === 'since' && !sinceIds.has(r.id)) return false;
      if (state.onlyNew === 'edition' && !editionIds.has(r.id)) return false;
      return true;
    });
    // 语言最后筛：上面「语言」一排的数量按其余条件算，点哪一个都知道会剩几部
    langCounts = new Map();
    for (const r of filtered) langCounts.set(langGroup(r), (langCounts.get(langGroup(r)) || 0) + 1);
    langBaseTotal = filtered.length;
    if (field('translation').visible && state.translation) { const picked = state.translation.split('\u001f'); filtered = filtered.filter(r => picked.includes(langGroup(r))); }
    filtered.sort((a,b) => {
      if (state.sort==='row') return compareRowOrder(a,b,state.zone);
      if (state.sort==='name') return a.name.localeCompare(b.name,'zh-CN');
      // 最近更新：有更新的按更新日期（同一天再按版本发布日期）排在前面，没更新的按收录日期排在后面
      if (state.sort==='updated') {
        if (!a.updated !== !b.updated) return a.updated ? -1 : 1;
        return (b.date || '').localeCompare(a.date || '') || String(b.version_date || '').localeCompare(String(a.version_date || '')) || compareRowOrder(a,b,state.zone);
      }
      if (state.sort==='code') return String(a.code).localeCompare(String(b.code),'zh-CN', {numeric:true});
      if (state.sort==='size' || state.sort==='size-desc') {
        // 没填大小的排在最后
        if (!a.size !== !b.size) return a.size ? -1 : 1;
        return state.sort==='size' ? (a.size||0) - (b.size||0) : (b.size||0) - (a.size||0);
      }
      // 最近收录：新批次在前，没有日期的批次放在最后。
      const ka = batchKey(a), kb = batchKey(b);
      if (ka !== kb) return (batchDate.get(kb) || '').localeCompare(batchDate.get(ka) || '') || ka.localeCompare(kb, 'zh-CN', {numeric:true});
      const da = a.date || '', db = b.date || '';
      if (da !== db) return db.localeCompare(da);
      // 同一天的按表格里的先后（就是录入时的顺序）
      return compareRowOrder(a,b,state.zone);
    });
    state.page = Math.min(Math.max(state.page,1), Math.max(1, Math.ceil(filtered.length/state.size)));
    render();
    writeHash();
  }
  // Download URLs are only exposed when the catalog owner enables the module.
  const directUrl = r => meta.modules?.downloads===true && field('quark_url').visible && r.quark_location_status==='matched' ? safeUrl(r.quark_location_url) : '';
  function linksHtml(r, withTake = true) {
    const links=downloadLinks(r);
    return `<div class="card-links">${links.map(l=>`<a class="disk" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}${withTake&&links.length?`<button class="take${takeList.has(r.id)?' in':''}" data-take="${esc(r.id)}" aria-pressed="${takeList.has(r.id)}">${takeList.has(r.id)?'✓ 清单':'＋ 清单'}</button>`:''}</div>`;
  }
  function resourceHint(r) {return downloadLinks(r).length?`<div class="resource-hint">${esc(folderOf(r)||'打开下载链接后按编号查找')} <b>${esc(r.code)}</b></div>`:'';}
  function findNote(r) {return [r.name,`编号：${r.code}`,r.version&&`版本：${r.version}`,...downloadLinks(r).map(l=>`${l.label}：${l.url}`),folderOf(r)].filter(Boolean).join('\n');}
  function catalogDate(r) {
    const match=String(r.date||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[1].slice(-2)+'年'+Number(match[2])+'/'+match[3] : (r.date_short||'');
  }
  function identityButton(r, detail=false) {
    return `<button class="catalog-identity" ${detail?'id="detailIdentity"':''} data-copy="${esc(r.code)}" title="点击复制编号" aria-label="复制编号 ${esc(r.code)}"><span class="catalog-date">${esc(catalogDate(r))}</span><strong>${esc(r.code)}</strong><span class="copy-hint">点击复制</span></button>`;
  }
  // 名称常是「中文名 / 别名 ～副标题～ 日文名 英文名」：列表里中文名用大字，其余放下面一行小字（搜索照旧按全名）
  var KANA_RE = /[\u3040-\u30ff]/, HAN_RE = /[\u4e00-\u9fff]/;
  function splitTitle(name) {
    const full = String(name || '').replace(/^更新\s*/, '').trim();
    const words = full.split(/\s+/);
    if (!words.some(w => HAN_RE.test(w) && !KANA_RE.test(w))) return {main: full, sub: ''};
    let i = 1;
    while (i < words.length && !KANA_RE.test(words[i]) && !/^[A-Za-z0-9][A-Za-z0-9 .:'’!?&+-]*$/.test(words[i])) i++;
    let main = words.slice(0, i).join(' '), sub = words.slice(i).join(' ');
    const alt = main.match(/^([^\/／]{2,})[\/／](.+)$/);   // 「名称/别名」：第一个写法当主名，其余算别名
    if (alt) { main = alt[1]; sub = (alt[2] + ' ' + sub).trim(); }
    main = main.replace(/[\s\-–—~～:：]+$/, '');
    return main ? {main, sub} : {main: full, sub: ''};
  }
  // 一部条目一行：封面（左上角语言章）· 名称和别名 · 语言 / 类型 / 平台 / 版本 / 少量标签 / 推荐章 · 右边编号、收藏、对比、加入清单
  var CARD_TAGS = 3;
  const sheetStamps = r => (r.category_sheets || [r.sheet]).filter(s => /推荐/.test(s || '')).map(s => `<span class="stamp${/网友/.test(s) ? ' net' : ''}">${esc(s)}</span>`).join('');
  function card(r) {
    if (state.view === 'grid') return tileHtml(r);
    const fav = favorites.has(r.id), title = splitTitle(r.name), taken = takeList.has(r.id), direct = directUrl(r), code = esc(r.code);
    const tags = [...recordTags(r)];
    const shown = tags.slice(0, CARD_TAGS), more = tags.length - shown.length;
    // 不按批次排的时候没有批次标题，日期写在这一行里
    const meta3 = [fieldValue(r,'genre'), fieldValue(r,'platform')].filter(Boolean).map(v => `<span class="sep">·</span><span>${esc(v)}</span>`).join('')
      + (r.version ? `<span class="sep">·</span><button class="ver" data-copy="${esc(r.version)}" title="点一下复制版本号">${esc(r.version.slice(0, 36))}</button>` : '')
      + (sizeText(r) ? `<span class="sep">·</span><span>${esc(sizeText(r))}</span>` : '') + (!byMonth() && r.date ? `<span class="sep">·</span><span>${esc(catalogDate(r))}</span>` : '');
    const sources = cardSourceLinks(r).replace('class="card-source-links"', 'class="card-source-links mini"');
    const mark = marks[r.id];
    return `<article class="row${taken ? ' picked' : ''}${viewed.has(r.id) ? ' seen' : ''}" data-id="${esc(r.id)}" data-detail="${esc(r.id)}">
      ${thumbHtml(r)}
      <div class="info">
        <div class="t1">${state.view === 'compact' ? langStamp(r) : ''}${sinceIds.has(r.id) ? '<span class="badge new-badge" title="你上次来之后新增或更新">新</span>' : ''}${r.updated ? '<span class="badge upd">更新</span>' : ''}<button class="title-button name" data-detail="${esc(r.id)}" title="${esc(r.name.replace(/^更新\s*/, ''))}">${esc(title.main)}</button>${mark ? `<span class="badge mark-${mark}">${MARKS[mark]}</span>` : ''}${blockReason(r) && mark !== 'hidden' ? `<span class="badge mark-hidden">${blockReason(r)}</span>` : ''}</div>
        ${title.sub ? `<div class="alt" title="${esc(title.sub)}">${esc(title.sub)}</div>` : ''}
        ${updateLine(r)}
        <div class="t3"><span class="k">${field("translation").visible?esc(langOf(r)):""}</span>${meta3}
          ${shown.map(t => `<button class="tag" data-filter-tag="${esc(t)}" title="只看「${esc(t)}」">${esc(t)}</button>`).join('')}${more > 0 ? `<span class="tag tag-more" title="还有 ${more} 个标签，点开详情看">+${more}</span>` : ''}${sheetStamps(r)}${fieldValue(r,'author') ? `<span class="sep">·</span><span class="author">${esc(r.author)}</span>` : ''}${sources}</div>
        ${r.notes && !r.update_summary ? `<div class="row-note" title="${esc(r.notes)}">${esc(r.notes.replace(/\s+/g, ' ').slice(0, 160))}</div>` : ''}
        ${r.quark_location_status === 'ambiguous' ? '<div class="row-note warn">合集里有同名文件夹，下载前核对版本</div>' : ''}
      </div>
      <div class="act">
        <div class="act-top"><label class="compare-check" title="选几部一起并排看"><input type="checkbox" data-compare="${esc(r.id)}" ${state.compare.has(r.id) ? 'checked' : ''}>对比</label>
          <button class="fav-mini${fav ? ' saved' : ''}" data-fav="${esc(r.id)}" aria-label="${fav ? '取消收藏' : '收藏'}：${esc(title.main)}" aria-pressed="${fav}">${fav ? '♥' : '♡'}</button>
          <button class="code" data-copy="${code}" title="点一下复制编号" aria-label="复制编号 ${code}">${code}</button></div>
        <div class="act-bottom">${linksHtml(r)}</div>
      </div>
    </article>`;
  }
  // 封面墙：只看封面和名字，点开看详情
  function tileHtml(r) {
    const title=splitTitle(r.name),fav=favorites.has(r.id);
    return `<article class="tile${viewed.has(r.id)?' seen':''}" data-id="${esc(r.id)}" data-detail="${esc(r.id)}">${thumbHtml(r)}<div class="tile-caption"><div class="tile-name">${esc(title.main)}</div><div class="tile-meta"><button class="code" data-copy="${esc(r.code)}">${esc(r.code)}</button><button class="fav-mini${fav?' saved':''}" data-fav="${esc(r.id)}" aria-label="收藏 ${esc(r.name)}">${fav?'♥':'♡'}</button></div>${linksHtml(r)}</div></article>`;
  }
  // 批次标题：日期、数量、明确提供的位置和可选下载入口。
  var batchCounts = new Map(), batchIndex = new Map();
  data.forEach(r => { if (!batchIndex.has(batchKey(r))) batchIndex.set(batchKey(r), batchIndex.size); });
  const dataYear = String(meta.update_date || '').slice(0, 4);
  function batchHead(r) {
    const k=batchKey(r),info=batchCounts.get(k)||{n:0,upd:0},col=collectionOf(r),path=[col?.label,folderOf(r)].filter(Boolean).join(' › ');
    const label=/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')?r.date.slice(5).replace('-','.'):k;
    return `<div class="batch-head" id="batch-${batchIndex.get(k)}"><div class="bdate" title="${esc(k)}">${esc(label)}</div><div class="bmeta"><span>${info.n} 条${info.upd?` · 更新 ${info.upd}`:''}</span>${path?`<span class="path" title="${esc(path)}">${esc(path)}</span>`:''}</div><div class="batch-actions">${linksHtml(r,false)}${meta.modules?.downloads===true?`<button class="secondary sm" data-take-batch="${esc(k)}">＋ 这一批</button>`:''}</div></div>`;
  }
  function cancelCardRender() {
    renderToken++;
    if (renderObserver) { renderObserver.disconnect(); renderObserver = null; }
    if (renderIdle !== null) {
      if ('cancelIdleCallback' in window) cancelIdleCallback(renderIdle);
      clearTimeout(renderIdle);
      renderIdle = null;
    }
  }
  // 按批次浏览：「最近收录」排序时，每到一个新批次插一个批次标题；左边日历和手机上的月份条可以直接跳过去
  function monthKey(r) { return String(r.date || '').slice(0, 7); }
  function byMonth() { return state.sort === 'recent'; }
  var monthCounts = new Map();
  function cardsHtml(list, prev) {
    if (!byMonth()) return list.map(card).join('');
    let last = prev ? batchKey(prev) : null;
    return list.map(r => {
      const k = batchKey(r), head = k !== last ? batchHead(r) : '';
      last = k;
      return head + card(r);
    }).join('');
  }
  function renderMonthJump() {
    const months = [...monthCounts.keys()];
    $('monthJump').hidden = !byMonth() || months.length < 2;
    if ($('monthJump').hidden) return;
    $('monthJump').innerHTML = '<span class="month-jump-label">跳到</span>' + months.map(m => `<button data-jump-month="${m || 'none'}">${m ? `${Number(m.slice(5))} 月` : '无日期'}<span>${monthCounts.get(m)}</span></button>`).join('');
  }
  function jumpToRecord(idx) {
    if (idx < 0) return false;
    // 「全部展示」时条目平时是边滚边画的；跳过去时一次画完，才能直接跳到后面的批次
    if (state.size === 99999) { renderAllOnce = true; render(); }
    else {state.page=Math.floor(idx/state.size)+1;renderAllOnce=true;render();}
    const id = filtered[idx].id;
    const go = () => {
      let el = $('results').querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (el && el.previousElementSibling?.classList.contains('batch-head')) el = el.previousElementSibling;
      el?.scrollIntoView({block: 'start'});
    };
    requestAnimationFrame(() => { go(); setTimeout(go, 250); });
    return true;
  }
  function jumpToMonth(m) { jumpToRecord(filtered.findIndex(r => monthKey(r) === (m === 'none' ? '' : m))); }
  function jumpToDay(day) { if (!jumpToRecord(filtered.findIndex(r => r.date === day))) toast('这一天的条目被现在的筛选条件筛掉了'); }
  var renderAllOnce = false, renderedSignature='', renderedCount=0;
  function renderCards(begin, end) {
    const mount = $('results');
    cancelCardRender();
    const items = filtered.slice(begin);
    monthCounts = new Map(); batchCounts = new Map();
    for (const r of filtered) {
      monthCounts.set(monthKey(r), (monthCounts.get(monthKey(r)) || 0) + 1);
      const b = batchCounts.get(batchKey(r)) || {n: 0, upd: 0}; b.n++; if (r.updated) b.upd++; batchCounts.set(batchKey(r), b);
    }
    renderMonthJump();
    if (items.length <= 48 || renderAllOnce) {
      renderAllOnce = false;
      mount.innerHTML = cardsHtml(items, filtered[begin - 1]);
      return;
    }
    const signature=state.view+'|'+begin+'|'+filtered.map(r=>r.id).join('\u001f');
    const initialCount=signature===renderedSignature?Math.max(48,renderedCount):48;renderedSignature=signature;renderedCount=0;
    const token = renderToken;
    let cursor = 0;
    mount.innerHTML = '';
    const sentinel = document.createElement('div');
    sentinel.className = 'render-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    mount.append(sentinel);
    const appendChunk = () => {
      if (token !== renderToken) return;
      const next = Math.min(cursor + (cursor?48:initialCount), items.length);
      sentinel.insertAdjacentHTML('beforebegin', cardsHtml(items.slice(cursor, next), cursor ? items[cursor - 1] : filtered[begin - 1]));
      cursor = next;renderedCount=cursor;
      $('pageInfo').textContent=`已显示 ${begin+1}–${begin+cursor} / ${filtered.length}${cursor<items.length?' · 往下滑继续加载':''}`;
      if (cursor >= items.length) {
        sentinel.remove();
        if (renderObserver) { renderObserver.disconnect(); renderObserver = null; }
      }
    };
    const schedule = () => {
      if (token !== renderToken || cursor >= items.length || renderIdle !== null) return;
      const run = () => {
        renderIdle = null;
        appendChunk();
        if (cursor < items.length && sentinel.isConnected && sentinel.getBoundingClientRect().top < window.innerHeight + 900) schedule();
      };
      renderIdle = 'requestIdleCallback' in window ? requestIdleCallback(run, {timeout:120}) : setTimeout(run, 16);
    };
    appendChunk();
    if (cursor < items.length) {
      if ('IntersectionObserver' in window) {
        renderObserver = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) schedule();
        }, {rootMargin:'900px'});
        renderObserver.observe(sentinel);
      } else {
        const loop = () => {
          if (token !== renderToken || cursor >= items.length) return;
          schedule();
          setTimeout(loop, 32);
        };
        loop();
      }
    }
  }
  function render() {
    nav();
    refreshCollectionTools();
    chips('genreChips', genres, 'genre');
    chips('platformChips', platforms, 'platform');
    renderTransSeg();
    for (const input of document.querySelectorAll('[data-extra-marker]')) input.checked = state.extraMarkers.split('\u001f').includes(input.dataset.extraMarker);
    chips('tagChips', topTags, 'tag');
    $('hotAuthors').innerHTML=['',...popularAuthors].map(author=>{const active=author?state.author.split('\u001f').includes(author):!state.author;return `<button class="chip${active?' active':''}" data-hot-author="${esc(author)}" aria-pressed="${active}">${esc(author||'全部')}${author?` <span class="author-count">${authorCounts.get(author)}</span>`:''}</button>`;}).join('');
    renderDiscoverySearch();
        const labels = {query:'搜索', genre:field('genre').label, platform:field('platform').label, translation:field('translation').label, tag:'标签', month:'月份', author:field('author').label, updated:'有更新',cheat:extraMarkers.find(item=>item.key==='cheat')?.label||'补充信息',save:extraMarkers.find(item=>item.key==='save')?.label||'附加文件',uncensored:extraMarkers.find(item=>item.key==='uncensored')?.label||'扩展内容',extraMarkers:'附加标记',onlyFavorites:'只看收藏',unseen:'没点开过的',onlyNew:state.onlyNew==='since'?'你上次来之后的新内容':'本期新增和更新'};
    const multiFields = ['genre','platform','translation','tag','month','author','extraMarkers'];
    const activeItems = [];
    for (const k of ['query','genre','platform','translation','tag','month','author','updated','cheat','save','uncensored','extraMarkers','onlyFavorites','unseen','onlyNew']) {
      if (!state[k]) continue;
      if (multiFields.includes(k)) {
        for (const v of String(state[k]).split('\u001f').filter(Boolean)) {
          activeItems.push({ field: k, value: v, text: `${labels[k]}：${esc(k === 'extraMarkers' ? extraMarkers.find(item=>item.key===v)?.label || v : v)}` });
        }
      } else if (k === 'query') {
        activeItems.push({ field: k, value: '', text: `${labels[k]}：${esc(state.query)}` });
      } else {
        activeItems.push({ field: k, value: '', text: labels[k] });
      }
    }
    const panelCount = activeItems.filter(item => !['query','translation','updated'].includes(item.field)).length;
    $('filterCount').textContent = panelCount; $('filterCount').hidden = !panelCount;
    $('activeFilters').innerHTML = (presets.length ? `<span class="preset-label">常用</span>${presets.map((p, i) => `<span class="preset${JSON.stringify(p.state) === JSON.stringify(snapshot()) ? ' on' : ''}"><button data-preset="${i}" title="套用这组筛选">☆ ${esc(p.name)}</button><button data-preset-del="${i}" aria-label="删除常用筛选 ${esc(p.name)}">×</button></span>`).join('')}${activeItems.length ? '<span class="preset-sep"></span>' : ''}` : '')
      + activeItems.map(item => `<button data-clear-filter="${item.field}"${item.value ? ` data-filter-val="${esc(item.value)}"` : ''} aria-label="移除${item.text}筛选">${item.text} <span>×</span></button>`).join('')
      + (activeItems.length && !presets.some(p => JSON.stringify(p.state) === JSON.stringify(snapshot())) ? '<button class="preset-save" data-preset-save title="以后在这里一点就能套用">☆ 存为常用</button>' : '')
      + (activeItems.length > 1 ? '<button class="preset-save" data-clear-all>全部清空</button>' : '');
    $('activeFilters').hidden = !activeItems.length && !presets.length;
    $('exportResults').disabled = !filtered.length;
    $('sectionTitle').innerHTML = `${esc(zoneNames[state.zone]||'全部条目')} <span id="resultCount">${filtered.length}</span>`;
    const begin = (state.page-1)*state.size, end = Math.min(begin+state.size, filtered.length);
    $('hiddenNote').innerHTML = hiddenNow || state.showHidden ? `<button class="text-button" id="toggleHidden">${state.showHidden ? '已显示不感兴趣和屏蔽的 · 收起' : `另有 ${hiddenNow} 部不感兴趣或屏蔽的没显示 · 显示`}</button>${blockedTags.size || blockedAuthors.size ? ' <button class="text-button" id="manageBlocked">管理屏蔽</button>' : ''}` : (blockedTags.size || blockedAuthors.size ? '<button class="text-button" id="manageBlocked">管理屏蔽</button>' : '');
    $('summary').textContent = filtered.length ? `${byMonth() ? `${new Set(filtered.map(batchKey)).size} 批 · 新收录的在前` : ''}` : '找到 0 件条目';
    $('results').className = state.view === 'grid' ? 'wall' : state.view === 'compact' ? 'rows compact' : 'rows';
    renderOverview();
    if ($('toggleAuthors')) syncAuthorRow();
    renderCards(begin, end);
    $('empty').hidden = !!filtered.length;
    $('results').hidden = !filtered.length;
    for (const [id, v] of [['listView','list'],['compactView','compact'],['gridView','grid']]) { $(id).classList.toggle('selected', state.view===v); $(id).setAttribute('aria-pressed', state.view===v); }
    const count = Math.max(1, Math.ceil(filtered.length/state.size));
    $('jumpPage').max = count; $('jumpPage').value = state.page;
    const first = Math.max(1, Math.min(state.page-2, count-4)), last = Math.min(count, first+4);
    $('pageInfo').textContent = `从第 ${state.page} 页开始 · 共 ${filtered.length} 条，往下滑继续加载`;
    $('pages').innerHTML = `<button data-page="${state.page-1}" aria-label="上一页" ${state.page===1?'disabled':''}>←</button>` +
      Array.from({length:last-first+1}, (_,i)=>first+i).map(p => `<button data-page="${p}" ${state.page===p?'class="active" aria-current="page"':''} aria-label="第 ${p} 页">${p}</button>`).join('') +
      `<button data-page="${state.page+1}" aria-label="下一页" ${state.page===count?'disabled':''}>→</button>`;
    if (kbId) $('results').querySelector(`[data-id="${CSS.escape(kbId)}"]`)?.classList.add('kb');
    updateCompare();
    updateTakeBar();
    syncSelectControls.forEach(sync=>sync());
  }
  // 概况：最新一批、本月、更新、你上次来之后、拿取清单。点一下就筛或跳过去（数字按全部条目算，不随筛选变）
  const latestDay = data.map(r => r.date || '').filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() || '';
  const latestMonth = latestDay.slice(0, 7);
  function renderOverview() {
    const dayN = data.filter(r => r.date === latestDay), monthN = data.filter(r => (r.date || '').startsWith(latestMonth)).length, updN = data.filter(r => r.updated).length;
    const tiles = [
      takenUpdates().length&&['taken','拿过的条目有更新',takenUpdates().length,'按已拿到时的版本比较','只看这些'],
      latestDay && ['day', '最新一批', `${Number(latestDay.slice(5, 7))}/${Number(latestDay.slice(8))}`, `${dayN.length} 部 · 更新 ${dayN.filter(r => r.updated).length}`, '跳到最新一批'],
      latestMonth && ['month', `${Number(latestMonth.slice(5))} 月收录`, monthN, state.month === latestMonth ? '正在只看这个月' : '点一下只看这个月', '只看这个月'],
      ['updated', '有更新的条目', updN, state.updated ? '正在只看更新' : '点一下只看更新', '只看有更新的'],
      sinceInfo && (sinceInfo.added || sinceInfo.updated) && ['since', '你上次来之后', sinceInfo.added + sinceInfo.updated, `新增 ${sinceInfo.added} · 更新 ${sinceInfo.updated}`, '只看这些'],
      ['unseen', '没点开过的', data.filter(r => !viewed.has(r.id) && !blockReason(r)).length, state.unseen ? '正在只看这些' : viewed.size ? `已看过 ${viewed.size} 部` : '点开过的会记下来', '只看没点开过的'],
      meta.modules?.downloads===true&&['take', '拿取清单', takeList.size, takenDone.size ? `已拿到 ${takenDone.size}` : takeList.size ? '点开看怎么下载' : '还没加条目', '打开拿取清单'],
    ].filter(Boolean);
    const on = {month: state.month === latestMonth, updated: state.updated, since: state.onlyNew === 'since', unseen: state.unseen};
    const latest=RC.url(meta.latest_catalog_url);
    $('overview').innerHTML = (latest?`<a class="ov catalog-age" href="${esc(latest)}" target="_blank" rel="noopener noreferrer"><small>这份表 ${esc(meta.update_date||'未标注日期')}</small><b>查新表 ↗</b><span>打开你配置的最新版链接</span></a>`:'') + tiles.map(([k, label, num, sub, tip]) => `<button class="ov${on[k] ? ' on' : ''}" data-ov="${k}" title="${esc(tip)}"><small>${esc(label)}</small><b>${esc(num)}</b><span>${esc(sub)}</span></button>`).join('');
  }
  function renderTransSeg() {
    $('transSeg').hidden=!field('translation').visible;
    const picked=state.translation.split('\u001f');
    $('transSeg').innerHTML=`<button data-translation="" class="${state.translation?'':'on'}">全部${esc(field('translation').label)} <small>${langBaseTotal}</small></button>`+configuredVersions.map(v=>`<button data-translation="${esc(v.name)}" class="${picked.includes(v.name)?'on':''}"><i class="ldot" style="background:${v.color}"></i>${esc(v.name)} <small>${langCounts.get(v.name)||0}</small></button>`).join('');
  }
  function updateCompare() {
    $('compareBar').hidden = !state.compare.size;
    $('compareCount').textContent = state.compare.size;
    $('compareNames').innerHTML = [...state.compare].map(id => `<button data-remove="${esc(id)}" aria-label="移除对比：${esc(byId.get(id).name)}">${esc(byId.get(id).name)} ×</button>`).join('');
    $('compareOpen').disabled = state.compare.size < 2;
  }
  function toggleFavorite(id) {
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    persist(); apply();
    toast(favorites.has(id) ? '已加入我的收藏' : '已取消收藏');
  }
  // 更新的条目：名称下一行「10/24 更新：补充了修订说明」
  function updateLine(r) {
    if (!r.updated || !(r.update_summary || r.date_short)) return '';
    return `<div class="update-line">↻ ${esc(r.date_short || '')} 更新${r.update_summary ? '：' + esc(r.update_summary) : ''}</div>`;
  }
  // 这部条目上了哪些榜：详情里列出来，点一下打开那个榜单
  function rankHtml(r) {
    const list = Array.isArray(meta.rankings) ? meta.rankings.filter(x => x && Array.isArray(x.tiers)) : [];
    const hits = [];
    list.forEach((rk, index) => rk.tiers.forEach(t => (t.items || []).forEach(it => { if (it.id === r.id) hits.push({index, rk, tier: t.name, score: it.score, note: it.note}); })));
    return hits.length ? `<div class="detail-ranks"><b>上榜</b>${hits.map(h => `<button class="chip" data-open-rank="${h.index}">${esc(h.rk.title || '精选名单')} · ${esc(h.tier)}${h.score !== undefined && h.score !== '' ? ' · ' + esc(h.score) : ''}</button>${h.note ? `<span class="muted">${esc(h.note)}</span>` : ''}`).join('')}</div>` : '';
  }
  // 目录里同一部条目的其他版本：主名（去掉「更新」、别名、版本号）相同的卡
  const versionKey = r => normalizeSearch(splitTitle(r.name).main);
  const versionGroups = new Map();
  for (const r of data) { const k = versionKey(r); if (k.length < 2) continue; if (!versionGroups.has(k)) versionGroups.set(k, []); versionGroups.get(k).push(r); }
  const otherVersions = r => (versionGroups.get(versionKey(r)) || []).filter(o => o !== r).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const locationText=r=>[collectionOf(r)?.label,folderOf(r)].filter(Boolean).join(' › ');
  function detail(id) {
    const r = byId.get(id); if (!r) return;
    if (!viewed.has(r.id)) { viewed.add(r.id); persist(); $('results').querySelector(`[data-id="${CSS.escape(r.id)}"]`)?.classList.add('seen'); }
    detailId = r.id;
    const title = splitTitle(r.name), others = otherVersions(r), taken = takeList.has(r.id), fav = favorites.has(r.id);
    const kv = [['资料编号', esc(RC.sourceIds(r).join(' · '))], ['网盘位置', locationText(r) ? `${esc(locationText(r))} › <b class="mono">${esc(r.code)}</b>` : ''], [field('translation').label, field('translation').visible?esc(langOf(r)):''], ['版本', esc(r.version)],
      [field('genre').label,esc(fieldValue(r,'genre'))],[field('platform').label,esc(fieldValue(r,'platform'))],[field('author').label,esc(fieldValue(r,'author'))], ['大小', esc(sizeText(r))],
      [r.updated ? '更新日期' : '收录日期', esc(r.date_label || r.date)], ['版本发布', esc(r.version_date)],
      ['分区', esc((r.category_sheets || [r.sheet]).join(' · '))], ['附带', esc([...(r.perks || []), ...((r.cheats || []).length ? ['补充信息'] : [])].join(' · '))],
      ['标签', [...recordTags(r)].map(t => `<button class="tag" data-filter-tag="${esc(t)}">${esc(t)}</button>`).join('')]].filter(([, v]) => v);
    const vrow = (o, me) => `<tr class="${me ? 'me' : ''}"><td class="mono">${esc(o.code)}</td><td>${esc(o.version || '—')}</td><td>${esc(langOf(o))}</td><td>${esc(o.date || batchKey(o))}</td><td>${me ? '这一部' : `<button class="secondary sm" data-detail-open="${esc(o.id)}">看</button>`}</td></tr>`;
    modal(title.main, `${title.sub ? `<div class="alts">${esc(title.sub)}</div>` : ''}
      <div class="detail-actions top">
        ${downloadLinks(r).length ? `<button class="take${taken ? ' in' : ''}" data-take="${esc(r.id)}" aria-pressed="${taken}">${taken ? '✓ 在拿取清单里' : '＋ 加入拿取清单'}</button>` : ''}
        <button class="secondary" id="detailFav" aria-pressed="${fav}">${fav ? '♥ 已收藏' : '♡ 收藏条目'}</button>
        <button class="secondary" id="detailCompare" aria-pressed="${state.compare.has(r.id)}">${state.compare.has(r.id) ? '✓ 已加入对比' : '加入对比'}</button>
      </div>
      <div class="mark-group" role="group" aria-label="我的标记">${Object.entries(MARKS).map(([k, label]) => `<button class="mark-btn mark-${k}${marks[r.id] === k ? ' on' : ''}" data-mark="${k}" aria-pressed="${marks[r.id] === k}">${{want: '☆', played: '✓', hidden: '⊘'}[k]} ${label}</button>`).join('')}
        <details class="block-menu"><summary>不想看这一类…</summary><p class="muted small">屏蔽后，带这个标签或这个作者的条目平时都不显示，可以在左边「不感兴趣」或列表上方的「管理屏蔽」里找回来。</p>
          <div class="card-tags">${fieldValue(r,'author') ? `<button class="chip" data-block-author="${esc(r.author)}">${blockedAuthors.has(r.author) ? '✓ 已屏蔽' : '屏蔽'}作者「${esc(r.author)}」</button>` : ''}${[...new Set([...(r.play_tags || []), ...(r.tags || [])])].filter(t => ![r.genre, r.platform, r.translation].includes(t)).map(t => `<button class="chip" data-block-tag="${esc(t)}">${blockedTags.has(t) ? '✓ ' : ''}${esc(t)}</button>`).join('')}</div></details></div>
      <div class="detail-identity">${identityButton(r,true)}</div>
      ${r.updated && r.update_summary ? `<h5>这次更新了什么</h5><div class="table-note">${esc(r.update_summary)}</div>` : ''}
      <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      ${rankHtml(r)}
      ${linksHtml(r, false)}
      ${resourceHint(r)}
      ${r.notes ? `<h5>备注 / 更新日志</h5><div class="table-note">${esc(r.notes)}</div>` : ''}
      ${others.length ? `<h5><span>目录里同一部条目的其他版本（${others.length}）</span><button class="secondary sm" id="compareVersions">并排对比全部版本</button></h5>
        <div class="table-wrap"><table class="vtable"><thead><tr><th>编号</th><th>版本</th><th>语言</th><th>收录</th><th></th></tr></thead><tbody>${vrow(r, true)}${others.map(o => vrow(o, false)).join('')}</tbody></table></div>` : ''}
      ${similarHtml(r, others)}
      ${extraDetail(r)}
      <div class="guide-block my-note"><label for="myNote"><b>我的备注</b>（只存在这个浏览器里）</label><textarea id="myNote" rows="3" maxlength="5000">${esc(notes[r.id]||'')}</textarea></div>
      <div class="detail-actions">
        <button class="secondary" id="copyCode">复制编号</button>
        <button class="secondary" id="copyFind">复制编号和查找说明</button>
      </div>`, '条目详情', {drawer: true, before: detailNav(r) + thumbHtml(r, 'hero-cover')});
    $('modalBody').querySelectorAll('[data-detail-step]').forEach(b => b.onclick = () => stepDetail(+b.dataset.detailStep));
    $('detailFav').onclick = () => { toggleFavorite(r.id); $('detailFav').textContent = favorites.has(r.id)?'♥ 已收藏':'♡ 收藏条目'; $('detailFav').setAttribute('aria-pressed', favorites.has(r.id)); };
    $('detailCompare').onclick = () => {
      if (!state.compare.has(r.id) && state.compare.size >= COMPARE_MAX) return toast(`最多同时对比 ${COMPARE_MAX} 部。`);
      state.compare.has(r.id) ? state.compare.delete(r.id) : state.compare.add(r.id);
      render(); detail(r.id);
    };
    $('modalBody').querySelectorAll('[data-mark]').forEach(b => b.onclick = () => setMark(r.id, b.dataset.mark));
    $('modalBody').querySelectorAll('[data-block-tag],[data-block-author]').forEach(b => b.onclick = () => {
      const tag = b.dataset.blockTag, author = b.dataset.blockAuthor, set = tag !== undefined ? blockedTags : blockedAuthors, v = tag !== undefined ? tag : author;
      set.has(v) ? set.delete(v) : set.add(v);
      persist(); apply(); toast(set.has(v) ? `已屏蔽「${v}」：这类条目平时不显示` : `已取消屏蔽「${v}」`);
      detail(r.id); $('modalBody').querySelector('.block-menu').open = true;
    });
    if ($('compareVersions')) $('compareVersions').onclick = () => openCompare([r, ...others], `${title.main} · 全部版本并排对比`);
    $('copyCode').onclick = () => copyText(r.code, '编号已复制');
    $('modalBody').querySelectorAll('[data-open-rank]').forEach(b => b.onclick = () => openRankings(+b.dataset.openRank));
    $('modalBody').querySelectorAll('[data-detail-open]').forEach(b => b.onclick = () => detail(b.dataset.detailOpen));
    $('copyFind').onclick = () => copyText(findNote(r), '编号和查找说明已复制');
    $('myNote').onchange = () => { const v = $('myNote').value.trim(); if (v) notes[r.id] = v.slice(0,5000); else delete notes[r.id]; persist(); toast('备注已保存在这个浏览器里'); };
  }
  var detailId = null;
  // 详情里翻上一部 / 下一部：按现在列表的顺序（键盘 ← →）
  function detailNav(r) {
    const i = filtered.findIndex(x => x.id === r.id);
    if (i < 0) return '';
    return `<div class="detail-nav"><button class="secondary sm" data-detail-step="-1" ${i ? '' : 'disabled'}>‹ 上一部</button><span class="muted small">第 ${i + 1} / ${filtered.length} 部 · 键盘 ← →</span><button class="secondary sm" data-detail-step="1" ${i < filtered.length - 1 ? '' : 'disabled'}>下一部 ›</button></div>`;
  }
  function stepDetail(d) {
    const i = filtered.findIndex(x => x.id === detailId), next = filtered[i + d];
    if (i < 0 || !next) return;
    detail(next.id);
    const row = $('results').querySelector(`[data-id="${CSS.escape(next.id)}"]`);
    if (row) row.scrollIntoView({block: 'nearest'}); else jumpToRecord(i + d);
  }
  // 推荐：同一个作者的其他条目，和标签最相近的条目（不算同一部条目的其他版本、不感兴趣和屏蔽的）
  function similarHtml(r, others) {
    const skip = new Set([r.id, ...others.map(o => o.id)]);
    const sameAll = field('author').visible && r.author ? data.filter(o => !skip.has(o.id) && o.author === r.author && !blockReason(o)).sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [], same = sameAll.slice(0, 8);
    const mine = new Set(r.play_tags || []);
    const near = mine.size ? data.filter(o => !skip.has(o.id) && o.author !== r.author && !blockReason(o))
      .map(o => [o, (o.play_tags || []).filter(t => mine.has(t)).length + (o.genre === r.genre ? 0.5 : 0)]).filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || (b[0].date || '').localeCompare(a[0].date || '')).slice(0, 8).map(([o]) => o) : [];
    const tiles = list => `<div class="mini-tiles">${list.map(o => `<button class="mini-tile${viewed.has(o.id) ? ' seen' : ''}" data-detail-open="${esc(o.id)}" title="${esc(o.name.replace(/^更新\s*/, ''))}">${thumbHtml(o)}<span>${esc(splitTitle(o.name).main)}</span></button>`).join('')}</div>`;
    return (same.length ? `<h5><span>同作者「${esc(r.author)}」的其他条目（${sameAll.length}）</span></h5>${tiles(same)}` : '')
      + (near.length ? `<h5><span>标签相近的条目</span><span class="muted">按共同标签多少排</span></h5>${tiles(near)}` : '');
  }
  function setMark(id, m) {
    const r = byId.get(id); if (!r) return;
    if (marks[r.id] === m) delete marks[r.id]; else marks[r.id] = m;
    persist(); apply();
    toast(marks[r.id] ? (m === 'hidden' ? '已标为不感兴趣：以后不显示，可以在左边「不感兴趣」里找回来' : `已标为「${MARKS[m]}」`) : '已去掉标记');
    if ($('modal').open && detailId === r.id) detail(r.id);
  }
  function openBlocked() {
    const list = [...[...blockedTags].map(t => ['tag', t]), ...[...blockedAuthors].map(a => ['author', a])];
    modal('管理屏蔽', list.length ? `<p>带这些标签或来自这些作者的条目平时不显示。点一下取消屏蔽。</p><div class="card-tags">${list.map(([k, v]) => `<button class="chip" data-unblock-${k}="${esc(v)}">${k === 'tag' ? '标签' : '作者'}：${esc(v)} ×</button>`).join('')}</div>` : '<p>还没有屏蔽任何标签或作者。在条目详情里点「不想看这一类…」可以屏蔽。</p>', '我的标记');
    $('modalBody').onclick = e => {
      const t = e.target.closest('[data-unblock-tag]'), a = e.target.closest('[data-unblock-author]');
      if (t) blockedTags.delete(t.dataset.unblockTag); else if (a) blockedAuthors.delete(a.dataset.unblockAuthor); else return;
      persist(); apply(); openBlocked();
    };
  }
  $('hiddenNote').onclick = e => {
    if (e.target.closest('#toggleHidden')) { state.showHidden = !state.showHidden; apply(); }
    else if (e.target.closest('#manageBlocked')) openBlocked();
  };
  function reset(all=false) {
    Object.assign(state, {query:'', genre:'', platform:'', translation:'', tag:'', month:'', author:'', updated:false, cheat:false, save:false, uncensored:false, extraMarkers:'', onlyFavorites:false, unseen:false, onlyNew:'', page:1});
    if (all) state.zone = 'all';
    $('search').value = ''; $('month').value = ''; $('author').value = ''; $('onlyUpdated').checked = false; ['onlyCheats','onlySaves','onlyUncensored','onlyFavorites'].forEach(id=>$(id).checked=false);
    $('inlineTagSearch').value='';$('inlineAuthorSearch').value='';
    apply();
  }
  function change(field, value) { state[field] = value; state.page = 1; apply(); }
  function menu(open) {
    $('sidebar').classList.toggle('open', open);
    $('scrim').hidden = !open;
    $('menuButton').setAttribute('aria-expanded', open);
    if (open) $('navigation').querySelector('button')?.focus();
  }
  $('menuButton').onclick = () => menu(!$('sidebar').classList.contains('open'));
  $('scrim').onclick = () => menu(false);
  $('navigation').onclick = e => {
    const b = e.target.closest('[data-zone]');
    if (!b) return;
    change('zone', b.dataset.zone);
    menu(false);
    $('navigation').querySelector(`[data-zone="${b.dataset.zone}"]`)?.focus({preventScroll:true});
  };
  // 搜索输入防抖：停顿 180 毫秒再筛选，不再每敲一个字就全部重算
  let searchTimer = null;
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => change('query', $('search').value), 180); renderSuggest(); });
  // 搜索联想：边打字边列出最像的条目（回车直接打开）和对得上的标签 / 作者（点一下改成按它筛选）
  const suggestBox = document.createElement('div');
  suggestBox.id = 'suggest'; suggestBox.className = 'suggest'; suggestBox.hidden = true; suggestBox.setAttribute('role', 'listbox');
  $('search').closest('.search-box').append(suggestBox);
  let sugItems = [], sugIndex = -1;
  function renderSuggest() {
    const q = $('search').value.trim(), tokens = q.split(/\s+/).map(normalizeSearch).filter(Boolean);
    if (!tokens.length || document.activeElement !== $('search')) { suggestBox.hidden = true; sugItems = []; return; }
    const first = tokens[0], score = r => (normalizeSearch(r.code) === first ? 4 : 0) + (normalizeSearch(splitTitle(r.name).main).startsWith(first) ? 2 : 0) + (normalizeSearch(r.name).includes(first) ? 1 : 0);
    const works = data.filter(r => tokens.every(t => searchIndex.get(r.id).includes(t))).map(r => [r, score(r)]).sort((a, b) => b[1] - a[1] || (b[0].date || '').localeCompare(a[0].date || '')).slice(0, 6).map(([r]) => r);
    const tagHits = tokens.length === 1 ? tagList.filter(t => normalizeSearch(t).includes(first)).slice(0, 5) : [];
    const authorHits = field('author').visible && tokens.length === 1 ? authors.filter(a => normalizeSearch(a).includes(first)).slice(0, 3) : [];
    sugItems = [...works.map(r => ({type: 'work', r})), ...tagHits.map(v => ({type: 'tag', v})), ...authorHits.map(v => ({type: 'author', v}))];
    sugIndex = -1;
    if (!sugItems.length) { suggestBox.innerHTML = '<p class="sug-empty">没有对得上的条目，换个写法试试（支持拼音首字母、日文、编号）</p>'; suggestBox.hidden = false; return; }
    let i = 0;
    const item = html => `<button type="button" class="sug" data-sug="${i++}">${html}</button>`;
    suggestBox.innerHTML = (works.length ? `<div class="sug-h">条目 · 回车打开</div>${works.map(r => item(`${langStamp(r)}<span class="sug-name">${esc(splitTitle(r.name).main)}</span><span class="mono muted">${esc(r.code)}</span>`)).join('')}` : '')
      + (tagHits.length ? `<div class="sug-h">按标签筛选</div><div class="sug-chips">${tagHits.map(v => item(`# ${esc(v)} <small>${tagCounts.get(v) || 0}</small>`)).join('')}</div>` : '')
      + (authorHits.length ? `<div class="sug-h">按作者筛选</div><div class="sug-chips">${authorHits.map(v => item(`${esc(v)} <small>${authorCounts.get(v) || 0}</small>`)).join('')}</div>` : '');
    suggestBox.hidden = false;
  }
  function chooseSuggest(i) {
    const it = sugItems[i]; if (!it) return;
    suggestBox.hidden = true;
    if (it.type === 'work') return detail(it.r.id);
    $('search').value = ''; state.query = '';
    toggleFilter(it.type, it.v);
  }
  suggestBox.addEventListener('mousedown', e => e.preventDefault());
  suggestBox.addEventListener('click', e => { const b = e.target.closest('[data-sug]'); if (b) chooseSuggest(+b.dataset.sug); });
  $('search').addEventListener('keydown', e => {
    if (suggestBox.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); const n = sugItems.length; if (!n) return;
      sugIndex = (sugIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      suggestBox.querySelectorAll('[data-sug]').forEach(b => b.classList.toggle('on', +b.dataset.sug === sugIndex));
    } else if (e.key === 'Enter') { e.preventDefault(); chooseSuggest(sugIndex >= 0 ? sugIndex : sugItems[0]?.type === 'work' ? 0 : -1); }
    else if (e.key === 'Escape') { suggestBox.hidden = true; }
  });
  $('search').addEventListener('focus', renderSuggest);
  $('search').addEventListener('blur', () => setTimeout(() => { suggestBox.hidden = true; }, 120));
  // 填了大小的条目不到三成时，「按大小排序」排出来基本是乱的，先不放出来
  if (data.filter(r => r.size).length < data.length * 0.3) $('sort').querySelectorAll('option[value^="size"]').forEach(o => o.remove());
  $('sort').value = state.sort;
  $('sort').onchange = () => change('sort', $('sort').value);
  // 「热门作者」一行默认收起（作者很分散，排第一的也只有十几部）；选了作者时保持展开
  var authorsOpen = false;
  function syncAuthorRow() {
    const open = authorsOpen || !!state.author;
    document.querySelector('.popular-authors').hidden = !field('author').visible||!open;
    $('toggleAuthors').textContent = open ? '收起作者 ↑' : '按作者筛选 ↓';
    $('toggleAuthors').setAttribute('aria-expanded', String(open));
  }
  $('toggleAuthors').onclick = () => { authorsOpen = !(authorsOpen || !!state.author); syncAuthorRow(); if (authorsOpen) $('inlineAuthorSearch')?.focus(); };
  $('monthJump').addEventListener('click', e => { const b = e.target.closest('[data-jump-month]'); if (b) jumpToMonth(b.dataset.jumpMonth); });
  var autoUpdSort = false;
  $('onlyUpdated').onchange = () => {
    const on = $('onlyUpdated').checked;
    if (on && state.sort === 'recent') { state.sort = 'updated'; autoUpdSort = true; toast('只看更新：已改成按更新日期排，新更新的在前'); }
    else if (!on && autoUpdSort && state.sort === 'updated') { state.sort = 'recent'; autoUpdSort = false; }
    $('sort').value = state.sort; change('updated', on);
  };
  $('pageSize').onchange = () => { change('size', Number($('pageSize').value)); persist(); };
  // 「更多筛选」平时收起：常用的语言和「只看更新」一直在上面
  // 「更多筛选」平时收起，打开时浮在列表上面（不把下面的内容挤下去）；点外面或按 Esc 收起
  const showFilters = open => { $('filters').hidden = !open;document.body.classList.toggle('mobile-filter-open',open&&matchMedia('(max-width:760px)').matches); $('filterToggle').setAttribute('aria-expanded', open); };
  $('filterToggle').onclick = () => showFilters($('filters').hidden);
  document.addEventListener('click', e => {
    if ($('filters').hidden || $('modal').open) return;
    const path = e.composedPath();
    if (!path.includes($('filters')) && !path.includes($('filterToggle')) && !e.target.closest('[data-mobile=filter]')) showFilters(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('filters').hidden && !$('modal').open) showFilters(false); });
  // 📌 跟随滚动：开着时顶栏（搜索、语言、筛选）吸在最上面。电脑默认开，手机默认关
  function setFollow(on) {
    saved.follow = on; $('followTop').checked = on;
    document.documentElement.classList.toggle('following', on);
    syncTopHeight();
  }
  $('followTop').onchange = () => { setFollow($('followTop').checked); persist(); };
  $('topJump').onclick = () => $('backTop').click();
  $('kbHelp').onclick = () => shortcutHelp();
  // 手机：显示方式、主题、换背景、含更新日志收在 ⚙ 里，顶栏只留标题、密码、拿取清单、搜索和语言
  $('mobileOpts').onclick = () => { const open = !$('top').classList.contains('opts-open'); $('top').classList.toggle('opts-open', open); $('mobileOpts').setAttribute('aria-expanded', open); };
  $('reset').onclick = () => reset();
  $('emptyReset').onclick = () => state.zone==='favorites' ? openCollectionManager('import') : reset(true);
  $('heroToggle').onclick = () => { heroCollapsed = !heroCollapsed; updateHero(); persist(); };
    $('activeFilters').onclick = e => {
    const pre = e.target.closest('[data-preset]'), del = e.target.closest('[data-preset-del]');
    if (pre) { restoreSnapshot(presets[+pre.dataset.preset].state); apply(); return; }
    if (del) { presets.splice(+del.dataset.presetDel, 1); persist(); render(); return; }
    if (e.target.closest('[data-preset-save]')) return savePreset();
    if (e.target.closest('[data-clear-all]')) return reset();
    const button = e.target.closest('[data-clear-filter]'); if (!button) return;
    const field = button.dataset.clearFilter;
    const val = button.dataset.filterVal;
    if (val) {
      toggleFilter(field, val);
      return;
    }
    state[field] = ['updated','cheat','save','uncensored','onlyFavorites','unseen'].includes(field) ? false : '';
    if (field === 'query') $('search').value = '';
    else if (['updated','cheat','save','uncensored','onlyFavorites'].includes(field)) $({updated:'onlyUpdated',cheat:'onlyCheats',save:'onlySaves',uncensored:'onlyUncensored',onlyFavorites:'onlyFavorites'}[field]).checked = false;
    else if (['month','author'].includes(field)) $(field).value = '';
    state.page = 1; apply();
  };
  $('jumpForm').onsubmit = e => {
    e.preventDefault();
    const target = Number($('jumpPage').value), maximum = Math.max(1, Math.ceil(filtered.length/state.size));
    if (!Number.isInteger(target) || target < 1 || target > maximum) { toast(`请输入 1–${maximum} 之间的页码。`); return; }
    state.page = target; render();
    $('results').scrollIntoView({block:'start'});
    $('results').focus({preventScroll:true});
  };
    // Small, dependency-free XLSX writer. Inline strings preserve identifiers and
  // prevent spreadsheet applications from interpreting user text as formulas.
  function exportWorkbook(rows) {
    const xml = value => String(value == null ? '' : value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
    const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const widths=[20,52,22,14,18,18,24,22,16,14,52,55,55,12];
    const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr" s="${i===0?1:0}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:N${rows.length}"/></worksheet>`;
    const files={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="筛选结果" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml':`<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      'xl/worksheets/sheet1.xml':sheet
    };
    const utf8=s=>{const bytes=unescape(encodeURIComponent(s));return Uint8Array.from(bytes,c=>c.charCodeAt(0));};
    const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
    const parts=[],directory=[];let offset=0,centralSize=0;
    for(const name of Object.keys(files)) {
      const path=utf8(name),body=utf8(files[name]),sum=crc(body);
      const header=new Uint8Array(30+path.length),v=new DataView(header.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,sum,true);v.setUint32(18,body.length,true);v.setUint32(22,body.length,true);v.setUint16(26,path.length,true);header.set(path,30);
      const central=new Uint8Array(46+path.length),c=new DataView(central.buffer);
      c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,sum,true);c.setUint32(20,body.length,true);c.setUint32(24,body.length,true);c.setUint16(28,path.length,true);c.setUint32(42,offset,true);central.set(path,46);
      parts.push(header,body);directory.push(central);offset+=header.length+body.length;centralSize+=central.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true);e.setUint16(8,directory.length,true);e.setUint16(10,directory.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    return new Blob(parts.concat(directory,[end]),{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  $('exportResults').hidden = meta.ui_config?.enable_export === false;
  $('exportResults').onclick = () => {
    if (meta.ui_config?.enable_export === false) return;
    const records=filtered.slice();
    const suggested=meta.ui_config?.export_filename || (meta.input_name || document.title.replace(/\.(html?|xlsx)$/i,''))+'-筛选结果';
    modal('导出结果',`<p>导出当前筛选的全部 ${records.length} 件条目，顺序与列表一致。</p><label for="exportName">文件名</label><input id="exportName" style="width:100%;margin:8px 0 16px" value="${esc(suggested)}" maxlength="120"><label for="exportFormat">文件格式</label><select id="exportFormat" style="margin:8px 0 20px;width:100%"><option value="xlsx">Excel 表格（保留格式）</option><option value="csv">CSV</option></select><button id="confirmExport" class="primary">导出文件</button>`,'导出');
    $('exportName').focus();
    $('confirmExport').onclick=()=>{
      const format=$('exportFormat').value;
      let name=$('exportName').value.trim().replace(/\.(xlsx|csv)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'');
      if(!name){toast('请填写文件名。');$('exportName').focus();return;}
      if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
      const rows=[['编号','名称','版本','类型','平台','语言','制作团队','分区','收录日期','大小','表内备注','百度','夸克','已收藏'],...records.map(r=>[r.code,r.name,r.version,r.genre,r.platform,r.translation,r.author,r.sheet,r.date,sizeText(r),r.notes,r.baidu_url,r.quark_url,favorites.has(r.id)?'是':'否'])];
      const cell=value=>{let s=String(value==null?'':value);if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
      const blob=format==='xlsx'?exportWorkbook(rows):new Blob(['\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name+'.'+format;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      $('modal').close();toast(`已导出 ${records.length} 件条目。`);
    };
  };

  $('gridView').onclick = () => { state.view='grid'; persist(); render(); };
  $('listView').onclick = () => { state.view='list'; persist(); render(); };
  $('compactView').onclick = () => { state.view='compact'; persist(); render(); };
  $('pages').onclick = e => {
    const b = e.target.closest('[data-page]');
    if (b && !b.disabled) { state.page = Number(b.dataset.page); render(); $('results').scrollIntoView({block:'start'}); $('results').focus({preventScroll:true}); }
  };
  $('results').onclick = e => {
    const take = e.target.closest('[data-take]');
    if (take) { toggleTake(take.dataset.take); return; }
    const batch = e.target.closest('[data-take-batch]');
    if (batch) { const ids = filtered.filter(r => batchKey(r) === batch.dataset.takeBatch && downloadLinks(r).length).map(r => r.id); ids.forEach(id => takeList.add(id)); persist(); render(); toast(`这一批 ${ids.length} 部已加入拿取清单`); return; }
    // 勾「对比」、点标签（标签由下面统一处理）时不要顺带打开详情
    if (e.target.closest('a[href],.compare-check,[data-filter-tag]')) return;
    const copy = e.target.closest('[data-copy]');
    if (copy) { copyText(copy.dataset.copy, copy.classList.contains('ver') ? '版本号已复制' : '编号已复制'); return; }
    const fav = e.target.closest('[data-fav]');
    const d = e.target.closest('[data-detail]');
    if (fav) { const id = fav.dataset.fav; toggleFavorite(id); $('results').querySelector(`[data-fav="${CSS.escape(id)}"]`)?.focus({preventScroll:true}); }
    else if (d) detail(d.dataset.detail);
  };
  $('results').onchange = e => {
    const b = e.target.closest('[data-compare]'); if (!b) return;
    const id = b.dataset.compare;
    if (b.checked) {
      if (state.compare.size >= COMPARE_MAX) { b.checked = false; toast(`最多同时对比 ${COMPARE_MAX} 部。`); return; }
      state.compare.add(id);
    } else state.compare.delete(id);
    updateCompare();
  };
  $('compareNames').onclick = e => { const b = e.target.closest('[data-remove]'); if (b) { state.compare.delete(b.dataset.remove); render(); } };
  $('compareClear').onclick = () => { state.compare.clear(); render(); };
  // 并排对比：一列一部，不一样的格子标黄。自己勾的几部，或者详情里「并排对比全部版本」
  var COMPARE_MAX = 6;
  const CMP_FIELDS = [['', r => thumbHtml(r), true], ['名称', r => { const t = splitTitle(r.name); return `<button class="text-button strong" data-detail-open="${esc(r.id)}">${esc(t.main)}</button>${t.sub ? `<div class="alts">${esc(t.sub)}</div>` : ''}`; }],
    ['原名', r => esc(r.orig_title || '—')], ['英文名', r => esc(r.english || '—')], ['编号', r => `<span class="mono">${esc(r.code)}</span>`], ['分类', r => esc(r.category || '—')], ['版本', r => esc(r.version || '—')], [ '收录日期', r => esc(r.date || batchKey(r))], [field('translation').label, r => field('translation').visible?esc(langOf(r)):'—'],
    [field('genre').label, r => esc(fieldValue(r,'genre') || '—')], [field('platform').label, r => esc(fieldValue(r,'platform') || '—')], ['大小', r => esc(sizeText(r) || '—')], [field('author').label, r => esc(fieldValue(r,'author') || '—')],
    ['分区', r => esc((r.category_sheets || [r.sheet]).join(' · '))], ['附带', r => esc((r.perks || []).join(' · ') || '—')], ['附加信息', r => esc((r.cheats || []).join(' / ') || '—')],
    ['标签', r => [...recordTags(r)].map(t => `<span class="tag">${esc(t)}</span>`).join(' ') || '—'], ['更新了什么', r => esc(r.updated ? (r.update_summary || '（没写）') : '—')],
    ['网盘位置', r => esc(locationText(r) || '—')], ['备注', r => r.notes ? `<div class="table-note">${esc(r.notes)}</div>` : '—'], ['下载', r => linksHtml(r), true]];
  function openCompare(rows, title) {
    if (rows.length < 2) return toast('至少选两部才能并排看');
    const body = CMP_FIELDS.map(([label, f, plain]) => {
      const cells = rows.map(f), same = cells.every(c => c === cells[0]);
      if (same && cells[0] === '—') return '';   // 几部都没有的项目（比如都没有英文名）不占一行
      return `<tr><th scope="row">${esc(label)}</th>${cells.map(c => `<td class="${!plain && !same ? 'diff' : ''}">${c}</td>`).join('')}</tr>`;
    }).join('');
    modal(title, `<p>黄色的格子是不一样的地方。</p><div class="table-wrap"><table class="ctable">${body}</table></div>`, '并排对比');
    $('modal').classList.add('wide');
    $('modalBody').querySelectorAll('[data-detail-open]').forEach(b => b.onclick = () => detail(b.dataset.detailOpen));
  }
  $('compareOpen').onclick = () => openCompare([...state.compare].map(id => byId.get(id)).filter(Boolean), `并排对比 ${state.compare.size} 部`);
  $('surprise').onclick = () => {
    if (!filtered.length) { toast('当前筛选没有条目，请先调整筛选。'); return; }
    detail(filtered[Math.floor(Math.random()*filtered.length)].id);
  };
  $('themeSwitch').onclick = e => {
    const b = e.target.closest('[data-theme-set]'); if (!b) return;
    setTheme(b.dataset.themeSet); persist();
  };
  function guideHtml() {return `<ul class="help-list"><li>搜索名称、编号、来源编号、别名、标签和作者；支持繁简、全半角、假名和拼音，多词用空格分隔。</li><li>筛选同类多选满足任一项，标签多选需同时满足。展开标签后按 Esc 收起。</li><li>收藏、备注、已拿到的版本记录保存在当前浏览器；可在收藏管理中备份与导入。</li><li>勾选对比、详情里的全部版本和拿取清单，都可以打开并排对比。</li><li>默认离线。只有你点击配置的外链或开启远程图片/背景时才会联网。</li></ul>${meta.extract_guide?`<div class="guide-block">${esc(meta.extract_guide)}</div>`:''}`;}

  $('help').onclick = () => modal('把喜欢的，留在身边。', guideHtml(), 'A QUICK GUIDE');
  $('copyPassword').onclick = () => {if(topNotice.copyable)copyText(password,'提示已复制');};
  $('exportFav').onclick = () => {
    const blob = new Blob([JSON.stringify(personalPayload(), null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = String(meta.input_name || meta.title || '目录').replace(/[\\/:*?"<>|]+/g, '') + '-收藏与备注.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('收藏与备注已导出');
  };
  $('importFav').onclick = () => $('importFile').click();
  $('backTop').onclick = () => window.scrollTo({top:0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  document.addEventListener('keydown', e => {
    const typing = !!e.target.closest?.('input,textarea,select,[contenteditable="true"]');
    if (e.key==='/' && !typing && !$('modal').open) { e.preventDefault(); $('search').focus(); }
    if (e.key==='Escape' && $('sidebar').classList.contains('open')) { menu(false); $('menuButton').focus(); }
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) shortcut(e);
  });
  // 键盘：j / k 在列表里上下选，回车打开；x 加入清单、f 收藏、c 对比、w 想看、p 看过、h 不感兴趣；详情里 ← → 翻上一部下一部
  var kbId = null;
  function kbMove(d) {
    const rows = [...$('results').querySelectorAll('.row,.tile')]; if (!rows.length) return;
    const cur = rows.findIndex(el => el.dataset.id === kbId), i = cur < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, cur + d));
    rows.forEach(el => el.classList.remove('kb')); rows[i].classList.add('kb'); kbId = rows[i].dataset.id;
    rows[i].scrollIntoView({block: 'nearest'});
  }
  function shortcut(e) {
    const inDetail = $('modal').open && $('modal').classList.contains('drawer') && $('detailFav') && detailId;
    if ($('modal').open && !inDetail) return;
    const id = inDetail ? detailId : kbId, k = e.key;
    if (inDetail && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); stepDetail(k === 'ArrowLeft' ? -1 : 1); return; }
    if (!inDetail && (k === 'j' || k === 'k')) { e.preventDefault(); kbMove(k === 'j' ? 1 : -1); return; }
    if (!inDetail && (k === 'Enter' || k === 'o') && kbId && !e.target.closest?.('button,a')) { e.preventDefault(); detail(kbId); return; }
    if (k === '?') { e.preventDefault(); return shortcutHelp(); }
    if (k === 't') { e.preventDefault(); return openTakeList(); }
    if (!id) return;
    if (k === 'x') { const r = byId.get(id); if (r && (r.baidu_url || r.quark_url)) toggleTake(id); if (inDetail) detail(id); }
    else if (k === 'f') { toggleFavorite(id); if (inDetail) detail(id); }
    else if (k === 'c') { if (state.compare.has(id)) state.compare.delete(id); else if (state.compare.size < COMPARE_MAX) state.compare.add(id); render(); if (inDetail) detail(id); }
    else if (k === 'w') setMark(id, 'want'); else if (k === 'p') setMark(id, 'played'); else if (k === 'h') setMark(id, 'hidden');
  }
  function shortcutHelp() {
    const rows = [['/', '搜索'], ['j / k', '在列表里往下 / 往上选一部'], ['回车 或 o', '打开选中的条目'], ['← / →', '详情里看上一部 / 下一部'], ['x', '加入 / 移出拿取清单'], ['t', '打开拿取清单'],
      ['f', '收藏 / 取消收藏'], ['c', '加入 / 移出对比'], ['w', '标为想看'], ['p', '标为看过'], ['h', '标为不感兴趣（以后不显示）'], ['Esc', '关掉弹窗、筛选面板和联想'], ['?', '看这张表']];
    modal('键盘快捷键', `<p>打字的时候这些键不起作用。</p><table class="kbd-table">${rows.map(([k, v]) => `<tr><th><kbd>${esc(k)}</kbd></th><td>${esc(v)}</td></tr>`).join('')}</table>`, '快捷键');
  }
  $('quickPills').innerHTML = [
    `<button class="quick-pill" id="pillPwd">顶部提示 <b>${esc(password)}</b></button>`,
    (meta.toolbox_baidu_url||meta.toolbox_url) ? `<a class="quick-pill" href="${esc(meta.toolbox_baidu_url||meta.toolbox_url)}" target="_blank" rel="noopener noreferrer">${esc(meta.toolbox_quark_url ? '工具箱（百度） ↗' : '工具箱 ↗')}</a>` : '',
    meta.toolbox_quark_url ? `<a class="quick-pill" href="${esc(meta.toolbox_quark_url)}" target="_blank" rel="noopener noreferrer">工具箱（夸克） ↗</a>` : '',
    `<button class="quick-pill" id="pillGuide">完整解压说明</button>`,
    `<span class="quick-pill" style="cursor:default">收录 <b>${data.length}</b></span>`
  ].join('');
  $('pillPwd').hidden=!topNotice.visible;
  $('pillPwd').onclick=()=>$('pwdChip').click();
  $('pillGuide').onclick = () => unpackWizard();
  $('month').innerHTML = '<option value="">全部月份</option>' + months.map(m => `<option value="${m}">${m.slice(0,4)} 年 ${Number(m.slice(5))} 月</option>`).join('');
  $('author').innerHTML = '<option value="">全部团队</option>' + authors.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  $('pageSize').value = String(state.size);
  document.title = meta.input_name || meta.title || '__PRODUCT_NAME__';
  $('footerBrand').textContent = document.title;
  $('sideNote').textContent = meta.is_demo ? '中性数据 · 生成流程验证' : '__PRODUCT_NAME__ · 离线目录';
  $('footerMeta').textContent = '数据日期：' + (meta.update_date || '未标注') + ' · ' + data.length + ' 条';
  const notice = String(meta.warning || meta.notice || '');

  function matchFavoriteItem(item, dataList){
    var code = String(item.code || '').trim();
    var oldId = String(item.id || '').trim();
    var title = String(item.title || '').trim();
    var origTitle = String(item.orig_title || '').trim();
    var category = String(item.category || '').trim();
    var version = String(item.version || '').trim();

    // 1. CODE FIRST: 按 code 精确寻找候选
    var codeMatches = code ? dataList.filter(function(x){ return String(x.code || '').trim() === code; }) : [];

    // 唯一编号仍需尊重备份里明确的条目名；编号被复用时交给读者确认。
    if(codeMatches.length === 1){
      const target = codeMatches[0];
      const incoming = [title, origTitle].map(normalizeSearch).filter(Boolean);
      const names = [target.title, target.name, target.orig_title, target.english, ...(target.aliases || [])].map(normalizeSearch).filter(Boolean);
      const agrees = incoming.some(a => names.some(b => a === b || Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))));
      if (incoming.length && names.length && !agrees) return {status:'ambiguous', candidates:[target], oldItem:item};
      return { status: 'matched', target, matchType: 'code_unique' };
    }

    // 情况 B：新版存在多条相同 code -> 锁定候选集，在同 code 内依序校对
    if(codeMatches.length > 1){
      var cands = codeMatches.slice();

      // (1) orig_title 原名校对
      if(origTitle){
        var mExact = cands.filter(function(x){ return x.orig_title && x.orig_title.trim().toLowerCase() === origTitle.toLowerCase(); });
        if(mExact.length === 1) return { status: 'matched', target: mExact[0], matchType: 'code_and_orig_title' };
        if(mExact.length > 1){ cands = mExact; }
        else {
          var mInc = cands.filter(function(x){
            var xo = String(x.orig_title || '').toLowerCase();
            var io = origTitle.toLowerCase();
            return xo && (xo.includes(io) || io.includes(xo));
          });
          if(mInc.length === 1) return { status: 'matched', target: mInc[0], matchType: 'code_and_orig_title' };
          if(mInc.length > 1) cands = mInc;
        }
      }

      // (2) title 中文名/主标题校对
      if(title && cands.length > 1){
        var mExact = cands.filter(function(x){ return x.title && x.title.trim().toLowerCase() === title.toLowerCase(); });
        if(mExact.length === 1) return { status: 'matched', target: mExact[0], matchType: 'code_and_title' };
        if(mExact.length > 1){ cands = mExact; }
        else {
          var mInc = cands.filter(function(x){
            var xt = String(x.title || '').toLowerCase();
            var it = title.toLowerCase();
            return xt && (xt.includes(it) || it.includes(xt));
          });
          if(mInc.length === 1) return { status: 'matched', target: mInc[0], matchType: 'code_and_title' };
          if(mInc.length > 1) cands = mInc;
        }
      }

      // (3) 来源分类校对
      if(category && cands.length > 1){
        var mExact = cands.filter(function(x){ return x.category && x.category.trim() === category; });
        if(mExact.length === 1) return { status: 'matched', target: mExact[0], matchType: 'code_and_category' };
        if(mExact.length > 1){ cands = mExact; }
        else {
          var mSub = cands.filter(function(x){
            var xc = String(x.category || '');
            var xz = String((x.source_record || x).zone || '');
            if(!xc && !xz) return false;
            if(xc.includes(category) || category.includes(xc)) return true;
            return false;
          });
          if(mSub.length === 1) return { status: 'matched', target: mSub[0], matchType: 'code_and_category' };
          if(mSub.length > 1) cands = mSub;
        }
      }

      // (4) version 条目版本校对
      if(version && cands.length > 1){
        var mVer = cands.filter(function(x){ return x.version && x.version.trim() === version; });
        if(mVer.length === 1) return { status: 'matched', target: mVer[0], matchType: 'code_and_version' };
        if(mVer.length > 1) cands = mVer;
      }

      // (5) old id 旧 stable ID 辅助校对 (仅在同 code 候选内最后参考)
      if(oldId && cands.length > 1){
        var mId = cands.filter(function(x){ return x.id === oldId; });
        if(mId.length === 1) return { status: 'matched', target: mId[0], matchType: 'code_and_id' };
      }

      // 仍有多个同 code 候选：绝不跳到其他编号，交由用户手动选择
      return { status: 'ambiguous', candidates: cands, oldItem: item };
    }

    // 情况 C：新版没有这个 code -> 降级用 old id + orig_title / title 检查更名/改号
    if(oldId){
      var byId = dataList.filter(function(x){ return x.id === oldId || (x.merged_ids||[]).includes(oldId) || (x.legacy_ids||[]).includes(oldId); });
      if(byId.length === 1){
        var cand = byId[0];
        var origOk = origTitle && cand.orig_title && (cand.orig_title.toLowerCase() === origTitle.toLowerCase() || cand.orig_title.includes(origTitle) || origTitle.includes(cand.orig_title));
        var titleOk = title && cand.title && (cand.title.toLowerCase() === title.toLowerCase() || cand.title.includes(title) || title.includes(cand.title));
        if(origOk || titleOk || (!origTitle && !title)){
          return { status: 'matched', target: cand, matchType: 'fallback_id_and_title' };
        }
      }
    }

    if(origTitle){
      var byOrig = dataList.filter(function(x){ return x.orig_title && x.orig_title.trim().toLowerCase() === origTitle.toLowerCase(); });
      if(byOrig.length === 1 && (!title || !byOrig[0].title || byOrig[0].title.toLowerCase() === title.toLowerCase() || byOrig[0].title.includes(title) || title.includes(byOrig[0].title))){
        return { status: 'matched', target: byOrig[0], matchType: 'fallback_orig_title' };
      }
    }

    if(title && title.length >= 4){
      var byTitle = dataList.filter(function(x){ return x.title && x.title.trim().toLowerCase() === title.toLowerCase(); });
      if(byTitle.length === 1){
        return { status: 'matched', target: byTitle[0], matchType: 'fallback_title' };
      }
    }

    return {
      status: 'unmatched',
      oldItem: item
    };
  }


    // Compatibility bridge: keep catalog identities and existing browser data.
  const boundLinks = Object.assign(Object.create(null), saved.boundLinks || {});
  for(const r of data)for(const id of [...(r.merged_ids||[]),...(r.legacy_ids||[])])if(id!==r.id && boundLinks[id])boundLinks[r.id]={...boundLinks[id],...(boundLinks[r.id]||{})};
  let pendingFavorites = [...(Array.isArray(saved.pendingFavorites) ? saved.pendingFavorites : []), ...(Array.isArray(saved.favorites) ? saved.favorites.filter(id=>!byId.has(id)).map(id=>({id})) : [])];
  const safeUrl = value => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
  function mergePersonal(value) {
    if (!value || !Array.isArray(value.favorites)) throw new Error('收藏文件缺少 favorites 列表。');
    if (value.favorites.length > 50000) throw new Error('收藏条目过多。');
    const entries=[...value.favorites,...(Array.isArray(value.pendingFavorites)?value.pendingFavorites:[])];
    for(const raw of entries){
      if(typeof raw==='string' && raw.length && raw.length<=200)continue;
      if(!raw || typeof raw!=='object' || Array.isArray(raw) || !['id','code','title','orig_title'].some(k=>typeof raw[k]==='string' && raw[k].trim()))throw new Error('收藏条目格式错误。');
      for(const k of ['id','code','title','orig_title','category','version'])if(raw[k]!=null && typeof raw[k]!=='string')throw new Error('收藏字段必须为文字。');
    }
    for(const key of ['notes','boundLinks','marks'])if(value[key]!=null && (typeof value[key]!=='object' || Array.isArray(value[key])))throw new Error('个人数据格式错误。');
    for(const key of ['viewed','blockedTags','blockedAuthors','presets'])if(value[key]!=null && !Array.isArray(value[key]))throw new Error('个人数据格式错误。');
    if(Object.values(value.notes||{}).some(n=>typeof n!=='string' || n.length>5000))throw new Error('备注格式不正确。');
    for(const pack of Object.values(value.boundLinks||{})){
      if(!pack || typeof pack!=='object' || Array.isArray(pack))throw new Error('绑定链接格式错误。');
      for(const [site,url] of Object.entries(pack))if(['__proto__','constructor','prototype'].includes(site) || typeof url!=='string' || !safeUrl(url))throw new Error('绑定链接必须为有效的网页地址。');
    }
    let added = 0;
    const pairs = new Map();
    for (const raw of [...value.favorites, ...(Array.isArray(value.pendingFavorites) ? value.pendingFavorites : [])]) {
      const item = typeof raw === 'string' ? {id:raw} : raw;
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('收藏条目格式错误。');
      const result = matchFavoriteItem(item, data);
      if (result.status === 'matched') {
        const id = result.target.id;
        pairs.set(item.id, id);
        if (!favorites.has(id)) { favorites.add(id); added++; }
        pendingFavorites = pendingFavorites.filter(p => JSON.stringify(p) !== JSON.stringify(item));
      } else if (!pendingFavorites.some(p => JSON.stringify(p) === JSON.stringify(item))) pendingFavorites.push(item);
    }
    for (const [oldId, note] of Object.entries(value.notes || {})) {
      const id = pairs.get(oldId) || oldId;
      if (typeof note === 'string' && id && !notes[id]) notes[id] = note.slice(0,5000);
    }
    for (const [oldId, pack] of Object.entries(value.boundLinks || {})) {
      const id = pairs.get(oldId) || oldId;
      if (['__proto__','constructor','prototype'].includes(id) || !pack || typeof pack !== 'object') continue;
      if (!boundLinks[id]) boundLinks[id] = Object.create(null);
      for (const [site, url] of Object.entries(pack)) {
        if (!['__proto__','constructor','prototype'].includes(site) && safeUrl(url) && !boundLinks[id][site]) boundLinks[id][site] = safeUrl(url);
      }
    }
    // 想看 / 看过 / 不感兴趣、看过、屏蔽、常用筛选：已有的不覆盖，只补没有的
    for (const [oldId, m] of Object.entries(value.marks || {})) { const id = canonicalId(pairs.get(oldId) || oldId); if (id && MARKS[m] && !marks[id]) marks[id] = m; }
    for (const id of value.viewed || []) { const t = typeof id === 'string' && canonicalId(id); if (t) viewed.add(t); }
    for (const t of value.blockedTags || []) if (typeof t === 'string' && t.length <= 60) blockedTags.add(t);
    for (const a of value.blockedAuthors || []) if (typeof a === 'string' && a.length <= 120) blockedAuthors.add(a);
    for (const p of value.presets || []) {
      if (!p || typeof p.name !== 'string' || !p.state || typeof p.state !== 'object' || presets.length >= 30 || presets.some(x => x.name === p.name)) continue;
      const st = {}; for (const [k, d] of Object.entries(SNAP)) if (typeof p.state[k] === typeof d) st[k] = p.state[k];
      presets.push({name: p.name.slice(0, 30), state: st});
    }
    return added;
  }
  function personalPayload() {
    return {format:'jiye-personal-v1', version:1, favorites:[...favorites],
      favoriteRecords:[...favorites].map(id => byId.get(id).source_record || byId.get(id)),
      notes, boundLinks, pendingFavorites, marks, viewed:[...viewed], blockedTags:[...blockedTags], blockedAuthors:[...blockedAuthors], presets};
  }
  function readImport(text) {
    text = text.trim();
    const prefix = ['JIYE1:', 'PANLU1:', 'GBFAV1:'].find(value => text.startsWith(value));
    if (prefix) {
      const bytes = Uint8Array.from(atob(text.slice(prefix.length).replace(/\s/g,'')), c => c.charCodeAt(0));
      const value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if (value.schema_version !== 1) throw new Error('不支持的收藏码版本。');
      return value;
    }
    const value = JSON.parse(text);
    if (Array.isArray(value.favoriteRecords)) value.favorites = value.favoriteRecords;
    return value;
  }
  function importPersonal(text) {
    const added = mergePersonal(readImport(text));
    persist(); apply(); toast(`新增 ${added} 件收藏，${pendingFavorites.length} 件待匹配。`);
  }
  function showPending() {
    modal('确认旧收藏', `<p>这些旧收藏暂时找不到对应条目，或找到了多个版本。它们没有被删除，请选择你要保留的那一款。</p><button id="backToManager" class="secondary">← 返回收藏管理</button> <button id="copyPending" class="secondary">复制待确认清单</button>${pendingFavorites.map((p,i) => {
      const result = matchFavoriteItem(p,data);
      const candidates = result.candidates || [];
      return `<div class="guide-block"><b>${esc(p.title || p.code || p.id)}</b><p>${esc(p.version || '')}</p>
        <select data-pending="${i}" aria-label="匹配旧收藏"><option value="">请选择条目</option>${(candidates.length ? candidates : data).map(r => `<option value="${esc(r.id)}">${esc(r.code+' · '+r.name+' · '+r.sheet+' · '+r.version)}</option>`).join('')}</select></div>`;
    }).join('') || '<p>没有待匹配收藏。</p>'}`);
    $('backToManager').onclick=()=>openCollectionManager();
    $('copyPending').onclick=()=>copyText(pendingFavorites.map(p=>[p.code,p.title||p.id,p.version].filter(Boolean).join(' · ')).join('\n'),'待匹配清单已复制');
    $('modalBody').onchange = e => {
      if (!e.target.matches('[data-pending]') || !byId.has(e.target.value)) return;
      const old=pendingFavorites[Number(e.target.dataset.pending)], id=e.target.value;
      if(old && notes[old.id] && !notes[id])notes[id]=notes[old.id];
      if(old && boundLinks[old.id] && !boundLinks[id])boundLinks[id]=boundLinks[old.id];
      favorites.add(id); pendingFavorites.splice(Number(e.target.dataset.pending),1);
      persist(); apply(); showPending();
    };
  }
  $('copyFavCode').onclick = () => {
    const items = [...favorites].map(id => {const r=byId.get(id);return {id:r.id,code:r.code,title:r.title || r.name,orig_title:r.orig_title,category:r.category,version:r.version};});
    const bytes = new TextEncoder().encode(JSON.stringify({schema_version:1,favorites:[...items,...pendingFavorites]}));
    copyText('JIYE1:'+btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')), '跨版本收藏码已复制');
  };
  $('pendingFav').onclick = showPending;
  // 旧收藏仅由读者主动粘贴收藏码或导入 JSON，不读取其他目录的浏览器存储。
  const sourceConfigs = (Array.isArray(meta.sources) ? meta.sources : []).filter(item => item && item.enabled === true);
  const sourceName = key => sourceConfigs.find(item => String(item.id || item.name).toLowerCase() === String(key).toLowerCase())?.name || key || '资料';
  function recordWebLinks(r) {
    const root = r.web_info || r.source_record?.web_info || {}, seen = new Set();
    return [root, ...(Array.isArray(root.links) ? root.links : [])].filter(info => {
      const url = safeUrl(info?.url); if (!url || seen.has(url)) return false;
      seen.add(url); return true;
    });
  }
  function officialStoreUrl(site, url) {
    return sourceConfigs.some(item => String(item.id || item.name).toLowerCase() === String(site).toLowerCase() && item.official) ? safeUrl(url) : '';
  }
  function cardSourceLinks(r) {
    const entries = new Map();
    for (const info of recordWebLinks(r)) {
      const site = String(info.site || info.source || '资料').toLowerCase();
      entries.set(site, {site, url: safeUrl(info.url), label: info.site || info.source || '资料', locked: Boolean(info.region_locked)});
    }
    const id = r.source_id || r.metadata_id;
    const provider = String(r.source_provider || r.metadata_source || '').toLowerCase();
    const adapter = sourceConfigs.find(item => String(item.id || item.name).toLowerCase() === provider);
    if (id && adapter?.detail_url && !entries.has(provider)) {
      const url = safeUrl(adapter.detail_url.replace('{id}', encodeURIComponent(id)));
      if (url) entries.set(provider, {site: provider, url, label: adapter.name});
    }
    for (const [site, value] of Object.entries(boundLinks[r.id] || boundLinks[r.code] || {})) if (safeUrl(value)) entries.set(site, {site, url: safeUrl(value), bound: true, label: sourceName(site)});
    if (!entries.size) return '';
    return `<div class="card-source-links" aria-label="正版与资料链接">${[...entries.values()].map(({site, url, label, bound, locked}) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"${locked ? ' class="locked-source" title="来源标注了地区限制，请查看官方说明"' : ''}>${esc(label)}<span>${locked ? '地区限制 · ' : ''}${officialStoreUrl(site, url) ? '正版' : bound ? '已绑定' : '资料'} ↗</span></a>`).join('')}</div>`;
  }
  function extraDetail(r) {
    const source=r.source_record || r, pack=boundLinks[r.id] || boundLinks[r.code] || {};
    // 搜索词：有原名 / 英文名就用；没有的话从名称里拆出日文、英文那一段，不带「更新」和中文译名
    const tt=splitTitle(r.name), words=tt.sub.split(/\s+/).filter(Boolean);
    const jp=r.orig_title || (KANA_RE.test(tt.sub) ? words.filter(w=>KANA_RE.test(w)||HAN_RE.test(w)).join(' ') : '') || tt.main;
    const en=r.english || words.filter(w=>/^[A-Za-z0-9][A-Za-z0-9 .:'’!?&+-]*$/.test(w)).join(' ') || jp;
    const infos=recordWebLinks(r);
    const searches = sourceConfigs.filter(item => item.search_url && !infos.some(info => String(info.site || info.source).toLowerCase() === String(item.id || item.name).toLowerCase())).map(item => [item.name || item.id, safeUrl(String(item.search_url).replace('{q}', encodeURIComponent(jp))), jp]).filter(([, url]) => url);
    const linkFields = [...new Set([...sourceConfigs.map(item => String(item.id || item.name)), ...Object.keys(pack), 'other'])];
    return `
      ${(r.cheats||[]).length?`<div class="guide-block"><b>附加信息</b><div class="card-tags">${r.cheats.map(c=>`<button class="chip" data-copy="${esc(c)}">${esc(c)} · 复制</button>`).join('')}</div></div>`:''}
      <details class="original-record" ${meta.ui_config?.expand_source===false?'':'open'}><summary>原始名称、标签与来源记录</summary><p>${esc(source.raw_title||'')}</p><p>${esc(source.raw_tags||'')}</p>${[...(r.source_variants||[]),...(r.merged_sources||[])].map(v=>`<p>${esc(v.sheet)} 第 ${esc(v.row_num)} 行：${esc(v.raw_title)}</p>`).join('')}</details>
      <div class="source-section"><b>正版与资料</b>${cardSourceLinks(r) || '<p class="muted small">还没有收录这部条目的正版链接。</p>'}
      ${searches.length ? `<p class="muted small">可以去这些网站搜一下（用${jp !== en ? '日文名 / 英文名' : '条目名'}搜）：</p><div class="source-actions">${searches.map(([label, url, q]) => `<a class="source-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="搜「${esc(q)}」">${esc(label)}<span>搜索 ↗</span></a>`).join('')}</div>` : ''}
      ${r.region_locked || infos.some(info => info.region_locked) ? '<div class="guide-block locked-notice"><b>地区限制提示</b><p>资料来源标注了地区限制，请查阅来源网站的官方说明。</p></div>' : ''}</div>
      <details class="link-editor"><summary>绑定我自己找到的正版 / 资料链接</summary><form data-link-editor="${esc(r.id)}">${linkFields.map(k=>`<label>${esc(k === 'other' ? '其他资料链接' : sourceName(k))}<input name="${esc(k)}" type="url" placeholder="https://…" value="${esc(pack[k]||'')}"></label>`).join('')}<button class="secondary" type="submit">保存链接</button></form></details>
      ${infos.filter(i=>safeUrl(i.url)&&(i.description||i.summary)).map(i=>`<div class="guide-block"><a href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener noreferrer">${esc(i.source||'原作资料')} · ${esc(i.title||'查看资料')}</a><p>${esc(i.description||i.summary||'')}</p></div>`).join('')}
      <div class="guide-block">${esc(meta.extract_guide||meta.row2_body||'')}</div>`;
  }
  $('modalBody').addEventListener('submit',e=>{
    const form=e.target.closest('[data-link-editor]');if(!form)return;e.preventDefault();
    const pack=Object.create(null);for(const input of form.querySelectorAll('input[name]')){
      const value=input.value.trim();if(value&&!safeUrl(value)){toast('请输入 http 或 https 链接');return;}
      if(value)pack[input.name]=safeUrl(value);
    }
    boundLinks[form.dataset.linkEditor]=pack;persist();render();
    const r=byId.get(form.dataset.linkEditor);if(r)detail(r.id);toast('链接已保存');
  });
  $('modalBody').addEventListener('click', e=>{const b=e.target.closest('[data-copy]');if(b)copyText(b.dataset.copy);});
  const multiFields=['genre','platform','translation','tag','month','author','extraMarkers'];
  function toggleFilter(field,value) {
    const values=state[field]?state[field].split('\u001f'):[];
    state[field]=!value?'':(values.includes(value)?values.filter(v=>v!==value):[...values,value]).join('\u001f');
    state.page=1; apply();
  }
  const tagList=unique(data.flatMap(r=>[...recordTags(r)]));
  const tagCounts=new Map(tagList.map(t=>[t,data.filter(r=>hasTag(r,t)).length]));
  tagList.sort((a,b)=>(tagCounts.get(b)-tagCounts.get(a))||a.localeCompare(b,'zh-CN'));
  function tagPicker(){
    filterPicker('tag',tagList,tagCounts,'全部标签','allTagSearch','allTagList');
  }
  function filterPicker(field,values,counts,title,inputId,listId){
    const rule=field==='tag'?'同时满足所选标签':'匹配任一所选作者';
    modal(title,`<div class="picker-toolbar"><input id="${inputId}" type="search" aria-label="搜索${title}" placeholder="输入名称搜索…"><p>${rule} · 按条目数量排序</p></div><div class="picker-grid" id="${listId}"></div><div class="picker-footer"><span id="pickerStatus" aria-live="polite"></span><button class="secondary" id="pickerClear">清空选择</button><button class="source-button" id="pickerDone">完成</button></div>`,'筛选条目');
    const draw=()=>{const selected=state[field].split('\u001f').filter(Boolean),found=values.filter(v=>v.toLocaleLowerCase().includes($(inputId).value.trim().toLocaleLowerCase()));
      $(listId).innerHTML=found.length?found.map(v=>`<button class="picker-option${selected.includes(v)?' active':''}" aria-pressed="${selected.includes(v)}" data-picker-value="${esc(v)}"><span>${esc(v)}</span><b>(${counts.get(v)||0})</b></button>`).join(''):'<p>没有匹配的结果，试试其他名称。</p>';
      $('pickerStatus').textContent=`已选 ${selected.length} 项 · 找到 ${found.length} 项`;
    };
    $(inputId).oninput=draw;$(listId).onclick=e=>{const b=e.target.closest('[data-picker-value]');if(b){const value=b.dataset.pickerValue;toggleFilter(field,value);draw();[...$(listId).querySelectorAll('button')].find(el=>el.dataset.pickerValue===value)?.focus({preventScroll:true});}};
    $('pickerClear').onclick=()=>{toggleFilter(field,'');draw();};$('pickerDone').onclick=()=>$('modal').close();draw();
  }
  $('allTags').onclick=tagPicker;
  $('findAuthor').onclick=()=>{
    filterPicker('author',authors,authorCounts,'全部作者','authorSearch','authorList');
  };
  $('moreAuthors').onclick=()=>$('findAuthor').click();
  $('hotAuthors').onclick=e=>{const button=e.target.closest('[data-hot-author]');if(!button)return;if(button.dataset.openPicker==='author')return filterPicker('author',authors,authorCounts,'全部作者','authorSearch','authorList');toggleFilter('author',button.dataset.hotAuthor);};
  document.addEventListener('click',e=>{const b=e.target.closest('[data-filter-tag]');if(b){toggleFilter('tag',b.dataset.filterTag);if($('modal').open)$('modal').close();}});
  $('overview').onclick = e => {
    const b = e.target.closest('[data-ov]'); if (!b) return;
    const k = b.dataset.ov;
    if (k === 'day') jumpToDay(latestDay);
    else if (k === 'taken') change('onlyNew',state.onlyNew==='taken'?'':'taken');
    else if (k === 'month') change('month', state.month === latestMonth ? '' : latestMonth);
    else if (k === 'updated') { $('onlyUpdated').checked = !state.updated; $('onlyUpdated').onchange(); }
    else if (k === 'since') change('onlyNew', state.onlyNew === 'since' ? '' : 'since');
    else if (k === 'take') openTakeList();
    else if (k === 'unseen') change('unseen', !state.unseen);
  };
  $('transSeg').onclick = e => { const b = e.target.closest('[data-translation]'); if (b) toggleFilter('translation', b.dataset.translation); };
  $('calendar').onclick = e => {
    const mon = e.target.closest('[data-mon]'), only = e.target.closest('[data-mon-only]'), day = e.target.closest('[data-day]');
    if (mon) { const m = mon.dataset.mon; openMonths.has(m) ? openMonths.delete(m) : openMonths.add(m); renderCalendar(); }
    else if (only) { const m = only.dataset.monOnly; change('month', state.month === m ? '' : m); menu(false); window.scrollTo(0, 0); }
    else if (day) { menu(false); jumpToDay(day.dataset.day); }
  };
  $('mbar').onclick = e => {
    const z = e.target.closest('[data-zone]');
    if (z) { change('zone', z.dataset.zone); window.scrollTo(0, 0); }
    else if (e.target.closest('[data-open-take]')) openTakeList();
    else if (e.target.closest('[data-back-top]')) $('backTop').click();
  };
  $('takeOpen').onclick = () => openTakeList();
  $('pwdChip').hidden=!topNotice.visible;
  $('pwdChip').onclick = () => topNotice.copyable?copyText(password,'提示已复制'):$('pwdChip').classList.toggle('open');
  $('pwdText').textContent = password;

  // 顶栏高度会随筛选面板展开变化：左栏和批次标题按它吸顶
  const syncTopHeight = () => document.documentElement.style.setProperty('--top-h', (getComputedStyle($('top')).position === 'sticky' ? $('top').offsetHeight : 0) + 'px');
  if ('ResizeObserver' in window) new ResizeObserver(syncTopHeight).observe($('top'));
  addEventListener('resize', syncTopHeight);
  setFollow(typeof saved.follow === 'boolean' ? saved.follow : !matchMedia('(max-width: 760px)').matches);
  [['genreChips','genre'],['platformChips','platform'],['tagChips','tag']].forEach(([id,field])=>{
    $(id).onclick=e=>{const b=e.target.closest(`[data-${field}]`);if(!b)return;if(b.dataset.openPicker===field)return field==='tag'?tagPicker():filterPicker('author',authors,authorCounts,'全部作者','authorSearch','authorList');toggleFilter(field,b.getAttribute('data-'+field));};
  });
  for(const id of ['month','author']) $(id).onchange=()=>{toggleFilter(id,$(id).value);$(id).value='';};
  const extraMount = $('onlyCheats').closest('.chips');
  for (const [id, key] of [['onlyCheats','cheat'],['onlySaves','save'],['onlyUncensored','uncensored']]) {
    const input = $(id), marker = extraMarkers.find(item => item.key === key), label = input.closest('label');
    label.hidden = !marker;
    if (marker) { for (const node of [...label.childNodes]) if (node.nodeType === 3) node.remove(); label.append(document.createTextNode(marker.label)); }
  }
  for (const marker of extraMarkers.filter(item => !['cheat','save','uncensored'].includes(item.key))) {
    const label = document.createElement('label'); label.className = 'check-label';
    const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.extraMarker = marker.key;
    input.onchange = () => toggleFilter('extraMarkers', marker.key);
    label.append(input, document.createTextNode(marker.label)); extraMount.append(label);
  }
  $('onlyCheats').onchange=()=>change('cheat',$('onlyCheats').checked);
  $('onlySaves').onchange=()=>change('save',$('onlySaves').checked);
  $('onlyUncensored').onchange=()=>change('uncensored',$('onlyUncensored').checked);
  $('onlyFavorites').onchange=()=>change('onlyFavorites',$('onlyFavorites').checked);
  $('showCounts').onchange=()=>{saved.showCounts=$('showCounts').checked;persist();apply();};
  $('showCounts').checked=!!saved.showCounts;

  document.body.classList.remove('compact');
  const doc={...(meta.row5_template || {}), ...(meta.ui_config || {})};
  $('documentation').onclick=()=>modal(doc['guide_title']||'目录使用指引',`<p>${esc(doc['guide_subtitle']||'')}</p><p>${esc(doc['guide_body']||'')}</p>${(meta.row5_steps||doc.steps||[]).map(s=>`<div class="guide-block"><b>${esc(s.title)}</b><p>${esc(s.body)}</p></div>`).join('')}${safeUrl(doc['doc_url'])?`<a class="primary" href="${esc(safeUrl(doc['doc_url']))}" target="_blank" rel="noopener noreferrer">${esc(doc['guide_button']||'打开说明文档')} ↗</a>`:''}`);
  $('creatorLink').hidden=false; $('creatorTitle').textContent=doc.contact_title || '关注与联系';
  if(safeUrl(doc.contact_url)) $('creatorLink').href=safeUrl(doc.contact_url);
  else $('creatorLink').onclick=e=>{e.preventDefault();modal(doc.contact_title || '关注与联系','<p>尚未配置联系入口，可在母版设置里添加。</p>');};
  if(safeUrl(doc['doc_url']))$('literatureCard').href=safeUrl(doc['doc_url']);
  else {$('literatureCard').href='#';$('literatureCard').onclick=e=>{e.preventDefault();$('documentation').click();};}
  $('navGuide').onclick=()=>$('documentation').click();

  function refreshCollectionTools() {
    const inFavorites=state.zone==='favorites';
    $('favoriteTools').hidden=!inFavorites;
    $('emptyTitle').textContent=inFavorites ? (favorites.size ? '没有符合筛选的收藏' : '喜欢的条目，从这里留下') : '这里暂时没有条目';
    $('emptyText').textContent=inFavorites ? (favorites.size ? '试试减少筛选条件，或导入更多收藏。' : '之前收藏过？粘贴旧收藏码，一次带过来。也可以点击条目上的爱心收藏。') : '换一个关键词，或清空筛选重新发现。';
    $('emptyReset').textContent=inFavorites?'导入收藏码':'浏览全部条目';
    const utilityBadge=$('utilityPendingCount');if(utilityBadge){utilityBadge.hidden=!pendingFavorites.length;utilityBadge.textContent=pendingFavorites.length+' 待确认';}
    $('collectionNeeds').hidden=!pendingFavorites.length;
    $('collectionNeeds').textContent=pendingFavorites.length+' 待确认';
    const count=$('managerCount');if(count)count.textContent=favorites.size;
    const pending=$('managerPending');if(pending){pending.hidden=!pendingFavorites.length;$('managerPendingCount').textContent=pendingFavorites.length;}
  }
  function openCollectionManager(panel='import') {
    menu(false);
    modal('收藏管理',`<p>已经收藏 <b id="managerCount">${favorites.size}</b> 件条目。导入旧收藏，或把现在的收藏带走。</p>
      <div class="manager-tabs" role="group" aria-label="收藏操作">
        <button id="managerImportTab" class="${panel==='import'?'active':''}" aria-pressed="${panel==='import'}">↓ 导入收藏</button>
        <button id="managerExportTab" class="${panel==='export'?'active':''}" aria-pressed="${panel==='export'}">↑ 分享 / 备份</button>
      </div>
      ${panel==='import'?`<div class="manager-panel"><h3>把之前的收藏带过来</h3><p>① 在旧版复制收藏码　② 粘贴到下面　③ 点击导入</p>
        <label for="managerCode">你的收藏码</label><textarea id="managerCode" placeholder="在这里粘贴完整的收藏码…" spellcheck="false"></textarea>
        <button id="managerSubmit" class="primary">导入这些收藏</button><p id="managerFeedback" class="manager-feedback" role="status" aria-live="polite"></p>
        <div class="manager-file"><p>手里是之前下载的备份文件？<br><small>选择文件即可恢复，已有收藏不会重复添加。</small></p><button id="managerFile" class="secondary">选择备份文件</button></div></div>`:
        `<div class="manager-panel"><h3>把喜欢的，好好留住</h3><div class="backup-options"><div class="backup-option"><strong>复制收藏码</strong><p>换新版时粘贴回来，或发给朋友。只包含收藏清单。</p><button class="primary" id="managerCopy" ${!favorites.size&&!pendingFavorites.length?'disabled':''}>复制收藏码</button></div>
        <div class="backup-option"><strong>下载完整备份</strong><p>保存收藏、个人备注、绑定链接，以及想看 / 看过 / 不感兴趣、看过、屏蔽和常用筛选。换设备时选择这个文件恢复。</p><button class="secondary" id="managerDownload">下载备份文件</button></div></div></div>`}
      <div class="manager-pending" id="managerPending" ${!pendingFavorites.length?'hidden':''}><strong>有 <span id="managerPendingCount">${pendingFavorites.length}</span> 条旧收藏需要你确认</strong><p>新表里暂时没找到它们，或有多个版本。我们已保留原来的信息，不会丢掉。</p><button id="managerResolve" class="secondary">查看并确认</button></div>`, '我的收藏');
    $('managerImportTab').onclick=()=>openCollectionManager('import');
    $('managerExportTab').onclick=()=>openCollectionManager('export');
    $('managerResolve').onclick=showPending;
    if(panel==='import'){
      $('managerFile').onclick=()=>$('importFile').click();
      $('managerSubmit').onclick=()=>{
        const text=$('managerCode').value.trim();
        if(!text){$('managerFeedback').textContent='先把收藏码粘贴到上面的框里哦。';$('managerCode').focus();return;}
        try {const before=favorites.size;importPersonal(text);$('managerFeedback').textContent=`导入完成！新增 ${favorites.size-before} 件，现有 ${favorites.size} 件收藏。${pendingFavorites.length?'还有 '+pendingFavorites.length+' 条需要在下方确认。':''}`;}
        catch(e){$('managerFeedback').textContent='这个收藏码暂时读不了，请检查是否复制完整。已有收藏没有改动。';}
      };
    }else{
      $('managerCopy').onclick=()=>$('copyFavCode').click();
      $('managerDownload').onclick=()=>$('exportFav').click();
    }
  }
  $('collectionManager').onclick=()=>openCollectionManager();
  $('favPageImport').onclick=()=>openCollectionManager('import');
  $('favPageExport').onclick=()=>openCollectionManager('export');
  $('importCode').onclick=()=>openCollectionManager('import');
  $('importFile').onchange=async()=>{
    const file=$('importFile').files[0];if(!file)return;
    try{if(file.size>20*1024*1024)throw new Error('备份文件不能超过 20 MB。');const before=favorites.size;importPersonal(await file.text());const feedback=$('managerFeedback');if(feedback)feedback.textContent=`备份已导入，新增 ${favorites.size-before} 件收藏。备注与绑定链接也已合并。`;}
    catch(e){const msg='无法导入：'+e.message;toast(msg);const feedback=$('managerFeedback');if(feedback)feedback.textContent=msg;}
    finally{$('importFile').value='';}
  };
  $('heroStyle').value=saved.heroStyle==='postcard'?'postcard':'compact';
  document.querySelector('.hero').dataset.layout=$('heroStyle').value;
  $('heroStyle').onchange=()=>{saved.heroStyle=$('heroStyle').value;document.querySelector('.hero').dataset.layout=saved.heroStyle;heroCollapsed=false;updateHero();persist();};

    const pageConfig = meta.ui_config || {};
  function setupBackground() {
    const button=$('refreshBackground'),raw=pageConfig.background_url;
    button.textContent='↻';button.title='换背景';button.setAttribute('aria-label','换背景');
    if(!pageConfig.show_background||!RC.url(raw))return;
    button.hidden=false;const layer=document.createElement('div');layer.id='sceneBackground';layer.setAttribute('aria-hidden','true');document.body.prepend(layer);
    document.documentElement.style.setProperty('--wallpaper-overlay',String((pageConfig.background_overlay??35)/100));
    document.documentElement.style.setProperty('--wallpaper-blur',(pageConfig.background_blur??2)+'px');
    let request=0,timer=null,retry=null,currentImage=null;
    const setBlur=()=>{const enabled=saved.backdropBlur!==false;document.documentElement.classList.toggle('no-backdrop-blur',!enabled);$('blurToggle').checked=enabled;};
    $('blurToggle').onchange=()=>{saved.backdropBlur=$('blurToggle').checked;setBlur();persist();};setBlur();
    function refresh(attempt=0){
      clearTimeout(timer);clearTimeout(retry);const id=++request;
      const url=new URL(matchMedia('(max-width:760px)').matches&&RC.url(pageConfig.background_mobile_url)?pageConfig.background_mobile_url:raw);url.searchParams.set('_t',Date.now()+'-'+id);
      button.dataset.state='loading';button.disabled=true;
      const image=new Image();image.alt='';image.decoding='async';image.referrerPolicy='no-referrer';
      const fail=()=>{if(id!==request)return;request++;clearTimeout(timer);button.disabled=false;button.dataset.state='error';button.title='背景加载失败，点此重试';if(attempt<2)retry=setTimeout(()=>refresh(attempt+1),3000);};
      timer=setTimeout(fail,10000);image.onerror=fail;
      image.onload=()=>{if(id!==request)return;clearTimeout(timer);const old=currentImage;currentImage=image;image.className='wallpaper-image';layer.append(image);document.documentElement.classList.add('has-wallpaper');requestAnimationFrame(()=>image.classList.add('visible'));if(old)setTimeout(()=>old.remove(),450);button.disabled=false;button.dataset.state='ready';button.title='换背景';};
      image.src=url.href;
    }
    button.onclick=()=>refresh();refresh();addEventListener('pagehide',()=>{request++;clearTimeout(timer);clearTimeout(retry);});
  }
  function applyPageSettings() {
    const setText=(selector,key)=>{const el=document.querySelector(selector);if(el && Object.prototype.hasOwnProperty.call(pageConfig,key)){el.textContent=pageConfig[key];el.hidden=!pageConfig[key];}};
    setText('.hero .eyebrow','eyebrow');setText('#heroTitle','hero_title');setText('.hero-copy>p','hero_subtitle');setText('.site-footer>span:first-child','footer_text');setText('#literatureCard strong','doc_title');setText('#literatureCard small','doc_subtitle');
    setText('#sideNote','sidebar_text');setText('#documentation strong','guide_title');setText('#documentation em','guide_subtitle');setText('#creatorTitle','contact_title');setText('#creatorLink em','contact_subtitle');
    $('literatureCard').setAttribute('aria-label',pageConfig.doc_title || '目录指引');
    $('surprise').hidden=pageConfig.show_random===false;
    const css=document.documentElement.style;
    if(pageConfig.font_family)css.setProperty('--page-font',pageConfig.font_family+', "Microsoft YaHei", sans-serif');
    for(const key of ['body_size','hero_size','card_title_size','footer_size'])if(pageConfig[key])css.setProperty('--'+key.split('_').join('-'),pageConfig[key]+'px');
    function addImage(value,id,parent){
      if(!value || !(/^(?:enc1:|img2:|data:image\/)/.test(value) || pageConfig.allow_remote_images === true && /^https?:\/\//.test(value)))return;
      const img=document.createElement('img');img.id=id;img.decoding='async';img.loading='lazy';img.src=CatalogImages.url(value);img.alt=id==='customHeroImage'?'头图':id==='biliCardImage'?'联系卡图片':'说明卡图片';img.addEventListener('error',()=>{img.hidden=true;});
      parent.prepend(img);if(id==='customLogoImage')parent.querySelector('svg').style.display='none';
    }
    addImage(pageConfig.hero_image,'customHeroImage',document.querySelector('.hero'));
    addImage(pageConfig.logo_image||pageConfig.doc_image||(window.__CATALOG_IMAGES__ || [])[0],'customLogoImage',$('literatureCard'));
    addImage(pageConfig.doc_image||(window.__CATALOG_IMAGES__ || [])[0],'docCardImage',$('documentation'));
    addImage(pageConfig.contact_image||(window.__CATALOG_IMAGES__ || [])[1],'biliCardImage',$('creatorLink'));
    $('documentation').querySelector('.destination-icon').hidden=Boolean(document.getElementById('docCardImage'));
    $('creatorLink').querySelector('.destination-icon').hidden=Boolean(document.getElementById('biliCardImage'));
    $('pillGuide').onclick=()=>unpackWizard();
    if(meta.ui_config_revision && saved.settingsRevision!==meta.ui_config_revision){
      if(pageConfig.theme)saved.theme=pageConfig.theme;
      if(pageConfig.hero_style)saved.heroStyle=pageConfig.hero_style;
      if(pageConfig.show_hero===false)heroCollapsed=true;
      saved.settingsRevision=meta.ui_config_revision;saved.paletteRevision=2;
    }
    $('heroStyle').value=saved.heroStyle==='postcard'?'postcard':'compact';
    document.querySelector('.hero').dataset.layout=$('heroStyle').value;
    const steps=meta.row5_steps || [];
    const defaults=[['收藏管理','收藏管理'],['使用帮助','使用帮助'],['随机发现','随机发现']].map(([key,label],order)=>({key,label,order,visible:true}));
    // 按设置里的「排序」排（母版里改了排序也生效）；没有排序号的保持原来的先后
    const items=Array.isArray(pageConfig.navigation)?pageConfig.navigation.map((x,i)=>[x,i]).sort((a,b)=>(Number(a[0].order)||0)-(Number(b[0].order)||0)||a[1]-b[1]).map(p=>p[0]):defaults;
    const urls={'打开目录指引':safeUrl(doc['doc_url']),'工具箱':safeUrl(meta.toolbox_baidu_url||meta.toolbox_url),'工具箱（百度网盘）':safeUrl(meta.toolbox_baidu_url||meta.toolbox_url),'工具箱（夸克网盘）':safeUrl(meta.toolbox_quark_url),'关注与联系':safeUrl(doc['contact_url'])};
    const icons={'收藏管理':'♡','使用帮助':'?','资源下载':'↓','正确解压':'▣','使用提示':'☷','打开目录指引':'↗','复制顶部提示':'⚿','工具箱':'🛠','工具箱（百度网盘）':'🛠','工具箱（夸克网盘）':'🛠','完整解压说明':'▤','关注与联系':'▣','随机发现':'✦'};
    const extras=[{key:'拿取清单',label:'拿取清单',visible:true}];
    if(changes&&!changes.first)extras.push({key:'本期变化',label:'本期变化',visible:true});
    extras.push({key:'精选名单',label:'精选名单',visible:true});
    extras.push({key:'月度名单',label:'月度名单',visible:true});
    Object.assign(icons,{'拿取清单':'☑','本期变化':'✧','精选名单':'★','月度名单':'☰'});
    // 精选名单、月度名单、本期变化放在左边「榜单和名单」；拿取清单在右上角，不在导航里重复
    const listKeys=['精选名单','月度名单','本期变化'];
    const navItems=[...extras.filter(x=>!items.some(i=>i.key===x.key)),...items].filter(item=>item.visible && item.key!=='拿取清单' && !(item.key==='随机发现' && pageConfig.show_random===false) && !(item.key==='本期变化' && (!changes||changes.first)));
    const navButton=item=>`<button class="nav-item" data-utility="${esc(item.key)}"><span aria-hidden="true">${esc(pageConfig.navigation_icons?.[item.key]||icons[item.key]||'·')}</span>${esc(item.label)}${item.key==='精选名单'&&rankings.length?`<b>${rankings.length}</b>`:item.key==='月度名单'&&monthLists.length?`<b>${monthLists.length}</b>`:''}</button>`;
    $('listNavigation').innerHTML=listKeys.map(k=>navItems.find(i=>i.key===k)).filter(Boolean).map(navButton).join('');
    $('listNavLabel').hidden=$('listNavigation').hidden=!$('listNavigation').innerHTML;
    $('utilityNavigation').innerHTML=navItems.filter(item=>!listKeys.includes(item.key)).map(item=>{
      const label=`<span aria-hidden="true">${esc(pageConfig.navigation_icons?.[item.key]||icons[item.key]||'·')}</span>${esc(item.label)}${item.key==='收藏管理'?'<b id="utilityPendingCount" hidden></b>':''}`;
      if(Object.prototype.hasOwnProperty.call(urls,item.key))return urls[item.key]?`<a class="nav-item" href="${esc(urls[item.key])}" target="_blank" rel="noopener noreferrer">${label}</a>`:`<button class="nav-item" data-utility="${esc(item.key)}">${label}</button>`;
      return `<button class="nav-item" data-utility="${esc(item.key)}">${label}</button>`;
    }).join('');
    $('listNavigation').onclick=$('utilityNavigation').onclick=e=>{
      const b=e.target.closest('[data-utility]');if(!b)return;menu(false);
      const key=b.dataset.utility;
      if(Object.prototype.hasOwnProperty.call(urls,key) && !urls[key])return modal(b.textContent.trim(),'<p>尚未配置此入口，可在母版设置里填写地址。</p>');
      if(key==='收藏管理')return openCollectionManager();
      if(key==='使用帮助')return modal('看板使用帮助',guideHtml().split('<div class="guide-block">')[0].replace(/\s*$/,''),'使用帮助');
      if(key==='随机发现')return $('surprise').click();
      if(key==='复制顶部提示')return copyText(password,'顶部提示已复制');
      if(key==='工具箱（百度网盘）'||key==='工具箱'||key==='工具箱（夸克网盘）'){if(!urls[key])toast('未配置对应网盘链接，请在 Excel 的 HTML设置 中填写。');return;}
      if(key==='完整解压说明'||key==='正确解压')return unpackWizard();
      if(key==='拿取清单')return openTakeList();
      if(key==='本期变化')return openChanges();
      if(key==='精选名单')return openRankings();
      if(key==='月度名单')return openMonthLists();
      const index={'资源下载':0,'正确解压':1,'使用提示':2}[key];const step=steps[index];
      if(step)modal(step.title,`<div class="original-record">${esc(step.body)}</div>`,'使用指南');
      else modal(b.textContent.trim(),'<p>请在 Excel 的 HTML设置中填写相应教学内容。</p>','使用指南');
    };
  }
  // ---------- 目录：提示条、拿取清单、解压向导、本期变化、精选名单 ----------
  function updateTakeBar() {
    $('takeCount').textContent = takeList.size;
    $('takeOpen').classList.toggle('has', takeList.size > 0);
    const m = $('mbar').querySelector('[data-open-take] b'); if (m) m.textContent = takeList.size;
  }
  function toggleTake(id) {
    const r = byId.get(id); if (!r) return;
    if (takeList.has(r.id)) { takeList.delete(r.id); toast('已从拿取清单移除'); }
    else { takeList.add(r.id); toast(takeList.size === 1 ? '已加入拿取清单：点右上角「拿取清单」看怎么下载' : '已加入拿取清单：同一个文件夹的会排在一起'); }
    persist(); render();
    if ($('modal').open && $('takeList')) openTakeList();
  }
  // 清单按已有合集与明确填写的位置分组。
  function takeGroups() {
    const groups=new Map();
    for(const id of takeList){const r=byId.get(id);if(!r)continue;const label=collectionOf(r)?.label||batchKey(r),folder=folderOf(r),key=label+'|'+folder;if(!groups.has(key))groups.set(key,{label,folder,items:[]});groups.get(key).items.push(r);}
    return [...groups.values()];
  }
  function takeText(){return takeGroups().map(g=>[`【${g.label}${g.folder?' › '+g.folder:''}】`,...g.items.map(r=>`${r.code}  ${r.name}  ${r.version||''}${takenDone.has(r.id)?'  ✓ 已拿到':''}\n${downloadLinks(r).map(l=>l.label+'：'+l.url).join('\n')}`)].join('\n')).join('\n\n');}
  function openTakeList() {
    menu(false);const items=[...takeList].map(id=>byId.get(id)).filter(Boolean),groups=takeGroups();
    modal('拿取清单',`<p>保存这次要处理的条目。勾选「已拿到」会记录当前版本；以后版本变化时，概况会提示。</p>${groups.map(g=>`<section class="take-group"><h4>${esc(g.label)} ${esc(g.folder)}</h4>${g.items.map(r=>`<div class="take-row${takenDone.has(r.id)?' done':''}"><button class="text-button" data-detail-open="${esc(r.id)}">${esc(r.code)} · ${esc(r.name)}</button><span>${esc(r.version)}</span>${linksHtml(r,false)}<label><input type="checkbox" data-take-done="${esc(r.id)}" ${takenDone.has(r.id)?'checked':''}>已拿到</label><label><input type="checkbox" data-take-compare="${esc(r.id)}" ${state.compare.has(r.id)?'checked':''}>对比</label><button class="icon-button" data-take-remove="${esc(r.id)}" aria-label="移除 ${esc(r.name)}">×</button></div>`).join('')}</section>`).join('')||'<p>清单还是空的，点条目旁的「＋ 清单」加入。</p>'}<div class="detail-actions"><button id="takeCopy" class="secondary">复制清单</button>${items.length>1?'<button id="takeCompare" class="primary">并排对比</button>':''}<button id="takeClearDone" class="secondary">移走已拿到</button><button id="takeClear" class="secondary">清空清单</button></div>`,'拿取清单',{drawer:true});
    $('takeCopy').onclick=()=>copyText(takeText());
    $('takeClearDone').onclick=()=>{for(const id of takenDone)takeList.delete(id);persist();render();openTakeList();};
    $('takeClear').onclick=()=>{takeList.clear();persist();render();openTakeList();};
    if($('takeCompare'))$('takeCompare').onclick=()=>{const picked=items.filter(r=>state.compare.has(r.id));openCompare((picked.length>1?picked:items).slice(0,COMPARE_MAX),'拿取清单 · 并排对比');};
    $('modalBody').onclick=e=>{const remove=e.target.closest('[data-take-remove]'),d=e.target.closest('[data-detail-open]');if(remove){takeList.delete(remove.dataset.takeRemove);persist();render();openTakeList();}else if(d)detail(d.dataset.detailOpen);};
    $('modalBody').onchange=e=>{const done=e.target.closest('[data-take-done]'),cmp=e.target.closest('[data-take-compare]');if(done){const id=done.dataset.takeDone;if(done.checked){takenDone.add(id);takenVersions[id]=String(byId.get(id)?.version||'');takenDates[id]=new Date().toISOString();}else{takenDone.delete(id);delete takenVersions[id];delete takenDates[id];}persist();render();openTakeList();}if(cmp){const id=cmp.dataset.takeCompare;if(cmp.checked&&state.compare.size>=COMPARE_MAX){cmp.checked=false;return toast(`最多对比 ${COMPARE_MAX} 条`);}cmp.checked?state.compare.add(id):state.compare.delete(id);updateCompare();}};
  }
  function unpackWizard(){const steps=(meta.row5_steps||doc.steps||[]).filter(x=>x&&(x.title||x.body));modal('使用说明',`${meta.extract_guide?`<p>${esc(meta.extract_guide)}</p>`:''}${steps.map(x=>`<section class="guide-block"><b>${esc(x.title)}</b><p>${esc(x.body)}</p></section>`).join('')||'<p>尚未配置附加说明。</p>'}`,'使用说明');}

  function openChanges() {
    if (!changes || changes.first) return modal('本期变化', '<p>这是第一份带变化记录的目录，下一期起会列出新增、更新和移除的条目。</p>', '本期变化');
    const list = ids => ids.map(x => byId.get(typeof x === 'string' ? x : x.id)).filter(Boolean);
    const fieldsOf = new Map((changes.updated || []).map(u => [canonicalId(u.id), u.fields || []]));
    const row = r => `<li><button class="text-button" data-detail-open="${esc(r.id)}">${esc(r.code)} · ${esc(r.name)}</button>${fieldsOf.has(r.id) ? ` <span class="muted">（${esc(fieldsOf.get(r.id).join('、'))}）</span>` : ''}</li>`;
    const added = list(changes.added || []), updated = list(changes.updated || []);
    modal('本期变化', `<p>和上一期（${esc(changes.since || '')}）相比：新增 <b>${added.length}</b> 部，更新 <b>${updated.length}</b> 部，移除 <b>${(changes.removed || []).length}</b> 部。</p>
      <button class="primary" id="onlyEdition">只看这些条目</button>
      ${added.length ? `<h3>新增</h3><ul class="change-list">${added.map(row).join('')}</ul>` : ''}
      ${updated.length ? `<h3>更新</h3><ul class="change-list">${updated.map(row).join('')}</ul>` : ''}
      ${(changes.removed || []).length ? `<h3>移除</h3><ul class="change-list">${changes.removed.map(x => `<li>${esc(x.code)} · ${esc(x.name)}</li>`).join('')}</ul>` : ''}`, '本期变化');
    $('onlyEdition').onclick = () => { $('modal').close(); change('onlyNew', 'edition'); };
    $('modalBody').querySelectorAll('[data-detail-open]').forEach(b => b.onclick = () => detail(b.dataset.detailOpen));
  }
  const rankings = Array.isArray(meta.rankings) ? meta.rankings.filter(x => x && Array.isArray(x.tiers)) : [];
  // 月度名单：按分组列条目，点开看详情；可以整份加进拿取清单，或复制名单文字
  const monthLists = Array.isArray(meta.month_lists) ? meta.month_lists.filter(x => x && Array.isArray(x.groups)) : [];
  function openMonthLists(index = 0) {
    const ls = monthLists[index]; if (!ls) return modal('月度名单', '<p class="muted">还没有发布的月度名单。</p>', '月度名单');
    const ids = ls.groups.flatMap(g => g.items.map(it => it.id)).filter(id => id && byId.has(id));
    modal(ls.title || '月度名单', `${monthLists.length > 1 ? `<div class="ranking-tabs">${monthLists.map((x, i) => `<button class="chip${i === index ? ' active' : ''}" data-ml="${i}">${esc(x.title || '名单')}</button>`).join('')}</div>` : ''}
      <p class="muted">${ids.length} 部 · 点条目看详情</p>
      <div class="ml-actions"><button class="secondary" id="mlTakeAll">整份加入拿取清单</button><button class="secondary" id="mlCopy">复制名单文字</button></div>
      ${ls.groups.map(g => `<div class="ml-group">${g.title ? `<h4>${esc(g.title)} <span class="muted">${g.items.length}</span></h4>` : ''}<div class="ml-items">${g.items.map(it => {
        const r = it.id && byId.get(it.id);
        return r ? `<button class="ml-item" data-detail-open="${esc(r.id)}">${it.star ? '<b class="ml-star">★</b>' : ''}<span class="mono">${esc(r.code)}</span><span class="ml-name">${esc(r.name.replace(/^更新\s*/, ''))}</span>${(it.marks || []).map(m => `<span class="chip">${esc(m)}</span>`).join('')}${takeList.has(r.id) ? '<span class="muted">☑</span>' : ''}</button>`
          : `<div class="ml-item muted">${esc(it.text || '')}</div>`;
      }).join('')}</div></div>`).join('')}`, '月度名单');
    $('modal').classList.add('wide');
    $('modalBody').querySelectorAll('[data-detail-open]').forEach(b => b.onclick = () => { $('modal').classList.remove('wide'); detail(b.dataset.detailOpen); });
    $('modalBody').querySelectorAll('[data-ml]').forEach(b => b.onclick = () => openMonthLists(+b.dataset.ml));
    $('mlTakeAll').onclick = () => { ids.forEach(id => takeList.add(id)); persist(); render(); toast(`已把 ${ids.length} 部加入拿取清单`); openMonthLists(index); };
    $('mlCopy').onclick = () => copyText(ls.text || '', '名单文字已复制');
  }
  function openRankings(index = 0) {
    const rk = rankings[index]; if (!rk) return modal('精选名单', '<p class="muted">还没有发布的榜单。</p>', '精选名单');
    const tierColors = ['#f28b82', '#f6ad55', '#f6e05e', '#68d391', '#63b3ed', '#b794f4'];
    modal(rk.title || '精选名单', `${rankings.length > 1 ? `<div class="ranking-tabs">${rankings.map((x, i) => `<button class="chip${i === index ? ' active' : ''}" data-rank="${i}">${esc(x.title || '榜单')}</button>`).join('')}</div>` : ''}
      <p class="muted">${esc(rk.period || '')}${rk.note ? ' · ' + esc(rk.note) : ''}</p>
      ${rk.image ? `<div class="ranking-image"><img src="${esc(CatalogImages.url(rk.image))}" alt="${esc(rk.title || '榜单')}">${(rk.regions || []).filter(g => byId.has(g.id)).map(g => `<button class="hotspot" style="left:${+g.x}%;top:${+g.y}%;width:${+g.w}%;height:${+g.h}%" data-detail-open="${esc(g.id)}" title="${esc(byId.get(g.id).name)}"></button>`).join('')}</div><p class="muted">点图上的条目可以打开详情。</p>` : ''}
      <div class="tiers">${rk.tiers.map((t, i) => `<div class="tier"><div class="tier-name" style="background:${tierColors[i % tierColors.length]}">${esc(t.name)}</div><div class="tier-items">${(t.items || []).filter(it => byId.has(it.id)).map(it => {
        const r = byId.get(it.id);
        // 有封面显示封面；没有的话用条目配色加名称首字，和有封面的排成一样大小
        const cover = (meta.ranking_covers || {})[r.id], [c1, c2] = r.palette || ['#dfe6e2', '#6b8f7d'];
        const pic = cover ? `<img src="${esc(CatalogImages.url(cover))}" alt="" loading="lazy">` : `<i class="tier-ph" style="background:linear-gradient(135deg,${esc(c1)},${esc(c2)})">${esc([...r.name.replace(/^更新\s*/, '')].slice(0, 2).join(''))}</i>`;
        return `<button class="tier-item has-cover" data-detail-open="${esc(r.id)}" title="${esc(it.note || r.name)}">${pic}<span>${esc(r.name.replace(/^更新\s*/, ''))}</span>${it.score !== undefined && it.score !== '' ? `<b>${esc(it.score)}</b>` : ''}</button>`;
      }).join('') || '<span class="muted">—</span>'}</div></div>`).join('')}</div>`, '精选名单');
    $('modal').classList.add('wide');
    $('modalBody').querySelectorAll('[data-detail-open]').forEach(b => b.onclick = () => { $('modal').classList.remove('wide'); detail(b.dataset.detailOpen); });
    $('modalBody').querySelectorAll('[data-rank]').forEach(b => b.onclick = () => openRankings(+b.dataset.rank));
  }
  // 关闭事件会晚一步触发；如果这时已经打开了新的弹窗，就不要去掉它的宽版样式
  $('modal').addEventListener('close', () => { if (!$('modal').open) $('modal').classList.remove('wide', 'drawer'); });
  // 点「夸克合集 / 百度合集」时先复制编号，链接照常打开
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-copy-open]');
    if (a) copyText(a.dataset.copyOpen,'查找文字已复制');
    // 详情弹窗里的「＋ 清单」
    const take = e.target.closest('#modalBody [data-take]');
    if (take) { e.preventDefault(); toggleTake(take.dataset.take); if (!$('takeList')) detail(take.dataset.take); }
  }, true);
  function renderNotices() {
    const host=$('workbookNotice'),messages=[],edition=String(meta.reader_edition||[meta.update_date,meta.ui_config_revision,meta.warning].join('|'));
    if(!saved.noticeDismissed||saved.noticeDismissed.edition!==edition)saved.noticeDismissed={edition,types:[]};
    const days=Number(pageConfig.stale_days??0),date=Date.parse(String(meta.update_date||'')+'T00:00:00'),age=Math.floor((Date.now()-date)/86400000),latest=RC.url(meta.latest_catalog_url);
    if(days>0&&Number.isFinite(age)&&age>days)messages.push({type:'stale',html:`这份表 ${esc(meta.update_date)} · 已过 ${age} 天${latest?` <a href="${esc(latest)}" target="_blank" rel="noopener noreferrer">下载最新版 ↗</a>`:''}`});
    if(notice.trim())messages.push({type:'announcement',html:esc(notice)});
    let cursor=0,rotation=null;
    const visible=()=>messages.filter(m=>!saved.noticeDismissed.types.includes(m.type));
    const height=()=>document.documentElement.style.setProperty('--notice-h',host.hidden?'0px':host.offsetHeight+'px');
    const draw=()=>{const list=visible();host.hidden=!list.length;if(!list.length){clearInterval(rotation);height();return;}cursor%=list.length;const m=list[cursor];host.dataset.kind=m.type;$('noticeText').innerHTML=m.html;host.classList.remove('open');$('noticeText').setAttribute('aria-expanded','false');height();};
    $('noticeText').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('noticeText').click();}};
    $('noticeText').onclick=e=>{if(e.target.closest('a'))return;const open=host.classList.toggle('open');$('noticeText').setAttribute('aria-expanded',String(open));height();};
    $('noticeClose').onclick=()=>{const list=visible();if(!list.length||!confirm('关闭这条提醒？当前这份表会记住，新导出的表会恢复。'))return;saved.noticeDismissed.types.push(list[cursor].type);persist();draw();};
    if('ResizeObserver'in window)new ResizeObserver(height).observe(host);
    rotation=setInterval(()=>{if(!host.classList.contains('open')&&visible().length>1){cursor++;draw();}},6000);addEventListener('pagehide',()=>clearInterval(rotation));draw();
  }
  // 搜索框旁边：要不要连更新日志一起搜
  (() => {
    const label = document.createElement('label');
    label.className = 'check-label search-notes';
    label.innerHTML = '<input type="checkbox" id="searchNotes"> 含更新日志';
    $('search').closest('.search-box').after(label);
    $('searchNotes').onchange = () => change('searchNotes', $('searchNotes').checked);
  })();

  for(const [key,mount] of [['genre','genreChips'],['platform','platformChips'],['author','hotAuthors']]){const row=$(mount).closest('.filter-row');row.hidden=!field(key).visible;row.querySelector('.filter-label').textContent=field(key).label;}
  $('toggleAuthors').hidden=!field('author').visible;
  extraMount.closest('.filter-row').hidden=!extraMarkers.length;
  $('takeOpen').hidden=meta.modules?.downloads!==true;
  $('blurToggle').checked=saved.backdropBlur!==false;document.documentElement.classList.toggle('no-backdrop-blur',saved.backdropBlur===false);
  $('blurToggle').onchange=()=>{saved.backdropBlur=$('blurToggle').checked;document.documentElement.classList.toggle('no-backdrop-blur',!saved.backdropBlur);persist();};
  $('pwdChip').title=topNotice.copyable?'复制顶部提示':'展开顶部提示';
  $('brandTitle').textContent=meta.title||'__PRODUCT_NAME__';
  window.JiyeReaderMobile?.mount({change,openTakeList,openMore:()=>openCollectionManager(),showFilters,menu,latest:RC.url(meta.latest_catalog_url),downloads:meta.modules?.downloads===true});
  applyPageSettings();
  renderNotices();
  if ('requestIdleCallback' in window) requestIdleCallback(() => setupBackground(), {timeout:1200});
  else setTimeout(setupBackground, 120);

    const discoveryActionGroups=[$('expandTags').parentElement,$('expandAuthors').parentElement];
  const discoveryOrigins={};
  const discoveryActionHolders=discoveryActionGroups.map(group=>group.parentElement);
  let expandTagList=false,expandAuthorList=false;
  function renderDiscoverySearch() {
    discoveryActionGroups.forEach((group,index)=>discoveryActionHolders[index].appendChild(group));
    const tq=$('inlineTagSearch').value.trim().toLocaleLowerCase();
    const aq=$('inlineAuthorSearch').value.trim().toLocaleLowerCase();
    const tags=(tq?tagList.filter(t=>normalizeSearch(t).includes(normalizeSearch(tq))):expandTagList?tagList:[...topTags]).sort((a,b)=>(tagCounts.get(b)-tagCounts.get(a))||a.localeCompare(b,'zh-CN'));
    chips('tagChips',expandTagList?tags:tags.slice(0,24),'tag');
    const matches=authors.filter(a=>normalizeSearch(a).includes(normalizeSearch(aq))).sort((a,b)=>(authorCounts.get(b)-authorCounts.get(a))||a.localeCompare(b,'zh-CN'));
    const shown=expandAuthorList?matches:aq?matches.slice(0,24):popularAuthors;
    $('hotAuthors').innerHTML=['',...shown].map(a=>{const active=a?state.author.split('\u001f').includes(a):!state.author;return `<button class="chip${active?' active':''}" data-hot-author="${esc(a)}" aria-pressed="${active}">${esc(a||'全部')}${a?` <span class="author-count">${authorCounts.get(a)}</span>`:''}</button>`;}).join('');
    const expandedOptions=(values,field,attribute,counts)=>['',...values].map(value=>{
      const active=value?state[field].split('\u001f').includes(value):!state[field];
      return `<button class="chip expanded-option${active?' active':''}" ${attribute}="${esc(value)}" aria-pressed="${active}"><span class="option-name">${esc(value||'全部')}</span><span class="option-count">${value?counts.get(value)||0:data.length}</span></button>`;
    }).join('');
    if(expandTagList)$('tagChips').innerHTML=expandedOptions(tags,'tag','data-tag',tagCounts);
    if(expandAuthorList)$('hotAuthors').innerHTML=expandedOptions(shown,'author','data-hot-author',authorCounts);
    $('tagSearchHint').textContent=tq?(tags.length?`找到 ${tags.length} 个标签${!expandTagList&&tags.length>24?'，先显示24个':''}`:'没有匹配的标签'):'';
    $('authorSearchHint').textContent=aq?(matches.length?`找到 ${matches.length} 个作者${!expandAuthorList&&matches.length>24?'，先显示24个':''}`:'没有匹配的作者'):'';
    for(const [id,expanded,target] of [['expandTags',expandTagList,'tagChips'],['expandAuthors',expandAuthorList,'hotAuthors']]){$(id).textContent=expanded?'收起 ↑':'展开全部 ↓';$(id).setAttribute('aria-expanded',String(expanded));$(target).classList.toggle('expanded-chips',expanded);}
  }
  const originalDiscoveryRender=renderDiscoverySearch;
  function markCombinedPickerButtons(){
    const tagAll=$('tagChips').querySelector('[data-tag=""]');
    const authorAll=$('hotAuthors').querySelector('[data-hot-author=""]');
    if(tagAll){tagAll.dataset.openPicker='tag';tagAll.title='打开全部标签并多选';}
    if(authorAll){authorAll.dataset.openPicker='author';authorAll.title='打开全部作者并多选';}
  }
  renderDiscoverySearch=function(){
    originalDiscoveryRender();
    discoveryActionGroups.forEach((group,index)=>discoveryActionHolders[index].append(group));
    markCombinedPickerButtons();
    // 展开按钮写上一共有多少个，知道后面还有多少
    $('expandTags').textContent=expandTagList?'收起 ↑':`展开全部 ${tagList.length} 个 ↓`;
    $('expandAuthors').textContent=expandAuthorList?'收起 ↑':`展开全部 ${authors.length} 个 ↓`;
  };
  $('expandTags').onclick=()=>{if(!expandTagList)discoveryOrigins.tag=scrollY;expandTagList=!expandTagList;renderDiscoverySearch();if(!expandTagList)scrollTo({top:discoveryOrigins.tag||0,behavior:'instant'});};
  $('expandAuthors').onclick=()=>{if(!expandAuthorList)discoveryOrigins.author=scrollY;expandAuthorList=!expandAuthorList;renderDiscoverySearch();if(!expandAuthorList)scrollTo({top:discoveryOrigins.author||0,behavior:'instant'});};
  document.addEventListener('keydown',e=>{if(e.key!=='Escape'||$('modal').open)return;if(expandTagList||expandAuthorList){e.preventDefault();e.stopImmediatePropagation();const origin=expandTagList?discoveryOrigins.tag:discoveryOrigins.author;expandTagList=false;expandAuthorList=false;renderDiscoverySearch();scrollTo({top:origin||0,behavior:'instant'});}},true);
  $('inlineTagSearch').oninput=renderDiscoverySearch;
  $('inlineAuthorSearch').oninput=renderDiscoverySearch;

  // Keep the native select as the single state source; provide a themed popup.
  function enhanceSelect(select) {
    const wrap=document.createElement('div');wrap.className='styled-select';
    select.before(wrap);wrap.append(select);select.classList.add('native-select-source');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const button=document.createElement('button');button.type='button';button.className='select-trigger';
    button.setAttribute('aria-label',select.getAttribute('aria-label')||'选择选项');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
    const list=document.createElement('div');list.className='select-options';list.hidden=true;list.setAttribute('role','listbox');list.setAttribute('aria-label',button.getAttribute('aria-label'));
    wrap.append(button,list);
    const multi=['month','author'].includes(select.id);
    if(multi)list.setAttribute('aria-multiselectable','true');
    const selected=option=>multi?(option.value?state[select.id].split('\u001f').includes(option.value):!state[select.id]):option.selected;
    const sync=()=>{button.textContent=(multi?[...select.options].filter(selected).map(o=>o.textContent).join('、'):select.selectedOptions[0]?.textContent)||'请选择';button.disabled=select.disabled;button.title=button.textContent;};
    const close=(focus=false)=>{list.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus();};
    function open(){
      document.dispatchEvent(new Event('close-select-popups'));
      list.textContent="";for(const option of select.options){const b=document.createElement('button');b.type='button';b.textContent=option.textContent;b.setAttribute('role','option');b.setAttribute('aria-selected',String(selected(option)));b.disabled=option.disabled;b.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close(true);};list.append(b);}
      list.hidden=false;button.setAttribute('aria-expanded','true');wrap.classList.toggle('opens-up',window.innerHeight-button.getBoundingClientRect().bottom<260);
      (list.querySelector('[aria-selected="true"]')||list.firstElementChild)?.focus();
    }
    button.onclick=()=>list.hidden?open():close();
    button.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}};
    list.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}
      if(e.key==='Tab'){close();return;}
      const choices=[...list.querySelectorAll('button:not(:disabled)')],index=choices.indexOf(document.activeElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();choices[e.key==='Home'?0:e.key==='End'?choices.length-1:(index+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length]?.focus();}
    };
    document.addEventListener('click',e=>{if(!wrap.contains(e.target))close();});document.addEventListener('close-select-popups',()=>close());
    select.addEventListener('change',sync);new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true});sync();
    return sync;
  }
  const syncSelectControls=[...document.querySelectorAll('select:not([hidden])')].map(enhanceSelect);

  if(saved.paletteRevision!==2){saved.theme=pageConfig.theme || 'eye';saved.paletteRevision=2;}
  { const o = readHash(); if (o) restoreSnapshot(o); }
  setTheme(saved.theme); updateHero(); apply(); persist();
  if (storageWarning) toast('未能读取本地设置，已使用默认显示。');
})();
