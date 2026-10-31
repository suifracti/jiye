// Stable data keys stay independent from labels chosen by the catalog owner.
window.JiyeReaderConfig = (() => {
  const labels={author:'作者',genre:'分类',platform:'载体',translation:'版本类型',baidu_url:'下载链接1',quark_url:'下载链接2'};
  const url=value=>{try{const u=new URL(String(value||''));return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}};
  function field(meta,key){const item=meta.field_config?.[key]||{};return {label:String(item.label||labels[key]||key),visible:item.visible!==false};}
  function versionTypes(meta){const list=(Array.isArray(meta.version_types)?meta.version_types:[]).filter(x=>x&&String(x.name||'').trim());return (list.length?list:[{name:'默认',color:'#64748b'}]).map(x=>({name:String(x.name),color:/^#[\da-f]{6}$/i.test(x.color)?x.color:'#64748b',values:Array.isArray(x.values)?x.values.map(String):[]}));}
  function versionType(meta,row){const list=versionTypes(meta),value=String(row.translation||'');return list.find(x=>x.name===value||x.values.includes(value))||(value?{name:value,color:'#64748b',values:[]}:list[0]);}
  function downloads(meta,row){if(meta.modules?.downloads!==true)return [];return ['baidu_url','quark_url'].flatMap(key=>{const f=field(meta,key);const href=url(key==='quark_url'&&row.quark_location_status==='matched'?row.quark_location_url||row[key]:row[key]);return f.visible&&href?[{key,label:f.label,url:href}]:[];});}
  function sourceIds(row){const found=new Set();const add=value=>{if(Array.isArray(value))value.forEach(add);else if(value&&typeof value==='object')Object.values(value).forEach(add);else if(value!==undefined&&value!==null&&String(value))found.add(String(value));};
    for(const key of ['source_id','metadata_id','source_ids','identifiers'])add(row[key]);
    for(const info of [row.web_info,...(Array.isArray(row.web_info?.links)?row.web_info.links:[])])if(info&&typeof info==='object')for(const [key,value] of Object.entries(info))if(key==='id'||key==='identifiers'||key.endsWith('_id'))add(value);
    return [...found];
  }
  function tags(row){const structural=new Set([row.genre,row.platform,row.translation,...String(row.platform||'').split(/\s*[+/、]\s*/)].filter(Boolean));return [...new Set([...(row.tags||[]),...(row.play_tags||[]),...(row.types||[])])].filter(t=>t&&!structural.has(t));}
  function topNotice(meta){const n=meta.top_notice||{};return {text:String(n.text||''),visible:n.visible===true&&!!n.text,copyable:n.copyable===true};}
  return {field,versionTypes,versionType,downloads,sourceIds,tags,topNotice,url};
})();
