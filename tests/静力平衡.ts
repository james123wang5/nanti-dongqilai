// 受力平衡实验室：和解析解对照（g = 10）
import assert from 'node:assert/strict';
import { statics, type StaticsSpec } from '../engine/labs/statics.ts';
import { validate } from '../engine/validate.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const run = (sp: StaticsSpec, t = 0) => statics({ g: 10, ...sp }, {}).frame(t).vals;
const mark = (sp: StaticsSpec, label: string) => { const m = statics({ g: 10, ...sp }, {}).marks?.find((x) => x.label === label); assert.ok(m, `没有节点 ${label}`); return m!.t; };

test('两绳悬挂重物：张力与解析解一致', () => {
  const v = run({ points: [{ id: 'A', at: [0, 0], fixed: true }, { id: 'B', at: [4, 0], fixed: true }, { id: 'O', at: [1, -1], m: 3 }], ropes: [{ id: 'OA', a: 'O', b: 'A' }, { id: 'OB', a: 'O', b: 'B' }] });
  const ua = [-1 / Math.SQRT2, 1 / Math.SQRT2], ub = [3 / Math.sqrt(10), 1 / Math.sqrt(10)], det = ua[0] * ub[1] - ua[1] * ub[0];
  near(v.T_OA, -30 * ub[0] / det); near(v.T_OB, ua[0] * 30 / det);
});
test('拉密定理：三力平衡 F1/sinα1 = F2/sinα2 = G/sinα3', () => {
  const v = run({ points: [{ id: 'A', at: [-1, 1], fixed: true }, { id: 'B', at: ['sqrt(3)', 1], fixed: true }, { id: 'O', at: [0, 0], m: 2 }], ropes: [{ id: 'a', a: 'O', b: 'A' }, { id: 'b', a: 'O', b: 'B' }] });
  // OA 与竖直夹 45°，OB 与竖直夹 60°。每个力除以另两个力夹角的正弦相等：Ta/sin120° = Tb/sin135° = G/sin105°
  const k = 20 / Math.sin(105 * Math.PI / 180); near(v.T_a, k * Math.sin(120 * Math.PI / 180)); near(v.T_b, k * Math.sin(135 * Math.PI / 180));
});
test('斜面静摩擦：f = mg sinθ，N = mg cosθ', () => {
  const v = run({ points: [{ id: '物块', at: [0, 0], m: 2 }], surfaces: [{ id: '斜面', on: '物块', angle: 30, mu: 0.8 }] });
  near(v.N_斜面, 20 * Math.cos(Math.PI / 6)); near(Math.abs(v.f_斜面), 20 * Math.sin(Math.PI / 6));
});
test('倾角缓慢增大：tanθ = μ 时开始滑动', () => {
  const t = mark({ duration: 1, points: [{ id: '物块', at: [0, 0], m: 2 }], surfaces: [{ id: '斜面', on: '物块', angle: '10+40*t', mu: 0.5 }] }, '物块 开始滑动');
  const tc = (Math.atan(0.5) * 180 / Math.PI - 10) / 40; assert.ok(Math.abs(t - tc) <= 1 / 240 + 1e-9, `${t} vs ${tc}`);
});
test('动态平衡：OA 方向不变、OB 缓慢转动，OB 与 OA 垂直时张力最小，最小值 G·sin30°', () => {
  // O 不动；OA 与竖直成 30°（A 在左上）；B 在以 O 为圆心的圆上从水平右方转到竖直上方
  const sp: StaticsSpec = { duration: 1, points: [{ id: 'A', at: ['-sin(pi/6)', 'cos(pi/6)'], fixed: true }, { id: 'B', at: ['cos(pi/2*t)', 'sin(pi/2*t)'], fixed: true }, { id: 'O', at: [0, 0], m: 1 }], ropes: [{ id: 'OA', a: 'O', b: 'A' }, { id: 'OB', a: 'O', b: 'B' }] };
  const t = mark(sp, 'T_OB 最小'), phi = 90 * t;   // OB 与水平的夹角
  near(phi, 30, 1e-3);   // 与 OA 垂直：OA 方向 120°，OB 方向 30°
  near(run(sp, t).T_OB, 10 * Math.sin(Math.PI / 6), 1e-4);
});
test('轻杆支架：水平杆受压 G/tanα，斜绳拉力 G/sinα', () => {
  const v = run({ points: [{ id: 'A', at: [0, 0], fixed: true }, { id: 'C', at: [0, 1], fixed: true }, { id: 'B', at: ['sqrt(3)', 0], m: 3 }], rods: [{ id: '杆', a: 'A', b: 'B' }], ropes: [{ id: '绳', a: 'B', b: 'C' }] });
  const al = Math.PI / 6; near(v.T_绳, 30 / Math.sin(al)); near(v.F_杆, -30 / Math.tan(al));   // 负号表示受压
});
test('跨两个定滑轮：中间挂 m，两端各挂 M，平衡时 2Mg·sinα = mg', () => {
  const v = run({ points: [{ id: 'M1', at: [-1, -2], m: 2 }, { id: 'M2', at: [1, -2], m: 2 }, { id: 'O', guess: [0, -0.5], m: 2 }], ropes: [{ id: '左', a: 'M1', b: 'O', via: [[-1, 0]] }, { id: '右', a: 'M2', b: 'O', via: [[1, 0]] }] });
  near(v.T_左, 20); near(v.T_右, 20); const al = Math.asin(20 / 40); near(v.y_O, -Math.tan(al), 1e-6); near(v.x_O, 0, 1e-6);
});
test('晾衣绳上的光滑挂钩：两侧张力相等，T = G/(2cosθ)，sinθ = d/L', () => {
  const v = run({ points: [{ id: 'A', at: [0, 0], fixed: true }, { id: 'B', at: [4, 1], fixed: true }, { id: 'P', guess: [2, -1], m: 1, look: 'ring' }], ropes: [{ id: '绳', a: 'A', b: 'B', via: ['P'], length: 5 }] });
  near(v.T_绳, 10 / (2 * Math.cos(Math.asin(4 / 5))), 1e-6);
});
test('给了绳长的绳其实是松的：判为松弛，张力为 0，结点挂在另一根绳正下方', () => {
  const v = run({ points: [{ id: 'A', at: [0, 0], fixed: true }, { id: 'B', at: [0.5, -0.5], fixed: true }, { id: 'O', guess: [0.1, -0.9], m: 1 }], ropes: [{ id: 'OA', a: 'O', b: 'A', length: 1 }, { id: 'OB', a: 'O', b: 'B', length: 2 }] });
  near(v.T_OB, 0); near(v.T_OA, 10); near(v.x_O, 0, 1e-6); near(v.y_O, -1, 1e-6);
});
test('三根拉直的绳挂在固定位置的结点上：静不定，报错', () => {
  assert.throws(() => run({ points: [{ id: 'A', at: [-1, 1], fixed: true }, { id: 'B', at: [1, 1], fixed: true }, { id: 'C', at: [0, -1], fixed: true }, { id: 'O', at: [0, 0], m: 1 }], ropes: [{ id: 'a', a: 'O', b: 'A' }, { id: 'b', a: 'O', b: 'B' }, { id: 'c', a: 'O', b: 'C' }] }), /静不定|条件不够/);
});
test('静不定：粗糙斜面上物块再用平行斜面的绳拉住，报“静不定”', () => {
  assert.throws(() => run({ points: [{ id: '物块', at: [0, 0], m: 2 }, { id: 'P', at: ['cos(pi/6)', 'sin(pi/6)'], fixed: true }], surfaces: [{ id: '斜面', on: '物块', angle: 30, mu: 0.5 }], ropes: [{ id: '绳', a: '物块', b: 'P' }] }), /静不定|条件不够/);
});
test('不能平衡时报错：光滑斜面上只靠重力和支持力', () => {
  assert.throws(() => run({ points: [{ id: '物块', at: [0, 0], m: 2 }], surfaces: [{ id: '斜面', on: '物块', angle: 30 }] }), /找不到平衡|不能唯一/);
});
test('通过题目入口求值并核验：val(T_OB) 与答案比较，来源是引擎', () => {
  const P: Problem = { spec: 'v1', params: { g: [10, 'm/s²', ''] }, scene: { surfaces: [], bodies: [], statics: { points: [{ id: 'A', at: [-1, 1], fixed: true }, { id: 'B', at: [1, 1], fixed: true }, { id: 'O', at: [0, 0], m: 1 }], ropes: [{ id: 'OA', a: 'O', b: 'A' }, { id: 'OB', a: 'O', b: 'B' }] } } as never, asks: [{ id: '1', text: 'OB 拉力', expr: 'val(T_OB)', answer: '5*sqrt(2)' }] } as never;
  assert.deepEqual(validate(P), []); const r = solveProblem(P); assert.equal(r.asks[0].ok, true, String(r.asks[0].error ?? r.asks[0].value)); assert.equal(r.asks[0].source, 'engine');
});
test('校验器：引用不存在的结点、固定点没写坐标', () => {
  const P = { spec: 'v1', scene: { surfaces: [], bodies: [], statics: { points: [{ id: 'A', fixed: true }, { id: 'O', at: [0, 0], m: 1 }], ropes: [{ id: 'r', a: 'O', b: 'X' }] } }, asks: [{ id: '1', text: 'x', expr: 'val(T_r)' }] } as never;
  const e = validate(P).join('\n'); assert.match(e, /固定点，必须写 at/); assert.match(e, /"X" 不在 points 里/);
});
console.log(`\n受力平衡测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
