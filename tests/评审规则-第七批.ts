import assert from 'node:assert/strict';
import katex from 'katex';
import { colorMath } from '../player/math-colors.ts';
import { groupDenseForces } from '../player/visual-rules.ts';
import { topicOf } from '../player/view-rules.ts';
const on = { velocity: true, force: true, displacement: true };
let count = 0;
const test = (name: string, run: () => void) => { run(); count++; console.log(`通过 ${name}`); };
test('独立物理符号和下标同色，关闭时保持原文', () => {
  const input = 'v_A+F_1+mg+x_A+\\Delta x+Δx+h';
  const out = colorMath(input, on);
  for (const [color, symbol] of [['#1c5fc4','v_A'],['#c9711a','F_1'],['#c9711a','mg'],['#5a4bb0','x_A'],['#5a4bb0','\\Delta x']]) assert.ok(out.includes(`\\textcolor{${color}}{${symbol}}`));
  assert.equal(colorMath(input, { velocity:false, force:false, displacement:false }), input);
});
test('文字、单位、命令、已有配色和别的符号的下标均保留', () => {
  for (const input of ['\\mathrm{m/s^2}', '\\text{F v x}', '\\operatorname{sin}', '\\textcolor{red}{v}', 'W_F+E_L+mv_F']) assert.equal(colorMath(input, on), input);
});
test('简写分数与未着色物理量的单字下标不破坏LaTeX', () => {
  for (const input of ['\\dfrac L4', '\\tfrac T2', '\\tfrac m2v_x^2', '\\tfrac12mv_F^2', 'R_{\\min}=\\dfrac L4']) assert.doesNotThrow(() => katex.renderToString(colorMath(input, on), {throwOnError:true}));
});
test('同类同向合并保持分力总矢量、来源及原数组不变', () => {
  const fs = [{ n:'来自甲的压力', by:'甲', x:0,y:-20 },{ n:'来自乙的压力', by:'乙', x:0,y:-30 },{ n:'地面支持力',by:'地面',x:0,y:50 }];
  const before = JSON.stringify(fs), out = groupDenseForces(fs);
  assert.equal(out.length,2); assert.equal(out[0].y,-50);assert.ok(out[0].n.includes('甲、乙')&&out[0].n.includes('共2个'));
  assert.equal(out.reduce((s,f)=>s+f.y,0),0);assert.equal(JSON.stringify(fs),before);
});
test('板块兜底为其他，机械结构仍归力学', () => {
  assert.equal(topicOf({title:'未知题',scene:{}}),'其他');
  assert.equal(topicOf({title:'半衰期'}),'原子物理');assert.equal(topicOf({title:'LC 振荡'}),'交变电流');
  assert.equal(topicOf({scene:{surfaces:[{}]}}),'力学');
});
console.log(`第七批规则：${count}/${count} 通过`);
