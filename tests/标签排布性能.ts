// 用操作次数约束复杂度，避免依赖机器快慢；同时检查选位与穷举候选排序一致。
import assert from 'node:assert/strict';
import { placeLabel, distanceToBox, overlaps, type Rect } from '../player/label-layout.ts';
let passed=0;
const test=(name:string,fn:()=>void)=>{fn();passed++;console.log(`通过 ${name}`);};

test('一万六千个远处障碍下，空闲首选位置仅需线性碰撞检查',()=>{
  let reads=0;const count=16000;
  const obstacles=Array.from({length:count},(_,i)=>({get x(){reads++;return 1600+i%100;},y:900,w:8,h:8}));
  const label={x:400,y:200,w:80,h:22};
  assert.deepEqual(placeLabel(label,obstacles,880,430),label);
  assert.ok(reads<=count*2,`障碍读取 ${reads} 次，不应遍历候选与障碍的笛卡尔积`);
});

test('重复障碍不会触发重复候选的平方级碰撞检查，保留同分时先向上',()=>{
  let reads=0;const count=2000;
  const obstacles=Array.from({length:count},()=>({get x(){reads++;return 440;},y:215,w:100,h:100}));
  const label={x:440,y:215,w:80,h:22};
  assert.deepEqual(placeLabel(label,obstacles,880,430),{...label,y:149});
  assert.ok(reads<=count*8,`障碍读取 ${reads} 次`);
});

// 与优化前的“全部碰撞筛选，再稳定排序”口径独立对照，不复用优化后的候选去重或早退。
function exhaustive(label:Rect,obstacles:Rect[],width:number,height:number,tip?:[number,number]){
  const bound=(r:Rect)=>({...r,x:Math.max(r.w/2+8,Math.min(width-r.w/2-8,r.x)),y:Math.max(r.h/2+44,Math.min(height-r.h/2-60,r.y))});
  const candidates=[label];
  for(const o of obstacles)candidates.push({...label,y:o.y-(o.h+label.h)/2-5},{...label,y:o.y+(o.h+label.h)/2+5},{...label,x:o.x-(o.w+label.w)/2-5},{...label,x:o.x+(o.w+label.w)/2+5});
  return candidates.map(bound).filter(r=>r.w+16<=width&&r.h+104<=height&&!obstacles.some(o=>overlaps(r,o)))
    .sort((a,b)=>(tip?distanceToBox(a,tip)-distanceToBox(b,tip):0)||Math.hypot(a.x-label.x,a.y-label.y)-Math.hypot(b.x-label.x,b.y-label.y))[0];
}
test('随机候选的最短移动、近箭头优先级、边界和同分顺序与穷举一致',()=>{
  let seed=20261111;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  let compared=0;
  for(let i=0;i<1200;i++){
    const width=300+rnd()*700,height=240+rnd()*500,label={x:(rnd()*1.4-.2)*width,y:(rnd()*1.4-.2)*height,w:20+rnd()*160,h:16+rnd()*40};
    const obstacles=Array.from({length:Math.floor(rnd()*55)},()=>({x:(rnd()*1.6-.3)*width,y:(rnd()*1.6-.3)*height,w:4+rnd()*150,h:4+rnd()*100}));
    if(i%3===0)obstacles.push(...obstacles.slice(0,10));
    const tip:[number,number]|undefined=i%2?[rnd()*width,rnd()*height]:undefined,expected=exhaustive(label,obstacles,width,height,tip);
    // 箭头全局退路是未改动的另一路搜索；此处只对照穷举候选能决定的结果。
    if(expected||!tip){assert.deepEqual(placeLabel(label,obstacles,width,height,tip),expected,`case ${i}`);compared++;}
  }
  assert.ok(compared>1000);
});
console.log(`标签排布性能规则：${passed}/${passed} 通过`);
