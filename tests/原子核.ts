// 原子核实验室：半衰期、衰变链、核反应守恒和质量亏损，和解析值对照
import assert from 'node:assert/strict';
import { nuclear } from '../engine/labs/nuclear.ts';
import { validate } from '../engine/validate.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
test('半衰期：经过 3 个半衰期剩 1/8，质量与活度同比例', () => {
  const o = nuclear({ species: [{ id: 'Rn', N0: 8000, m0: 16, half: 3.8 }] }, {}), v = o.frame(3 * 3.8).vals;
  near(v.N_Rn, 1000); near(v.m_Rn, 2); near(v.frac_Rn, 1 / 8); near(v.A_Rn, Math.LN2 / 3.8 * 1000); near(v.n_half, 3);
  assert.ok(o.marks?.some((m) => m.label === 'Rn 第3个半衰期' && Math.abs(m.t - 11.4) < 1e-9));
});
test('点阵里没衰变的点数等于理论值（取整）', () => {
  const o = nuclear({ dots: 400, species: [{ id: 'X', N0: 1, half: 2 }] }, {});
  for (const t of [0, 1, 2, 3.3, 6]) { const f = o.frame(t), blue = f.draw.filter((p) => p.k === 'circle' && (p as { fill?: string }).fill === '#1c5fc4').length; assert.ok(Math.abs(blue - 400 * Math.pow(.5, t / 2)) <= 1, `t=${t}: ${blue}`); }
});
test('衰变链 A→B→C：B 的数量符合贝特曼公式，总数守恒', () => {
  const lA = Math.LN2 / 1, lB = Math.LN2 / 3, t = 2.5, o = nuclear({ species: [{ id: 'A', N0: 1000, half: 1, to: 'B' }, { id: 'B', half: 3, to: 'C' }, { id: 'C' }] }, {}), v = o.frame(t).vals;
  near(v.N_B, 1000 * lA / (lB - lA) * (Math.exp(-lA * t) - Math.exp(-lB * t)), 1e-9); near(v.N_A + v.N_B + v.N_C, 1000, 1e-9);
});
test('核反应：质量数、电荷数守恒，按质量亏损算出放出的能量', () => {
  const o = nuclear({ reaction: { left: [['H', 2, 1], ['H', 3, 1]], right: [['He', 4, 2], ['n', 1, 0]], masses: { H: 0, He: 0, n: 0 } } } as never, {});
  void o;   // 同名粒子质量须分开写：用不同符号
  const o2 = nuclear({ reaction: { left: [['D', 2, 1], ['T', 3, 1]], right: [['He', 4, 2], ['n', 1, 0]], masses: { D: 2.0141, T: 3.0161, He: 4.0026, n: 1.0087 } } }, {}), v = o2.frame(0).vals;
  near(v.dm, 2.0141 + 3.0161 - 4.0026 - 1.0087, 1e-12); near(v.Q, v.dm * 931.5, 1e-12);
});
test('核反应方程不守恒时报错', () => {
  assert.throws(() => nuclear({ reaction: { left: [['U', 235, 92], ['n', 1, 0]], right: [['Ba', 141, 56], ['Kr', 92, 36], ['n', 1, 0]] } }, {}), /不守恒/);
});
test('题目入口：val(N_Rn) 在“第2个半衰期”节点核验，来源为引擎', () => {
  const P = { spec: 'v1', scene: { surfaces: [], bodies: [], nuclear: { species: [{ id: 'Rn', N0: 100, half: 3.8 }] } }, asks: [{ id: '1', text: '剩余', at: { event: 'mark', name: 'Rn 第2个半衰期' }, expr: 'val(N_Rn)', answer: 25 }] } as unknown as Problem;
  assert.deepEqual(validate(P), []); const r = solveProblem(P); assert.equal(r.asks[0].ok, true, String(r.asks[0].error ?? r.asks[0].value)); assert.equal(r.asks[0].source, 'engine');
});
test('校验器：粒子写法和衰变产物引用', () => {
  const e = validate({ spec: 'v1', scene: { surfaces: [], bodies: [], nuclear: { species: [{ id: 'A', N0: 1, half: 1, to: 'Z' }], reaction: { left: [['U', 235]], right: [] } } }, asks: [{ id: '1', text: 'x', expr: 'val(N_A)' }] } as never).join('\n');
  assert.match(e, /不在 species 里/); assert.match(e, /\["符号", 质量数, 电荷数\]/); assert.match(e, /right 要写粒子数组/);
});
console.log(`\n原子核测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
