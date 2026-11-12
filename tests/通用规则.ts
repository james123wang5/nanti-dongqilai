// 第三阶段：第一轮审查查出的通用计算问题，每条一个最小场景。只用本文件构造的场景。
import assert from 'node:assert/strict';
import { solveProblem, type Problem, type Ask } from '../engine/solve.ts';
import { simulate, type SceneSpec } from '../engine/sim.ts';
import { sameAnswer } from '../engine/num.ts';
import { validate } from '../engine/validate.ts';
import { ode } from '../engine/labs/ode.ts';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message.split('\n')[0]}`); }
}
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const problem = (scene: SceneSpec, asks: Ask[], extra: Partial<Problem> = {}): Problem => ({ spec: 'v1', constants: { g: 10 }, scene, asks, ...extra });
const value = (p: Problem, i = 0) => { const s = solveProblem(p); const a = s.asks[i]; if (a.error) throw new Error(a.error); return { a, s }; };
const flat = (extra: Partial<SceneSpec> = {}): SceneSpec => ({ surfaces: [{ id: '地面', kind: 'ground', y: 0 }], bodies: [{ id: 'A', kind: 'block', m: 1, on: '地面', x: 0, v: 0 }], tMax: 2, ...extra } as SceneSpec);

// ① 答案比较
test('答案比较：很小的非零答案按相对误差比，不因“都很小”判一致', () => {
  assert.equal(sameAnswer(1e-19, 0), false); assert.equal(sameAnswer(1e-9, 1e-7), false); assert.equal(sameAnswer(1.6e-19, 1.6001e-19), true);
  assert.equal(sameAnswer(0, 3e-10), true); assert.equal(sameAnswer(2, 2.001), true); assert.equal(sameAnswer(2, 2.01), false);
});
test('答案比较：静止物体动能 0 对照 1e-19 J 判为不一致', () => {
  const { a } = value(problem(flat({ tMax: 0.5 }), [{ id: '1', text: '动能', expr: 'KE(A)', answer: 1e-19 }]));
  assert.equal(a.ok, false);
});

// ② 撤力事件
test('撤力 until 写 when：t=1 s 撤去，末速度 2 m/s', () => {
  const { a } = value(problem(flat({ forces: [{ on: 'A', F: [2, 0], until: { event: 'when', expr: 't-1' } }] }), [{ id: '1', text: '末速度', expr: 'v(A)', answer: 2 }]));
  near(a.value, 2, 1e-6); assert.equal(a.ok, true);
});
test('施力 after 写 when：x 到 1 m 时开始推', () => {
  const sc = flat({ bodies: [{ id: 'A', kind: 'block', m: 1, on: '地面', x: 0, v: 1 }], forces: [{ on: 'A', F: [1, 0], after: { event: 'when', expr: 'x(A)-1', dir: 1 } }], tMax: 3 } as Partial<SceneSpec>);
  const { a } = value(problem(sc, [{ id: '1', text: '末速度', expr: 'v(A)', answer: 3 }]));
  near(a.value, 3, 1e-6);   // 1 s 匀速到 x=1，再加速 2 s：v = 1 + 2
});
test('停止 until 写 when：速度到 3 m/s 就停止模拟', () => {
  const sc = flat({ forces: [{ on: 'A', F: [2, 0] }], until: { event: 'when', expr: 'v(A)-3' }, tMax: 10 } as Partial<SceneSpec>);
  const { a } = value(problem(sc, [{ id: '1', text: '停止时刻', expr: 't', answer: 1.5 }]));
  near(a.value, 1.5, 1e-6);
});
test('撤力 until 写第 2 次撞墙：第 1 次撞墙时力还在', () => {
  // 光滑段两端弹性挡板，力一直向右：撞右墙反弹后被力推回再撞，第二次撞墙才撤
  const sc: SceneSpec = { surfaces: [{ id: 'S', from: [0, 0], to: [1, 0], walls: { start: 1, end: 1 } }], bodies: [{ id: 'A', kind: 'block', m: 1, on: 'S', at: 0.5, v: 0 }], forces: [{ on: 'A', F: [2, 0], until: { event: 'hit', body: 'A', n: 2 } }], tMax: 3 } as SceneSpec;
  const r = simulate(sc, { g: 10 });
  const hits = r.events.filter((e) => e.type === 'hit'), off = r.events.find((e) => e.type === 'force_off');
  assert.ok(hits.length >= 2 && off, '应至少撞两次并撤力'); near(off!.t, hits[1].t, 1e-9);
});

// ③ 挡板
test('e=0 挡板：撞上后速度为零，损失动能记入 Q', () => {
  const sc: SceneSpec = { surfaces: [{ id: 'S', from: [0, 0], to: [1, 0], walls: { end: 0 } }], bodies: [{ id: 'A', kind: 'block', m: 1, on: 'S', at: 0, v: 2 }], tMax: 2 } as SceneSpec;
  const { a, s } = value(problem(sc, [{ id: '1', text: '末速度', expr: 'v(A)', answer: 0 }, { id: '2', text: '耗能', expr: 'Q(A,S)', answer: 2 }]));
  near(a.value, 0, 1e-12); near(s.asks[1].value, 2, 1e-9);
});
test('0<e<1 挡板：损失 ½mv²(1−e²) 记入 Q', () => {
  const sc: SceneSpec = { surfaces: [{ id: 'S', from: [0, 0], to: [1, 0], walls: { end: 0.5 } }], bodies: [{ id: 'A', kind: 'block', m: 2, on: 'S', at: 0, v: 2 }], tMax: 0.8 } as SceneSpec;
  const { a } = value(problem(sc, [{ id: '1', text: '耗能', expr: 'Q(A,S)', answer: 3 }]));
  near(a.value, 3, 1e-9);
});

// ④ 反解
test('反解：条件整体乘 1e-8 不产生假的多解', () => {
  const sc = flat({ bodies: [{ id: 'A', kind: 'block', m: 1, on: '地面', x: 0, v: 'u' }], tMax: 1 } as Partial<SceneSpec>);
  for (const k of ['1', '1e-8', '1e8']) {
    const p = problem(sc, [{ id: '1', text: '初速度', expr: 'v(A)', answer: 2 }], { params: {}, unknowns: { u: { range: [0.5, 5] } }, conditions: [{ at: { event: 'end' }, eq: `${k}*(x(A)-2)` }] });
    const { a } = value(p); near(a.value, 2, 1e-5);
  }
});

// ⑦ 事件检测
test('薄场区：一步可能跨过的窄电场也能检测到、算到受力', () => {
  const sc = { plane: 'horizontal', surfaces: [], bodies: [{ id: 'P', kind: 'ball', m: 1, q: 1, pos: [0, 0], vel: [1, 0] }], em: [{ kind: 'E', E: [0, 1], region: { x: [0.00002, 0.00003], y: [-1, 1] } }], tMax: 1e-4 } as unknown as SceneSpec;
  const r = simulate(sc, { g: 10 });
  assert.ok(r.events.some((e) => e.type === 'enter') && r.events.some((e) => e.type === 'leave'), '应记录进出场区');
  near(r.end.bodies.P.vy, 1e-5, 1e-3);
});
test('when：一格内穿过 0 两次（短暂满足）也找得到', () => {
  const sc = flat({ bodies: [{ id: 'A', kind: 'block', m: 1, on: '地面', x: 0, v: 1 }], tMax: 1 } as Partial<SceneSpec>);
  const p = problem(sc, [{ id: '1', text: '第一次', at: { event: 'when', expr: '(t-0.1001)*(t-0.1002)' }, expr: 't', answer: 0.1001 }, { id: '2', text: '第二次', at: { event: 'when', expr: '(t-0.1001)*(t-0.1002)', n: 2 }, expr: 't', answer: 0.1002 }]);
  const s = solveProblem(p); near(s.asks[0].value, 0.1001, 1e-6); near(s.asks[1].value, 0.1002, 1e-6);
});

// ⑥ 运动方程（ode）
test('ode：事件切步后走满总时长，突变前的读数不被插值污染', () => {
  const o = ode({ state: { x: 0, v: 1 }, rates: { x: 'v', v: 0 }, events: [{ when: 'x-0.50025', dir: 1, set: { v: -1 }, once: true }], duration: 1, steps: 2000, draw: [], view: [0, 0, 1, 1] }, {});
  near(o.T, 1, 1e-9);
  near(o.frame(0.500125).vals.v, 1, 1e-9);   // 事件前
  near(o.frame(0.6).vals.v, -1, 1e-9);       // 事件后
  near(o.frame(1).vals.x, 0.50025 - (1 - 0.50025), 1e-6);
});

// ⑤ 校验器
test('校验器：asks 不是数组、重复 id 给出可读错误而不是崩溃', () => {
  const bad = problem(flat(), {} as unknown as Ask[]); assert.ok(validate(bad).length > 0);
  const dup = problem(flat({ bodies: [{ id: 'A', kind: 'block', m: 1, on: '地面', x: 0 }, { id: 'A', kind: 'block', m: 1, on: '地面', x: 1 }] } as Partial<SceneSpec>), [{ id: '1', text: 'x', expr: 'x(A)' }]);
  assert.ok(validate(dup).some((e) => /重复|重名/.test(e)), JSON.stringify(validate(dup)));
});

console.log(`\n通用规则测试：${passed}/${passed + failed} 通过`);
if (failed) process.exit(1);
