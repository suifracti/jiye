// 只配置显示，记录和工作簿始终使用原字段键。
const DEFAULT_FIELD_CONFIG={author:{label:'作者',visible:true},genre:{label:'分类',visible:true},platform:{label:'载体',visible:true},translation:{label:'版本类型',visible:true},baidu_url:{label:'下载链接1',visible:true},quark_url:{label:'下载链接2',visible:true}};
meta.modules ||= {downloads:false,quark:false};
meta.top_notice ||= {text:'',visible:false,copyable:false};
meta.field_config ||= {};
meta.version_types ||= [{name:'默认',color:'#64748b'}];
meta.latest_catalog_url ??= '';
meta.warning ??= '';
meta.ui_config ||= {};
meta.ui_config.stale_days ??= 0;
meta.ui_config.show_background ??= false;
meta.ui_config.background_url ??= '';
meta.ui_config.background_mobile_url ??= '';
function fieldLabel(key,fallback=key){return meta.field_config?.[key]?.label||DEFAULT_FIELD_CONFIG[key]?.label||fallback;}
function fieldVisible(key){return meta.field_config?.[key]?.visible!==false && (!['baidu_url','quark_url'].includes(key)||moduleEnabled('downloads'));}
function moduleEnabled(key){return meta.modules?.[key]===true;}
function versionTypes(){return (meta.version_types||[]).filter(item=>item.name).map(item=>({...item,color:/^#[0-9a-f]{6}$/i.test(item.color||'')?item.color:'#64748b'}));}
function quarkOptions(){return {modules:clone(meta.modules),quarkConfig:clone(project.quarkConfig||{authorized:false,list_url:'',share_check_url:''}),folderListings:clone(project.folderListings||{})};}
function requireQuark(){if(moduleEnabled('quark'))return true;showTab('settings');setStatus('夸克扫描默认关闭，请在设置中启用；只扫描你自己的分享。');return false;}
