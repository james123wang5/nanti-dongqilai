// 运行期物理边界中止后，只核验已经完成的过程，不把截断当作 end。
import assert from 'node:assert/strict';
import { simulate, type SceneSpec } from '../engine/sim.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const near = (a: number, b: number, tol = 1e-7) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
const scene = (): SceneSpec => ({ surfaces: [{ id: '地面', kind: 'ground', y: 0 }, { id: '槽', on: '宿主', from: [0, 0], to: [20, 0], marks: { P: 1.25 } }], bodies: [{ id: '宿主', kind: 'board', m: 1, length: 20, on: '地面', x: 0 }, { id: '球', m: 1, on: '槽', at: 1, v: 1 }], forces: [{ on: '宿主', F: [0, '30*t'] }], tMax: 1 });
const P = (): Problem => ({ spec: 'v1', constants: { g: 10 }, scene: scene(), asks: [
  { id: '早', text: '中止前时刻', at: { event: 'time', t: .2 }, expr: 'x(球)', answer: 1.2 },
  { id: '过点', text: '中止前事件', at: { event: 'pass', body: '球', to: 'P' }, expr: 't', answer: .25 },
  { id: '过零', text: '中止前 when', at: { event: 'when', expr: 'x(球)-1.4' }, expr: 't', answer: .4 },
  { id: '取量', text: '中止前 times/vals', expr: 'tp+xp', times: { tp: { event: 'pass', body: '球', to: 'P' } }, vals: { xp: { at: { event: 'time', t: .2 }, expr: 'x(球)' } }, answer: 1.45 },
  { id: '晚', text: '中止后时刻', at: { event: 'time', t: .8 }, expr: 'x(球)' },
  { id: '终', text: '不能把中止当结束', at: { event: 'end' }, expr: 't' },
  { id: '省略', text: '省略时刻仍不能读取伪造终态', expr: 'x(球)' },
  { id: '依赖', text: '早时刻含晚取量', at: { event: 'time', t: .2 }, expr: 'xp', vals: { xp: { at: { event: 'time', t: .8 }, expr: 'x(球)' } } },
] });
test('单侧支撑中止保留事件/时刻/when/times/vals，后续问题获得完整诊断', () => {
  const r = solveProblem(P(), .01); assert.ok(r.sim?.failure); near(r.sim!.failure!.t, 2 / 3); assert.equal(r.sim!.events.some((e) => e.type === 'end'), false);
  for (const a of r.asks.slice(0, 4)) assert.equal(a.ok, true, `${a.id} ${a.error ?? a.value}`);
  for (const a of r.asks.slice(4)) { assert.equal(a.source, 'unavailable'); assert.match(a.error!, /单侧支撑失效/); assert.match(a.error!, /宿主.*t=/); assert.match(a.error!, /球 位于轨道 槽/); assert.match(a.error!, /向下拉.*N/); assert.match(a.error!, /半径更大/); assert.match(a.error!, /locked:true/); }
  assert.ok(r.sim!.samples.every((s) => s.t <= r.sim!.failure!.t));
});
test('默认 simulate 仍抛错；显式 partial 才返回有效前缀', () => {
  assert.throws(() => simulate(scene(), { g: 10 }), /单侧支撑失效/); const r = simulate(scene(), { g: 10 }, { partial: true }); near(r.end.t, 2 / 3); assert.ok(r.failure);
});
test('仅由中止前条件反解的未知数仍可核验', () => {
  const p = P(); p.scene.bodies[1].v = 'u'; p.unknowns = { u: { range: [.5, 2] } }; p.conditions = [{ at: { event: 'time', t: .2 }, eq: 'x(球)-1.2' }]; const r = solveProblem(p); near(r.vars.u, 1, 1e-5); assert.equal(r.asks[0].ok, true); assert.match(r.asks[4].error!, /单侧支撑/);
});
test('未知数只能由中止后条件确定时，明确失败，不用试算中点冒充解', () => {
  const p = P(); p.scene.bodies[1].v = 'u'; p.unknowns = { u: { range: [.5, 2] } }; p.conditions = [{ at: { event: 'time', t: .8 }, eq: 'x(球)-1.8' }]; assert.throws(() => solveProblem(p), /单侧支撑失效/);
});
test('locked 完全固定由外界装置承担向下约束，普通支撑 N 保持非负', () => {
  const sc = scene(); sc.bodies[0].locked = true; const r = simulate(sc, { g: 10 }, { sample: .01 }); near(r.end.t, 1); assert.equal(r.failure, undefined); assert.ok(r.stages.every((s) => s.modes.filter((m) => m.upper === '宿主').every((m) => m.N >= 0)));
  const fs = r.end.bodies.宿主.fs!; near(fs.reduce((n, f) => n + f.y, 0), 0); assert.ok(fs.some((f) => f.n === '固定装置约束力' && f.y < 0));
});
test('解题步骤依赖后续过程时标为不可用，保留前面小问的答案', () => {
  const p = P(); p.solution = { 早: [{ say: '前段', check: { at: { event: 'time', t: .2 }, expr: 'x(球)', value: 1.2 } }, { say: '后段', check: { at: { event: 'time', t: .8 }, expr: 'x(球)', value: 1.8 } }] }; const r = solveProblem(p); assert.equal(r.asks[0].ok, true); assert.equal(r.asks[0].steps![0].verdict, 'ok'); assert.equal(r.asks[0].steps![1].source, 'unavailable'); assert.match(r.asks[0].steps![1].reason!, /模拟已中止/);
});
test('无可动轨道也采用单侧地面：变力拉离地面时保留此前结果', () => {
  const p: Problem = { spec: 'v1', constants: { g: 10 }, scene: { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 1, on: '地', x: 0 }], forces: [{ on: 'A', F: [0, '20*t'] }], tMax: 1 }, asks: [{ id: '1', text: '之前', at: { event: 'time', t: .2 }, expr: 'y(A)', answer: 0 }, { id: '2', text: '之后', at: { event: 'time', t: .8 }, expr: 'y(A)' }] };
  const r = solveProblem(p); near(r.sim!.failure!.t, .5); assert.equal(r.asks[0].ok, true); assert.match(r.asks[1].error!, /单侧支撑/);
});
test('普通直线上的 locked 由固定装置承受向下拉力，地面力不为负', () => {
  const sc: SceneSpec = { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 1, on: '地', x: 0, locked: true }], forces: [{ on: 'A', F: [2, 20] }], tMax: .1 };
  const r = simulate(sc, { g: 10 }, { sample: .01 }); assert.ok(r.stages.every((s) => s.modes.every((m) => m.N >= 0))); const fs = r.end.bodies.A.fs!; near(fs.reduce((n, f) => n + f.y, 0), 0); near(fs.reduce((n, f) => n + f.x, 0), 0);
});
test('运行中绳松弛：RK 试算失败时回退到已完成状态，保留此前求值', () => {
  const p: Problem = { spec: 'v1', constants: { g: 10 }, scene: { surfaces: [{ id: '线', from: [-20, 0], to: [20, 0] }], bodies: [{ id: 'A', m: 1, on: '线', at: 19 }, { id: 'B', m: 1, on: '线', at: 21 }], ropes: [{ between: ['A', 'B'] }], forces: [{ on: 'A', F: ['2*t-1', 0] }], tMax: 1 }, asks: [{ id: '1', text: '早段', at: { event: 'time', t: .2 }, expr: 'vx(A)', answer: -.08 }, { id: '2', text: '晚段', at: { event: 'time', t: .8 }, expr: 'vx(A)' }] };
  const r = solveProblem(p); assert.equal(r.sim!.failure!.code, 'constraint_loss'); assert.ok(r.sim!.end.t <= .5); assert.equal(r.asks[0].ok, true); assert.match(r.asks[1].error!, /松绳/);
});
test('运行期遇到未支持的可动轨道冲量：保留碰前已完成时刻', () => {
  const p: Problem = { spec: 'v1', constants: { g: 10 }, scene: { plane: 'horizontal', surfaces: [{ id: '地', kind: 'ground', y: 0 }, { id: '槽', on: '宿主', from: [0, 2], to: [20, 2] }], bodies: [{ id: '宿主', kind: 'board', m: 2, length: 20, on: '地', x: 0 }, { id: 'A', m: 1, on: '槽', at: 0, v: 2 }, { id: 'B', m: 1, pos: [1, 2] }], collisions: [{ bodies: ['A', 'B'], e: 1 }], tMax: 1 }, asks: [{ id: '1', text: '碰前', at: { event: 'time', t: .2 }, expr: 'x(A)', answer: .4 }, { id: '2', text: '碰后', at: { event: 'collided', bodies: ['A', 'B'] }, expr: 'vx(A)' }] };
  const r = solveProblem(p); assert.equal(r.sim!.failure!.code, 'unsupported_impact'); near(r.sim!.end.t, .5); assert.equal(r.asks[0].ok, true); assert.match(r.asks[1].error!, /冲量耦合/); assert.equal(r.sim!.events.some((e) => e.type === 'collided'), false);
});
console.log(`\n中止前结果测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
