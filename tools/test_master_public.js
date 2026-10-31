'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), zlib = require('node:zlib');
const core = fs.readFileSync('src/master/js/00-core.js', 'utf8');
const versions = fs.readFileSync('src/master/js/32-versions.js', 'utf8');
const old = {id:'demo-old',code:'DEMO260203R',name:'合成作品星图',sheet:'分区甲',zone:'sheet-0',category_sheets:['分区甲','分区乙'],category_zones:['sheet-0','sheet-1'],date:'2026-02-03',publish_date:'2026-02-03',version:'v1',platform:'PC',genre:'探索',translation:'中文',tags:['探索','PC','中文','原始标签'],updated:false,is_update:false,author:'合成创作组',web_info:{source:'custom',summary:'合成资料'},source_checks:{custom:{status:'ok'}}};
const duplicate = {...old,id:'demo-copy',canonical_id:'demo-old',sheet:'分区乙',zone:'sheet-1'};
const other = {id:'demo-other',code:'DEMO200',name:'合成独立作品',sheet:'分区乙',zone:'sheet-1',tags:[]};
const packed = {format:'catalog-shared-v1',strings:[],data:[[old,duplicate,other],[{},{},{}]]};
const cover = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="12" height="12"/></svg>').toString('base64');
const project = {catalog:{data:zlib.deflateSync(JSON.stringify(packed)).toString('base64')},meta:{ui_config:{}},collections:[],privateNotes:{'demo-old':'合成制作备注'},covers:{'demo-old':cover},rankings:[{id:'demo-ranking',tiers:[{items:[{id:'demo-old'},{id:'demo-other'}]}]}],monthLists:[{id:'demo-month',lines:[{type:'item',id:'demo-old'}]}]};
const blocks = {'master-shell':JSON.stringify('shell'),'reader-template':JSON.stringify('reader'),'project-data':JSON.stringify(project)};
const context = vm.createContext({assert,console,Blob,Response,TextEncoder,TextDecoder,CompressionStream,DecompressionStream,Uint8Array,atob,btoa,document:{getElementById:id=>({textContent:blocks[id]||''})},CatalogImages:{restore:async value=>value}});
const checks = `
const first=byId.get('demo-old'), second=byId.get('demo-other');
assert.equal(cards.length,2);assert.deepEqual(sectionsOf(first),['分区甲','分区乙']);
commit('一次批量修改',[
 ...fieldChanges(first,'date','2026-06-04'),...fieldChanges(first,'version','v2'),
 ...fieldChanges(first,'version_date','2026-06-01'),...fieldChanges(first,'platform','移动端'),
 ...fieldChanges(first,'tags',['合成批量标签']),...fieldChanges(first,'updated',true)
]);
assert.equal(first.id,'demo-old');assert.equal(first.publish_date,'2026-06-04');assert.equal(first.date_short,'6/04');
assert.equal(first.version,'v2');assert.equal(first.version_date,'2026-06-01');assert.equal(first.is_update,true);
assert.deepEqual(first.tags,['探索','移动端','中文','合成批量标签']);assert.equal(history.done.length,1);
undo();assert.equal(first.date,'2026-02-03');assert.equal(first.version,'v1');assert.equal(first.version_date,undefined);
assert.equal(first.platform,'PC');assert.equal(first.updated,false);assert.deepEqual(first.tags,['探索','PC','中文','原始标签']);
assert.equal(history.done.length,0);redo();assert.equal(first.version,'v2');assert.equal(first.is_update,true);
commit('跨分区修改',[...sectionChanges(first,'分区乙',false),...sectionChanges(second,'分区甲',true)]);
assert.deepEqual(sectionsOf(first),['分区甲']);assert.deepEqual(sectionsOf(second),['分区乙','分区甲']);
assert.deepEqual(second.category_zones,['sheet-1','sheet-0']);assert.equal(byId.get('demo-copy').canonical_id,'demo-old');
undo();assert.deepEqual(sectionsOf(first),['分区甲','分区乙']);assert.deepEqual(sectionsOf(second),['分区乙']);
const code=nextCode('DEMO','2026-02-03');assert(!views.some(record=>record.code===code));
const replacement=newRecord({code,name:'合成作品星图',date:'2026-02-03',sheet:'分区乙',version:'v3',tags:['新增标签'],batch:'合成批次'});
assert.equal(replacement.id,code);assert.equal(replacement.source_record.id,code);assert.equal(replacement.version,'v3');
const changes=inheritFromOld(replacement,[first]);
commit('新版继承并移除旧版',[...changes,...removeCardChanges(first),{kind:'add',record:replacement,index:0}]);
assert(!byId.has('demo-old'));assert(!byId.has('demo-copy'));assert.equal(cards.length,2);
assert.equal(byId.get(code).author,'合成创作组');assert.equal(byId.get(code).web_info.summary,'合成资料');
assert.equal(byId.get(code).source_checks.custom.status,'ok');assert.deepEqual(sectionsOf(byId.get(code)),['分区乙','分区甲']);
assert.equal(project.covers[code],project.covers['demo-old']);assert.equal(privateNotes[code],'合成制作备注');
assert.equal(project.rankings[0].tiers[0].items[0].id,code);assert.equal(project.rankings[0].tiers[0].items[1].id,'demo-other');
assert.equal(project.monthLists[0].lines[0].id,code);assert.notEqual(nextCode('DEMO','2026-02-03'),code);
undo();assert.deepEqual(views.map(record=>record.id),['demo-old','demo-copy','demo-other']);assert(!byId.has(code));
assert.equal(project.rankings[0].tiers[0].items[0].id,'demo-old');assert.equal(project.monthLists[0].lines[0].id,'demo-old');
assert.equal(project.covers[code],undefined);assert.equal(privateNotes[code],undefined);assert.equal(first.version,'v2');
redo();assert.deepEqual(views.map(record=>record.id),[code,'demo-other']);assert.equal(project.monthLists[0].lines[0].id,code);
assert.equal(project.covers[code],project.covers['demo-old']);assert.equal(byId.get(code).id,code);
console.log('master real core: batch undo/redo, dates/tags, stable IDs, sections, new code and version inheritance passed');
`;
vm.runInContext('(async()=>{\n'+core+'\n'+versions+'\n'+checks+'\n})()',context).catch(error=>{console.error(error);process.exitCode=1;});
