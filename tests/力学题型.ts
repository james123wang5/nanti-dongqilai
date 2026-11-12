// 高中力学各章题型的解析对照。只用自编场景。
import assert from 'node:assert/strict';
import { solveProblem, type Problem, type Ask } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
import type { SceneSpec } from '../engine/sim.ts';
let n = 0;
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } };
const solve = (scene: Partial<SceneSpec>, asks: [string, any][]) => {
  const P = { spec: 'v1', constants: { g: 10 }, scene: { surfaces: [], bodies: [], ...scene }, asks: asks.map(([expr, at], i) => ({ id: String(i + 1), text: expr, expr, ...(at ? { at } : {}) })) } as unknown as Problem;
  assert.deepEqual(validate(P), []);
  return solveProblem(P, 1 / 60).asks;
};
const near = (a: { value: number; error?: string }, b: number, tol = 1e-3) => assert.ok(Math.abs(a.value - b) < tol, `${a.value} ≠ ${b} ${a.error ?? ''}`);
const T = (t: number) => ({ event: 'time', t });
const hang = (id: string, x: number) => ({ id, from: [x, 10], to: [x, -50] });

test('绳：阿特伍德机 a = 5，T = 15', () => {
  const a = solve({ surfaces: [hang('左', 0), hang('右', 1)], bodies: [{ id: 'A', m: 3, on: '左', at: 5, v: 0 }, { id: 'B', m: 1, on: '右', at: 5, v: 0 }], ropes: [{ between: ['A', 'B'], via: [[0, 10], [1, 10]] }], tMax: 2 }, [['v(A)', T(1)], ['v(B)', T(1)], ['T()', T(1)], ['dy(A)', T(1)]]);
  near(a[0], 5); near(a[1], 5); near(a[2], 15); near(a[3], -2.5);
});
test('绳：桌面物块与悬挂物，含摩擦 a = 1，T = 9', () => {
  const a = solve({ surfaces: [{ id: '桌', from: [0, 0], to: [10, 0], mu: 0.2 }, { id: '竖', from: [10, 0], to: [10, -30] }], bodies: [{ id: 'M', m: 3, on: '桌', at: 1, v: 0 }, { id: 'm', m: 1, on: '竖', at: 1, v: 0 }], ropes: [{ between: ['M', 'm'], via: [[10, 0]] }], tMax: 2 }, [['v(M)', T(1)], ['T()', T(1)]]);
  near(a[0], 1); near(a[1], 9);
});
test('绳：拉力不足时物块静止，T 等于悬挂物重力', () => {
  const a = solve({ surfaces: [{ id: '桌', from: [0, 0], to: [10, 0], mu: 0.5 }, { id: '竖', from: [10, 0], to: [10, -30] }], bodies: [{ id: 'M', m: 3, on: '桌', at: 1, v: 0 }, { id: 'm', m: 1, on: '竖', at: 1, v: 0 }], ropes: [{ between: ['M', 'm'], via: [[10, 0]] }], tMax: 1 }, [['v(m)', T(.5)], ['T()', T(.5)]]);
  near(a[0], 0); near(a[1], 10);
});
test('绳：光滑斜面 30° 与悬挂物 a = 2.5', () => {
  const a = solve({ surfaces: [{ id: '斜', from: [0, 0], dir: ['cos(pi/6)', 'sin(pi/6)'], length: 10 }, { id: '竖', from: ['10*cos(pi/6)', 5], to: ['10*cos(pi/6)', -30] }], bodies: [{ id: 'M', m: 2, on: '斜', at: 1, v: 0 }, { id: 'm', m: 2, on: '竖', at: 1, v: 0 }], ropes: [{ between: ['M', 'm'], via: [['10*cos(pi/6)', 5]] }], tMax: 2 }, [['v(M)', T(1)]]);
  near(a[0], 2.5);
});
test('万有引力：圆轨道周期 2π，速率不变', () => {
  const a = solve({ plane: 'horizontal', fields: [{ kind: 'central', center: [0, 0], GM: 1 }], bodies: [{ id: '星', m: 1, pos: [1, 0], vel: [0, 1] }], tMax: 7 }, [['x(星)', T(2 * Math.PI)], ['v(星)', T(3)]]);
  near(a[0], 1, 1e-4); near(a[1], 1, 1e-6);
});
test('万有引力：近地点点火后到远地点，机械能守恒给出远地点半径', () => {
  const v = Math.sqrt(1.5), ra = 3;   // 从 r=1 加速到 v²=1.5，半长轴 2，远地点 3
  const a = solve({ plane: 'horizontal', fields: [{ kind: 'central', center: [0, 0], GM: 1 }], bodies: [{ id: '星', m: 1, pos: [1, 0], vel: [0, 1] }], kicks: [{ on: '星', when: T(0.5), vel: ['-sin(0.5)*sqrt(1.5)', 'cos(0.5)*sqrt(1.5)'] }], tMax: 20 }, [['sqrt(x(星)^2+y(星)^2)', { event: 'apsis', body: '星' }]]);
  near(a[0], ra, 1e-3); assert.ok(v > 1);
});
test('机车启动：恒定功率的最大速度 P/f', () => {
  const a = solve({ surfaces: [{ id: '路', kind: 'ground', y: 0 }], bodies: [{ id: '车', m: 1, on: '路', x: 0, v: 0.5 }], forces: [{ on: '车', F: ['10/max(v,0.1)', 0] }], resistance: [{ on: '车', magnitude: 2 }], tMax: 30 }, [['v(车)', T(29)]]);
  near(a[0], 5, 1e-2);
});
test('简谐：水平弹簧振子周期 2π√(m/k)', () => {
  const a = solve({ surfaces: [{ id: '面', from: [0, 0], to: [10, 0] }], bodies: [{ id: 'W', m: 1, on: '面', at: 0, v: 0, locked: true }, { id: 'A', m: 1, on: '面', at: 3, v: 0 }], springs: [{ id: 's', between: ['W', 'A'], k: 4, L0: 2 }], tMax: 4 }, [['x(A)', T(Math.PI)], ['x(A)', T(Math.PI / 2)]]);
  near(a[0], 3, 1e-4); near(a[1], 1, 1e-4);
});
test('单摆：光滑圆弧小角度周期 2π√(L/g)', () => {
  const L = 1, a0 = -90 - 3;
  const a = solve({ surfaces: [{ id: '摆', kind: 'arc', center: [0, L], radius: L, start: a0, end: -90 + 20, turn: 'ccw', side: 'tube' }], bodies: [{ id: 'A', kind: 'ball', m: 1, on: '摆', at: 0, v: 0 }], tMax: 3 }, [['t', { event: 'stop', body: 'A', n: 2 }]]);
  near(a[0], 2 * Math.PI * Math.sqrt(.1), 2e-3);
});
test('平抛、斜抛：落地时间与水平距离', () => {
  const a = solve({ surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', kind: 'ball', m: 1, pos: [0, 5], vel: [3, 0] }] }, [['t', { event: 'land', body: 'A' }], ['x(A)', { event: 'land', body: 'A' }]]);
  near(a[0], 1); near(a[1], 3);
});
test('追及：匀速追匀加速，最大距离在共速时', () => {
  const a = solve({ surfaces: [{ id: '路', kind: 'ground', y: 0 }], bodies: [{ id: '甲', m: 1, on: '路', x: 0, v: 10 }, { id: '乙', m: 1, on: '路', x: 20, v: 0 }], forces: [{ on: '乙', F: [2, 0] }], tMax: 8 }, [['x(甲)-x(乙)', { event: 'same_velocity', bodies: ['甲', '乙'] }]]);
  near(a[0], 5);
});
test('解析演示：圆锥摆，取值标为按 AI 方程/自定义量算出', () => {
  const P = { spec: 'v1', constants: { g: 10 }, params: { L: [1, 'm', '绳长'], th: [0.5, 'rad', '摆角'] }, scene: { surfaces: [], bodies: [], script: { duration: 4, bodies: { A: { x: 'L*sin(th)*cos(2*t)', y: '-L*cos(th)', z: 'L*sin(th)*sin(2*t)' } }, links: [{ a: [0, 0, 0], b: 'A' }], vectors: [{ on: 'A', v: [0, 10, 0], label: 'T' }], curves: [{ x: 'L*sin(th)*cos(2*pi*u)', y: '-L*cos(th)', z: 'L*sin(th)*sin(2*pi*u)' }], marks: [{ t: 1, label: '半圈' }] } }, asks: [{ id: '1', text: 'r', at: T(0), expr: 'x(A)', answer: 'L*sin(th)' }] } as unknown as Problem;
  assert.deepEqual(validate(P), []);
  const s = solveProblem(P, 1 / 60);
  near(s.asks[0] as never, Math.sin(.5)); assert.equal(s.asks[0].source, 'custom'); assert.equal(s.asks[0].ok, null); assert.equal(s.sim!.script, true); assert.ok(s.sim!.samples[10].script!.curves[0].pts.length > 50);
});
console.log(`\n力学题型测试：${n}/${n} 通过`);
