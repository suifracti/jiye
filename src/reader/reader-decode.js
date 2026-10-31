
window.__GAME_RECORDS_READY__ = (async function(){
 window.__GLOBAL_META__=await CatalogImages.restore(window.__GLOBAL_META__);
 window.__CATALOG_IMAGES__=await CatalogImages.restore(window.__CATALOG_IMAGES__);
 var p=window.__GAME_RECORDS__;
 if(!p||p.format!=='catalog-shared-v1'){window.__GAME_RECORDS__=[];return;}
 if(p.codec==='deflate-base64'){
   if(typeof DecompressionStream==='undefined')throw new Error('此浏览器不支持离线压缩资料，请使用最新版 Chrome、Edge 或 Firefox。');
   var binary=atob(p.data),bytes=new Uint8Array(binary.length);
   for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
   var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
   p=JSON.parse(await new Response(stream).text());
 }
 function decode(v){
   if(typeof v==='string'){
     if(v.slice(0,2)==='~@')return p.strings[Number(v.slice(2))];
     return v.slice(0,2)==='~~'?v.slice(1):v;
   }
   if(Array.isArray(v)){for(var i=0;i<v.length;i++)v[i]=decode(v[i]);}
   else if(v&&typeof v==='object'){
     var decoded=Object.create(null);
     Object.keys(v).forEach(function(k){decoded[p.keys?p.keys[Number(k)]:k]=decode(v[k]);});return decoded;
   }
   return v;
 }
 var data=decode(p.data);
 window.__GAME_RECORDS__=data[0].map(function(source,i){
   var view={};Object.keys(source).forEach(function(k){view[k]=source[k];});
   Object.keys(data[1][i]).forEach(function(k){view[k]=data[1][i][k];});
   view.source_record=source;return view;
 });
})();
