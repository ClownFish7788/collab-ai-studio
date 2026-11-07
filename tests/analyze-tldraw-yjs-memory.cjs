const fs=require('fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base='docs/collaboration/';
const position=JSON.parse(fs.readFileSync(base+'tldraw-yjs-memory-node-results.json','utf8'));
const text=JSON.parse(fs.readFileSync(base+'tldraw-yjs-memory-text-results.json','utf8'));
const currentHash=crypto.createHash('sha256').update(fs.readFileSync('tests/tldraw-yjs-memory-benchmark.cjs')).digest('hex');
assert.equal(position.sourceSha256,currentHash);assert.equal(text.sourceSha256,currentHash);
assert.equal(position.results.length,18);assert.equal(text.results.length,12);
const M=1048576, q=a=>{const s=[...a].sort((x,y)=>x-y);return {median:s[Math.floor(s.length/2)],min:s[0],max:s.at(-1)}};
const stage=(r,name)=>{const v=r.stages.find(x=>x.stage===name);assert.ok(v,name);return v};
const cases=[];
for(const [kind,report,frames]of [['position',position,30000],['text',text,3000]])for(const shapes of [100,4000])for(const capture of [true,false]){
 const runs=report.results.filter(x=>x.shapes===shapes&&x.updates===frames&&x.capture===capture);
 assert.equal(runs.length,3);
 const loaded=r=>stage(r,'loaded'),edited=r=>stage(r,'edited-'+frames);
 const stages=Object.fromEntries(runs[0].stages.map(s=>[s.stage,Object.fromEntries(['retainedHeapAboveEmpty','heapUsed','encodedBytes','gzipBytes','logicalJsonBytes','retainedDeletedJsonBytes','undoSteps','structs','clockUnits','deletedClockUnits'].map(k=>[k,q(runs.map(r=>stage(r,s.stage)[k]))]))]));
 cases.push({kind,shapes,updates:frames,capture,loadedHeapMiB:q(runs.map(r=>loaded(r).retainedHeapAboveEmpty/M)),editedHeapMiB:q(runs.map(r=>edited(r).retainedHeapAboveEmpty/M)),growthHeapMiB:q(runs.map(r=>(edited(r).heapUsed-loaded(r).heapUsed)/M)),stages,
 curve:runs[0].stages.filter(s=>s.stage==='loaded'||s.stage.startsWith('edited-')).map(s=>({updates:s.updates,growthMiB:q(runs.map(r=>(stage(r,s.stage).heapUsed-loaded(r).heapUsed)/M))})),
 timings:{preflightMs:capture?q(runs.map(r=>r.timings.undoPreflight.ms)):null,preflightPostOperationHeapDeltaMiB:capture?q(runs.map(r=>(r.timings.undoPreflight.heapUncollectedAfter-r.timings.undoPreflight.heapBefore)/M)):null,sweepReleasedMs:q(runs.map(r=>r.timings.sweepWithoutHistoryMs)),reloadMs:q(runs.map(r=>r.timings.reloadPreservingIdsMs)),rebuildMs:q(runs.map(r=>r.timings.rebuildNewIdsMs))},
 gcReleasedHeapMiB:q(runs.map(r=>(stage(r,'history-cleared').heapUsed-stage(r,'sweep-after-clear').heapUsed)/M)),
 preflightAssociatedHeapChangeMiB:q(runs.map(r=>(stage(r,'after-undo-preflight').heapUsed-stage(r,'sweep-retaining-history').heapUsed)/M))});
}
const staticCases=[100,4000].map(shapes=>{const runs=position.results.filter(r=>r.shapes===shapes&&r.updates===0);return {shapes,heapMiB:q(runs.map(r=>r.stages[0].retainedHeapAboveEmpty/M)),encodedBytes:q(runs.map(r=>r.stages[0].encodedBytes))}});
const historyCost=[];
for(const kind of ['position','text'])for(const shapes of [100,4000]){const report=kind==='position'?position:text, n=kind==='position'?30000:3000;const full=report.results.filter(r=>r.shapes===shapes&&r.updates===n&&r.capture);const controls=report.results.filter(r=>r.shapes===shapes&&r.updates===n&&!r.capture);
 const diffs=full.map(r=>{const c=controls.find(x=>x.repeat===r.repeat);return (stage(r,'edited-'+n).heapUsed-stage(r,'loaded').heapUsed-stage(c,'edited-'+n).heapUsed+stage(c,'loaded').heapUsed)});
 historyCost.push({kind,shapes,pairedExtraHeapMiB:q(diffs.map(x=>x/M)),pairedExtraHeapBytesPerUpdate:q(diffs.map(x=>x/n))});}
const result={generatedAt:new Date().toISOString(),sourceSha256:currentHash,environment:position.environment,repeats:3,staticCases,cases,historyCost};
if(fs.existsSync(base+'tldraw-yjs-memory-browser-results.json')){
 result.browser=JSON.parse(fs.readFileSync(base+'tldraw-yjs-memory-browser-results.json','utf8'));
 const browserHash=crypto.createHash('sha256').update(fs.readFileSync('tests/memory-browser/app/page.tsx')).digest('hex');
 assert.equal(result.browser.browserSourceSha256,browserHash);
 assert.equal(result.browser.samples.filter(s=>!s.pilot).length,4);
}
fs.writeFileSync(base+'tldraw-yjs-memory-summary.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({staticCases,main:cases.map(c=>({kind:c.kind,n:c.shapes,capture:c.capture,load:c.loadedHeapMiB,growth:c.growthHeapMiB,heap:c.editedHeapMiB,bytes:c.stages['edited-'+c.updates].encodedBytes.median,retained:c.stages['edited-'+c.updates].retainedDeletedJsonBytes.median,gcBytes:c.stages['sweep-after-clear'].encodedBytes.median,newBytes:c.stages['rebuilt-new-ids'].encodedBytes.median,preflight:c.timings.preflightMs,preflightHeap:c.timings.preflightPostOperationHeapDeltaMiB,gcMs:c.timings.sweepReleasedMs,reload:c.timings.reloadMs,rebuild:c.timings.rebuildMs})),historyCost},null,2));
