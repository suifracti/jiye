// 目录母版 · 启动
refreshBrand();
refreshHealthCount();
showTab('list');
$('undoBtn').disabled = $('redoBtn').disabled = true;
setStatus(`已打开母版（上次保存：${project.savedAt ? new Date(project.savedAt).toLocaleString('zh-CN', {hour12: false}) : '未知'}）。` + (canPick ? '' : ' 这个浏览器不能写回文件，保存时会下载一个新母版。'));
// 留给自动化检查用
window.__MASTER__ = {views, get cards() { return cards; }, meta, project, privateNotes, history, commit, undo, redo, buildReader, buildMaster,
  exportWorkbook, readWorkbook, analyzeImport, applyImport: () => applyImport(), setPending: p => { pendingImport = p; }, pasteBlock, grid, parseReleaseText, nextCode, healthChecks};
