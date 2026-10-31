// 导出时可选：只读取现在已有的封面，不搜索作品资料，也不改母版原图。
function offlineCoverCandidates() {
  return cards.map(r => ({id: r.id, src: coverSrc(r), label: `${r.code || ''} ${shortName(r)}`.trim()})).filter(x => x.src);
}
function offlineCoverEstimate() {
  const items = offlineCoverCandidates();
  // 图片本体约 6～10 KB，HTML 里的编码也占空间；已内嵌的图原本就算在文件里。
  const existing = items.reduce((sum, x) => sum + (/^data:image\//.test((project.covers || {})[x.id] || '') ? project.covers[x.id].length : 0), 0);
  return {count: items.length, extraMB: Math.max(0, items.length * 12000 - existing) / 1048576};
}
function offlineLoadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; reject(new Error('读取图片超时')); }, 10000);
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('图片取不到或网站不让读取')); };
    img.src = src;
  });
}
async function offlineCoverData(src) {
  const compress = async value => {
    const img = await offlineLoadImage(value);
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(200, img.naturalWidth);
    canvas.height = Math.max(1, Math.round(img.naturalHeight * canvas.width / img.naturalWidth));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', 0.6);
    if (!data.startsWith('data:' + 'image/webp;')) throw new Error('这个浏览器不能压成 webp，请换 Chrome / Edge');
    return data;
  };
  try { return await compress(src); }
  catch (error) {
    if (!/^https?:\/\//i.test(src)) throw error;
    if (!HELPER || helperLost) throw new Error('网站不让直接读图；用小助手打开母版后再导出可重试');
    const result = await api('/api/offline-cover', {url: src});
    return compress(result.data);
  }
}
async function collectOfflineCovers(onProgress = () => {}) {
  const items = offlineCoverCandidates(), covers = {}, failed = [], cache = new Map();
  let next = 0, done = 0;
  onProgress({done, total: items.length, failed: 0});
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try {
        if (!cache.has(item.src)) cache.set(item.src, offlineCoverData(item.src));
        covers[item.id] = await cache.get(item.src);
      } catch (error) { failed.push({id: item.id, label: item.label, error: error.message || String(error)}); }
      onProgress({done: ++done, total: items.length, failed: failed.length});
    }
  }
  await Promise.all(Array.from({length: Math.min(4, items.length)}, worker));
  return {covers, failed, total: items.length};
}
function openReaderExportDialog() {
  const estimate = offlineCoverEstimate();
  const name = (meta.input_name || meta.title || '目录') + '.html';
  const box = openDialog(`<h3>导出分发版</h3>
    <label class="check"><input type="checkbox" id="offlineCovers"> 把封面压成小图放进去（不开网也能看）</label>
    <p class="count">有 ${estimate.count} 部作品现在有封面。勾选后文件会大约多 ${estimate.extraMB.toFixed(1)} MB（估算；已有内嵌图会重新压小）。每张宽最多 200 像素，webp 质量 0.6。</p>
    <p class="count">只处理现在的封面地址和内嵌图，不查新资料。读不到的会列出，仍可导出，其封面保持原来的联网显示方式。用小助手打开时可以代读跨站图片。</p>
    <p class="count">${esc(exportWhere(name))}</p>
    <div class="dialog-actions"><button data-close>取消</button><button class="primary" id="readerExportGo">导出</button></div>`);
  box.querySelector('#readerExportGo').onclick = () => {
    const offlineCovers = box.querySelector('#offlineCovers').checked;
    closeDialog();
    busy($('exportBtn'), '正在导出…', () => exportReaderFile({offlineCovers}));
  };
}
