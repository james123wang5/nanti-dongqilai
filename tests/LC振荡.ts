// LC 振荡：周期、能量守恒、相位关系、阻尼
import assert from 'node:assert/strict';
import { lc } from '../engine/labs/lc.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1e-30, Math.abs(b)), `${a} ≠ ${b}`);
const sp = { L: 0.01, C: 1e-6, U0: 10 }, T0 = 2 * Math.PI * Math.sqrt(0.01 * 1e-6);
test('周期 T = 2π√(LC)，q = q0·cos(ωt)，i = −q0ω·sin(ωt)', () => {
  const o = lc(sp, {}), w = 1 / Math.sqrt(0.01 * 1e-6), t = 0.37 * T0, v = o.frame(t).vals;
  near(v.T, T0, 1e-12); near(v.q, 1e-5 * Math.cos(w * t), 1e-6); near(v.i, -1e-5 * w * Math.sin(w * t), 1e-6);
});
test('能量守恒：电场能 + 磁场能 = 初始电场能', () => { const o = lc(sp, {}); for (const f of [.1, .3, .55, .9]) near(o.frame(f * T0).vals.E, .5 * 1e-6 * 100, 1e-8); });
test('第一次放电完毕在 T/4，第一次充电完毕（反向）在 T/2', () => {
  const m = lc(sp, {}).marks!; near(m.find((x) => x.label === '放电完毕')!.t, T0 / 4, 1e-4); near(m.find((x) => x.label === '充电完毕')!.t, T0 / 2, 1e-4);
});
test('有电阻时能量减少，减少的部分等于焦耳热', () => { const v = lc({ ...sp, R: 20 }, {}).frame(T0).vals; assert.ok(v.E < .5 * 1e-6 * 100); near(v.E + v.Q, .5 * 1e-6 * 100, 1e-9); });
test('参数不合法时报错', () => { assert.throws(() => lc({ L: 0, C: 1e-6, U0: 1 }, {}), /必须大于 0/); assert.throws(() => lc({ L: 1, C: 1 }, {}), /初始电压/); });
console.log(`\nLC 振荡测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
