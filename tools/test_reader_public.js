'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/reader/reader-app.js', 'utf8');
const body = source.match(/  function coverUrl\(r\) \{[\s\S]*?\n  \}/)[0];
function cover(record, meta = {}) {
  return vm.runInNewContext(body + '\ncoverUrl(record)', {
    record, meta, coverOff: new Set(), CatalogImages: {url: value => value},
  });
}
assert.equal(cover({id:'synthetic-a',source_id:'SYNTHETIC-000',web_info:{id:'00000000'}}), '', 'source IDs must not trigger implicit image requests');
assert.equal(cover({id:'synthetic-a'},{card_covers:{'synthetic-a':'data:image/png;base64,AA=='}}), 'data:image/png;base64,AA==');
assert.equal(cover({id:'synthetic-a',web_info:{cover_url:'https://example.invalid/cover.png'}}), '', 'remote image defaults off');
assert.equal(cover({id:'synthetic-a',web_info:{cover_url:'https://example.invalid/cover.png'}},{ui_config:{allow_remote_images:true}}), 'https://example.invalid/cover.png');
console.log('reader public cover behavior: passed');
const settingsSource = fs.readFileSync('src/master/js/50-settings.js', 'utf8');
const settingsBody = settingsSource.slice(settingsSource.indexOf('function settingText'), settingsSource.indexOf('function settingChanges'));
function roundtrip(type, current) {
  return vm.runInNewContext(settingsBody + '\nsettingFromText({type}, settingText({type}))', {type, current, settingValue: () => current});
}
assert.equal(JSON.stringify(roundtrip('versions', [{name:'修订版',color:'#336699',values:['v2','v3']} ])),JSON.stringify([{name:'修订版',color:'#336699',values:['v2','v3']} ]));
assert.equal(JSON.stringify(roundtrip('markers', [{key:'synthetic-marker',label:'演示标记',tag:'合成标签'}])), JSON.stringify([{key:'synthetic-marker',label:'演示标记',tag:'合成标签'}]));
assert.equal(JSON.stringify(roundtrip('lines', ['合成类型甲','合成类型乙'])), JSON.stringify(['合成类型甲','合成类型乙']));
console.log('reader settings synthetic roundtrip: passed');
