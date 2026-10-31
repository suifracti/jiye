// 目录母版 · 封面：自己选的图优先；其次使用明确配置的来源封面；都没有就用作品配色做占位。
// 名单、榜单、详情栏和导出的图片都用这一套。自己选的图压缩成小图存进母版（project.covers）。
const coverStore = () => project.covers || (project.covers = {});
// 不用封面：全部关（设置里「显示作品封面」）或者单部关（project.coverOff），关了就只用配色占位
const coversOn = () => (meta.ui_config || {}).show_covers !== false;
const coverOffStore = () => project.coverOff || {};
const coverMissing = new Set();   // 取图失败的条目（保留失败状态供重试）

// 资料来源返回的封面可选加载，默认不联网。
const steamAppId = r => String((r.web_info || {}).appid || '');
function autoCoverUrl(r) {
  const w=r.web_info||{}, value=w.cover_url||w.cover||w.image_url||(project.steamCovers||{})[steamAppId(r)]||r.cover_url||'';
  return /^(?:data:|blob:)/.test(value) || (meta.ui_config?.allow_remote_images && /^https?:\/\//i.test(value)) ? value : '';
}
const coverSrc = r => r && coversOn() && !coverOffStore()[r.id] ? CatalogImages.url(coverStore()[r.id] || autoCoverUrl(r)) : '';
function coverKind(r) {
  if (!coversOn()) return '不用封面（设置里关掉了全部作品的封面）';
  if (coverOffStore()[r.id]) return '不用封面（这一部单独关掉了）';
  if (coverStore()[r.id]) return '你选的图';
  return autoCoverUrl(r) ? '资料来源封面' : '';
}
function coverInitials(r) { return [...String(r ? shortName(r) : '?').replace(/^[\[【(（『「]+/, '')].slice(0, 2).join(''); }
function coverHtml(r, cls = '') {
  const [c1, c2] = (r && r.palette) || ['#dfe6e2', '#6b8f7d'];
  const src = coverSrc(r);
  return `<span class="cover ${cls}" style="--c1:${esc(c1)};--c2:${esc(c2)}" data-cover="${esc(r ? r.id : '')}" title="点一下换封面" role="button" tabindex="0">` +
    `<span class="cover-ph">${esc(coverInitials(r))}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-app="${esc(r && !coverStore()[r.id] ? steamAppId(r) : '')}">` : ''}</span>`;
}
// 封面图取不到时露出占位；Steam 旧地址取不到的记下来，名单 / 榜单里会提示「补全 Steam 封面」
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.cover')) return;
  if (img.dataset.app && !(project.steamCovers || {})[img.dataset.app]) { coverMissing.add(img.dataset.app); refreshCoverHints(); }
  img.remove();
}, true);
document.addEventListener('click', e => { const c = e.target.closest('.cover[data-cover]'); if (c && c.dataset.cover) { e.preventDefault(); e.stopPropagation(); openCoverDialog(c.dataset.cover); } });
document.addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('.cover[data-cover]'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCoverDialog(c.dataset.cover); } });

// 换了封面：页面上同一部作品的封面都换掉（不用重画整页）
function refreshCovers(ids) {
  for (const id of ids) document.querySelectorAll(`.cover[data-cover="${CSS.escape(id)}"]`).forEach(el => {
    const cls = [...el.classList].filter(c => c !== 'cover').join(' ');
    el.outerHTML = coverHtml(byId.get(id), cls);
  });
}
onChange(info => {
  const ids = (info?.changes || []).filter(c => c.kind === 'project' && c.path[0] === 'covers').map(c => c.path[1]);
  if (ids.length) refreshCovers(ids);
  if ((info?.changes || []).some(c => (c.kind === 'project' && ['steamCovers', 'coverOff'].includes(c.path[0])) || (c.kind === 'meta' && c.path[1] === 'show_covers')))
    refreshCovers([...new Set([...document.querySelectorAll('.cover[data-cover]')].map(el => el.dataset.cover))].filter(Boolean));
});
function setCover(id, value, label) {
  commit(label, [{kind: 'project', path: ['covers', id], before: clone(coverStore()[id]), after: value || undefined}]);
  refreshCovers([id]);
}

// 「补全 Steam 封面」：名单和榜单里放一个 <span data-cover-hint>，有取不到的 Steam 封面时显示按钮
function refreshCoverHints() {
  document.querySelectorAll('[data-cover-hint]').forEach(el => {
    const n = coverMissing.size;
    el.innerHTML = n ? `<button class="link" data-cover-fetch>有 ${n} 部 Steam 作品的封面要查一下地址，点这里补全</button>` : '';
  });
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-cover-fetch]')) return;
  if (!needHelper(null, '补全 Steam 封面')) return;
  const appids = [...coverMissing];
  runJob('/api/steam-covers', {appids,sourceConfig:sourceConfig()}, `补全 Steam 封面（${appids.length} 部）`, result => {
    const found = Object.fromEntries(Object.entries(result.covers || {}).filter(([, url]) => url));
    appids.forEach(a => coverMissing.delete(a));
    refreshCoverHints();
    closeDialog();
    if (!Object.keys(found).length) { setStatus(result.note||'当前来源未提供封面，可以手选或导入有权使用的图片。', 'error'); return; }
    const next = Object.assign({}, project.steamCovers || {}, found);
    commit(`补全 Steam 封面 ${Object.keys(found).length} 部`, [{kind: 'project', path: ['steamCovers'], before: clone(project.steamCovers), after: next}]);
    setStatus(`补全了 ${Object.keys(found).length} 部 Steam 作品的封面${appids.length > Object.keys(found).length ? `，${appids.length - Object.keys(found).length} 部没查到` : ''}。`, 'dirty');
  });
});

// 换封面的对话框：选文件、粘贴、拖进来、填网址，或者改回自动封面
function openCoverDialog(id) {
  const r = byId.get(id);
  if (!r) return;
  const own = coverStore()[id], kind = coverKind(r), autoKind = own && autoCoverUrl(r);
  const box = openDialog(`<h3>封面 · ${esc(r.code)} ${esc(shortName(r))}</h3>
    <div class="cover-dialog" id="cv_drop">${coverHtml(r, 'big')}
      <div class="cover-dialog-side">
        <p class="count">现在用的是：<b>${esc(kind || '配色占位（还没有封面）')}</b></p>
        <label class="file-btn primary-like">选择图片文件<input type="file" id="cv_file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
        <p class="count">也可以直接按 Ctrl+V 粘贴截图，或者把图片拖到这个框里。</p>
        <div class="field"><label for="cv_url">或者填图片网址</label><div class="row-inline"><input id="cv_url" placeholder="https://…/cover.jpg" autocomplete="off"><button id="cv_urlUse">用这个网址</button></div></div>
        ${own ? `<button id="cv_reset">不用自己选的图${autoKind ? '，改回自动封面' : ''}</button>` : ''}
        <label class="check"><input type="checkbox" id="cv_off" ${coverOffStore()[id] ? 'checked' : ''}> 这一部不用封面（只用配色加名称首字）</label>
        <label class="check"><input type="checkbox" id="cv_all" ${coversOn() ? '' : 'checked'}> 所有作品都不用封面（设置里的「显示作品封面」）</label>
      </div>
    </div>
    <div class="dialog-actions"><button data-close>关闭</button></div>`, {wide: true});
  const useFile = async file => {
    if (!file || !/^image\//.test(file.type)) { setStatus('这不是图片文件。', 'error'); return; }
    try {
      const data = await shrinkImage(file, 480, 0.82);
      setCover(id, data, `换封面：${r.code}`);
      setStatus(`已换封面（压缩后约 ${Math.round(data.length * 0.75 / 1024)} KB，存在母版里）。`, 'dirty');
      openCoverDialog(id);
    } catch (error) { setStatus('图片读不出来：' + error.message, 'error'); }
  };
  box.querySelector('#cv_file').addEventListener('change', e => useFile(e.target.files[0]));
  box.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].find(f => /^image\//.test(f.type)); if (f) { e.preventDefault(); useFile(f); } });
  const drop = box.querySelector('#cv_drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); useFile(e.dataTransfer.files[0]); });
  box.querySelector('#cv_urlUse').onclick = async () => {
    const url = box.querySelector('#cv_url').value.trim();
    if (!/^https?:\/\//i.test(url)) { setStatus('图片网址要以 http:// 或 https:// 开头。', 'error'); return; }
    // 能读到图片就压缩存进母版（导出图片时也能用）；对方网站不让读就只记网址
    try {
      const res = await fetch(url, {mode: 'cors', referrerPolicy: 'no-referrer'});
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      await useFile(new File([blob], 'cover', {type: blob.type || 'image/jpeg'}));
    } catch {
      setCover(id, url, `换封面：${r.code}`);
      setStatus('这个网站不让直接读图片：封面会照常显示，但导出图片时这一部会用占位。', 'dirty');
      openCoverDialog(id);
    }
  };
  box.querySelector('#cv_off').onchange = e => {
    commit(e.target.checked ? `这一部不用封面：${r.code}` : `恢复封面：${r.code}`, [{kind: 'project', path: ['coverOff', id], before: coverOffStore()[id], after: e.target.checked || undefined}]);
    openCoverDialog(id);
  };
  box.querySelector('#cv_all').onchange = e => { setMeta(['ui_config', 'show_covers'], e.target.checked ? false : undefined, e.target.checked ? '所有作品都不用封面' : '恢复作品封面'); openCoverDialog(id); };
  if (box.querySelector('#cv_reset')) box.querySelector('#cv_reset').onclick = () => { setCover(id, undefined, `改回自动封面：${r.code}`); openCoverDialog(id); };
}

// ---------- 画进导出的图片 ----------
function loadCoverImage(r, timeout = 10000) {
  const src = coverSrc(r);
  if (!src) return Promise.resolve(null);
  return new Promise(ok => {
    const img = new Image();
    const done = v => { clearTimeout(t); ok(v); };
    const t = setTimeout(() => done(null), timeout);
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => done(img);
    img.onerror = () => { if (steamAppId(r) && !coverStore()[r.id]) coverMissing.add(steamAppId(r)); done(null); };
    img.src = src;
  });
}
// 按「铺满裁切」画封面；没有图就画配色渐变加名称首字
function drawCover(ctx, img, r, x, y, w, h, font) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (img) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight), iw = img.naturalWidth * s, ih = img.naturalHeight * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  } else {
    const [c1, c2] = (r && r.palette) || ['#dfe6e2', '#6b8f7d'];
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = `800 ${Math.round(h * 0.3)}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(coverInitials(r), x + w / 2, y + h / 2);
  }
  ctx.restore();
}
// 按宽度折行，最多 maxLines 行，超出的用省略号
function wrapLines(ctx, text, maxW, maxLines) {
  const out = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; if (out.length === maxLines) break; }
    else line += ch;
  }
  if (out.length < maxLines && line) out.push(line);
  else if (out.length === maxLines && line) { let last = out[maxLines - 1]; while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1); out[maxLines - 1] = last + '…'; }
  return out;
}
