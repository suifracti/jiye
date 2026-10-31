'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const manual=fs.readFileSync('src/master/js/83-manual-ids.js','utf8').split('// ---------- 补编号窗口 ----------')[0];
const helper=fs.readFileSync('src/master/js/80-helper.js','utf8');
function extract(name){const start=helper.indexOf('function '+name+'('),end=helper.indexOf('\n}',start);return helper.slice(start,end+2);}
const context=vm.createContext({assert,console,URL});
vm.runInContext(`const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));const fieldChange=(r,key,after)=>({id:r.id,key,before:clone(r[key]),after:clone(after)});const project={sourceConfig:{custom_sources:[{key:'library',name:'资料库',records:[],detail_url:'https://example.invalid/items/{id}'}]},collections:[]};const meta={sources:[]};const cards=[];const byId=new Map();`,context);
vm.runInContext(extract('sourceConfig')+'\n'+extract('sourceChoices')+'\n'+manual+'\n'+helper.slice(helper.indexOf('function enrichState('),helper.indexOf('const enrichBtn'))+'\n'+extract('quarkChanges'),context);
vm.runInContext(`
const record={id:'demo-a',source:'steam',source_id:'101',source_id_origin:'manual',source_ids:{steam:'101',bangumi:'202'},source_checks:{steam:{status:'matched'},bangumi:{status:'matched'}},web_info:{source:'Steam',site:'steam',source_id:'101',origin:'manual',url:'https://store.steampowered.com/app/101/',links:[{source:'Steam',source_id:'101',url:'https://store.steampowered.com/app/101/'},{source:'Bangumi',source_id:'202',url:'https://bgm.tv/subject/202'}]}};
byId.set(record.id,record);
const cleared=Object.fromEntries(manualIdChanges(record,'').map(c=>[c.key,c.after]));assert(!cleared.source_ids.steam);assert.equal(cleared.source_ids.bangumi,'202');assert(cleared.web_info.links.some(x=>x.source==='Bangumi'));assert(!cleared.source_checks.steam);
const filled=Object.fromEntries(manualIdChanges(record,'library:demo-ref').map(c=>[c.key,c.after]));assert.equal(filled.web_info.url,'https://example.invalid/items/demo-ref');assert.equal(filled.source_id_origin,'manual');assert(filled.web_info.links.some(x=>x.source==='Steam'));assert.equal(parseManualId('https://bgm.tv/subject/202').source_id,'202');assert.equal(parseManualId('steam:wrong').valid,false);
const sourceChanges=enrichChanges({changed:{'demo-a':{web_info:{source_id:'new'},source_ids:{library:'demo-ref'},source_checks:{}}}});assert(sourceChanges.some(c=>c.key==='source_ids'));
const located={id:'located',quark_location_status:'matched',quark_location_url:'https://example.invalid/folder'};byId.set('located',located);const failureChanges=quarkChanges({records:{located:{status:'authorization_required',error:'未配置'}},summary:[]});assert(!failureChanges.some(c=>c.key==='quark_location_url'));assert(!failureChanges.some(c=>c.key==='quark_location_status'));
`,context);
const reference=fs.readFileSync('src/master/js/84-ref-sites.js','utf8');
for(const name of ['refProjectChange','refOfficialChanges','refSelectionChanges']){const start=reference.indexOf('function '+name+'('),end=reference.indexOf('\n}',start);vm.runInContext(reference.slice(start,end+2),context);}
vm.runInContext(`
const refMissingCover=r=>!(project.covers||{})[r.id];
const beforeStage=JSON.stringify(record);const stage=refSelectionChanges({covers:[{id:record.id,image:'synthetic-image',source:{site:'示例网站'}}],clues:[{id:record.id,official:[{source:'library',source_id:'demo-ref',url:'https://example.invalid/clue'}]}]});
assert.equal(JSON.stringify(record),beforeStage);assert(!project.covers);assert(stage.some(change=>change.kind==='project'&&change.path[0]==='covers'));assert.equal(stage.find(change=>change.key==='web_info').after.source_id,'101');
`,context);
console.log('manual IDs, source application, staged references and failed folder scan contracts: passed');
