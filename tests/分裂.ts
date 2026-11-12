// 分裂（爆炸、反冲）：动量守恒、释放能量、碎片后续运动
import assert from 'node:assert/strict';
import { validate } from '../engine/validate.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { simulate } from '../engine/sim.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const solve = (scene: object, asks: object[]) => { const P = { spec: 'v1', params: { g: [10, 'm/s²', ''] }, scene, asks } as unknown as Problem; const e = validate(P); assert.deepEqual(e, []); const r = solveProblem(P); for (const a of r.asks) assert.ok(!a.error, String(a.error)); return r.asks.map((a) => a.value); };
// 炮弹以 v0=20 m/s、仰角 45° 抛出，最高点炸成质量相等的两块，一块沿原路返回（速度 −vx），另一块速度由动量守恒算出（3vx）
const vx = 20 / Math.SQRT2, H = vx * vx / 20, tTop = vx / 10;
const shell = { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: '弹', m: 2, pos: [0, 0], vel: [vx, vx] }, { id: '甲', m: 1, from: '弹', vel: [-vx, 0] }, { id: '乙', m: 1, from: '弹' }], splits: [{ on: '弹', when: { event: 'when', expr: 'vy(弹)', dir: -1 } }], tMax: 10 };
const shellT = { ...shell, splits: [{ on: '弹', when: { event: 'time', t: tTop } }] };   // 直接调 simulate 时用时刻触发（when 需要题目入口提供求值）
test('最高点爆炸：另一块速度 3vx，落地点距抛出点 4 倍的半程', () => {
  const [v, x] = solve(shell, [{ id: '1', text: '乙速度', at: { event: 'split', name: '弹' }, expr: 'vx(乙)' }, { id: '2', text: '乙落地 x', at: { event: 'land', body: '乙' }, expr: 'x(乙)' }]);
  near(v, 3 * vx, 1e-6); near(x, vx * tTop + 3 * vx * tTop, 1e-4);   // 半程 vx·tTop，再飞 3vx·tTop
});
test('爆炸释放的能量 Q(爆炸) = 碎片动能和 − 母体动能，Q() 不把它算成生热', () => {
  const [Q, Qall] = solve(shell, [{ id: '1', text: 'E', at: { event: 'split', name: '弹' }, expr: 'Q(爆炸)' }, { id: '2', text: 'Q', at: { event: 'split', name: '弹' }, expr: 'Q()' }]);
  near(Q, .5 * 1 * vx * vx + .5 * 1 * 9 * vx * vx - .5 * 2 * vx * vx, 1e-6); near(Qall, 0, 1e-9);
});
test('轨道上反冲：人以对地 2 m/s 向后跳离静止的车，车获得 m人·2/m车 的速度', () => {
  const [v] = solve({ plane: 'horizontal', surfaces: [{ id: '路', from: [-20, 0], to: [20, 0] }], bodies: [{ id: '车人', m: 150, on: '路', at: 20, v: 0 }, { id: '人', m: 50, from: '车人', v: -2 }, { id: '车', m: 100, from: '车人' }], splits: [{ on: '车人', when: { event: 'time', t: 1 } }], tMax: 3 },
    [{ id: '1', text: '车速', at: { event: 'end' }, expr: 'v(车)' }]);
  near(v, 1, 1e-9);
});
test('分裂前碎片不出现，分裂后母体不出现', () => {
  const r = simulate(shellT as never, { g: 10 }, { sample: 1 / 30 });
  assert.ok(!r.samples[3].bodies['甲'] && r.samples[3].bodies['弹']); assert.ok(r.end.bodies['甲'] && !r.end.bodies['弹']);
});
test('校验器：质量对不上、两块都不写速度、母体没写 splits', () => {
  const P = (sc: object) => validate({ spec: 'v1', scene: sc, asks: [{ id: '1', text: 'x', expr: 'vx(乙)' }] } as never).join('\n');
  assert.match(P({ ...shell, bodies: [shell.bodies[0], { id: '甲', m: 1, from: '弹' }, { id: '乙', m: 1, from: '弹' }] }), /最多一块不写速度/);
  assert.match(P({ ...shell, splits: [] }), /没有写进 splits/);
  assert.throws(() => simulate({ ...shellT, bodies: [shell.bodies[0], { id: '甲', m: 1, from: '弹', vel: [-vx, 0] }, { id: '乙', m: 2, from: '弹' }] } as never, { g: 10 }), /质量之和/);
});
console.log(`\n分裂测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
