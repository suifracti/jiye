'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), cp=require('node:child_process');
const core=fs.readFileSync('src/master/js/00-core.js','utf8'), xlsx=fs.readFileSync('src/master/js/70-xlsx.js','utf8');
// The production workbook reader uses DOMParser; Node's test adapter delegates XML
// syntax to Python's standard XML parser instead of inventing an XLSX parser.
class Element {
  constructor(tree){Object.assign(this,tree);this.children=(tree.children||[]).map(t=>new Element(t));}
  getAttribute(name){return this.attrs?.[name]??(name==='r:id'?this.attrs?.['id']:null)??null;}
  getAttributeNS(ns,name){return this.getAttribute(name);}
  get textContent(){return (this.text||'')+this.children.map(c=>c.textContent).join('');}
  getElementsByTagName(name){return this.children.flatMap(c=>[...(c.tag===name?[c]:[]),...c.getElementsByTagName(name)]);}
}
class DOMParser {
  parseFromString(xml){
    const script='import sys,json,xml.etree.ElementTree as E\ndef out(e):return {"tag":e.tag.split("}")[-1],"attrs":{k.split("}")[-1]:v for k,v in e.attrib.items()},"text":e.text or "","children":[out(c) for c in e]}\nprint(json.dumps(out(E.fromstring(sys.stdin.read()))))';
    const root=new Element(JSON.parse(cp.execFileSync('python3',['-I','-c',script],{input:xml,encoding:'utf8',maxBuffer:128*1024*1024})));
    return {getElementsByTagName:name=>[...(root.tag===name?[root]:[]),...root.getElementsByTagName(name)]};
  }
}
const context=vm.createContext({console,assert,Blob,TextEncoder,TextDecoder,CompressionStream,DecompressionStream,DOMParser,Date,setTimeout});
const setup=`
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const project={collections:[{id:'col-demo',label:'示例合集',baidu:'',quark:'',members:['item-a']}],sourceConfig:{bangumi:{enabled:false},custom_sources:[]},folderListings:{'col-demo':[{fid:'demo-folder',name:'DEMO101',path:'/DEMO101'}]},rankings:[{id:'rank-demo',items:[{id:'item-a'}]}]};
const meta={input_name:'示例目录',ui_config:{navigation:[{title:'示例卡片',url:'https://example.invalid/'}]}};
let views=[{id:'item-a',code:'DEMO101',name:'示例资料',sheet:'作品',zone:'sheet-0',date:'2026-01-01',sections:['作品'],tags:[],source:'custom',source_id:'demo-1',aliases:['示例别名'],web_info:{summary:'原简介'},customValue:'保留自定义值'},{id:'item-b',code:'DEMO102',name:'第二条资料',sheet:'作品',zone:'sheet-0',tags:[]}];
let cards=views;const byId=new Map(views.map(v=>[v.id,v]));const privateNotes={},editLog=[],SECTIONS=['作品'];const sheetZone=new Map([['作品','sheet-0']]);const sectionsOf=r=>r.category_sheets||[r.sheet];
const searchText=r=>r.name,refreshCards=()=>{cards=views;};const FIELD_LABEL={};
const tabHandlers={},SETTING_LIST=[];const collectionMembers=c=>views.filter(v=>(c.members||[]).includes(v.id));
const settingText=()=>'',settingFromText=(s,v)=>v,settingInvalid=()=>false,settingChanges=()=>[];
const fieldText=(r,k)=>Array.isArray(r[k])?r[k].join(' '):String(r[k]??'');
const parseFieldValue=(k,v)=>k==='tags'?String(v).split(' ').filter(Boolean):k==='updated'?v==='是':v;
const streamBytes=async(bytes,transform)=>new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
const PREFIX_FOR=()=> 'DEMO',todayStr=()=> '2026-01-01',batchFor=()=> '示例批次',collectionForBatch=()=>null;
const setStatus=()=>{},esc=String;
`;
context.Response=Response;
const history=core.slice(core.indexOf('const history ='),core.indexOf('// 可在表格里编辑的字段'));
const fieldChanges=core.slice(core.indexOf('function fieldChanges('),core.indexOf('// ---------- 合集'));
const records=core.slice(core.indexOf('const pad ='),core.indexOf('// ---------- 分区（推荐）'));
vm.runInContext(setup+history+fieldChanges+records+xlsx+'\nrenderXlsx=()=>{};',context);
(async()=>{
  assert(vm.runInContext("WORK_COLUMNS.some(([,key])=>key==='source_id')",context),'generic source ID must round-trip');
  vm.runInContext(`const csv=parseCsv('目录ID,名称,备注\\r\\nitem-a,"示例,资料","两行\\n文字"\\r\\n');assert.equal(csv[1][1],'示例,资料');assert.equal(csv[1][2],'两行\\n文字');`,context);
  await vm.runInContext(`(async()=>{const exported=await exportWorkbook();project.excelBase={rows:exported.base,aux:exported.aux};globalThis.book=await readWorkbook(await exported.blob.arrayBuffer());assert.equal(book['作品'][1][WORK_COLUMNS.findIndex(([,k])=>k==='source_id')+1],'demo-1');assert(book['来源配置']);assert(book['目录定位']);assert(book['分区']);assert(book['项目配置']);})()`,context);
  vm.runInContext(`
const nameCol=book['作品'][0].indexOf('名称');book['作品'][1][nameCol]='表格改名';byId.get('item-a').name='母版改名';
const analysis=analyzeImport(book,'fixture.xlsx');assert.equal(analysis.conflicts.filter(c=>c.key==='name').length,1);assert.equal(analysis.conflicts.find(c=>c.key==='name').use,'master');
analysis.conflicts.find(c=>c.key==='name').use='table';pendingImport=analysis;applyImport();assert.equal(byId.get('item-a').name,'表格改名');undo();assert.equal(byId.get('item-a').name,'母版改名');redo();assert.equal(byId.get('item-a').name,'表格改名');assert.equal(byId.get('item-a').customValue,'保留自定义值');
const partial=analyzeImport({'作品':[['目录ID','名称'],['item-a','CSV改名']]},'mapped.csv');assert.equal(partial.missing,1);assert.equal(views.length,2);
`,context);
  vm.runInContext(`
const sourceBook={'作品':[['ID','名称'],['item-a',byId.get('item-a').name]],'来源配置':[['配置名','JSON'],['sourceConfig',JSON.stringify({custom_sources:[{key:'library',records:[]}]})]],'目录定位':[['合集ID','文件夹JSON'],['col-demo','[{"fid":"another-demo","name":"DEMO102"}]']]};
const oldConfig=JSON.stringify(project.sourceConfig);pendingImport=analyzeImport(sourceBook,'source-fixture.xlsx');applyImport();assert.equal(project.sourceConfig.custom_sources[0].key,'library');assert.equal(project.folderListings['col-demo'][0].fid,'another-demo');undo();assert.equal(JSON.stringify(project.sourceConfig),oldConfig);redo();assert.equal(project.sourceConfig.custom_sources[0].key,'library');
const addBook={'作品':[['目录ID','名称','资料编号','资料来源','别名JSON','自定义备注'],['new-demo','新增示例','generic-demo','library','["可编辑别名"]','扩展内容']]};
pendingImport=analyzeImport(addBook,'new.csv');applyImport();assert.equal(byId.get('new-demo').source_id,'generic-demo');assert.equal(byId.get('new-demo').aliases[0],'可编辑别名');assert.equal(byId.get('new-demo').extra_fields['自定义备注'],'扩展内容');undo();assert(!byId.has('new-demo'));redo();assert(byId.has('new-demo'));
const beforeInvalid=JSON.stringify(views);assert.throws(()=>analyzeImport({'作品':[['ID','名称','资料JSON'],['item-a','不能写入','{bad']]},'broken.csv'));assert.equal(JSON.stringify(views),beforeInvalid);
`,context);
  await vm.runInContext(`(async()=>{
views=Array.from({length:2000},(_,index)=>({id:'stress-'+index,code:'SYN'+index,name:'合成资料'+index,sheet:'作品',zone:'sheet-0',date:'2026-01-01',tags:['合成'],aliases:['Synthetic '+index],category_sheets:['作品'],web_info:{summary:'合成简介'},version:'v1'}));cards=views;byId.clear();views.forEach(record=>byId.set(record.id,record));
const exported=await exportWorkbook();project.excelBase={rows:exported.base,aux:exported.aux};const stressBook=await readWorkbook(await exported.blob.arrayBuffer());const report=analyzeImport(stressBook,'synthetic-2000.xlsx');assert.equal(stressBook['作品'].length,2001);assert.equal(report.conflicts.length,0);assert.equal(report.auto.length,0);assert.equal(report.added.length,0);assert.equal(new Set(views.map(r=>r.id)).size,2000);
})()`,context);
  console.log('xlsx/csv round-trip, conflict, undo/redo and 2000 synthetic workbook rows: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
