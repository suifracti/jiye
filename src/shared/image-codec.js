// 普通压缩图片存储；旧 enc1 仅支持读取迁移。离线与 file:// 均可用。
window.CatalogImages = (() => {
  const legacyKey = new TextEncoder().encode('catalog-images-v1'), cache = new Map(), encoded = new Map();
  const pattern = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/;
  function b64(bytes) { let s=''; for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768)); return btoa(s); }
  function bytes(s) { const raw=atob(s); return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
  async function stream(raw, codec) { return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(codec)).arrayBuffer()); }
  async function encode(value) {
    const m=pattern.exec(value); if(!m)return value;
    if(encoded.has(value))return encoded.get(value);
    const mime=new TextEncoder().encode(m[1]), image=bytes(m[2]), raw=new Uint8Array(1+mime.length+image.length);
    raw[0]=mime.length; raw.set(mime,1); raw.set(image,1+mime.length);
    const packed=await stream(raw,new CompressionStream('deflate'));
    const out='img2:'+b64(packed).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'').match(/.{1,40}/g).join('.');
    encoded.set(value,out); return out;
  }
  async function decode(value) {
    if(!value.startsWith('enc1:')&&!value.startsWith('img2:'))return value;
    let s=value.slice(5).replace(/\./g,'').replace(/-/g,'+').replace(/_/g,'/'); s+='='.repeat((4-s.length%4)%4);
    const packed=bytes(s); if(value.startsWith('enc1:'))for(let i=0;i<packed.length;i++)packed[i]^=legacyKey[i%legacyKey.length];
    const raw=await stream(packed,new DecompressionStream('deflate')), mime=new TextDecoder().decode(raw.subarray(1,raw[0]+1));
    const plain='data:'+mime+';base64,'+b64(raw.subarray(raw[0]+1)); if(value.startsWith('img2:'))encoded.set(plain,value); return plain;
  }
  async function walk(value, fn) {
    if(typeof value==='string')return fn(value);
    if(Array.isArray(value))return Promise.all(value.map(x=>walk(x,fn)));
    if(value&&typeof value==='object'){const out={}; for(const [k,v] of Object.entries(value))out[k]=await walk(v,fn); return out;}
    return value;
  }
  function url(value) {
    if(typeof value!=='string'||!pattern.test(value))return value||'';
    if(!cache.has(value)){const m=pattern.exec(value); cache.set(value,URL.createObjectURL(new Blob([bytes(m[2])],{type:m[1]})));}
    return cache.get(value);
  }
  return {encode,decode,protect:value=>walk(value,encode),restore:value=>walk(value,decode),url};
})();
