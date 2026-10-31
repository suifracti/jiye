// 目录母版 · 设置：原「HTML设置」表的各项，做成表单；同一份清单也用于 Excel 里的「HTML设置」表
// paths：一个设置可能要同时写几个位置（看板里有几处读同一件事）
const U = k => ['ui_config', k];
const SETTINGS = [
  {group: '页面与提示', items: [
    {label: '页面标题', type: 'text', paths: [['input_name'], ['title']], hint: '浏览器标签页上显示的名字，也是导出文件的默认文件名'},
    {label: '数据日期', type: 'date', paths: [['update_date']]},
    {label: '公告', type: 'area', paths: [['warning'], ['notice']], hint: '默认留空；读者可展开和关闭'},
    {label: '显示顶部提示', type: 'bool', default:false, paths:[['top_notice','visible']]},
    {label: '顶部提示文字', type:'text', paths:[['top_notice','text']]},
    {label: '顶部提示可复制', type:'bool', default:false, paths:[['top_notice','copyable']]},
    {label: '最新版链接', type:'url', paths:[['latest_catalog_url']], hint:'留空时不显示入口'},
    {label: '解压说明', type: 'area', paths: [['extract_guide'], ['row2_body']]},
    {label: '教学步骤', type: 'steps', paths: [['row5_steps'], ['row4_modules'], ['row5_template', 'steps']]},
  ]},
  {group: '入口链接', items: [
    {label: '说明文档链接', type: 'url', paths: [U('doc_url'), ['row5_template', 'doc_url']], hint: '说明卡和文档按钮的目标地址'},
    {label: '联系卡链接', type: 'url', paths: [U('contact_url'), ['row5_template', 'contact_url']]},
    {label: '联系卡标题', type: 'text', paths: [U('contact_title'), ['row5_template', 'contact_title']]},
    {label: '工具箱（百度网盘）链接', type: 'url', paths: [['toolbox_baidu_url'], ['toolbox_url']]},
    {label: '工具箱（夸克网盘）链接', type: 'url', paths: [['toolbox_quark_url']]},
    {label: '目录指引标题', type: 'text', paths: [U('doc_title')]},
    {label: '目录指引副标题', type: 'text', paths: [U('doc_subtitle')]},
  ]},
  {group: '首页与外观', items: [
    {label: '默认配色', type: 'select', paths: [U('theme')], options: [['eye', '护眼绿'], ['pink', '粉色'], ['warm', '暖色'], ['dark', '深色'], ['light', '浅色']]},
    {label: '头图样式', type: 'select', paths: [U('hero_style')], options: [['compact', '简约横幅'], ['postcard', '分栏卡片']]},
    {label: '显示头图', type: 'bool', paths: [U('show_hero')]},
    {label: '头图小字', type: 'text', paths: [U('eyebrow')]},
    {label: '头图标题', type: 'text', paths: [U('hero_title')]},
    {label: '头图副标题', type: 'text', paths: [U('hero_subtitle')]},
    {label: '显示随机发现', type: 'bool', paths: [U('show_random')]},
    {label: '显示作品封面', type: 'bool', paths: [U('show_covers')], hint: '关掉后只显示作品配色和名称首字。外部图片需要另行启用；也可按作品单独关闭封面'},
    {label: '旧版提醒天数', type: 'number', min: 0, max: 365, paths: [U('stale_days')], hint: '默认 0 不提醒；设置天数后提示检查最新版'},
    {label: '页脚文案', type: 'text', paths: [U('footer_text')]},
    {label: '侧栏底部文案', type: 'text', paths: [U('sidebar_text')]},
    {label: '页面字体', type: 'text', paths: [U('font_family')], hint: '例如 Microsoft YaHei；看的人电脑上要装有这个字体'},
    {label: '正文字号', type: 'number', min: 12, max: 22, paths: [U('body_size')]},
    {label: '头图标题字号', type: 'number', min: 20, max: 52, paths: [U('hero_size')]},
    {label: '作品标题字号', type: 'number', min: 14, max: 28, paths: [U('card_title_size')]},
    {label: '页脚字号', type: 'number', min: 10, max: 18, paths: [U('footer_size')]},
    {label: '头图图片', type: 'image', paths: [U('hero_image')]},
    {label: '左上角图片', type: 'image', paths: [U('logo_image')]},
    {label: '说明卡图片', type: 'image', paths: [U('doc_image')]},
    {label: '联系卡图片', type: 'image', paths: [U('contact_image')]},
  ]},
  {group: '卡片与分类', items: [
    {label: '使用指南标题', type: 'text', paths: [U('guide_title')]},
    {label: '使用指南副标题', type: 'text', paths: [U('guide_subtitle')]},
    {label: '联系卡副标题', type: 'text', paths: [U('contact_subtitle')]},
    {label: '允许加载外部图片', type: 'bool', default: false, paths: [U('allow_remote_images')]},
    {label: '版本类型名称与颜色', type:'versions', paths:[['version_types']], hint:'每行：名称｜颜色（#64748b）｜对应值（可选，顿号分隔）。默认只有「默认」；不会改已有记录的字段值'},
    {label: '类型建议', type: 'lines', paths: [U('type_options').concat('genre')]},
    {label: '平台建议', type: 'lines', paths: [U('type_options').concat('platform')]},
    {label: '附加标记', type: 'markers', paths: [U('extra_markers')], hint: '每行一个：显示名称｜标签。可任意增减和排序'},
  ]},
  {group: '背景图片', items: [
    {label: '显示背景图片', type: 'bool', default:false, paths: [U('show_background')], hint: '默认关闭，地址留空；开启后才请求自己填写的图片地址'},
    {label: '电脑背景地址', type: 'url', paths: [U('background_url')]},
    {label: '手机背景地址', type: 'url', paths: [U('background_mobile_url')], hint: '留空则用电脑的地址'},
    {label: '背景遮罩浓度', type: 'number', min: 0, max: 95, paths: [U('background_overlay')], hint: '数字越大背景越淡，文字越清楚'},
    {label: '背景模糊程度', type: 'number', min: 0, max: 20, paths: [U('background_blur')]},
  ]},
  {group:'可选模块',items:[
    {label:'显示下载链接',type:'bool',default:false,paths:[['modules','downloads']],hint:'默认关闭；开启后显示自己填写的下载链接'},
    {label:'启用夸克扫描',type:'bool',default:false,paths:[['modules','quark']],hint:'默认关闭；只扫描你自己的分享。可检查大小、失效情况并重新定位'},
  ]},
  {group: '导出结果与原始记录', items: [
    {label: '启用导出功能', type: 'bool', paths: [U('enable_export')]},
    {label: '导出结果文件名', type: 'text', paths: [U('export_filename')]},
    {label: '原始记录默认展开', type: 'bool', paths: [U('expand_source')]},
  ]},
];
const SETTING_LIST = SETTINGS.flatMap(g => g.items);
const settingValue = s => getPath(meta, s.paths[0]);
// 设置的文字形式（Excel 里用）↔ 值
function settingText(s) {
  const v = settingValue(s);
  if (s.type === 'bool') return (v ?? s.default ?? true) ? '是' : '否';
  if (s.type === 'lines') return (v || []).join('\n');
  if (s.type === 'groups') return (v || []).map(group => Array.isArray(group) ? group[0] + '｜' + group[1].join('、') : group.label + '｜' + (group.values || []).join('、')).join('\n');
  if (s.type === 'markers') return (v || []).map(item => item.label + '｜' + (item.tag || item.label)).join('\n');
  if(s.type==='versions')return (v||[{name:'默认',color:'#64748b'}]).map(item=>[item.name,item.color,(item.values||[]).join('、')].join('｜')).join('\n');
  if (s.type === 'select') return (s.options.find(o => o[0] === v) || [, v ?? ''])[1];
  if (s.type === 'steps') return (v || []).map(x => `${x.title || ''}｜${x.body || ''}`).join('\n//\n');
  if (s.type === 'image' && String(v || '').startsWith('data:')) return '（本地图片，已内嵌）';
  return v == null ? '' : String(v);
}
function settingFromText(s, text) {
  text = String(text ?? '').trim();
  if(s.type==='versions')return text.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const [name,color='#64748b',values='']=line.split('｜');return {name:name.trim(),color:/^#[0-9a-f]{6}$/i.test(color.trim())?color.trim():'#64748b',...(values?{values:values.split(/[、,，]/).map(v=>v.trim()).filter(Boolean)}:{})};});
  if (s.type === 'lines') return text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (s.type === 'groups') return text.split(/\r?\n/).filter(line => line.trim()).map(line => {const [label, values = label] = line.split('｜'); return {...(settingValue(s) || []).find(group => !Array.isArray(group) && group.label === label.trim()), label:label.trim(), values:values.split(/[、,，]/).map(value => value.trim()).filter(Boolean)};});
  if (s.type === 'markers') return text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {const [label, tag = label] = line.split('｜'); const prior = (settingValue(s) || []).find(item => item.label === label.trim()); return {...prior, key:prior?.key || 'custom-' + index, label:label.trim(), tag:tag.trim()};});
  if (s.type === 'bool') return !/^(否|no|false|0)$/i.test(text);
  if (s.type === 'number') return text === '' ? undefined : Math.max(s.min, Math.min(s.max, +text || 0));
  if (s.type === 'select') return (s.options.find(o => o[1] === text || o[0] === text) || [settingValue(s)])[0];
  if (s.type === 'steps') return text.split(/\n?\/\/\n?/).map(b => b.trim()).filter(Boolean).map(b => { const [t, ...rest] = b.split('｜'); return {title: t.trim(), body: rest.join('｜').trim()}; });
  return text;
}
function settingChanges(s, value) {
  return s.paths.map(path => ({kind: 'meta', path, before: clone(getPath(meta, path)), after: clone(value)}));
}
function settingInvalid(s, value) {
  if ((s.type === 'url') && value && !/^https?:\/\/\S+$/.test(value)) return '要以 http:// 或 https:// 开头';
  if (s.type === 'image' && value && !/^(https?:\/\/\S+|data:image\/(png|jpeg|webp|gif);base64,)/.test(value)) return '填图片的 https 地址，或者选一张本地图片';
  if (s.label === '导出结果文件名' && /[<>:"/\\|?*]/.test(value || '')) return '只能填文件名，不能有路径或特殊字符';
  return '';
}

// 导航里的三项扩展：设置表里还没有时也列出来，默认排在最前面（和看板一致）
const DEFAULT_NAV_ITEMS = ['收藏管理','使用帮助','资源下载','正确解压','使用提示','打开目录指引','复制顶部提示','工具箱（百度网盘）','工具箱（夸克网盘）','完整解压说明','关注与联系','随机发现'].map((key, order) => ({key,label:key,order,visible:true}));
const NAV_EXTRAS = ['拿取清单', '本期变化', '夯榜', '月度名单'];
function navRows() {
  const list = clone((meta.ui_config || {}).navigation || DEFAULT_NAV_ITEMS);
  const min = Math.min(0, ...list.map(n => +n.order || 0));
  NAV_EXTRAS.forEach((key, i) => { if (!list.some(n => n.key === key)) list.push({key, label: key, order: min - NAV_EXTRAS.length + i, visible: true}); });
  return list.sort((a, b) => a.order - b.order);
}
function renderSettings() {
  const ui = meta.ui_config || {};
  const nav = navRows();
  $('pane-settings').innerHTML = `<div class="pane-inner settings">
    <div class="pane-head"><h2>设置</h2><span class="spacer"></span><button id="setPreview">预览效果</button></div>
    <p class="count">这些就是原来「HTML设置」表里的内容。改完点「预览效果」看看，导出分发版时生效。</p>
    ${SETTINGS.map(g => `<section class="section"><h3>${g.group}</h3><div class="grid2">${g.items.map((s, i) => settingField(s, SETTING_LIST.indexOf(s))).join('')}</div></section>`).join('')}
    <section class="section"><h3>字段显示名称</h3><p class="count">可配置作者、分类、载体、版本类型与下载字段的显示；记录、导入导出仍按稳定字段键工作。</p><table><thead><tr><th>字段键</th><th>显示名称</th><th>显示</th></tr></thead><tbody>${Object.keys(DEFAULT_FIELD_CONFIG).map(key=>`<tr data-config-field="${esc(key)}"><td class="mono">${esc(key)}</td><td><input data-config-label value="${esc(fieldLabel(key,FIELD_LABEL[key]))}"></td><td><input type="checkbox" data-config-visible ${meta.field_config?.[key]?.visible===false?'':'checked'}></td></tr>`).join('')}</tbody></table></section>
    <section class="section"><h3>联网与资料来源</h3><p class="count">默认离线，未启用的来源不会访问网络。</p><button id="setSources">来源设置</button><h4>夸克自定义适配器（选填）</h4><p class="count">留空使用内置只读扫描自己的分享。只有使用自定义 HTTP 模板时需要勾选授权；支持 {share_id}、{parent_id}、{page}、{page_size}。</p>${['list_url','share_check_url'].map(key=>`<div class="field"><label>${key==='list_url'?'目录列表 URL 模板':'分享检查 URL 模板'}</label><input data-quark-config="${key}" value="${esc(project.quarkConfig?.[key]||'')}"></div>`).join('')}<label><input type="checkbox" data-quark-config="authorized" ${project.quarkConfig?.authorized?'checked':''}>我有权使用这个自定义 HTTP 适配器</label></section>
    <section class="section"><h3>导航</h3>
      <p class="count">数字越小越靠前；不勾「显示」就不出现在左侧导航里。「本期变化」只在有上一期可比时出现，「夯榜」「月度名单」默认显示，没有发布内容时会提示。</p>
      <table class="nav-table"><thead><tr><th>项目</th><th>显示名称</th><th>排序</th><th>显示</th></tr></thead><tbody>
      ${nav.map(n => `<tr data-nav="${esc(n.key)}"><td>${esc(n.key)}</td><td><input data-k="label" value="${esc(n.label)}"></td><td><input data-k="order" type="number" value="${n.order}"></td><td><input data-k="visible" type="checkbox" ${n.visible ? 'checked' : ''}></td></tr>`).join('')}
      </tbody></table></section>
    <section class="section"><h3>图标</h3>
      <p class="count">填一个 emoji 或符号；留空用默认图标。</p>
      <div class="grid4">${Object.entries({...Object.fromEntries(SECTIONS.map(key => [key, ''])), ...(ui.category_icons || {})}).map(([k, v]) => `<div class="field"><label>${esc(k)}</label><input data-icon="category_icons" data-key="${esc(k)}" value="${esc(v)}" maxlength="4"></div>`).join('')}
      ${Object.entries({...Object.fromEntries(nav.map(item => [item.key, ''])), ...(ui.navigation_icons || {})}).map(([k, v]) => `<div class="field"><label>${esc(k)}</label><input data-icon="navigation_icons" data-key="${esc(k)}" value="${esc(v)}" maxlength="4"></div>`).join('')}</div>
    </section></div>`;
  const pane = $('pane-settings');
  pane.querySelector('#setSources').onclick=openSourceSettings;
  pane.querySelectorAll('[data-config-field]').forEach(row=>row.onchange=()=>{const key=row.dataset.configField,before=clone(meta.field_config?.[key]),after={label:row.querySelector('[data-config-label]').value.trim()||FIELD_LABEL[key],visible:row.querySelector('[data-config-visible]').checked};commit('修改字段显示',[{kind:'meta',path:['field_config',key],before,after}]);});
  pane.querySelectorAll('[data-quark-config]').forEach(input=>input.onchange=()=>{const before=clone(project.quarkConfig),after={...before,[input.dataset.quarkConfig]:input.type==='checkbox'?input.checked:input.value.trim()};commit('修改夸克适配器配置',[{kind:'project',path:['quarkConfig'],before,after}]);});
  pane.querySelectorAll('[data-setting]').forEach(el => el.addEventListener('change', () => {
    const s = SETTING_LIST[+el.dataset.setting];
    let value;
    if (s.type === 'bool') value = el.checked;
    else if (['number','lines','groups','markers','versions'].includes(s.type)) value = settingFromText(s, el.value);
    else if (s.type === 'steps') value = [...pane.querySelectorAll(`[data-step-of="${el.dataset.setting}"]`)].reduce((list, inp) => {
      const i = +inp.dataset.i; list[i] = list[i] || {title: '', body: ''}; list[i][inp.dataset.part] = inp.value; return list;
    }, []).filter(x => x.title || x.body);
    else value = el.value.trim();
    const bad = settingInvalid(s, value);
    if (bad) { setStatus(`「${s.label}」${bad}。`, 'error'); return; }
    commit(`改设置：${s.label}`, settingChanges(s, value));
  }));
  pane.querySelectorAll('[data-image-file]').forEach(input => input.addEventListener('change', () => {
    const file = input.files[0], s = SETTING_LIST[+input.dataset.imageFile];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setStatus('图片超过 3MB，会让分发版太大，请先压缩。', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => commit(`改设置：${s.label}（本地图片）`, settingChanges(s, reader.result));
    reader.readAsDataURL(file);
  }));
  pane.querySelectorAll('[data-image-clear]').forEach(b => b.addEventListener('click', () => {
    const s = SETTING_LIST[+b.dataset.imageClear];
    commit(`清除设置：${s.label}`, settingChanges(s, ''));
  }));
  pane.querySelectorAll('tr[data-nav] input').forEach(input => input.addEventListener('change', () => {
    const navList = navRows();
    const item = navList.find(n => n.key === input.closest('tr').dataset.nav);
    item[input.dataset.k] = input.type === 'checkbox' ? input.checked : input.dataset.k === 'order' ? +input.value || 0 : input.value.trim();
    navList.sort((a, b) => a.order - b.order);
    commit(`改导航：${item.key}`, [{kind: 'meta', path: U('navigation'), before: clone(meta.ui_config.navigation), after: navList}]);
  }));
  pane.querySelectorAll('[data-icon]').forEach(input => input.addEventListener('change', () => {
    const path = U(input.dataset.icon).concat(input.dataset.key);
    commit(`改图标：${input.dataset.key}`, [{kind: 'meta', path, before: getPath(meta, path), after: input.value.trim() || undefined}]);
  }));
  $('setPreview').addEventListener('click', () => $('previewBtn').click());
}
function settingField(s, idx) {
  const v = settingValue(s), id = 'set_' + idx, hint = s.hint ? `<div class="hint">${esc(s.hint)}</div>` : '';
  if (s.type === 'bool') return `<div class="field"><label><input type="checkbox" id="${id}" data-setting="${idx}" ${(v ?? s.default ?? true) ? 'checked' : ''}> ${esc(s.label)}</label>${hint}</div>`;
  if (s.type === 'select') return `<div class="field"><label for="${id}">${esc(s.label)}</label><select id="${id}" data-setting="${idx}">${s.options.map(o => `<option value="${o[0]}" ${o[0] === v ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>${hint}</div>`;
  if (['lines','groups','markers','versions'].includes(s.type)) return `<div class="field wide"><label for="${id}">${esc(s.label)}</label><textarea id="${id}" data-setting="${idx}" rows="4">${esc(settingText(s))}</textarea>${hint}</div>`;
  if (s.type === 'area') return `<div class="field wide"><label for="${id}">${esc(s.label)}</label><textarea id="${id}" data-setting="${idx}" rows="3">${esc(v || '')}</textarea>${hint}</div>`;
  if (s.type === 'steps') {
    const steps = [...(v || []), {title: '', body: ''}];
    return `<div class="field wide"><label>${esc(s.label)}</label>${steps.map((st, i) => `<div class="step">
      <input placeholder="第 ${i + 1} 步标题" data-setting="${idx}" data-step-of="${idx}" data-i="${i}" data-part="title" value="${esc(st.title)}">
      <textarea rows="2" placeholder="第 ${i + 1} 步正文" data-setting="${idx}" data-step-of="${idx}" data-i="${i}" data-part="body">${esc(st.body)}</textarea></div>`).join('')}
      <div class="hint">清空标题和正文即可删除一步；最后一个空白步骤用来新增。</div></div>`;
  }
  if (s.type === 'image') {
    const isData = String(v || '').startsWith('data:');
    return `<div class="field"><label for="${id}">${esc(s.label)}</label>
      <input id="${id}" data-setting="${idx}" value="${isData ? '' : esc(v || '')}" placeholder="${isData ? '已内嵌本地图片' : 'https 图片地址，留空用默认图'}">
      <div class="row-inline"><label class="file-btn">选本地图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-image-file="${idx}" hidden></label>
      ${v ? `<button data-image-clear="${idx}">清除</button>` : ''}${isData ? '<img class="thumb" alt="" src="' + esc(CatalogImages.url(v)) + '">' : ''}</div></div>`;
  }
  const type = s.type === 'number' ? `type="number" min="${s.min}" max="${s.max}"` : s.type === 'date' ? 'type="date"' : '';
  return `<div class="field"><label for="${id}">${esc(s.label)}</label><input id="${id}" ${type} data-setting="${idx}" value="${esc(v ?? '')}" class="${s.type === 'url' ? 'mono' : ''}">${hint}</div>`;
}
tabHandlers.settings = renderSettings;
onChange(info => {
  if ($('pane-settings').hidden) return;
  // 设置页里正在输入时不重画，避免打断
  if (!$('pane-settings').contains(document.activeElement) || /撤销|重做/.test(info?.label || '')) renderSettings();
});
