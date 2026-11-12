// 真实 Chrome 开题性能：每次独立配置目录；首轮记录 CPU profile，随后两轮仅计时。
// 例：node 难题/tests/性能分析-播放器.mjs --key 真题-2025湖北10-五边形 --port 5193 --out 难题/tests/质检/结果/性能修正/after --limit-ms 6500
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {assertCanLaunchBrowser} from './浏览器守卫.mjs';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function browser(){
 const profile=mkdtempSync(resolve(out,'.chrome-')),port=9820+Math.floor(Math.random()*100);
 const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--use-angle=metal','--enable-gpu','about:blank'],{stdio:'ignore'});
 let ws,id=0;const pending=new Map(),listeners=new Map();
 for(let i=0;i<80&&!ws;i++){try{const ps=await(await fetch(`http://127.0.0.1:${port}/json`)).json();ws=new WebSocket(ps.find(p=>p.type==='page').webSocketDebuggerUrl);}catch{}if(!ws)await sleep(200);}
 if(!ws){chrome.kill();throw Error('Chrome启动失败');}
 if(ws.readyState!==1)await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id){pending.get(d.id)?.(d);pending.delete(d.id);}else for(const cb of listeners.get(d.method)??[])cb(d.params,d.sessionId);};
 const send=(method,params={},sessionId)=>new Promise((r,j)=>{const n=++id;pending.set(n,d=>d.error?j(Error(JSON.stringify(d.error))):r(d.result));ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
 const ev=async(fn,data)=>{const r=await send('Runtime.evaluate',{expression:typeof fn==='string'?fn:`(${fn})(${JSON.stringify(data)??''})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`http://localhost:${arg('--port','5193')}/?qa`});
 for(let i=0;i<200;i++){if(await ev('!!window.__qa'))break;await sleep(100);}
 return {ev,send,on:(method,cb)=>{const a=listeners.get(method)??[];a.push(cb);listeners.set(method,a);},close:async()=>{ws.close();chrome.kill();await Promise.race([new Promise(r=>chrome.once('exit',r)),sleep(2000)]);rmSync(profile,{recursive:true,force:true});}};
}

const out=resolve(arg('--out','难题/tests/质检/结果/性能分析'));
const key=arg('--key','');
if(!key)throw Error('需要 --key 题目文件夹名；可选 --port、--out、--trials、--limit-ms');
const trials=Number(arg('--trials','3')),limit=Number(arg('--limit-ms','6500'));
if(!Number.isInteger(trials)||trials<1||!Number.isFinite(limit)||limit<=0)throw Error('trials需要为正整数，limit-ms需要为正数');
mkdirSync(out,{recursive:true});
await assertCanLaunchBrowser();
const runs=[];
for(let trial=0;trial<trials;trial++){
 const b=await browser();try{
 const list=await b.ev(()=>__qa.list()),index=list.findIndex(x=>x.key===key);
 if(index<0)throw Error('找不到目标题');
 const profiled=trial===0;
 await b.ev(()=>{window.__workerTimes=[];const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){const begin=performance.now();this.addEventListener('message',e=>{window.__workerTimes.push({wall:performance.now()-begin,engine:e.data.ms,pending:e.data.solved?.pending});});return send.apply(this,args);};});
 if(profiled){
  await b.ev(async()=>{const url=performance.getEntriesByType('resource').find(x=>/\/scene2d\.ts/.test(x.name)).name;const {Scene2D}=await import(url);window.__costs={};for(const key of ['prepare','render','fit','prims','flushLabels','spotNear','spot','block']){const original=Scene2D.prototype[key];Scene2D.prototype[key]=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{const a=window.__costs[key]??={calls:0,ms:0,max:0};const dt=performance.now()-t;a.calls++;a.ms+=dt;a.max=Math.max(a.max,dt);if(key==='flushLabels')a.maxObstacles=Math.max(a.maxObstacles??0,this.taken.length);}};}});
  await b.send('Profiler.enable');await b.send('Profiler.setSamplingInterval',{interval:1000});await b.send('Profiler.start');

 }
 await b.send('Performance.enable');const start=await b.send('Performance.getMetrics');
 const opened=await b.ev(i=>__qa.open(i),index),end=await b.send('Performance.getMetrics');
 const timings=Object.fromEntries(end.metrics.filter(x=>['ScriptDuration','LayoutDuration','TaskDuration','RecalcStyleDuration'].includes(x.name)).map(x=>[x.name,(x.value-(start.metrics.find(y=>y.name===x.name)?.value??0))*1000]));
 const row={trial,profiled,opened,metrics:timings,workerMessages:await b.ev(()=>window.__workerTimes)};
 if(profiled){row.methods=await b.ev(()=>window.__costs);const {profile}=await b.send('Profiler.stop');writeFileSync(`${out}/main.cpuprofile`,JSON.stringify(profile));}
 runs.push(row);console.log(JSON.stringify(row));
 }finally{await b.close();}
}
writeFileSync(`${out}/timing.json`,JSON.stringify(runs,null,2));
if(runs.some(r=>r.opened.fail||r.opened.ms>limit))process.exitCode=1;
