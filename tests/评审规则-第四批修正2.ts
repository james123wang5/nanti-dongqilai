// 不启动浏览器：真实二维/三维绘制方法 + 原质检窗口的几何复现。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {solveProblem} from '../engine/solve.ts';
import {sampleAt} from '../player/timeline.ts';
import {buildLesson,buildProcessMap} from '../player/lesson.ts';
import {chartHeight,forceMax} from '../player/visual-rules.ts';
import {distanceToBox} from '../player/label-layout.ts';
import {canvasEnvironment,loadScene,loadPlayerClass} from './helpers/画布替身.ts';
const D2=await loadScene(),D3=await loadPlayerClass(new URL('../player/scene3d.ts',import.meta.url),'Scene3D'),env=canvasEnvironment();
const read=(key:string)=>JSON.parse(readFileSync(new URL(`../problems/${key}/standard.json`,import.meta.url),'utf8'));
let passed=0;const test=(name:string,fn:()=>void)=>{fn();passed++;console.log(`通过 ${name}`);};
const rows:any[]=[];
try{
  test('真实二维/三维受力绘制：同刻条数、质量字母、大小、顺序和合力一致',()=>{
    const S=solveProblem(read('00-板块示例'),1/30),sim=S.sim!,snap=sampleAt(sim,.2),width=930,height=430;
    for(const letters of [false,true])for(const selected of [['B'],['A','B']]) /* 受力默认只画所求物体，B 要学生点它 */{
      const a=new D2(env.element(width,height));a.prepare(sim,0,1.5);a.setMasses({B:'M',A:'m'});a.symbolsOnly=letters;a.setOverlay({forces:selected,spans:[],from:0});a.toggle('force',true);a.update(snap);a.render(0);
      // 不调用构造器或 WebGLRenderer；真实 Three 数学对象只用于投影方向。
      const b=Object.create(D3.prototype);Object.assign(b,{sim,lastSnap:snap,forceIds:selected,flags:{force:true},fmax:forceMax(sim,0,1.5),forceLayer:document.createElement('canvas'),model:new THREE.Group(),camera:new THREE.OrthographicCamera(-10,10,10,-10,.1,100),bodies:new Map(sim.geo.bodies.map((q)=>[q.id,{group:new THREE.Group()}])),screenOf:(id:string)=>[id==='B'?600:300,230]});b.camera.position.z=10;b.camera.updateMatrixWorld();b.setMasses({B:'M',A:'m'});b.symbolsOnly=letters;b.drawForces(width,height,[]);
      const semantic=(list:any[])=>list.map((x)=>({body:x.body,label:x.label.replace(/（长度为示意）$/,''),magnitude:x.magnitude,resultant:x.resultant})).sort((p,q)=>(p.body+p.label).localeCompare(q.body+q.label));   // 反馈修订：同向共线后顺序按排法定；拉长的示意箭头平面按物体大小、立体按固定值，长度和“示意”标记不比，只比条数、名字、大小
      assert.deepEqual(semantic(a.qa.forceArrows),semantic(b.qa.forceArrows));assert.ok(b.qa.forceArrows.some((x:any)=>x.body==='B'&&x.label.startsWith('Mg')));
    }
  });
  test('空闲但距箭头过远的速度标签缓存不会被直接复用',()=>{
    const S=solveProblem(read('00-板块示例'),1/30),a=new D2(env.element(930,430));a.prepare(S.sim,0,1.5);a.taken=[];
    a.lastSpot.set('v_A#1c5fc4#0',[0,120]);const pos=a.spotNear(405,150,80,22,'v_A#1c5fc4#0',false,[400,160]);
    assert.ok(pos);assert.ok(distanceToBox({x:pos[0]+40,y:pos[1]+11,w:80,h:22},[400,160])<=42);
  });
  const fixtures=JSON.parse(readFileSync(new URL('./fixtures/第四批修正2.json',import.meta.url),'utf8')).cases,cache=new Map();
  const inter=(a:any,b:any)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  for(const c of fixtures){
    const P=read(c.key);if(!cache.has(c.key))cache.set(c.key,solveProblem(P,1/30));const S=cache.get(c.key),sim=(c.k>=0?S.asks[c.k].sim:undefined)??S.sim,{w0,w1,focus}=c.info,span=w1-w0;
    const a=new D2(env.element(879.6,431));a.prepare(sim,w0,w1);a.element=env.element(879.6,716-chartHeight(a.contentRatio,716));a.prepare(sim,w0,w1);a.setFocus(focus);a.symbolsOnly=!!S.samples;
    const at=c.k>=0?S.asks[c.k].t??S.asks[c.k].span?.[1]:undefined,keyT=at!==undefined&&at>=w0&&at<=w1?at:null;
    const lesson=c.k<0?buildProcessMap(P,sim,w0,w1,!!S.samples).steps:buildLesson({P,a:S.asks[c.k],q:P.asks[c.k],sim,w0,w1,keyT,letters:!!S.samples});
    const frame=(t:number)=>{const step=lesson.filter((s:any)=>s.t<=t+1e-9).at(-1),sh=step?.show??{};a.setOverlay({forces:sh.forces??[],spans:sh.span??[],gap:sh.gap,label:sh.label,from:w0});a.update(sampleAt(sim,t));a.render(0);return structuredClone(a.qa);};
    const ts=new Set<number>(Array.from({length:22},(_,i)=>w0+span*i/21));for(const i of c.issues)ts.add(i.t);for(const s of lesson)if(s.t>=w0&&s.t<=w1)ts.add(s.t);
    let velocityFar=0,allFar=0,cross=0,jump=0,maxVelocityDistance=0;
    for(const t of [...ts].sort((a,b)=>a-b)){
      const f=frame(t),main=f.texts.filter((x:any)=>!x.inset&&!x.rot&&x.w>1);
      for(const l of f.labels.filter((l:any)=>l.tip&&!l.inset)){const d=Math.hypot(Math.max(l.x-l.tip[0],0,l.tip[0]-l.x-l.w),Math.max(l.y-l.tip[1],0,l.tip[1]-l.y-l.h));if(d>45)allFar++;if(l.s.includes('#1c5fc4')){maxVelocityDistance=Math.max(maxVelocityDistance,d);if(d>45)velocityFar++;}}
      // 逐字保留质检的箭头穿字采样和命中条件，不改变阈值。
      for(const ar of f.arrows.filter((r:any)=>!r.inset)){const n=Math.ceil(Math.hypot(ar.x1-ar.x0,ar.y1-ar.y0)/4);for(const x of main){let hit=0;for(let i=2;i<n-1;i++){const px=ar.x0+(ar.x1-ar.x0)*i/n,py=ar.y0+(ar.y1-ar.y0)*i/n;if(px>x.x+2&&px<x.x+x.w-2&&py>x.y+2&&py<x.y+x.h-2)hit++;}if(hit>=2)cross++;}}
    }
    for(const center of [.2,.5,.8]){let previous:any;for(let i=0;i<8;i++){const f=frame(w0+span*center+i*span/720);if(previous){const m=new Map(previous.labels.filter((l:any)=>l.tip).map((l:any)=>[l.s,l]));for(const l of f.labels.filter((l:any)=>l.tip)){const p:any=m.get(l.s);if(p&&Math.hypot((l.x-l.ax)-(p.x-p.ax),(l.y-l.ay)-(p.y-p.ay))>24)jump++;}}previous=f;}}
    rows.push({key:c.key,k:c.k,held:c.held,allFar,velocityFar,maxVelocityDistance,cross,jump});
  }
  test('原报告速度标签：开发不多于1问、留出不多于3问距箭头过远',()=>{
    assert.ok(rows.filter((r)=>!r.held&&r.velocityFar).length<=1&&rows.filter((r)=>r.held&&r.velocityFar).length<=3,JSON.stringify(rows));
  });
  test('河南两窗口的长度刻度不被箭头穿过',()=>{
    const henan=rows.filter((r)=>r.key==='2026-河南-15');assert.equal(henan.length,2);assert.ok(henan.every((r)=>r.cross===0),JSON.stringify(henan));
  });
  test('所有原异常窗口的标签跳动不超过原2/0',()=>{
    assert.ok(rows.filter((r)=>!r.held&&r.jump).length<=2&&rows.filter((r)=>r.held&&r.jump).length===0,JSON.stringify(rows));
  });
  console.log('第二轮复现：'+JSON.stringify(rows));
  console.log(`第四批修正2规则：${passed}/${passed} 通过`);
}finally{env.restore();}
