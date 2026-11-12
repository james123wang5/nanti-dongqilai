// 第二轮自编题。测试不读取盲测回复，也不以盲测题名选择逻辑。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import katex from 'katex';
import { simulate, findEvent, type SceneSpec, type Snapshot } from '../engine/sim.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
import { expressionToTex, evaluate } from '../engine/expr.ts';
import { expressionSource, verificationCounts } from '../engine/source.ts';
import { sampleAt, chartSnapshots } from '../player/timeline.ts';
import { bodyPose, fitFrame, pointLayout } from '../player/geometry.ts';
let passed = 0;
const near = (a: number, b: number, tol = 1e-7) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
function test(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const problem = (scene: SceneSpec): Problem => ({ spec: 'v1', constants: { g: 10 }, scene, asks: [{ id: '1', text: '末速度', expr: 'v(A)', answer: 0 }] });
const flat = (): SceneSpec => ({ plane: 'horizontal', surfaces: [{ id: '路', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 2, on: '路', x: 0, v: 4 }], tMax: 2 });
test('1 地面的损失位置、初位置、标记与阻力 s 都使用世界 x', () => {
  for (const direction of [-1, 1]) {
    const sc = flat(); sc.bodies[0].x = direction > 0 ? 0 : 4; sc.bodies[0].v = 4 * direction;
    sc.surfaces[0].losses = [{ at: 2, energy: 3 }]; sc.surfaces[0].marks = { P: 2 };
    const r = simulate(sc, { g: 10 }), e = findEvent(r, { event: 'energy_loss' })!;
    near(e.snap.bodies.A.x, 2); near(Math.hypot(e.snap.bodies.A.vx, e.snap.bodies.A.vy), Math.sqrt(13)); near(e.snap.heat['A|路'], 3);
    near(findEvent(r, { event: 'pass', to: 'P' })!.snap.bodies.A.x, 2);
  }
  const sc = flat(); delete sc.bodies[0].x; sc.bodies[0].at = 3; sc.surfaces[0].resistance = '2*s'; sc.tMax = 0.1;
  const r = simulate(sc, { g: 10 }); near(r.start.bodies.A.x, 3); near(r.stages[0].acc.A, -3);
});
test('1 拒绝写了却无效的部件字段', () => {
  for (const mutate of [
    (p: Problem) => { p.scene.surfaces[0].walls = { end: 1 }; },
    (p: Problem) => { p.conditions = [{ just: { event: 'stop', body: 'A' } }, { eq: '2-3' }]; },
    (p: Problem) => { Object.assign(p.scene.surfaces[0], { drag: 3 }); },
    (p: Problem) => { p.scene.bodies[0].vel = [4, 0]; },
    (p: Problem) => { p.scene.surfaces[0] = { id: '路', kind: 'arc', center: [0, 0], radius: 2, start: 0, end: 90, speed: 1 }; },
    (p: Problem) => { p.scene.bodies[0] = { id: 'A', m: 2, pos: [0, 3], vel: [1, 0] }; p.scene.forces = [{ on: 'A', along: 2 }]; },
  ]) { const p = problem(flat()); mutate(p); assert.ok(validate(p).length); }
});
function ring(closed: boolean, clockwise = false, e = 1) {
  const sc: SceneSpec = { plane: 'horizontal', surfaces: [{ id: '环', kind: 'arc', center: [1, 2], radius: 3, start: 0, end: closed ? 360 : clockwise ? -180 : 180, turn: clockwise ? 'cw' : 'ccw', side: 'tube', next: closed ? '环' : undefined }], bodies: [{ id: 'A', kind: 'ball', m: 3, on: '环', at: closed ? 6 * Math.PI - 0.3 : 2, v: 2 }, { id: 'B', kind: 'ball', m: 3, on: '环', at: closed ? 0 : 3 }], collisions: [{ bodies: ['A','B'], e }], tMax: 1 };
  return simulate(sc, { g: 10 }, { sample: 1 / 60 });
}
test('2 开放圆弧、闭环接缝、顺逆时针：球形图标恰好接触', () => {
  for (const closed of [false, true]) for (const cw of [false, true]) {
    const r = ring(closed, cw), f = fitFrame(r, 0, 1), e = r.events.find((e) => e.type === 'collide')!;
    assert.ok(e); const original = JSON.stringify(e.snap);
    const a = bodyPose(r, f, 'A', e.snap), b = bodyPose(r, f, 'B', e.snap);
    near(Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]), a.size);
    assert.ok(pointLayout(r, f, e.snap).A !== undefined); assert.equal(JSON.stringify(e.snap), original);
  }
});
test('2 闭环接缝两侧及碰撞时显示连续，真实大小物体不偏移', () => {
  const r = ring(true), f = fitFrame(r, 0, 1), t = r.events.find((e) => e.type === 'collide')!.t;
  for (const id of ['A','B']) {
    const before = bodyPose(r, f, id, sampleAt(r, t - 1e-8)), after = bodyPose(r, f, id, sampleAt(r, t + 1e-8));
    near(before.c[0], after.c[0], 1e-6); near(before.c[1], after.c[1], 1e-6);
  }
  const physical = structuredClone(r); physical.geo.bodies[0].L = 0.4;
  near(bodyPose(physical, f, 'A', physical.start).size, 0.4);
});
test('2、4 闭环粘连后，两图标贴边，两个速度标签取同一个碰后值', () => {
  const r = ring(true, false, 0), f = fitFrame(r, 0, 1), t = findEvent(r, { event: 'collided' })!.t;
  const s = sampleAt(r, t), a = bodyPose(r, f, 'A', s), b = bodyPose(r, f, 'B', s);
  near(Math.hypot(s.bodies.A.vx, s.bodies.A.vy), 1); near(Math.hypot(s.bodies.B.vx, s.bodies.B.vy), 1);
  near(Math.hypot(a.c[0]-b.c[0], a.c[1]-b.c[1]), a.size);
});
test('3 表达式语法树通用转换分式、根号、下标及括号，可由 KaTeX 排版', () => {
  for (const text of ['mA*v0/(mA+mB)', 'sqrt(2*g*R)', '-v_0^2/(2*mu2*g)', '(a+b)^(c-d)', '1e-3*sqrt(x^2+y^2)']) {
    const tex = expressionToTex(text), html = katex.renderToString(tex, { throwOnError: true }); assert.ok(html.includes('katex'));
  }
  assert.match(expressionToTex('mA*v0/(mA+mB)'), /\\frac/); assert.match(expressionToTex('sqrt(2*g*R)'), /\\sqrt/);
  assert.match(expressionToTex('v0'), /_\{0\}/); near(evaluate('-2^2+3*4', { vars: {} }), 8); near(evaluate('pi', { vars: { pi: 3.14 } }), 3.14);
});
const collision = (): SceneSpec => ({ plane: 'horizontal', surfaces: [{ id: '路', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 3, on: '路', x: 2, v: 6 }, { id: 'B', m: 5, on: '路', x: 5 }], collisions: [{ bodies: ['A','B'], e: 0.5 }], tMax: 1 });
test('4 粗采样跨碰撞时不混合速度、动能和耗能；事件默认碰后', () => {
  const r = simulate(collision(), { g: 10 }, { sample: 0.3 }), t = findEvent(r, { event: 'collided' })!.t;
  near(sampleAt(r, t - 1e-8).bodies.A.vx, 6); near(sampleAt(r, t).bodies.A.vx, 0.375); near(sampleAt(r, t + 1e-8).bodies.A.vx, 0.375);
  near(sampleAt(r, t, 'before').bodies.A.vx, 6); near(sampleAt(r, t - 1e-8).heat['碰撞'] ?? 0, 0);
  assert.ok(sampleAt(r, t).heat['碰撞'] > 0);
  const graph = chartSnapshots(r, 0, 1).filter((s) => s.t === t);
  assert.ok(graph.some((s) => s.bodies.A.vx === 6)); assert.ok(graph.some((s) => Math.abs(s.bodies.A.vx - 0.375) < 1e-7));
});
test('4 挡板和能量损失也保留事件前后值', () => {
  const sc = flat(); sc.surfaces = [{ id: '路', from: [0, 0], to: [3, 0], walls: { end: 1 }, losses: [{ at: 1, fraction: 0.5 }] }];
  const r = simulate(sc, { g: 10 }, { sample: 0.7 }), loss = findEvent(r, { event: 'energy_loss' })!, hit = findEvent(r, { event: 'hit' })!;
  near(sampleAt(r, loss.t, 'before').bodies.A.vx, 4); near(sampleAt(r, loss.t).bodies.A.vx, Math.sqrt(8));
  near(sampleAt(r, hit.t, 'before').bodies.A.vx, Math.sqrt(8)); near(sampleAt(r, hit.t).bodies.A.vx, -Math.sqrt(8));
});
test('5、6 抄答案公式的回复只能是仅代数，步骤同样不算引擎核验', () => {
  const p = problem(flat()); p.params = { v0: 4, mu: 0.2 };
  p.asks = [{ id: '1', text: '抄公式', expr: 'v0/(mu*g)', answer: 'v0/(mu*g)' }];
  p.solution = { '1': [{ say: '公式复述', check: { expr: 'v0/(mu*g)', value: 'v0/(mu*g)' } }] };
  const s = solveProblem(p); assert.equal(s.label, '仅代数，未模拟验证'); assert.equal(s.asks[0].source, 'algebra'); assert.equal(s.asks[0].ok, null);
  assert.equal(s.asks[0].steps![0].verdict, 'algebra'); assert.deepEqual(verificationCounts(s.asks), { ...verificationCounts([]), algebra: 1, steps: { ...verificationCounts([]).steps, algebra: 1 } });
});
test('5 只附带事件或没使用的别名，以及乘零的模拟函数，不能伪装验证', () => {
  const p = problem(flat()); p.params = { u: 4, alias: 'u/g' };
  for (const expr of ['alias', 'u+0*v(A)', 'u+(vx(A)-vx(A))']) assert.equal(expressionSource(p, expr, { event: 'stop', body: 'A' }, { unused: { event: 'stop', body: 'A' } }, { unused2: { at: { event: 'end' }, expr: 'v(A)' } }), 'algebra');
  assert.equal(expressionSource(p, 'arrival', undefined, { arrival: { event: 'pass', to: 'P' } }), 'engine');
  assert.equal(expressionSource(p, 't', { event: 'time', t: 2 }), 'algebra');
  p.asks = [{ id: '1', text: '未使用的别名不应强制取值', expr: 'alias', answer: 0.4, vals: { unused: { at: { event: 'collide' }, expr: 'v(A)' } } }];
  assert.equal(solveProblem(p).asks[0].source, 'algebra');
});
test('5 过程条件反解未知数可以核验，另写公式的派生别名单独分级', () => {
  const p = problem({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [20, 0], marks: { P: 8 } }], bodies: [{ id: 'A', m: 2, on: '路', at: 0, v: 'u' }], tMax: 4 });
  p.params = { twice: '2*u' }; p.unknowns = { u: { range: ['sqrt(4)', 8] } }; p.conditions = [{ at: { event: 'pass', to: 'P' }, eq: 't-2' }];
  p.asks = [{ id: '1', text: '反解速度的两倍', expr: 'twice', answer: 8 }];
  const s = solveProblem(p); assert.equal(s.asks[0].source, 'custom'); assert.equal(s.asks[0].ok, null); assert.equal(s.asks[0].answerMatch, true);
});
test('5 无条件、恒等式和相依条件不能确定未知数', () => {
  for (const equations of [[], ['u-u'], ['u+w-5','2*(u+w-5)']]) {
    const p = problem(flat()); p.unknowns = { u: { range: [2, 6] } }; if (equations.length === 2) p.unknowns.w = { range: [2, 6] };
    p.conditions = equations.map((eq) => ({ eq })); assert.throws(() => solveProblem(p), /条件|残差|决定/);
  }
  const conserved = problem({ surfaces: [], bodies: [{ id: 'A', m: 2, pos: [0, 20], vel: ['u', 0] }], tMax: 0.2 });
  conserved.unknowns = { u: { range: [2, 6] } }; conserved.conditions = [{ eq: 'KE(A)+PE(A)-u^2-400' }];
  assert.throws(() => solveProblem(conserved), /恒等式|条件|决定/);
  const twoRoots = problem({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [20, 0], marks: { P: 6 } }], bodies: [{ id: 'A', m: 2, on: '路', at: 0, v: 'u' }], tMax: 4 });
  twoRoots.unknowns = { u: { range: [2, 8] } }; twoRoots.conditions = [{ at: { event: 'pass', to: 'P' }, eq: '(t-1)*(t-2)' }];
  assert.throws(() => solveProblem(twoRoots), /多个根/);
  twoRoots.conditions[0].eq = '(t-1)^2*(t-2)^2'; assert.throws(() => solveProblem(twoRoots), /多个根/);
  const endpoint = problem({ surfaces: [{ id: '弧', kind: 'arc', center: [0, 1], radius: 1, start: -90, end: 90, side: 'inside', marks: { Q: 90 } }], bodies: [{ id: 'A', m: 2, on: '弧', at: 0, v: 'u' }], tMax: 8 });
  endpoint.unknowns = { u: { range: [2, 10] } };
  endpoint.conditions = [{ at: { event: 'leave', body: 'A', from: '弧' }, eq: 'N(A)-40' }];
  assert.throws(() => solveProblem(endpoint), /多个根/); // 入口折返与到达顶端是不同的分支
  endpoint.conditions[0].at = { event: 'pass', body: 'A', to: 'Q' };
  endpoint.asks = [{ id: '1', text: '顶端 Q 的速度', at: { event: 'pass', body: 'A', to: 'Q' }, expr: 'v(A)', answer: 'sqrt(30)' }];
  assert.equal(solveProblem(endpoint).asks[0].ok, true);
});
test('5 纯代数条件得到的未知数不能算引擎反解', () => {
  const p = problem(flat()); p.unknowns = { u: { range: [2, 6] } }; p.conditions = [{ eq: 'u-4' }]; p.asks = [{ id: '1', text: '代数求根', expr: 'u', answer: 4 }];
  const s = solveProblem(p); assert.equal(s.asks[0].source, 'algebra'); assert.equal(s.label, '仅代数，未模拟验证');
});
test('5 共享范围必须由明确的小问条件求值，不能拿区间中点搭场景', () => {
  const p = problem({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [20, 0], marks: { P: 'D' } }], bodies: [{ id: 'A', m: 2, on: '路', at: 0, v: 'u' }], tMax: 5 });
  p.params = { D: 6 }; p.unknowns = { u: { range: [2, 8] } };
  p.asks = [
    { id: '1', text: '共享条件得到速度后，到原标记的时间', at: { event: 'pass', to: 'P' }, expr: 't', answer: 1.5 },
    { id: '2', text: '换标记后由时间反解速度', with: { D: 8 }, conditions: [{ at: { event: 'pass', to: 'P' }, eq: 't-2' }], expr: 'u', answer: 4 },
  ];
  const s = solveProblem(p); near(s.vars.u, 4); assert.ok(s.asks.every((a) => a.ok === true));
  delete p.asks[1].conditions; assert.throws(() => solveProblem(p), /没有.*条件/);
});
test('1、5 with 可以把原来的未知数指定为已知值，不能被反解覆盖', () => {
  const p = problem({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [20, 0], marks: { P: 8 } }], bodies: [{ id: 'A', m: 2, on: '路', at: 0, v: 'u' }], tMax: 3 });
  p.unknowns = { u: { range: [2, 8] } }; p.conditions = [{ at: { event: 'pass', to: 'P' }, eq: 't-2' }];
  p.asks = [{ id: '1', text: '另给速度为5时', with: { u: 5 }, conditions: [], at: { event: 'pass', to: 'P' }, expr: 't', answer: 1.6 }];
  const s = solveProblem(p); near(s.vars.u, 4); near(s.asks[0].value, 1.6); assert.equal(s.asks[0].ok, true);
});
test('5 混合条件中，纯代数决定的未知数不会借另一未知数冒充引擎来源', () => {
  const p = problem(flat()); p.scene.bodies[0].v = 'u'; p.unknowns = { u: { range: [2, 6] }, w: { range: [2, 6] } };
  p.conditions = [{ eq: 'u-4' }, { eq: 'vx(A)-w' }];
  p.asks = [{ id: '1', text: '代数确定', expr: 'u', answer: 4 }, { id: '2', text: '由模拟速度确定', expr: 'w', answer: 4 }];
  const s = solveProblem(p); assert.equal(s.asks[0].source, 'algebra'); assert.equal(s.asks[1].source, 'custom'); assert.equal(s.asks[1].verified, false);
});
test('6 混合来源、数值不一致和算不出分别统计', () => {
  const p = problem(flat()); p.asks = [
    { id: '1', text: '速度', expr: 'v(A)', answer: 4 }, { id: '2', text: '参数', expr: '2+2', answer: 4 },
    { id: '3', text: '错答案', expr: 'v(A)', answer: 7 }, { id: '4', text: '无此事件', at: { event: 'collide' }, expr: 'v(A)', answer: 0 },
  ];
  const s = solveProblem(p); assert.deepEqual(verificationCounts(s.asks), { ...verificationCounts([]), engine: 1, algebra: 1, mismatch: 1, unavailable: 1 });
});
test('8 unsupported 可以保留空场景与解答，但不产生假模拟和核验', () => {
  const p = problem({ surfaces: [], bodies: [] }); p.unsupported = '需要刚体转动，当前引擎无法建模'; p.solution = { '1': [{ say: '保留推导', tex: 'E=I\\omega^2/2', check: { expr: '2', value: 2 } }] };
  assert.deepEqual(validate(p), []); const s = solveProblem(p); assert.equal(s.sim, undefined); assert.equal(s.label, '超出引擎能力，未经验证'); assert.equal(s.asks[0].steps![0].verdict, 'skip');
  p.scene = flat(); assert.ok(validate(p).some((e) => e.includes('一部分')));
});
test('9 任意两条共线轨道上的物体可以取共速事件，无需相碰或摩擦接触', () => {
  const p = problem({ plane: 'horizontal', surfaces: [{ id: '路', kind: 'ground', y: 0 }, { id: '另一条', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 2, on: '路', x: 0, v: 3 }, { id: 'B', m: 2, on: '另一条', x: 8, v: 1 }], forces: [{ on: 'A', F: [-4, 0] }], tMax: 1.3 });
  p.asks = [{ id: '1', text: '共速时间', at: { event: 'same_velocity', body: 'B', to: 'A', bodies: ['B','A'] }, expr: 't', answer: 1 }];
  const s = solveProblem(p); assert.equal(s.asks[0].ok, true); near(s.asks[0].t!, 1);
});
test('10 斜抛最高点 stop 的竖直速度为零，水平速度保留', () => {
  const p = problem({ surfaces: [], bodies: [{ id: 'A', m: 2, pos: [1, 3], vel: [2, 7] }], until: { event: 'stop', body: 'A' } });
  p.asks = [{ id: '1', text: '最高点高度增量', at: { event: 'stop', body: 'A' }, expr: 'dy(A)', answer: 2.45 }];
  const s = solveProblem(p); near(s.sim!.end.t, 0.7); near(s.sim!.end.bodies.A.vx, 2); near(s.sim!.end.bodies.A.vy, 0); assert.equal(s.asks[0].ok, true);
});
test('11 不同轨道上的点与木板按边缘碰撞，板长不改变左端接触时刻', () => {
  for (const L of [1.5, 7, 15]) {
    const r = simulate({ plane: 'horizontal', surfaces: [{ id: '甲', kind: 'ground', y: 0 }, { id: '乙', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 2, on: '甲', x: 0, v: 2 }, { id: 'B', kind: 'board', m: 4, length: L, on: '乙', x: 5, v: -1 }], collisions: [{ bodies: ['A','B'], e: 1 }], tMax: 2 }, { g: 10 });
    const e = findEvent(r, { event: 'collided' })!; near(e.t, 5 / 3); near(e.snap.bodies.A.vx, -2); near(e.snap.bodies.B.vx, 1);
  }
});
test('12 竖直可动管用 board 与恒模相对阻力，碰后加速度及最高点解析对照', () => {
  const p = problem({ surfaces: [{ id: '竖直', from: [0, 0], to: [0, 100], walls: { start: 1 } }], bodies: [{ id: '管', kind: 'board', m: 6, length: 12, on: '竖直', at: 4 }, { id: '球', m: 2, on: '管', at: 12 }], resistance: [{ on: '球', relativeTo: '管', magnitude: 90 }], tMax: 2 });
  p.asks = [
    { id: '1', text: '管首次弹起后的加速度', at: { event: 'hit', body: '管', n: 1, phase: 'after' }, expr: 'a(管)', answer: -25 },
    { id: '2', text: '球首次弹起后的加速度', at: { event: 'hit', body: '管', n: 1, phase: 'after' }, expr: 'a(球)', answer: 35 },
    { id: '3', text: '管第一次弹起高度', at: { event: 'stop', body: '管', n: 1 }, expr: 'y(管)', answer: '5/3' },
  ];
  const s = solveProblem(p); for (const a of s.asks) assert.equal(a.ok, true, JSON.stringify(a));
});
test('13 近似题给数据仍建模，差异照实显示，不修改容差', () => {
  const p = problem({ plane: 'horizontal', surfaces: [{ id: '路', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 3, on: '路', x: 0, v: 3 }], resistance: [{ on: 'A', magnitude: 6 }], tMax: 3 });
  p.asks = [{ id: '1', text: '题给近似时间 1.49 s', at: { event: 'stop', body: 'A' }, expr: 't', answer: 1.49 }];
  const s = solveProblem(p); assert.ok(s.sim); near(s.asks[0].value, 1.5); assert.equal(s.asks[0].ok, false);
});
test('14 中间过程不确定时，两个确定阶段按小问独立模拟，代数部分如实标出', () => {
  const p = problem({ surfaces: [{ id: '传送带', kind: 'ground', y: 0, speed: 5, mu: 0.2 }], bodies: [{ id: 'A', m: 3, on: '传送带', at: 0 }], tMax: 3 });
  p.asks = [
    { id: '1', text: '前段共速时间', at: { event: 'same_velocity', body: 'A', to: '传送带' }, expr: 't', answer: 2.5 },
    { id: '2', text: '只有能量端点，未模拟未知路径', expr: '3*g', answer: 30 },
    { id: '3', text: '后段平抛位移', scene: { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'F', m: 3, pos: [2, 5], vel: [0, 0] }, { id: 'G', m: 5, pos: [2, 5], vel: [6, 0] }], collisions: [{ bodies: ['F','G'], e: 0.3 }], tMax: 2 }, at: { event: 'land', body: 'F' }, expr: '(x(F)+x(G))/2-2', answer: 3.975 },
  ];
  p.solution = { '3': [{ say: '从碰前初态模拟碰撞，再算平抛', check: { at: { event: 'land', body: 'F' }, expr: 'x(F)', value: '2+39/8' } }] };
  const s = solveProblem(p); assert.equal(s.label, '部分核验'); assert.equal(s.asks[0].ok, true); assert.equal(s.asks[1].source, 'algebra'); assert.equal(s.asks[2].ok, true);
  assert.equal(s.asks[2].steps![0].verdict, 'ok'); assert.ok(s.asks[2].sim!.geo.bodies.some((b) => b.id === 'F'));
});
test('7、13、14 提示词要求模拟量、近似数据照常建模、已知阶段完整建模', () => {
  const prompt = readFileSync(new URL('../prompt/模板.md', import.meta.url), 'utf8');
  for (const word of ['不把答案抄进', '近似', '所有能确定', 'unsupported']) assert.ok(prompt.includes(word), word);
});
console.log(`\n第二轮自编测试：${passed}/${passed} 通过`);
