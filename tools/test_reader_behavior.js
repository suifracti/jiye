'use strict';
// Offline behavior checks execute production functions with synthetic records.
// Rendering is stubbed; this is not browser or device acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const reader = fs.readFileSync('src/reader/reader-app.js', 'utf8');
const versions = fs.readFileSync('src/master/js/32-versions.js', 'utf8');
function section(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert(a >= 0 && b > a, 'production function boundary must exist');
  return text.slice(a, b);
}
const fixture = [
  {id:'demo-a',code:'DEMO101',name:'合成目录甲',title:'合成目录甲',aliases:['Synthetic Alpha'],genre:'资料',platform:'Windows',translation:'中文',author:'示例团队甲',tags:['探索','原创'],perks:['扩展附件'],date:'2026-01-03',size:500,notes:'专属日志词',version:'v2',zone:'z1'},
  {id:'demo-b',code:'DEMO102',name:'合成目录乙',title:'合成目录乙',aliases:['Synthetic Beta'],genre:'课程',platform:'macOS',translation:'英文',author:'示例团队乙',tags:['学习','原创'],date:'2026-01-02',size:1200,updated:true,version:'v1',zone:'z2'},
  {id:'demo-c',code:'DEMO103',name:'合成目录甲',title:'合成目录甲',genre:'资料',platform:'Windows+移动端',translation:'中文',author:'示例团队甲',tags:['探索'],date:'2026-01-01',size:0,version:'v1',zone:'z1'},
];
const context = vm.createContext({window:{},assert,fixture,console,URL,TextEncoder,TextDecoder,Uint8Array,atob,btoa});
const setup = `
const data=fixture, cards=data, byId=new Map(data.map(r=>[r.id,r]));
const defaults={zone:'all',query:'',genre:'',platform:'',translation:'',tag:'',month:'',author:'',updated:false,cheat:false,save:false,uncensored:false,extraMarkers:'',onlyFavorites:false,unseen:false,showHidden:false,onlyNew:'',searchNotes:false,sort:'row',page:1,size:100};
const state={...defaults}, favorites=new Set(), notes=Object.create(null), boundLinks=Object.create(null), marks=Object.create(null), viewed=new Set(), blockedTags=new Set(), blockedAuthors=new Set(), presets=[];
let pendingFavorites=[], filtered=[], hiddenNow=0, langCounts=new Map(),langBaseTotal=0;
const MARKS={want:'想看',played:'看过',hidden:'不感兴趣'}, sinceIds=new Set(['demo-a']),editionIds=new Set(['demo-b']);
const extraMarkers=[{key:'extension',label:'扩展附件',tag:'扩展附件'}];
const field=k=>({visible:true,label:k});
const canonicalId=id=>byId.get(id)?.id, langGroup=r=>r.translation;
const compareRowOrder=(a,b)=>data.indexOf(a)-data.indexOf(b), batchKey=r=>r.date,batchDate=new Map(data.map(r=>[r.date,r.date]));
const render=()=>{},writeHash=()=>{};
const KANA=/[぀-ヿ]/,SNAP={query:'',zone:'all',tag:'',extraMarkers:'',onlyFavorites:false,sort:'row'};
const safeUrl=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}};
function checkFilter(patch,expected){Object.assign(state,defaults,patch);apply();assert.equal(JSON.stringify(filtered.map(r=>r.id)),JSON.stringify(expected));}
`;
const blockReason = reader.match(/  const blockReason = .*;/)[0];
vm.runInContext(fs.readFileSync('src/reader/reader-config.js','utf8')+'\n'+fs.readFileSync('src/reader/reader-search-map.js','utf8'),context);
const code = `const RC=window.JiyeReaderConfig;const takenUpdates=()=>[];\n`+ setup + section(reader,'  const tagCache','  function nav()') + blockReason
  + section(reader,'  function markerMatches','  const password')
  + section(reader,'  function apply()','  // Download URLs')
  + section(reader,'  function matchFavoriteItem','    // Compatibility bridge')
  + section(reader,'  function mergePersonal','  function importPersonal')
  + section(versions,'function nameVariants','// 删除一部作品');
vm.runInContext(code, context);
vm.runInContext(`
assert.equal(normalizeSearch(' ＳＹＮＴＨＥＴＩＣ・アルファ！ '),'syntheticあるふぁ');
assert.equal(normalizeSearch('幻想鄉與書庫'),'幻想乡与书库');
checkFilter({query:'synthetic alpha'},['demo-a']);
checkFilter({query:'专属日志词'},[]);checkFilter({query:'专属日志词',searchNotes:true},['demo-a']);
checkFilter({genre:'资料\\u001f课程',tag:'原创',platform:'Windows\\u001fmacOS'},['demo-a','demo-b']);
checkFilter({tag:'原创\\u001f探索'},['demo-a']);
checkFilter({extraMarkers:'extension'},['demo-a']);
checkFilter({translation:'英文'},['demo-b']);assert.equal(langBaseTotal,3);
checkFilter({month:'2026-01',author:'示例团队甲'},['demo-a','demo-c']);
checkFilter({sort:'size-desc'},['demo-b','demo-a','demo-c']);
checkFilter({onlyNew:'since'},['demo-a']);checkFilter({onlyNew:'edition'},['demo-b']);
favorites.add('demo-a');checkFilter({onlyFavorites:true},['demo-a']);
marks['demo-b']='hidden';checkFilter({},['demo-a','demo-c']);checkFilter({zone:'hidden'},['demo-b']);
marks['demo-b']='played';viewed.add('demo-a');checkFilter({unseen:true},['demo-b','demo-c']);
notes['demo-a']='合成个人备注';boundLinks['demo-a']={custom:'https://example.invalid/demo/source'};
const backup=JSON.stringify(personalPayload());favorites.clear();delete notes['demo-a'];delete boundLinks['demo-a'];delete marks['demo-b'];viewed.clear();
assert.equal(mergePersonal(readImport(backup)),1);assert(favorites.has('demo-a'));assert.equal(notes['demo-a'],'合成个人备注');assert.equal(boundLinks['demo-a'].custom,'https://example.invalid/demo/source');assert.equal(marks['demo-b'],'played');assert(viewed.has('demo-a'));
for (const prefix of ['JIYE1:','PANLU1:','GBFAV1:']) {const code=prefix+btoa(JSON.stringify({schema_version:1,favorites:[{id:'demo-a',code:'DEMO101'}]}));assert.equal(readImport(code).favorites[0].id,'demo-a');}
assert.equal(matchFavoriteItem({code:'DEMO101',title:'合成目录甲'},data).status,'matched');
assert.notEqual(matchFavoriteItem({code:'DEMO101',title:'完全不同的合成条目'},data).status,'matched','same code must not silently bind a clearly different title');
const hits=findOtherVersions('更新 合成目录甲',[],new Set(['demo-a']));assert.equal(hits.length,1);assert.equal(hits[0].id,'demo-c');
`, context);
console.log('reader synthetic search/filter/backup/matching and version discovery: passed');
