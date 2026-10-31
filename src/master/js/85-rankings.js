// 目录母版 · 榜单（夯榜）：从目录里挑作品排进档位，可以填分数和一句话；
// 也可以放一张榜单图，在图上框出作品，读者点图就能打开那部作品。导出时勾了「发布」的榜单进分发版。
const DEFAULT_TIERS = ['夯爆', '小夯', '不夯', '路边'];
const TIER_COLORS = ['#f28b82', '#f6ad55', '#f6e05e', '#68d391', '#63b3ed', '#b794f4'];
let rankSel = null;
const rankingsOf = () => project.rankings || [];
function setRankings(next, label) {
  return commit(label, [{kind: 'project', path: ['rankings'], before: clone(project.rankings || []), after: next}]);
}
function editRanking(fn, label) {
  const next = clone(rankingsOf());
  const rk = next.find(x => x.id === rankSel);
  if (!rk) return;
  fn(rk, next);
  setRankings(next, label);
  renderRankings();
}
let rankQuery = '';
function rankItemName(id) { const r = byId.get(id); return r ? r.name : `（已不在目录里：${id}）`; }

function renderRankings() {
  const list = rankingsOf();
  if (!rankSel || !list.some(x => x.id === rankSel)) rankSel = list[0]?.id || null;
  const rk = list.find(x => x.id === rankSel);
  $('pane-rankings').innerHTML = `<div class="pane-inner rankings">
    <div class="pane-head"><h2>榜单</h2><span class="spacer"></span><button id="rkNew" class="primary">＋ 新建榜单</button></div>
    <p class="count">从目录里挑作品排进档位，可以填分数和一句话短评。勾「发布到分发版」的榜单，读者在左侧导航「夯榜」里能看到，点作品就打开详情。</p>
    <div class="rk-list">${list.map(x => `<button class="rk-tab${x.id === rankSel ? ' on' : ''}" data-rk="${x.id}">${esc(x.title || '未命名榜单')}<small>${esc(x.period || '')}${x.published ? ' · 已发布' : ''}</small></button>`).join('') || '<span class="count">还没有榜单。</span>'}</div>
    ${rk ? rankingEditor(rk) : ''}</div>`;
  const pane = $('pane-rankings');
  $('rkNew').onclick = () => {
    const id = 'rk' + Date.now().toString(36);
    const now = new Date();
    setRankings([...clone(rankingsOf()), {id, title: `${now.getMonth() + 1}月夯榜`, period: `${now.getFullYear()}年${now.getMonth() + 1}月`, note: '', published: false,
      tiers: DEFAULT_TIERS.map(name => ({name, items: []})), regions: []}], '新建榜单');
    rankSel = id;
    renderRankings();
  };
  pane.querySelectorAll('[data-rk]').forEach(b => b.onclick = () => { rankSel = b.dataset.rk; renderRankings(); });
  if (rk) bindRankingEditor(rk);
}

function rankingEditor(rk) {
  const img = rk.imageId ? (project.rankingImages || {})[rk.imageId] : '';
  return `<section class="section">
    <div class="grid2">
      <div class="field"><label for="rk_title">标题</label><input id="rk_title" value="${esc(rk.title || '')}"></div>
      <div class="field"><label for="rk_period">时期</label><input id="rk_period" value="${esc(rk.period || '')}" placeholder="例：2025年7–10月"></div>
      <div class="field wide"><label for="rk_note">说明（可空）</label><input id="rk_note" value="${esc(rk.note || '')}" placeholder="例：分数来自本月读者投票"></div>
      <label class="wide"><input type="checkbox" id="rk_pub" ${rk.published ? 'checked' : ''}> 发布到分发版（读者在左侧「夯榜」里看到，带封面）</label>
    </div>
    <div class="row-inline"><button id="rk_png" class="primary">导出图片</button><label><input type="checkbox" id="rk_pngNames" ${rk.pngNames ? 'checked' : ''}> 图上在封面下写作品名</label><span data-cover-hint></span><span class="spacer"></span><button id="rk_del">删除这个榜单</button></div>
    <p class="count">导出图：每档一排封面，分数压在封面上。${esc(exportWhere(`${rk.title || '夯榜'}.jpg`))}</p>
  </section>
  <section class="section">
    <h3>加作品</h3>
    <div class="rk-add"><input id="rk_q" placeholder="搜名称或编号" autocomplete="off"><select id="rk_tier">${rk.tiers.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}</select></div>
    <div class="rk-results" id="rk_results"></div>
  </section>
  <section class="section">
    <div class="pane-head"><h3>档位</h3><span class="spacer"></span><button id="rk_addTier">＋ 加一档</button></div>
    <p class="count">把作品拖到别的档位，或用 ← → 调整顺序；分数和短评直接改。</p>
    <div class="rk-tiers">${rk.tiers.map((t, ti) => `<div class="rk-tier" data-tier="${ti}">
      <div class="rk-tier-name" style="background:${TIER_COLORS[ti % TIER_COLORS.length]}"><input value="${esc(t.name)}" data-tier-name="${ti}" aria-label="档位名称">
        <div class="rk-tier-tools"><button data-tier-up="${ti}" title="上移" ${ti ? '' : 'disabled'}>↑</button><button data-tier-down="${ti}" title="下移" ${ti < rk.tiers.length - 1 ? '' : 'disabled'}>↓</button><button data-tier-del="${ti}" title="删除这一档（作品一起移出）">×</button></div></div>
      <div class="rk-items" data-drop="${ti}">${t.items.map((it, ii) => `<div class="rk-item" draggable="true" data-item="${ti}:${ii}">
        ${byId.has(it.id) ? coverHtml(byId.get(it.id), 'xs') : ''}
        <span class="rk-name" title="${esc(rankItemName(it.id))}">${esc(rankItemName(it.id))}</span>
        <input class="rk-score" data-score="${ti}:${ii}" value="${esc(it.score ?? '')}" placeholder="分" aria-label="分数">
        <input class="rk-note" data-note="${ti}:${ii}" value="${esc(it.note || '')}" placeholder="短评" aria-label="短评">
        <span class="rk-tools"><button data-move="${ti}:${ii}:-1" title="往前">←</button><button data-move="${ti}:${ii}:1" title="往后">→</button><button data-remove="${ti}:${ii}" title="移出榜单">×</button></span>
      </div>`).join('') || '<span class="count">拖作品到这里，或在上面搜索后加进来</span>'}</div></div>`).join('')}</div>
  </section>
  <section class="section">
    <h3>榜单图（可选）</h3>
    <p class="count">放一张榜单截图，在图上按住鼠标拖出一个框，再选对应的作品。读者点图上的框就能打开那部作品。图片会压缩后放进母版${rk.published ? '和分发版' : ''}。</p>
    <div class="row-inline"><label class="file-btn">${img ? '换一张图' : '选择图片'}<input type="file" id="rk_img" accept="image/png,image/jpeg,image/webp" hidden></label>${img ? '<button id="rk_imgDel">去掉图片</button>' : ''}</div>
    ${img ? `<div class="rk-image" id="rk_canvas"><img src="${esc(CatalogImages.url(img))}" alt="" draggable="false">${(rk.regions || []).map((g, i) => `<div class="rk-region" style="left:${g.x}%;top:${g.y}%;width:${g.w}%;height:${g.h}%" title="${esc(rankItemName(g.id))}"><button data-region-del="${i}" title="删除这个框">×</button><span>${esc(rankItemName(g.id))}</span></div>`).join('')}<div class="rk-drawing" id="rk_draw" hidden></div></div>
      <div id="rk_bind" class="rk-bind" hidden><input id="rk_bindQ" placeholder="这个框是哪部作品？搜名称或编号" autocomplete="off"><div class="rk-results" id="rk_bindResults"></div><button id="rk_bindCancel">取消</button></div>` : ''}
  </section>`;
}

// 榜单、名单里的「搜一部作品」：名称、编号、日文名、拼音全拼或首字母都行
function searchCards(q, limit = 8) {
  const tokens = String(q || '').trim().split(/\s+/).map(normalizeSearch).filter(Boolean);
  if (!tokens.length) return [];
  return cards.filter(r => { const hay = normalizeSearch(r.code + ' ' + r.name) + ' ' + searchPinyin(r); return tokens.every(t => hay.includes(t)); }).slice(0, limit);
}
function bindRankingEditor(rk) {
  const pane = $('pane-rankings');
  const field = (id, key) => $(id).addEventListener('change', e => editRanking(x => { x[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim(); }, `改榜单${{title: '标题', period: '时期', note: '说明', published: '发布', pngNames: '导出图样式'}[key]}`));
  field('rk_title', 'title'); field('rk_period', 'period'); field('rk_note', 'note'); field('rk_pub', 'published'); field('rk_pngNames', 'pngNames');
  $('rk_del').onclick = () => { setRankings(rankingsOf().filter(x => x.id !== rk.id).map(clone), `删除榜单「${rk.title}」`); rankSel = null; renderRankings(); };
  $('rk_png').onclick = () => busy($('rk_png'), '正在画图…', () => exportRankingPng(rk));
  refreshCoverHints();
  // 加作品
  const showResults = () => {
    $('rk_results').innerHTML = searchCards($('rk_q').value).map(r => `<button data-add="${esc(r.id)}"><span class="mono">${esc(r.code)}</span> ${esc(r.name)}</button>`).join('');
  };
  $('rk_q').value = rankQuery;
  showResults();
  $('rk_q').addEventListener('input', () => { rankQuery = $('rk_q').value; showResults(); });
  $('rk_results').addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const ti = +$('rk_tier').value;
    editRanking(x => { if (!x.tiers.some(t => t.items.some(it => it.id === b.dataset.add))) x.tiers[ti].items.push({id: b.dataset.add, score: '', note: ''}); }, `榜单加入：${byId.get(b.dataset.add)?.code}`);
    $('rk_tier').value = String(ti);
    $('rk_q').focus();
  });
  // 档位
  $('rk_addTier').onclick = () => editRanking(x => { x.tiers.push({name: '新档位', items: []}); }, '榜单加一档');
  pane.querySelectorAll('[data-tier-name]').forEach(el => el.addEventListener('change', () => editRanking(x => { x.tiers[+el.dataset.tierName].name = el.value.trim() || '未命名'; }, '改档位名称')));
  pane.querySelectorAll('[data-tier-up],[data-tier-down]').forEach(b => b.onclick = () => editRanking(x => {
    const i = +(b.dataset.tierUp ?? b.dataset.tierDown), j = b.dataset.tierUp !== undefined ? i - 1 : i + 1;
    [x.tiers[i], x.tiers[j]] = [x.tiers[j], x.tiers[i]];
  }, '调整档位顺序'));
  pane.querySelectorAll('[data-tier-del]').forEach(b => b.onclick = () => editRanking(x => { x.tiers.splice(+b.dataset.tierDel, 1); }, '删除档位'));
  // 作品：分数、短评、顺序、移出
  const at = s => s.split(':').map(Number);
  pane.querySelectorAll('[data-score],[data-note]').forEach(el => el.addEventListener('change', () => {
    const [ti, ii] = at(el.dataset.score || el.dataset.note);
    editRanking(x => { x.tiers[ti].items[ii][el.dataset.score ? 'score' : 'note'] = el.value.trim(); }, el.dataset.score ? '改分数' : '改短评');
  }));
  pane.querySelectorAll('[data-move]').forEach(b => b.onclick = () => {
    const [ti, ii, d] = at(b.dataset.move);
    editRanking(x => { const items = x.tiers[ti].items, j = ii + d; if (j < 0 || j >= items.length) return; [items[ii], items[j]] = [items[j], items[ii]]; }, '调整作品顺序');
  });
  pane.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    const [ti, ii] = at(b.dataset.remove);
    editRanking(x => { x.tiers[ti].items.splice(ii, 1); }, '移出榜单');
  });
  // 拖动到别的档位
  let dragging = null;
  pane.querySelectorAll('[data-item]').forEach(el => {
    el.addEventListener('dragstart', e => { dragging = el.dataset.item; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
  pane.querySelectorAll('[data-drop]').forEach(zone => {
    zone.addEventListener('dragover', e => { if (dragging) { e.preventDefault(); zone.classList.add('over'); } });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('over');
      if (!dragging) return;
      const [ti, ii] = at(dragging), to = +zone.dataset.drop;
      dragging = null;
      if (ti === to) return;
      editRanking(x => { const [it] = x.tiers[ti].items.splice(ii, 1); x.tiers[to].items.push(it); }, `移到「${rk.tiers[to].name}」`);
    });
  });
  // 榜单图
  $('rk_img').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await shrinkImage(file);
      project.rankingImages = project.rankingImages || {};
      const imgId = rk.imageId || 'img' + Date.now().toString(36);
      project.rankingImages[imgId] = data;
      editRanking(x => { x.imageId = imgId; if (!rk.imageId) x.regions = []; }, '放入榜单图');
      markDirty();
      setStatus(`已放入榜单图（压缩后约 ${Math.round(data.length * 0.75 / 1024)} KB）。`, 'dirty');
    } catch (error) { setStatus('图片读不出来：' + error.message, 'error'); }
  });
  if ($('rk_imgDel')) $('rk_imgDel').onclick = () => editRanking(x => { x.imageId = ''; x.regions = []; }, '去掉榜单图');
  if ($('rk_canvas')) bindRegionDrawing(rk);
}
// 压缩：最长边默认 1600 像素，转成 WebP（不支持时用 JPEG）
async function shrinkImage(file, max = 1600, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('不是图片')); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const webp = c.toDataURL('image/webp', quality);
    return webp.startsWith('data:' + 'image/webp') ? webp : c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}
// 图上框选：鼠标移动 / 松开的监听只装一次，用 regionDraw 记住当前这张图
const regionDraw = {start: null, rect: null, box: null};
const regionPct = e => { const b = regionDraw.box.getBoundingClientRect(); return {x: Math.max(0, Math.min(100, (e.clientX - b.left) / b.width * 100)), y: Math.max(0, Math.min(100, (e.clientY - b.top) / b.height * 100))}; };
window.addEventListener('mousemove', e => {
  const d = regionDraw;
  if (!d.start || !d.box?.isConnected) return;
  const p = regionPct(e);
  d.rect = {x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y)};
  Object.assign($('rk_draw').style, {left: d.rect.x + '%', top: d.rect.y + '%', width: d.rect.w + '%', height: d.rect.h + '%'});
});
window.addEventListener('mouseup', () => {
  const d = regionDraw;
  if (!d.start || !d.box?.isConnected) return;
  d.start = null;
  if (!d.rect || d.rect.w < 1 || d.rect.h < 1) { $('rk_draw').hidden = true; return; }
  $('rk_bind').hidden = false;
  $('rk_bindQ').focus();
});
function bindRegionDrawing(rk) {
  const box = $('rk_canvas'), draw = $('rk_draw');
  regionDraw.box = box; regionDraw.start = null; regionDraw.rect = null;
  box.addEventListener('mousedown', e => {
    if (e.target.closest('button') || e.button !== 0) return;
    e.preventDefault();
    regionDraw.start = regionPct(e); regionDraw.rect = null;
    draw.hidden = false;
    Object.assign(draw.style, {left: regionDraw.start.x + '%', top: regionDraw.start.y + '%', width: '0', height: '0'});
  });
  $('rk_bindQ').addEventListener('input', () => {
    $('rk_bindResults').innerHTML = searchCards($('rk_bindQ').value).map(r => `<button data-bind="${esc(r.id)}"><span class="mono">${esc(r.code)}</span> ${esc(r.name)}</button>`).join('');
  });
  $('rk_bindResults').addEventListener('click', e => {
    const b = e.target.closest('[data-bind]');
    const rect = regionDraw.rect;
    if (!b || !rect) return;
    const g = {x: +rect.x.toFixed(2), y: +rect.y.toFixed(2), w: +rect.w.toFixed(2), h: +rect.h.toFixed(2), id: b.dataset.bind};
    editRanking(x => { x.regions = [...(x.regions || []), g]; }, `图上框选：${byId.get(g.id)?.code}`);
  });
  $('rk_bindCancel').onclick = () => { $('rk_bind').hidden = true; draw.hidden = true; regionDraw.rect = null; };
  box.querySelectorAll('[data-region-del]').forEach(b => b.onclick = () => editRanking(x => { x.regions.splice(+b.dataset.regionDel, 1); }, '删除图上的框'));
}

// 导出图片：和常见的夯榜图一样，每档一排封面，分数压在封面上（可选在封面下方写作品名）
async function exportRankingPng(rk) {
  const font = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif';
  const W = 1400, pad = 24, labelW = 170, tile = 150, gap = 4, names = !!rk.pngNames;
  const tileH = tile + (names ? 30 : 0), perRow = Math.max(1, Math.floor((W - pad * 2 - labelW - gap) / (tile + gap)));
  const ids = [...new Set(rk.tiers.flatMap(t => t.items.map(it => it.id)).filter(id => byId.has(id)))];
  const images = new Map(await Promise.all(ids.map(async id => [id, await loadCoverImage(byId.get(id))])));
  const rows = rk.tiers.map(t => { const items = t.items.filter(it => byId.has(it.id)); return {name: t.name, items, h: Math.max(1, Math.ceil(items.length / perRow)) * (tileH + gap) + gap}; });
  const headH = 104, H = headH + rows.reduce((s, r) => s + r.h + 6, 0) + pad;
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), dpr = 2;
  c.width = W * dpr; c.height = H * dpr; ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0f1013'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.font = `800 38px ${font}`; ctx.fillText(rk.title || '夯榜', pad, 56);
  ctx.fillStyle = '#9aa3b2'; ctx.font = `400 18px ${font}`; ctx.fillText([rk.period, rk.note].filter(Boolean).join(' · '), pad, 86);
  let y = headH;
  rows.forEach((row, i) => {
    ctx.fillStyle = TIER_COLORS[i % TIER_COLORS.length]; ctx.fillRect(pad, y, labelW, row.h);
    ctx.fillStyle = '#1b1b1b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const size = row.name.length > 3 ? 28 : 40;
    ctx.font = `800 ${size}px ${font}`;
    const lines = wrapLines(ctx, row.name, labelW - 20, 3);
    lines.forEach((t, k) => ctx.fillText(t, pad + labelW / 2, y + row.h / 2 + (k - (lines.length - 1) / 2) * (size + 6)));
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#2a2c31'; ctx.fillRect(pad + labelW, y, W - pad * 2 - labelW, row.h);
    row.items.forEach((it, k) => {
      const r = byId.get(it.id), x = pad + labelW + gap + (k % perRow) * (tile + gap), ty = y + gap + Math.floor(k / perRow) * (tileH + gap);
      drawCover(ctx, images.get(it.id), r, x, ty, tile, tile, font);
      const score = String(it.score ?? '').trim();
      if (score) {
        ctx.font = `900 40px ${font}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
        ctx.lineWidth = 7; ctx.strokeStyle = '#d7263d'; ctx.strokeText(score, x + tile / 2, ty + 46);
        ctx.fillStyle = '#fff'; ctx.fillText(score, x + tile / 2, ty + 46);
        ctx.textAlign = 'left';
      }
      if (names) {
        ctx.fillStyle = '#1d1f24'; ctx.fillRect(x, ty + tile, tile, 30);
        ctx.fillStyle = '#e9ecf1'; ctx.font = `500 14px ${font}`;
        ctx.fillText(wrapLines(ctx, shortName(r), tile - 12, 1)[0] || '', x + 6, ty + tile + 20);
      }
    });
    y += row.h + 6;
  });
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
  const missing = [...images.values()].filter(v => !v).length;
  const res = await writeFile('img:' + rk.id, blob, `${rk.title || '夯榜'}.jpg`, {'image/jpeg': ['.jpg']}, 'JPG 图片');
  if (!res.cancelled) setStatus((res.written ? `已写入榜单图：${res.name}` : `已开始下载榜单图：${res.name}`) + (missing ? `。${missing} 部没取到封面，用了配色占位，点榜单里的封面可以换` : ''), 'ok');
  refreshCoverHints();
}
tabHandlers.rankings = renderRankings;
onChange(info => { if (!$('pane-rankings').hidden && /撤销|重做/.test(info?.label || '')) renderRankings(); });
