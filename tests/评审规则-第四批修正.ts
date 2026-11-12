// 几何复现不启动浏览器；字体宽度近似，不能代替像素质检。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {solveProblem} from '../engine/solve.ts';
import {sampleAt} from '../player/timeline.ts';
import {buildLesson,buildProcessMap} from '../player/lesson.ts';
import {chartHeight} from '../player/visual-rules.ts';
import {placeStableLabel,overlaps} from '../player/label-layout.ts';
import {loadScene,canvasEnvironment} from './helpers/画布替身.ts';
const Scene=await loadScene(),env=canvasEnvironment();
let count=0;
const test=(s:string,f:()=>void)=>{f();count++;console.log(`通过 ${s}`);};
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/第四批修正.json',import.meta.url),'utf8')).cases;
const inter=(a:any,b:any)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
const solved=new Map(),rows:any[]=[];
try {
  test('稳定排布优先复用旧位置，不为省几像素而换边',()=>{
    const a={x:200,y:160,w:80,h:22},p={...a,x:185,y:150};
    assert.deepEqual(placeStableLabel(a,[],800,400,p,[200,160]),p);
  });
  test('旧位置被占时在21px内找空位，不压物体',()=>{
    const a={x:200,y:160,w:60,h:22},ob=[{x:200,y:178,w:80,h:10}];
    const r=placeStableLabel(a,ob,800,400,a,[200,160])!;
    assert.ok(r&&!ob.some((o)=>overlaps(r,o,1)));assert.ok(Math.hypot(r.x-a.x,r.y-a.y)<=21);
  });
  for(const c of fixtures){
    if(!solved.has(c.key))solved.set(c.key,solveProblem(JSON.parse(readFileSync(new URL(`../problems/${c.key}/standard.json`,import.meta.url),'utf8')),1/30));
    const S=solved.get(c.key),P=JSON.parse(readFileSync(new URL(`../problems/${c.key}/standard.json`,import.meta.url),'utf8')),sim=(c.k>=0?S.asks[c.k].sim:undefined)??S.sim,{w0,w1,focus}=c.info,span=w1-w0;
    const stage=new Scene(env.element(879.6,431));stage.prepare(sim,w0,w1);stage.element=env.element(879.6,716-chartHeight(stage.contentRatio,716));stage.prepare(sim,w0,w1);stage.setFocus(focus);stage.symbolsOnly=!!S.samples;stage.toggle('inset',true); // 放大镜现在是开关，默认关；这里验打开后的效果
    const lesson=c.k<0?buildProcessMap(P,sim,w0,w1,!!S.samples).steps:buildLesson({P,a:S.asks[c.k],q:P.asks[c.k],sim,w0,w1,keyT:null,letters:!!S.samples});
    const frame=(t:number)=>{const st=lesson.filter((s:any)=>s.t<=t+1e-9).at(-1),sh=st?.show??{};stage.setOverlay({forces:sh.forces??[],spans:sh.span??[],gap:sh.gap,label:sh.label,from:w0});stage.update(sampleAt(sim,t));stage.render(0);return structuredClone(stage.qa);};
    const ts=new Set<number>(Array.from({length:22},(_,i)=>w0+span*i/21));for(const e of c.issues)ts.add(e.t);for(const s of lesson)if(s.t>=w0&&s.t<=w1)ts.add(s.t);
    let inset=0,overlap=0,owned=0,jump=0;
    for(const t of [...ts].sort((a,b)=>a-b)){
      const f=frame(t);owned+=f.texts.filter((x:any)=>x.s.startsWith('放大 ')&&x.inset).length;
      if(f.inset)inset+=f.texts.filter((x:any)=>!x.inset&&inter(f.inset,x)>.3*x.w*x.h).length;
      const bs=f.bodies.filter((b:any)=>!b.inset&&b.kind!=='board');
      for(let i=0;i<bs.length;i++)for(const b of bs.slice(i+1)){
        const a=bs[i],d=Math.hypot(a.x-b.x,a.y-b.y),real=Math.hypot(a.wx-b.wx,a.wy-b.wy),need=(a.size+b.size)/2;
        if(d<.7*(a.r+b.r)&&real>need*1.05+1e-9&&real>1e-6*(Math.abs(a.wx)+Math.abs(a.wy)+1e-12))overlap++;
      }
    }
    for(const center of [.2,.5,.8]){let previous:any;
      for(let i=0;i<8;i++){const f=frame(w0+span*center+i*span/720);
        if(previous){const prev=new Map(previous.labels.filter((l:any)=>l.tip).map((l:any)=>[l.s,l]));
          for(const l of f.labels.filter((l:any)=>l.tip)){const p:any=prev.get(l.s);if(p&&Math.hypot((l.x-l.ax)-(p.x-p.ax),(l.y-l.ay)-(p.y-p.ay))>24)jump++;}
        }previous=f;
      }
    }
    rows.push({key:c.key,k:c.k,held:c.held,inset,overlap,owned,jump,board:sim.geo.bodies.find((b:any)=>b.id===focus)?.kind==='board'});
  }
  test('七处放大窗说明属于窗内，主画面不被说明误遮挡',()=>{
    const cases=rows.filter((r)=>fixtures.find((c:any)=>c.key===r.key&&c.k===r.k).issues.some((i:any)=>i.cat==='放大窗挡住'));
    assert.equal(cases.length,7);// 所求物体是木板/轨道时不再开放大窗（放大它只会框出一块空地方），其余照旧要求说明在窗内
    assert.ok(cases.every((r:any)=>(r.board?r.owned===0:r.owned>0)&&r.inset===0),JSON.stringify(cases));
  });
  test('炮弹分裂和防滑带四处复现均不再画重叠',()=>{
    const cases=rows.filter((r)=>fixtures.find((c:any)=>c.key===r.key&&c.k===r.k).issues.some((i:any)=>i.cat==='物体画重叠'));
    assert.equal(cases.length,4);assert.ok(cases.every((r)=>r.overlap===0),JSON.stringify(cases));
  });
  test('原异常窗口的连续帧标签跳动不超过开发3问、留出0问',()=>{
    const dev=rows.filter((r)=>!r.held&&r.jump>0),held=rows.filter((r)=>r.held&&r.jump>0);
    assert.ok(dev.length<=3&&held.length===0,JSON.stringify({dev,held}));
  });
  test('电荷符号在名字旁，保持深色且不压住粒子',()=>{
    const P=JSON.parse(readFileSync(new URL('../problems/示例-磁场圆周/standard.json',import.meta.url),'utf8')),S=solveProblem(P,1/30),sim=S.asks[0].sim??S.sim;
    const stage=new Scene(env.element(879.6,500));stage.prepare(sim,0,sim.end.t);stage.update(sampleAt(sim,0));stage.render(0);
    const charged=stage.qa.texts.filter((t:any)=>t.s.includes('(+)'));assert.ok(charged.length>0);
    assert.ok(charged.every((t:any)=>t.color==='#1a262a'&&stage.qa.bodies.every((b:any)=>inter(t,{x:b.x-b.r,y:b.y-b.r,w:2*b.r,h:2*b.r})<=.35*t.w*t.h)));
  });
  test('扁场景图标放大有上限，打开受力时物体大小不变（不再忽大忽小）',()=>{
    const P=JSON.parse(readFileSync(new URL('../problems/00-板块示例/standard.json',import.meta.url),'utf8')),S=solveProblem(P,1/30),sim=S.sim,stage=new Scene(env.element(879.6,400));
    stage.prepare(sim,0,1.5);stage.update(sampleAt(sim,.8));stage.render(0);const normal=stage.qa.bodies.find((b:any)=>b.id==='A').r;
    stage.setOverlay({forces:['A'],spans:[],from:0});stage.render(0);const force=stage.qa.bodies.find((b:any)=>b.id==='A').r;
    assert.ok(normal>=19&&normal<=28&&Math.abs(force-normal)<1e-9,`${normal} ${force}`);assert.ok(stage.qa.forceArrows.length>1);
  });
  test('手机通过实际布局收缩文字，不隐藏整页溢出',()=>{
    const css=readFileSync(new URL('../player/style.css',import.meta.url),'utf8');
    assert.ok(css.includes('.stage { grid-template-columns:minmax(0,1fr); }'));
    assert.ok(/#nowMessage\s*\{[^}]*flex:1 1 0%[^}]*min-width:0[^}]*overflow:hidden[^}]*text-overflow:ellipsis/.test(css));
    assert.ok(!/(?:body|html)[^{]*\{[^}]*overflow-x:\s*hidden/.test(css));
  });
  console.log('复现窗口：'+JSON.stringify(rows));
  console.log(`第四批修正规则：${count}/${count} 通过`);
}finally{env.restore();}
