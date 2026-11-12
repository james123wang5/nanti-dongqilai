// 无浏览器：真实求解输出 + 画面纯规则；不读取或改写题库数据。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { solveProblem, type Problem } from '../engine/solve.ts';
import type { SimResult } from '../engine/sim.ts';
import { sampleAt } from '../player/timeline.ts';
import { fitFrame, COLORS } from '../player/geometry.ts';
import { chartHeight, forceGlyphs, forceMax, readableFont, toolbarCaption, MEANING, BODY_COLORS } from '../player/visual-rules.ts';
import { placeLabel, overlaps } from '../player/label-layout.ts';
let count = 0;
const test = (name: string, fn: () => void) => { fn(); count++; console.log(`通过 ${name}`); };
const read = (id: string): Problem => JSON.parse(readFileSync(new URL(`../problems/${id}/standard.json`,import.meta.url),'utf8'));
const board = read('00-板块示例'), solved = solveProblem(board,1/30), sim = solved.sim!;
test('扁场景图像高度占40%，限制200至320；普通场景160', () => {
  assert.equal(chartHeight(4,700),280); assert.equal(chartHeight(4,400),200); assert.equal(chartHeight(4,900),320);
  assert.equal(chartHeight(3.2,700),160); assert.equal(chartHeight(1,700),160);
});
test('按真实世界几何判断板块为扁场景，不依赖画布像素', () => {
  const c = fitFrame(sim,0,solved.asks[2].t!).content;
  assert.ok((c.x1-c.x0)/(c.y1-c.y0)>3.2);
});
test('比例尺扫描每一个采样及事件，排除问外时段', () => {
  const snap = (t: number, x: number) => ({ t, bodies: { A: { fs:[{n:'外力',x,y:0}] } } });
  const s = { start:snap(0,1),end:snap(3,1000),samples:[snap(0,1),snap(.1,50),snap(.2,2)],events:[{snap:snap(.3,70),before:snap(.3,90),after:snap(.3,80)}] } as unknown as SimResult;
  assert.equal(forceMax(s,0,1),90); assert.equal(forceMax(s,0,.2),50);
});
test('实验舱真实输出F与mg绘制长度严格6比1', () => {
  const s = solveProblem(read('真题-2026卷13-实验舱'),1/30).sim!, b = sampleAt(s,.1).bodies['舱'];
  const glyphs = forceGlyphs(b.fs!,forceMax(s,0,1)), F = glyphs.find((f) => f.label.startsWith('F ='))!, mg = glyphs.find((f) => f.label.startsWith('mg ='))!;
  assert.equal(F.magnitude,30000); assert.equal(mg.magnitude,5000); assert.equal(F.length/mg.length,6); assert.equal(F.length,96); assert.equal(mg.length,16);
});
test('小力最短14px，加括号说明长度为示意；零合力不画假箭头', () => {
  const glyphs=forceGlyphs([{n:'外力',x:1,y:0},{n:'外力',x:-1,y:0}],1000);
  assert.equal(glyphs[0].length,14); assert.ok(glyphs[0].label.endsWith('（长度为示意）'));
  const sum=glyphs.at(-1)!; assert.equal(sum.length,0); assert.equal(sum.label,'F合 = 0');
});
test('大分力抵消后的非零小合力不误标为零', () => {
  const sum=forceGlyphs([{n:'外力',x:1e8,y:0},{n:'外力',x:-1e8+.001,y:0}],1e8).at(-1)!;
  assert.ok(sum.magnitude>0); assert.ok(sum.schematic); assert.notEqual(sum.label,'F合 = 0');
});
test('真实木板上两个摩擦力包含各自施力方，保留原数值', () => {
  const fs = sampleAt(sim,.2).bodies.B.fs!, before = structuredClone(fs), glyphs=forceGlyphs(fs,forceMax(sim,0,1));
  assert.ok(glyphs.some((g) => g.label.startsWith('f(地面)'))); assert.ok(glyphs.some((g) => g.label.startsWith('f(A)')));
  assert.deepEqual(fs,before); assert.equal(glyphs.at(-1)!.magnitude,1);
});
test('mu2改成0.2时，木板分力之和严格为零', () => {
  const p=structuredClone(board); (p.params!.mu2 as unknown[])[0]=.2;
  const s=solveProblem(p,1/30).sim!, fs=sampleAt(s,.2).bodies.B.fs!, sum=forceGlyphs(fs,forceMax(s,0,1)).at(-1)!;
  assert.equal(sum.label,'F合 = 0'); assert.equal(sum.magnitude,0); assert.equal(sum.length,0);
});
test('合力深橙3px，分力橙2px，使用同一比例尺', () => {
  const g=forceGlyphs([{n:'外力',x:3,y:0},{n:'重力',x:0,y:-4}],5);
  assert.equal(g[0].color,MEANING.force); assert.equal(g[0].width,2); assert.equal(g[2].color,'#8a4a0c'); assert.equal(g[2].width,3); assert.equal(g[2].length,96);
});
test('物体六色采用评审建议，颜色与含义色分开', () => {
  assert.deepEqual(COLORS,['#4b5563','#a0703c','#2f8f83','#8c8c3a','#b0567a','#6b6b6b']); assert.deepEqual(COLORS,BODY_COLORS);
  assert.ok(COLORS.every((c) => ![MEANING.velocity,MEANING.force,MEANING.displacement,MEANING.target,MEANING.verified].includes(c)));
});
test('小字号提升到13px，不改变大字号、字重或字体', () => {
  assert.equal(readableFont('italic 600 10.5px serif'),'italic 600 13px serif'); assert.equal(readableFont('500 14px serif'),'500 14px serif');
});
test('顶栏步骤优先于阶段，转折点显示1.6秒再恢复当前步骤', () => {
  const step={say:'木板受滑块向右的摩擦力和地面向左的摩擦力。'};
  assert.deepEqual(toolbarCaption(step,1,'阶段','',0,100),{badge:'第 2 步',text:step.say,kind:'step'});
  assert.equal(toolbarCaption(step,1,'阶段','两者共速',1700,1699).text,'两者共速');
  assert.equal(toolbarCaption(step,1,'阶段','两者共速',1700,1700).text,step.say);
  assert.equal(toolbarCaption(undefined,-1,'阶段','',0,100).text,'阶段');
});
test('现有避让可让相邻标签同时避开边线和另一段文字', () => {
  const obstacles=[{x:200,y:160,w:100,h:4}],a=placeLabel({x:200,y:160,w:60,h:18},obstacles,800,400)!;
  const b=placeLabel({x:200,y:160,w:90,h:18},[...obstacles,a],800,400)!;
  assert.ok(a&&b&&!overlaps(a,b)); assert.ok(!obstacles.some((o)=>overlaps(a,o)||overlaps(b,o)));
});
// 画布替身只用于检查真实渲染代码能运行，以及绘字时实际采用的样式；不充当像素或浏览器验收。
const sceneUrl = new URL('../player/scene2d.ts',import.meta.url);
const source = stripTypeScriptTypes(readFileSync(sceneUrl,'utf8'),{mode:'transform'}).replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_m,_q,path) => `from '${new URL(path,sceneUrl).href}'`);
const { Scene2D } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('真实二维绘制冒烟：长木板截断、实验舱力图、气缸/光学/线框文字', () => {
  const keys=['document','location','devicePixelRatio'], original=keys.map((k)=>Object.getOwnPropertyDescriptor(globalThis,k));
  const noop=()=>{}, state: Record<string,any>={font:'13px serif',fillStyle:MEANING.ink,textAlign:'left',lineWidth:1}, stack: any[]=[];
  const context=new Proxy(state,{get:(o,k:string)=>k in o?o[k]:k==='save'?()=>stack.push({...o}):k==='restore'?()=>Object.assign(o,stack.pop()):k==='getTransform'?()=>({a:1,b:0,c:0,d:1,e:0,f:0}):k==='measureText'?(s:string)=>({width:[...s].reduce((n,c)=>n+(/[^\x00-\xff]/.test(c)?1:.55)*parseFloat(/([\d.]+)px/.exec(o.font)![1]),0)}):/create.*Gradient/.test(k)?()=>({addColorStop:noop}):noop});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>context,remove:noop})}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{search:'?qa'}});Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:1});
  try {
    for (const id of ['00-板块示例','真题-2026卷13-实验舱','真题-2024卷13-差压阀','真题-2025卷13-盖玻片','真题-2025陕晋宁青6-线框']) {
      const solved=solveProblem(read(id),1/30), sim=solved.asks[0].sim??solved.sim!, stage=new Scene2D({prepend:noop,getBoundingClientRect:()=>({width:930,height:400})});
      stage.prepare(sim,0,Math.max(1,solved.asks[0].t??sim.end.t));stage.update(sampleAt(sim,.2));stage.setOverlay({forces:[],spans:[],from:0});stage.toggle('force',id.includes('实验舱'));stage.render(0);
      assert.ok(stage.qa.texts.length>0,id); assert.ok(stage.qa.texts.every((t:any)=>t.h>=13&&t.outlineWidth===2&&t.outline===MEANING.paper),id);
      if (sim.board) assert.ok(stage.qa.texts.every((t:any)=>t.color===MEANING.ink),id);
      if (id.includes('实验舱')) { const arrows=stage.qa.forceArrows, F=arrows.find((a:any)=>a.label.startsWith('F =')),mg=arrows.find((a:any)=>a.label.startsWith('mg ='));assert.ok(mg.schematic ? mg.label.includes('长度为示意') && F.length>mg.length : F.length/mg.length===6, `F ${F.length} mg ${mg.length}`); }   // 反馈修订：伸不出物体的短箭头拉长并标示意
      if (id==='00-板块示例') assert.ok(stage.qa.texts.some((t:any)=>t.s.includes('全长 100 m')));
    }
  } finally { keys.forEach((k,i)=>original[i]?Object.defineProperty(globalThis,k,original[i]!):Reflect.deleteProperty(globalThis,k)); }
});
console.log(`第四批评审规则：${count}/${count} 通过`);
