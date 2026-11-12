// 电学、磁学题型的解析对照。只用自编场景。
import assert from 'node:assert/strict';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
let n = 0;
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } };
const solve = (scene: object, asks: [string, any][], extra: object = {}) => {
  const P = { spec: 'v1', constants: { g: 10 }, scene: { surfaces: [], bodies: [], ...scene }, asks: asks.map(([expr, at], i) => ({ id: String(i + 1), text: expr, expr, ...(at ? { at } : {}) })), ...extra } as unknown as Problem;
  assert.deepEqual(validate(P), []);
  return solveProblem(P, 1 / 60).asks;
};
const near = (a: { value: number; error?: string }, b: number, tol = 2e-3) => assert.ok(Math.abs(a.value - b) < tol * Math.max(1, Math.abs(b)), `${a.value} ≠ ${b} ${a.error ?? ''}`);
const T = (t: number) => ({ event: 'time', t });
const P1 = { id: 'p', kind: 'ball', m: 1, q: 1 };

test('匀强磁场：半径 mv/qB，周期 2πm/qB', () => {
  const a = solve({ plane: 'horizontal', em: [{ kind: 'B', B: 2 }], bodies: [{ ...P1, pos: [0, 0], vel: [4, 0] }], tMax: 4 }, [['x(p)', T(Math.PI)], ['y(p)', T(Math.PI / 2)], ['v(p)', T(1)]]);
  near(a[0], 0); near(a[1], -4); near(a[2], 4);
});
test('平行板偏转：类平抛', () => {
  const a = solve({ plane: 'horizontal', em: [{ id: '板间', kind: 'E', E: [0, 2], region: { x: [0, 4], y: [-5, 5] } }], bodies: [{ ...P1, pos: [-1, 0], vel: [2, 0] }], tMax: 4 }, [['y(p)', { event: 'leave', body: 'p', from: '板间' }], ['vy(p)', { event: 'leave', body: 'p', from: '板间' }], ['t', { event: 'enter', body: 'p', to: '板间' }]]);
  near(a[0], 4); near(a[1], 4); near(a[2], .5);
});
test('速度选择器：v = E/B 时直线通过', () => {
  const a = solve({ plane: 'horizontal', em: [{ kind: 'E', E: [0, -6] }, { kind: 'B', B: -2 }], bodies: [{ ...P1, pos: [0, 0], vel: [3, 0] }], tMax: 2 }, [['y(p)', T(1.5)], ['x(p)', T(1.5)]]);
  near(a[0], 0); near(a[1], 4.5);
});
test('有界磁场：从直边界射入，半圆后射出', () => {
  const a = solve({ plane: 'horizontal', em: [{ id: '磁场', kind: 'B', B: 1, region: { x: [0, 20], y: [-20, 20] } }], bodies: [{ ...P1, pos: [-1, 0], vel: [2, 0] }], tMax: 6 }, [['y(p)', { event: 'leave', body: 'p', from: '磁场' }]]);
  near(a[0], -4, 3e-3);
});
test('圆形磁场：沿半径射入必沿半径射出', () => {
  const a = solve({ plane: 'horizontal', em: [{ id: '磁场', kind: 'B', B: 1, region: { center: [0, 0], radius: 2 } }], bodies: [{ ...P1, pos: [-3, 0], vel: [2, 0] }], tMax: 8 }, [['x(p)*vy(p)-y(p)*vx(p)', { event: 'leave', body: 'p', from: '磁场' }]]);
  near(a[0], 0, 5e-3);
});
test('点电荷：库仑力下的圆轨道', () => {
  const a = solve({ plane: 'horizontal', em: [{ kind: 'Q', Q: -1, at: [0, 0] }], bodies: [{ ...P1, pos: [1, 0], vel: [0, 1] }], tMax: 7 }, [['v(p)', T(3)], ['x(p)', T(2 * Math.PI)]], { constants: { g: 10, k: 1 } });
  near(a[0], 1); near(a[1], 1);
});
test('微观尺度：电子在磁场里，时间只有微秒量级', () => {
  const m = 9e-31, q = 1.6e-19, B = 1e-3, v = 1e6, Tc = 2 * Math.PI * m / (q * B);
  const a = solve({ plane: 'horizontal', em: [{ kind: 'B', B }], bodies: [{ id: 'e', kind: 'ball', m, q, pos: [0, 0], vel: [v, 0] }], tMax: Tc }, [['y(e)', T(Tc / 2)]]);
  near(a[0], -2 * m * v / (q * B), 5e-3);
});
test('单棒切割：v = v0·exp(−B²L²t/mR)', () => {
  const a = solve({ plane: 'horizontal', surfaces: [{ id: '轨', from: [0, 0], to: [50, 0], rails: 1 }], bodies: [{ id: '棒', look: 'rod', m: 1, on: '轨', at: 0, v: 4 }], forces: [{ on: '棒', F: ['-4*vx/2', 0] }], tMax: 3 }, [['v(棒)', T(1)]]);
  near(a[0], 4 * Math.exp(-2));
});
test('双棒：最终共速，动量守恒', () => {
  const a = solve({ plane: 'horizontal', surfaces: [{ id: '轨', from: [0, 0], to: [99, 0], rails: 1 }], bodies: [{ id: 'a', look: 'rod', m: 1, on: '轨', at: 0, v: 6 }, { id: 'b', look: 'rod', m: 2, on: '轨', at: 5, v: 0 }], forces: [{ on: 'a', F: ['-3*(v_a-v_b)', 0] }, { on: 'b', F: ['3*(v_a-v_b)', 0] }], tMax: 8 }, [['v(a)', T(7.5)], ['v(b)', T(7.5)]]);
  near(a[0], 2, 5e-3); near(a[1], 2, 5e-3);
});
const loop = { nodes: { n0: [0, 0], n1: [0, 4], n2: [6, 4], n3: [6, 0] } };
test('闭合电路：I = E/(R+r)，路端电压', () => {
  const a = solve({ circuit: { ...loop, elements: [{ id: '电源', kind: 'battery', a: 'n1', b: 'n0', E: 12, r: 1 }, { id: 'K', kind: 'switch', a: 'n1', b: 'n2' }, { id: 'R', kind: 'R', a: 'n2', b: 'n3', R: 5 }, { id: 'A', kind: 'ammeter', a: 'n3', b: 'n0' }] } }, [['I(A)', T(1)], ['U(电源)', T(1)], ['P(R)', T(1)]]);
  near(a[0], 2); near(a[1], 10); near(a[2], 20);
});
test('混联：并联分流，电压表不分流', () => {
  const a = solve({ circuit: { nodes: { g: [0, 0], p: [0, 4], x: [3, 4], y: [3, 0], z: [6, 4], w: [6, 0] }, elements: [{ id: 'E', kind: 'battery', a: 'p', b: 'g', E: 9, r: 0 }, { id: 'R1', kind: 'R', a: 'p', b: 'x', R: 2 }, { id: 'R2', kind: 'R', a: 'x', b: 'y', R: 6 }, { id: 'L', kind: 'wire', a: 'y', b: 'g' }, { id: 'R3', kind: 'R', a: 'x', b: 'z', R: 3 }, { id: 'L2', kind: 'wire', a: 'z', b: 'w' }, { id: 'L3', kind: 'wire', a: 'w', b: 'y' }, { id: 'V', kind: 'voltmeter', a: 'x', b: 'y' }] } }, [['I(R1)', T(1)], ['U(V)', T(1)], ['I(R2)', T(1)]]);
  near(a[0], 2.25); near(a[1], 4.5); near(a[2], .75);
});
test('动态电路：滑动变阻器增大，干路电流减小', () => {
  const a = solve({ circuit: { ...loop, duration: 4, elements: [{ id: 'E', kind: 'battery', a: 'n1', b: 'n0', E: 6, r: 1 }, { id: 'W', kind: 'wire', a: 'n1', b: 'n2' }, { id: 'Rp', kind: 'rheostat', a: 'n2', b: 'n3', R: '1+t' }, { id: 'A', kind: 'ammeter', a: 'n3', b: 'n0' }] } }, [['I(A)', T(0)], ['I(A)', T(4)]]);
  near(a[0], 3); near(a[1], 1);
});
test('断开开关：没有电流，电压表读电动势', () => {
  const a = solve({ circuit: { ...loop, elements: [{ id: 'E', kind: 'battery', a: 'n1', b: 'n0', E: 6, r: 1 }, { id: 'K', kind: 'switch', a: 'n1', b: 'n2', on: 0 }, { id: 'R', kind: 'R', a: 'n2', b: 'n3', R: 5 }, { id: 'W', kind: 'wire', a: 'n3', b: 'n0' }, { id: 'V', kind: 'voltmeter', a: 'n1', b: 'n0' }] } }, [['I(R)', T(1)], ['U(V)', T(1)]]);
  near(a[0], 0, 1e-6); near(a[1], 6);
});
console.log(`\n电磁题型测试：${n}/${n} 通过`);
