// 双缝干涉实验室：和解析值对照
import assert from 'node:assert/strict';
import { slit } from '../engine/labs/slit.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1e-12, Math.abs(b)), `${a} ≠ ${b}`);
const base = { lambda: 600e-9, d: 0.2e-3, L: 1 };
test('条纹间距 Δx = Lλ/d', () => { near(slit(base, {}).frame(0).vals.dx, 1 * 600e-9 / 0.2e-3); });
test('屏上距中心 Δx 处是第 1 级亮纹，Δx/2 处是暗纹（精确光程差）', () => {
  const dx = 3e-3, v = slit({ ...base, probes: [{ id: 'P', x: dx }, { id: 'Q', x: dx / 2 }] }, {}).frame(0).vals;
  near(v.order_P, 1, 1e-4); near(v.order_Q, .5, 1e-4); assert.ok(v.I_P > .9999 && v.I_Q < 1e-6); assert.equal(v.bright_P, 1); assert.equal(v.dark_Q, 1); assert.equal(v.dark_P, 0);
});
test('上缝前插薄片：零级亮纹移向上方，移动 (n−1)eL/d', () => {
  const v = slit({ ...base, film: { slit: 1, n: 1.5, e: 6e-6 } }, {}).frame(0).vals; near(v.x0, 0.5 * 6e-6 * 1 / 0.2e-3, 1e-3);   // 引擎用精确光程差，课本式是小角度近似
  const w = slit({ ...base, film: { slit: 2, n: 1.5, e: 6e-6 } }, {}).frame(0).vals; near(w.x0, -0.5 * 6e-6 * 1 / 0.2e-3, 1e-3);
});
test('波长随 t 变大时条纹间距随之变大', () => { const o = slit({ ...base, lambda: '400e-9+300e-9*t' }, {}); near(o.frame(1).vals.dx, 700e-9 / 0.2e-3); near(o.frame(0).vals.dx, 400e-9 / 0.2e-3); });
test('参数不合法时报错', () => { assert.throws(() => slit({ ...base, d: 0 }, {}), /都必须大于 0/); });
console.log(`\n双缝测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
