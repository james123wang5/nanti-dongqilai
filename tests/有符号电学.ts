// 大小量保持兼容；方向量按明确的右手定则/楞次定律核验。
import assert from 'node:assert/strict';
import { induction } from '../engine/labs/induction.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const near = (a: number, b: number, tol = 2e-5) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
test('线框进入 +z 磁场顺时针为负、离开时逆时针为正', () => {
  const o = induction({ kind: 'frame', w: 1, h: 1, R: 2, m: 1e8, x: -.5, v: [1, 0], regions: [{ x: [0, 2], B: 3 }], duration: 3 }, {});
  const entering = o.frame(.25).vals, leaving = o.frame(2).vals;
  near(entering.emfs, -3); near(entering.Is, -1.5); near(leaving.emfs, 3); near(leaving.Is, 1.5);
  for (const s of [entering, leaving]) { near(s.I, Math.abs(s.Is)); near(s.emf, Math.abs(s.emfs)); }
});
test('导体棒反向运动：v×B 向下为正，支路回流向上为正', () => {
  const o = induction({ kind: 'rails', L: 2, B: 3, rods: [{ id: '棒', m: 1, r: 1, drive: '1-2*t' }], branches: [{ R: 2 }], duration: 1 }, {});
  for (const [t, v] of [[0, 1], [.25, .5], [.5, 0], [.75, -.5], [1, -1]]) {
    const s = o.frame(t).vals; near(s.emfs, 6 * v); near(s.Is, 2 * v); near(s.Is_棒, 2 * v); near(s.emfs_棒, 6 * v); near(s.Is_b1, 2 * v); near(s.I, Math.abs(s.Is)); near(s.emf, Math.abs(s.emfs));
  }
});
test('线圈 +z 磁场增大为顺时针、减小为逆时针', () => {
  const o = induction({ kind: 'coil', N: 4, S: 2, B: 't*(1-t)', R: 2, duration: 1 }, {});
  for (const [t, e] of [[.25, -4], [.75, 4]]) { const s = o.frame(t).vals; near(s.emfs, e); near(s.Is, e / 2); near(s.emf, 4); near(s.I, 2); }
});
test('转动棒：ω 朝 +z 时 v×B 沿径向向外，反转后符号反转', () => {
  for (const w of [-2, 2]) { const s = induction({ kind: 'rotate', L: 2, r0: 1, B: 3, omega: w, R: 2, duration: 1 }, {}).frame(.3).vals; near(s.emfs, 4.5 * w); near(s.Is, 2.25 * w); near(s.emf, Math.abs(s.emfs)); near(s.I, Math.abs(s.Is)); }
});
test('带符号量真正参与答案核验：线圈正确符号通过、错误符号不通过', () => {
  const p: Problem = { spec: 'v1', scene: { surfaces: [], bodies: [], induction: { kind: 'coil', N: 2, S: 3, B: 't', R: 2, duration: 1 } }, asks: [{ id: '1', text: '电流方向及数值', at: { event: 'time', t: .5 }, expr: 'val(Is)', answer: -3 }, { id: '2', text: '错误方向', expr: 'val(emfs)', answer: 6 }, { id: '3', text: '大小保持兼容', expr: 'val(I)', answer: 3 }] };
  assert.deepEqual(validate(p), []); const r = solveProblem(p); assert.equal(r.asks[0].ok, true); assert.equal(r.asks[1].ok, false); assert.equal(r.asks[2].ok, true); assert.equal(r.asks[0].source, 'engine');
});
test('用有符号电流查反转过零时刻，不被线圈输出采样网格量化', () => {
  const p: Problem = { spec: 'v1', scene: { surfaces: [], bodies: [], induction: { kind: 'coil', N: 1, S: 1, B: 't*(0.873-t)', R: 1, duration: 1 } }, asks: [{ id: '1', text: '负转正', at: { event: 'when', expr: 'val(Is)', dir: 1 }, expr: 't', answer: .4365 }] };
  const r = solveProblem(p); assert.equal(r.asks[0].ok, true); near(r.asks[0].value, .4365, 1e-7);
});
test('电路 Is(元件)：统一 a→b；电源供电时内部电流为负', () => {
  const p: Problem = { spec: 'v1', scene: { surfaces: [], bodies: [], circuit: { duration: 1, nodes: { n0: [0, 0], n1: [0, 1] }, elements: [{ id: '源', kind: 'battery', a: 'n1', b: 'n0', E: 10, r: 1 }, { id: '阻', kind: 'R', a: 'n1', b: 'n0', R: '4+5*t' }] } }, asks: [{ id: '1', text: '电源声明方向', expr: 'Is(源)', answer: -1 }, { id: '2', text: '电阻声明方向', expr: 'Is(阻)', answer: 1 }, { id: '3', text: '大小', expr: 'I(源)', answer: 1 }, { id: '4', text: '初始方向', at: { event: 'start' }, expr: 'Is(阻)', answer: 2 }, { id: '5', text: '快照取量', expr: 'val(Is_源)', answer: -1 }] };
  assert.deepEqual(validate(p), []); const r = solveProblem(p); for (const a of r.asks) { assert.equal(a.ok, true, `${a.text} ${a.error ?? a.value}`); assert.equal(a.source, 'engine'); }
});
test('支路换端点：大小不变，有符号电流取反', () => {
  const p: Problem = { spec: 'v1', scene: { surfaces: [], bodies: [], circuit: { nodes: { n0: [0, 0], n1: [0, 1] }, elements: [{ id: '源', kind: 'battery', a: 'n1', b: 'n0', E: 6, r: 1 }, { id: '阻', kind: 'R', a: 'n0', b: 'n1', R: 2 }] } }, asks: [{ id: '1', text: '反接取负', expr: 'Is(阻)', answer: -2 }, { id: '2', text: '大小', expr: 'I(阻)', answer: 2 }] };
  const r = solveProblem(p); assert.ok(r.asks.every((a) => a.ok));
});
console.log(`\n有符号电学测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
