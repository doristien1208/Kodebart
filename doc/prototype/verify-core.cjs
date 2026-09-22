// Pure Node verification; does not launch or control a browser.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=__dirname;
const html=fs.readFileSync(path.join(root,'KodeBart-UI-Demo.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const extract=(name,next)=>script.slice(script.indexOf('function '+name+'('),script.indexOf('function '+next+'('));
const sandbox={};vm.createContext(sandbox);
vm.runInContext(extract('rand','closeModal')+extract('validateRecord','day1')+'this.rand=rand;this.validateRecord=validateRecord;',sandbox);
const r={key:'B102',human:false,name:'未提供',code:'0102',refusal:null};
const ok=sandbox.validateRecord(r,{value:'0102',policy:'default_false'});
assert.equal(ok.value,102);assert.equal(ok.refusal,false);assert.equal(ok.origin,'defaulted');
const held=sandbox.validateRecord(r,{value:'0102',policy:'request_review'});
assert.equal(held.refusal,null);assert.equal(held.origin,'review');
assert(sandbox.validateRecord(r,{value:'0102'}).error);
for(const value of ['友善的人','NaN','1e2','102.5','0607','-102',''])assert(sandbox.validateRecord(r,{value,policy:'default_false'}).error);
assert.equal(sandbox.validateRecord({human:true,name:'林予安'}, {value:'林予安'}).value,'林予安');
assert(sandbox.validateRecord({human:true,name:'林予安'}, {value:'0102'}).error);
sandbox.records=[{key:'H17',human:true,name:'林予安'},{key:'B102',human:false,code:'0102'},{key:'B607',human:false,code:'0607'}];
vm.runInContext(extract('isValidSave','readSave')+'this.isValidSave=isValidSave;',sandbox);
const initial={version:1,seed:42,phase:'day1',archived:{},drafts:{},events:[],evidence:{reportOpened:false,receiptOpened:false}};
assert(sandbox.isValidSave(initial));
for(const bad of [null,{}, {...initial,phase:'day2'}, {...initial,archived:[]}, {...initial,seed:-1}, {...initial,evidence:{}}, {...initial,drafts:{B102:{value:5}}}])assert(!sandbox.isValidSave(bad));
vm.runInContext(extract('arranged','day2')+'this.arranged=arranged;',sandbox);
const cases=[];
for(const refusal of [false,null])for(const interference of [false,true]){
 sandbox.state={archived:{B102:{refusal}},night:{intervention:interference}};
 assert.equal(sandbox.arranged(),refusal===false||interference);
 cases.push({refusal,interference,arranged:sandbox.arranged()});
}
let yes=0,no=0;
for(let seed=1;seed<=1000;seed++){
 const a=sandbox.rand(seed,'night.intervention');
 assert(a>=0&&a<1);assert.equal(a,sandbox.rand(seed,'night.intervention'));
 const restored=JSON.parse(JSON.stringify({seed,night:{intervention:a<.45}}));
 assert.equal(restored.night.intervention,a<.45);
 if(a<.45)yes++;else no++;
}
assert(yes>0&&no>0);
assert(!html.includes('__COVER_DATA__'));
assert(html.includes('data:image/png;base64,'));
assert(!/\b(?:alert|confirm|prompt)\s*\(/.test(script));
assert(!/\.innerHTML\s*=/.test(script));
assert(!/https?:\/\//.test(html));
assert(html.includes('novalidate:true'));
const result={scriptSyntax:'pass',typeValidation:'pass',saveSchema:'pass',branchMatrix:cases,deterministicSeeds:1000,interventionSamples:{yes,no},embeddedAsset:'pass',externalRequests:'none',nativeBlockingDialogs:'none',browserVerification:'blocked; not performed'};
fs.writeFileSync(path.join(root,'Core-Test-Results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
