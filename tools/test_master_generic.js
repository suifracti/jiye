const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const meta={},ctx=vm.createContext({meta});
vm.runInContext(fs.readFileSync('src/master/js/06-config.js','utf8'),ctx);
assert.equal(meta.modules.quark,false);assert.equal(meta.modules.downloads,false);assert.equal(meta.top_notice.visible,false);assert.equal(meta.ui_config.stale_days,0);assert.equal(meta.latest_catalog_url,'');
assert.deepEqual(Array.from(meta.version_types,x=>x.name),['默认']);
meta.field_config.author={label:'导演',visible:false};assert.equal(vm.runInContext("fieldLabel('author')",ctx),'导演');assert.equal(vm.runInContext("fieldVisible('author')",ctx),false);
const cards=[{id:'a',author:'',web_info:{maker:'虚构作者'}},{id:'b',author:'手工作者',web_info:{maker:'来源作者'}}];
Object.assign(ctx,{cards,byId:new Map(cards.map(r=>[r.id,r])),fieldChanges:(r,key,after)=>[{kind:'field',id:r.id,key,before:r[key],after}],clone:structuredClone,$:()=>({addEventListener(){}})});
vm.runInContext(fs.readFileSync('src/master/js/63-local-fill.js','utf8'),ctx);
const report=vm.runInContext('localFillReport()',ctx);assert.equal(report.length,1);ctx.selection=report;cards[0].author='后来手填';assert.equal(vm.runInContext('localFillChanges(selection).length',ctx),0);
console.log('通用母版默认离线、字段配置、版本类型及本地回填保留人工内容通过');
Object.assign(ctx,{project:{collections:[]},tabHandlers:{},onChange(){},getPath:(object,path)=>path.reduce((value,key)=>value?.[key],object)});
vm.runInContext(fs.readFileSync('src/master/js/50-settings.js','utf8'),ctx);
const types=vm.runInContext("settingFromText(SETTING_LIST.find(item=>item.type==='versions'),'修订版｜#123456｜v2、第二版')",ctx);
assert.equal(types[0].name,'修订版');assert.equal(types[0].color,'#123456');assert.deepEqual(Array.from(types[0].values),['v2','第二版']);
const nodes={},node=id=>nodes[id]||=({before(){},checked:true});let started=0,helperChecks=0,html='',click;
const routine=vm.createContext({cards:[],meta:{},project:{collections:[]},clone:structuredClone,QUARK_FIELDS:[],esc:String,
  $:node,recentCards:()=>[],enrichRecords:()=>[],coverStore:()=>({}),coverOffStore:()=>({}),refSitesOf:()=>[],enabledSourceKeys:()=>[],sourceConfig:()=>({}),quarkOptions:()=>({modules:{quark:false}}),moduleEnabled:()=>false,localFillReport:()=>[],
  document:{createElement:()=>({addEventListener:(event,fn)=>click=fn})},needHelper:()=>{helperChecks++;return false;},runJob:()=>started++,setStatus(){},openDialog:text=>{html=text;return {querySelector:()=>null};},closeDialog(){},showTab(){},
});
vm.runInContext(fs.readFileSync('src/master/js/82-daily.js','utf8'),routine);
click();assert.equal(started,0);assert.equal(helperChecks,0,'默认离线例行不要求小助手');assert.match(html,/没有启用资料来源/);assert.match(html,/前往设置/);
console.log('版本类型配置解析和未启用来源的离线例行通过');
let commits=0,saves=0,exportCount=0;
Object.assign(routine,{byId:new Map(),currentEnrichResult:r=>r,refSelectionChanges:()=>[],enrichChanges:()=>[],quarkChanges:()=>[],localFillChanges:()=>[],commit:()=>commits++,saveMasterFile:async()=>{saves++;return {written:true};},exportReaderFile:async()=>{exportCount++;return {written:true};},blockingProblems:()=>[]});
nodes.dailyApplyExport.onclick().then(()=>{assert.equal(commits,1);assert.equal(saves,2);assert.equal(exportCount,1);console.log('离线例行一次应用、保存并导出通过');}).catch(error=>{console.error(error);process.exitCode=1;});
Object.assign(ctx,{views:cards});cards[0].quark_url='https://example.invalid/old';
vm.runInContext(fs.readFileSync('src/master/js/41-quark-tools.js','utf8'),ctx);
ctx.result={records:{a:{status:'missing',scanComplete:false},b:{status:'unknown'}}};
assert.equal(vm.runInContext('quarkHealthIssues(result).length',ctx),0,'没扫完或网络未知不写失踪');
ctx.result.records.a.scanComplete=true;assert.equal(vm.runInContext('quarkHealthIssues(result).length',ctx),1);
ctx.col={id:'demo',quark:cards[0].quark_url};ctx.result={summary:[{collection:'demo',complete:false}],records:{}};
assert.equal(vm.runInContext("replacementChanges(col,'https://example.invalid/new',result,col.quark).length",ctx),0,'未完成不换分享');
