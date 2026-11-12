// 自编题与解析解。只使用本文件构造的场景，不读取盲测题。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { solveProblem, type Problem, type Ask } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
import { bodyPose, fitFrame, pointLayout } from '../player/geometry.ts';
import { simulate, type SceneSpec, type Snapshot } from '../engine/sim.ts';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}
const near = (actual: number, expected: number, tol = 1e-7) => assert.ok(Math.abs(actual - expected) < tol, `${actual} ≠ ${expected}`);
const solve = (scene: SceneSpec, asks: Ask[]) => {
  const p: Problem = { spec: 'v1', constants: { g: 10 }, scene, asks };
  const s = solveProblem(p);
  assert.equal(s.label, '已核验', JSON.stringify(s.asks.map((a) => ({ id: a.id, v: a.value, error: a.error }))));
  return s;
};
const symbolic = JSON.parse(readFileSync(new URL('./cases/字母自由落体.json', import.meta.url), 'utf8')) as Problem;
test('A 两组字母答案及步骤均通过，第二组重新模拟', () => {
  const s = solveProblem(symbolic, 1 / 60);
  assert.equal(s.label, '已核验'); assert.equal(s.samples!.length, 2);
  near(s.samples![0].asks[0].value, Math.sqrt(40)); near(s.samples![1].asks[0].value, Math.sqrt(90));
  assert.notEqual(s.samples![0].sim.end.t, s.samples![1].sim.end.t);
  assert.equal(s.samples![1].asks[0].steps![0].verdict, 'ok');
});
test('A 第一组碰巧正确的错公式，第二组必须拦住（答案及过程）', () => {
  const p = structuredClone(symbolic); p.asks[0].answer = 'sqrt(4*g)'; p.solution!['1'][0].check!.value = '2*m*g';
  const s = solveProblem(p);
  assert.equal(s.samples![0].label, '已核验'); assert.equal(s.samples![1].label, '有问题');
  assert.equal(s.asks[0].ok, false); assert.equal(s.asks[0].steps![0].verdict, 'bad'); assert.equal(s.label, '有问题');
});
test('A 缺数值、取 1、同组、第二组缺参数及非法值均明确拒绝', () => {
  for (const mutate of [
    (p: Problem) => { p.params!.H = ['H', 'm', '数值任取']; },
    (p: Problem) => { p.params!.H = [1, 'm', '数值任取']; },
    (p: Problem) => { p.samples = [{ H: 2, m: 3 }]; },
    (p: Problem) => { p.samples = [{ H: 4 }]; },
    (p: Problem) => { p.samples = [{ H: 1, m: 4 }]; },
    (p: Problem) => { delete p.samples; },
  ]) { const p = structuredClone(symbolic); mutate(p); assert.ok(validate(p).length, JSON.stringify(p)); }
});
test('A 非有限字母公式不得判对', () => {
  const p = structuredClone(symbolic); p.asks[0].answer = '1/0';
  const s = solveProblem(p); assert.equal(s.label, '有问题'); assert.match(s.asks[0].error!, /有限数值/);
  p.asks[0].answer = symbolic.asks[0].answer; p.solution!['1'][0].check!.value = '1/0';
  const r = solveProblem(p); assert.equal(r.asks[0].steps![0].verdict, 'bad'); assert.match(r.asks[0].steps![0].error!, /有限数值/);
});

const cross: SceneSpec = {
  plane: 'horizontal', tMax: 3, surfaces: [{ id: '甲', from: [-5, 0], to: [5, 0] }, { id: '乙', from: [5, 0], to: [-5, 0] }],
  bodies: [{ id: 'A', m: 2, on: '甲', at: 3, v: 2 }, { id: 'B', m: 3, on: '乙', at: 5 }], collisions: [{ bodies: ['A', 'B'], e: 1 }],
};
test('C 不同且反向的共线轨道：动量、恢复系数、能量与碰后轨道', () => {
  const s = solve(cross, [
    { id: '1', text: 'A 碰后速度', at: { event: 'collided' }, expr: 'vx(A)', answer: -0.4 },
    { id: '2', text: 'B 碰后速度', at: { event: 'collided' }, expr: 'vx(B)', answer: 1.6 },
    { id: '3', text: '总动能', at: { event: 'collided' }, expr: 'KE(A)+KE(B)', answer: 4 },
  ]);
  assert.equal(s.asks[0].sim!.end.bodies.A.on, '甲'); assert.equal(s.asks[0].sim!.end.bodies.B.on, '乙');
});
test('C 相交轨道按切线约束传递法向冲量', () => {
  const scene = structuredClone(cross);
  scene.surfaces[1] = { id: '乙', from: [0, -5], to: [0, 5] };
  scene.bodies[1].at = 4; scene.bodies[1].v = 1; scene.collisions![0].e = 0.5;
  // n=(2,-1)/√5。有效逆质量为 (4/5)/2+(1/5)/3=7/15。
  // J=(1+e)√5/(7/15)，故 vA'=2-45/14=-17/14，vB'=1-15/14=-1/14。
  solve(scene, [
    { id: '1', text: '水平速度', at: { event: 'collided' }, expr: 'vx(A)', answer: '-17/14' },
    { id: '2', text: '竖直速度', at: { event: 'collided' }, expr: 'vy(B)', answer: '-1/14' },
  ]);
});
test('C 两个抛体迎面相撞，保留共同竖直速度', () => {
  solve({ surfaces: [], tMax: 1.2, bodies: [{ id: 'A', m: 2, pos: [-2, 10], vel: [2, 0] }, { id: 'B', m: 2, pos: [2, 10], vel: [-2, 0] }], collisions: [{ bodies: ['A', 'B'], e: 1 }] }, [
    { id: '1', text: '碰撞时刻', at: { event: 'collide' }, expr: 't', answer: 1 },
    { id: '2', text: 'A 水平速度', at: { event: 'collided' }, expr: 'vx(A)', answer: -2 },
    { id: '3', text: 'A 竖直速度', at: { event: 'collided' }, expr: 'vy(A)', answer: -10 },
  ]);
});
test('C 空中竖直相碰，按质量和恢复系数算碰后竖直速度', () => {
  solve({ surfaces: [], tMax: 0.7, bodies: [{ id: 'A', m: 2, pos: [0, 0], vel: [0, 8] }, { id: 'B', m: 4, pos: [0, 6], vel: [0, -2] }], collisions: [{ bodies: ['A', 'B'], e: 0.5 }] }, [
    { id: '1', text: '相碰时刻', at: { event: 'collide' }, expr: 't', answer: 0.6 },
    { id: '2', text: 'A 碰后', at: { event: 'collided' }, expr: 'vy(A)', answer: -8 },
    { id: '3', text: 'B 碰后', at: { event: 'collided' }, expr: 'vy(B)', answer: -3 },
  ]);
});
test('C 空中有大小的小球斜碰，法线与切向分量', () => {
  solve({ plane: 'horizontal', surfaces: [], tMax: 1, bodies: [{ id: 'A', m: 2, length: 1, pos: [-2, 0], vel: [2, 0] }, { id: 'B', m: 2, length: 1, pos: [0, 0.6], vel: [0, 0] }], collisions: [{ bodies: ['A', 'B'], e: 1 }] }, [
    { id: '1', text: '相碰时刻', at: { event: 'collide' }, expr: 't', answer: 0.6 },
    { id: '2', text: 'A 水平速度', at: { event: 'collided' }, expr: 'vx(A)', answer: 0.72 },
    { id: '3', text: 'A 竖直速度', at: { event: 'collided' }, expr: 'vy(A)', answer: -0.96 },
    { id: '4', text: '总动能', at: { event: 'collided' }, expr: 'KE(A)+KE(B)', answer: 4 },
  ]);
});
test('C 擦肩而过和未列出的配对不得误碰', () => {
  const scene: SceneSpec = { plane: 'horizontal', surfaces: [], tMax: 2, bodies: [{ id: 'A', m: 2, pos: [-2, 0], vel: [2, 0] }, { id: 'B', m: 2, pos: [2, 0.01], vel: [-2, 0] }, { id: 'C', m: 2, pos: [0, 0], vel: [0, 0] }], collisions: [{ bodies: ['A', 'B'], e: 1 }] };
  const s = simulate(scene, { g: 10 }); assert.equal(s.events.filter((e) => e.type === 'collided').length, 0);
});
test('C 初始恰好接触，只在 t=0 碰撞一次', () => {
  const s = solve({ plane: 'horizontal', surfaces: [], tMax: 0.1, bodies: [{ id: 'A', m: 2, pos: [0, 0], vel: [2, 0] }, { id: 'B', m: 2, pos: [0, 0], vel: [-2, 0] }], collisions: [{ bodies: ['A', 'B'], e: 1 }] }, [
    { id: '1', text: '碰撞时刻', at: { event: 'collide' }, expr: 't', answer: 0 },
    { id: '2', text: '交换速度', at: { event: 'collided' }, expr: 'vx(A)', answer: -2 },
    { id: '3', text: '不重复碰撞', expr: 'count()', answer: 1 },
  ]); assert.equal(s.sim.events.filter((e) => e.type === 'collided').length, 1);
});
test('C 空中粘连后外力按总质量分配', () => {
  // A 受 F=2 N，a=1。初间距 4.5 m，1 s 时相遇，碰前速度 3、-2，粘后 0.5。
  const scene: SceneSpec = { plane: 'horizontal', surfaces: [], tMax: 2, bodies: [{ id: 'A', m: 2, pos: [-2, 0], vel: [2, 0] }, { id: 'B', m: 2, pos: [2.5, 0], vel: [-2, 0] }], collisions: [{ bodies: ['A', 'B'], e: 0 }], forces: [{ on: 'A', F: [2, 0] }] };
  solve(scene, [
    { id: '1', text: '粘连瞬间', at: { event: 'collided' }, expr: 'vx(A)', answer: 0.5 },
    { id: '2', text: '之后共同受力', expr: 'vx(A)', answer: 1 },
    { id: '3', text: '保持粘连', expr: 'x(A)-x(B)', answer: 0 },
  ]);
});

test('D1 恒模阻力：正向、反向、静止、相对可动板', () => {
  for (const sign of [-1, 1]) solve({ surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 2, on: '地', x: 0, v: 3 * sign }], resistance: [{ on: 'A', magnitude: 4 }], tMax: 5 }, [
    { id: '1', text: '停止时刻', at: { event: 'stop' }, expr: 't', answer: 1.5 },
    { id: '2', text: '位移', expr: 'dx(A)', answer: sign * 2.25 },
    { id: '3', text: '生热', expr: 'Q()', answer: 9 },
  ]);
  solve({ surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: '板', kind: 'board', length: 20, m: 4, on: '地', x: 0 }, { id: 'A', m: 2, on: '板', at: 2, v: 6 }], resistance: [{ on: 'A', relativeTo: '板', magnitude: 4 }], tMax: 3 }, [
    { id: '1', text: '共速时间', at: { event: 'same_velocity' }, expr: 't', answer: 2 },
    { id: '2', text: '共速速度', at: { event: 'same_velocity' }, expr: 'vx(板)', answer: 2 },
  ]);
});
test('D1 在外力作用下停止再反向，阻力随之反向', () => {
  solve({ plane: 'horizontal', surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 2, on: '地', x: 0, v: 2 }], forces: [{ on: 'A', F: [-4, 0] }], resistance: [{ on: 'A', magnitude: 2 }], tMax: '5/3' }, [
    { id: '1', text: '末速度', expr: 'vx(A)', answer: -1 },
    { id: '2', text: '末位移', expr: 'dx(A)', answer: '1/6' },
    { id: '3', text: '耗能', expr: 'Q()', answer: '7/3' },
  ]);
});
test('D2 瞬时固定能量与比例损失，并累计生热', () => {
  solve({ surfaces: [{ id: '路', from: [0, 0], to: [20, 0], losses: [{ at: 2, energy: 7 }, { at: 4, fraction: 0.5 }] }], bodies: [{ id: 'A', m: 2, on: '路', at: 0, v: 4 }], tMax: 3 }, [
    { id: '1', text: '第一段后', at: { event: 'energy_loss', n: 1 }, expr: 'v(A)', answer: 3 },
    { id: '2', text: '第二段后', at: { event: 'energy_loss', n: 2 }, expr: 'KE(A)', answer: 4.5 },
    { id: '3', text: '总损失', expr: 'Q()', answer: 11.5 },
  ]);
});
test('D2 经过后反弹回来，再经过时仍损失能量', () => {
  solve({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [10, 0], walls: { end: 1 }, losses: [{ at: 2, fraction: 0.5 }] }], bodies: [{ id: 'A', m: 2, on: '路', at: 0, v: 10 }], tMax: 3 }, [
    { id: '1', text: '第二次经过时动能', at: { event: 'energy_loss', n: 2 }, expr: 'KE(A)', answer: 25 },
    { id: '2', text: '累计耗能', at: { event: 'energy_loss', n: 2 }, expr: 'Q()', answer: 75 },
  ]);
});
test('D3 接触弹簧：压缩最大及回到原长分离，之后不牵引', () => {
  const s = solve({ surfaces: [{ id: '路', from: [-5, 0], to: [10, 0] }], bodies: [{ id: '墙', m: 2, on: '路', at: 5, locked: true }, { id: 'A', m: 2, on: '路', at: 6.5, v: -1 }], springs: [{ id: '簧', between: ['墙', 'A'], k: 8, L0: 1, mode: 'contact' }], tMax: 2.5 }, [
    { id: '1', text: '压缩最大弹性势能', at: { event: 'extreme', body: '簧' }, expr: 'Ep(簧)', answer: 1 },
    { id: '2', text: '分离速度', at: { event: 'separate', body: '簧' }, expr: 'vx(A)', answer: 1 },
    { id: '3', text: '之后不再受力', expr: 'Fs(簧)', answer: 0 },
  ]);
  near(s.asks[1].t!, 0.5 + Math.PI / 2); near(s.sim.end.bodies.A.vx, 1);
});
test('D4 F(t)=6t，m=3：积分得到 v=t²、x=t³/3；按时撤力', () => {
  for (const airborne of [false, true]) solve({ plane: 'horizontal', surfaces: airborne ? [] : [{ id: '路', from: [0, 0], to: [30, 0] }], bodies: airborne ? [{ id: 'A', m: 3, pos: [0, 0], vel: [0, 0] }] : [{ id: 'A', m: 3, on: '路', at: 0 }], forces: [{ on: 'A', F: ['6*t', 0], until: { event: 'time', t: 2 } }], tMax: 3 }, [
    { id: '1', text: '撤力时速度', at: { event: 'force_off' }, expr: 'vx(A)', answer: 4 },
    { id: '2', text: '撤力时位置', at: { event: 'force_off' }, expr: 'dx(A)', answer: '8/3' },
    { id: '3', text: '之后匀速', expr: 'vx(A)', answer: 4 },
  ]);
});
test('D4 变力下的瞬时加速度及指定时间取值', () => {
  solve({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [30, 0] }], bodies: [{ id: 'A', m: 3, on: '路', at: 0 }], forces: [{ on: 'A', F: ['6*t', 0] }], tMax: 2 }, [
    { id: '1', text: 't=1 时 a=2', at: { event: 'time', t: 1 }, expr: 'a(A)', answer: 2 },
    { id: '2', text: 't=1.5 时 v=2.25', at: { event: 'time', t: 1.5 }, expr: 'v(A)', answer: 2.25 },
  ]);
});
test('D4 变力达到静摩擦上限后开始滑动', () => {
  // m=2，F=2t，静阻力上限4；t=2 后 a=t-2，t=3 时 v=1/2，x=1/6。
  solve({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [10, 0] }], bodies: [{ id: 'A', m: 2, on: '路', at: 0 }], forces: [{ on: 'A', F: ['2*t', 0] }], resistance: [{ on: 'A', magnitude: 4 }], tMax: 3 }, [
    { id: '1', text: '开始滑动', at: { event: 'slip' }, expr: 't', answer: 2 },
    { id: '2', text: '末速度', expr: 'vx(A)', answer: 0.5 },
    { id: '3', text: '位移', expr: 'dx(A)', answer: '1/6' },
    { id: '4', text: '耗能', expr: 'Q()', answer: '2/3' },
  ]);
});
test('D4 各问独立反解时间；t=0 可立即撤力', () => {
  solve({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [30, 0] }], bodies: [{ id: 'A', m: 3, on: '路', at: 0 }], forces: [{ on: 'A', F: ['6*t', 0] }], tMax: 3 }, [
    { id: '1', text: '第一问指定时刻', at: { event: 'time', t: 1 }, expr: 'v(A)', answer: 1 },
    { id: '2', text: '第二问反解时刻', expr: 'T', answer: 2, unknowns: { T: { range: [1, 3] } }, conditions: [{ at: { event: 'time', t: 'T' }, eq: 'v(A)-4' }] },
  ]);
  solve({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [30, 0] }], bodies: [{ id: 'A', m: 3, on: '路', at: 0 }], forces: [{ on: 'A', F: [6, 0], until: { event: 'time', t: 0 } }], tMax: 1 }, [
    { id: '1', text: '撤力时刻', at: { event: 'force_off' }, expr: 't', answer: 0 },
    { id: '2', text: '未启动', expr: 'v(A)', answer: 0 },
  ]);
});
test('D5 路径阻力 F=2s，m=2：v²=v0²-s²，并核对耗能', () => {
  solve({ surfaces: [{ id: '路', from: [0, 0], to: [8, 0], resistance: '2*s', marks: { P: 2 } }], bodies: [{ id: 'A', m: 2, on: '路', at: 0, v: 3 }], tMax: 1 }, [
    { id: '1', text: '经过 P 的速率', at: { event: 'pass', to: 'P' }, expr: 'v(A)', answer: 'sqrt(5)' },
    { id: '2', text: '到 P 耗能', at: { event: 'pass', to: 'P' }, expr: 'Q()', answer: 4 },
  ]);
});
test('D5 圆弧恒阻力：按弧长做功；速率相关阻力：指数衰减', () => {
  solve({ plane: 'horizontal', surfaces: [{ id: '弯道', kind: 'arc', center: [0, 0], radius: 2, start: 0, end: 90, side: 'tube', resistance: 2 }], bodies: [{ id: 'A', m: 2, on: '弯道', at: 0, v: 4 }], tMax: 1 }, [
    { id: '1', text: '离开弯道的速率', at: { event: 'leave' }, expr: 'v(A)', answer: 'sqrt(16-2*pi)' },
    { id: '2', text: '耗能', at: { event: 'leave' }, expr: 'Q()', answer: '2*pi' },
  ]);
  solve({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [10, 0], resistance: 'v' }], bodies: [{ id: 'A', m: 2, on: '路', at: 0, v: 4 }], tMax: 2 }, [
    { id: '1', text: '指数衰减速率', expr: 'v(A)', answer: 4 / Math.E },
    { id: '2', text: '耗能', expr: 'Q()', answer: 16 * (1 - Math.exp(-2)) },
  ]);
});
test('D5 圆弧上被恒阻力制停后保持静止，不产生数值反复折返', () => {
  const s = solve({ plane: 'horizontal', surfaces: [{ id: '环', kind: 'arc', center: [0, 0], radius: 3, start: 0, end: 360, side: 'tube', next: '环', resistance: 4 }], bodies: [{ id: 'A', m: 2, on: '环', at: 0, v: 2 }], tMax: 3 }, [
    { id: '1', text: '制停时间', at: { event: 'stop' }, expr: 't', answer: 1 },
    { id: '2', text: '最后速率', expr: 'v(A)', answer: 0 },
    { id: '3', text: '路程', expr: 'path(A,环)', answer: 1 },
    { id: '4', text: '耗能', expr: 'Q()', answer: 4 },
  ]);
  assert.equal(s.sim.events.filter((e) => e.type === 'stop').length, 1);
});
test('D6 碰撞计数：碰前、碰后、物体与配对', () => {
  solve(cross, [
    { id: '1', text: '碰前', at: { event: 'collide' }, expr: 'count()', answer: 0 },
    { id: '2', text: '碰后', at: { event: 'collided' }, expr: 'count()', answer: 1 },
    { id: '3', text: '按物体', expr: 'count(B)', answer: 1 },
    { id: '4', text: '按配对', expr: 'count(B,A)', answer: 1 },
  ]);
});
test('明确拒绝转动惯量及绳轮耦合', () => {
  const p = structuredClone(symbolic); Object.assign(p.scene, { pulleys: [], inertia: 2 });
  assert.ok(validate(p).filter((e) => e.includes('不支持转动惯量和绳轮耦合')).length >= 2);
  const normal = structuredClone(symbolic); normal.scene.surfaces[0].marks = { I: 2 }; assert.deepEqual(validate(normal), []);
});
test('明确报出能力边界，不截断能量或伪装粘连', () => {
  const p: Problem = { spec: 'v1', scene: { ...cross, surfaces: [cross.surfaces[0], { id: '乙', from: [0, -5], to: [0, 5] }], bodies: [cross.bodies[0], { ...cross.bodies[1], at: 4, v: 1 }], collisions: [{ bodies: ['A', 'B'], e: 0 }] }, asks: [{ id: '1', text: '碰后', expr: 'v(A)', answer: 0 }] };
  assert.throws(() => solveProblem(p), /不能粘连/);
  p.scene = { plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [10, 0], losses: [{ at: 1, energy: 100 }] }], bodies: [{ id: 'A', m: 2, on: '路', at: 0, v: 2 }], tMax: 1 };
  assert.throws(() => solveProblem(p), /动能不足/);
  p.scene = { surfaces: [], bodies: [{ id: 'A', m: 2, pos: [0, 0], vel: [1, 0] }], resistance: [{ on: 'A', magnitude: 2 }] };
  assert.ok(validate(p).some((e) => e.includes('不支持空中恒模阻力')));
});

test('B 质点对称错开、贴边、端点收回及连续性，快照不变', () => {
  const scene: SceneSpec = { plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [10, 0], walls: { start: 1, end: 1 } }], bodies: [{ id: 'A', m: 2, on: '路', at: 4, v: 1 }, { id: 'B', m: 2, on: '路', at: 6, v: -1 }], collisions: [{ bodies: ['A', 'B'], e: 1 }], tMax: 1.1 };
  const r = simulate(scene, { g: 10 }, { sample: 1 / 60 }), f = fitFrame(r, 0, 1.1), original = JSON.stringify(r);
  const at = (a: number, b: number): Snapshot => ({ ...r.start, bodies: { A: { ...r.start.bodies.A, x: a }, B: { ...r.start.bodies.B, x: b } } });
  const s = at(5, 5), offsets = pointLayout(r, f, s);
  near(offsets.A, -f.body / 2); near(offsets.B, f.body / 2);
  near(bodyPose(r, f, 'B', s).c[0] - bodyPose(r, f, 'A', s).c[0], f.body);
  near(bodyPose(r, f, 'A', at(0, 6)).c[0], f.body / 2);
  near(bodyPose(r, f, 'B', at(4, 10)).c[0], 10 - f.body / 2);
  for (const boundary of [0, f.body / 2, 5]) {
    const x = bodyPose(r, f, 'A', at(boundary - 1e-8, 5)).c[0];
    const y = bodyPose(r, f, 'A', at(boundary + 1e-8, 5)).c[0]; assert.ok(Math.abs(x - y) < 1e-6);
  }
  assert.equal(JSON.stringify(r), original);
});
test('B 板端、三个重合点及真实大小物体', () => {
  const scene: SceneSpec = { plane: 'horizontal', surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: '板', kind: 'board', m: 10, length: 4, on: '地', x: 0 }, ...['A', 'B', 'C'].map((id) => ({ id, m: 2, on: '板', at: 2 })), { id: '实', m: 2, length: 0.3, on: '板', at: 3 }], tMax: 1 };
  const r = simulate(scene, { g: 10 }), f = fitFrame(r, 0, 1);
  const x = ['A', 'B', 'C'].map((id) => bodyPose(r, f, id, r.start).c[0]); near(x[1] - x[0], f.body); near(x[2] - x[1], f.body);
  near(bodyPose(r, f, '实', r.start).c[0], 3); near(bodyPose(r, f, '实', r.start).size, 0.3);
  const end = structuredClone(r.start); end.bodies.A.x = 0; end.bodies.B.x = 2; end.bodies.C.x = 4;
  assert.ok(bodyPose(r, f, 'A', end).c[0] >= f.body / 2); assert.ok(bodyPose(r, f, 'C', end).c[0] <= 4 - f.body / 2);
});
test('B 滑出板端时显示位置连续', () => {
  const r = simulate({ plane: 'horizontal', surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: '板', kind: 'board', m: 4, length: 2, on: '地', x: 0 }, { id: 'A', m: 2, on: '板', at: 1, v: 1 }], tMax: 2 }, { g: 10 }, { sample: 1 / 60 });
  const f = fitFrame(r, 0, 2), event = r.events.find((e) => e.type === 'leave')!, before = event.snap, after = structuredClone(before);
  after.t += 1e-8; after.bodies.A.x += 1e-8; after.bodies.A.on = '地';
  const a = bodyPose(r, f, 'A', before), b = bodyPose(r, f, 'A', after);
  near(a.c[0], b.c[0], 1e-6); near(a.c[1], b.c[1], 1e-6);
});
test('B 质点接近真实大小物体，只移动示意图标', () => {
  const r = simulate({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [10, 0] }], bodies: [{ id: 'A', m: 2, on: '路', at: 4 }, { id: 'B', m: 2, length: 1, on: '路', at: 5 }], tMax: 1 }, { g: 10 });
  const f = fitFrame(r, 0, 1), s = structuredClone(r.start); s.bodies.A.x = 4.5;
  near(bodyPose(r, f, 'A', s).c[0] + f.body / 2, 4.5); near(bodyPose(r, f, 'B', s).c[0], 5);
});
test('B 两条反向共线轨道上的质点仍对称贴边', () => {
  const r = simulate(cross, { g: 10 }, { sample: 1 / 60 }), f = fitFrame(r, 0, 3);
  const s = r.events.find((e) => e.type === 'collide')!.snap;
  const a = bodyPose(r, f, 'A', s), b = bodyPose(r, f, 'B', s);
  near(b.c[0] - a.c[0], f.body); near(a.c[1], b.c[1]);
});
console.log(`\n新能力测试：${passed}/${passed} 通过`);
