// 光电效应：Ek = hν − W0、遏止电压、截止频率、饱和电流与光强
import assert from 'node:assert/strict';
import { atom } from '../engine/labs/atom.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const H = 4.1357e-15;
test('Ek = hν − W0，Uc 数值等于 Ek（eV→V）', () => { const v = atom({ light: { nu: 1e15 }, metal: { W0: 2.25 } }, {}).frame(0).vals; near(v.Ek, H * 1e15 - 2.25); near(v.Uc, v.Ek); near(v.emit, 1); near(v.nu_c, 2.25 / H); });
test('用波长给光：ν = c/λ', () => { const v = atom({ light: { lambda: 500e-9 }, metal: { W0: 2.25 } }, {}).frame(0).vals; near(v.nu, 3e8 / 500e-9); near(v.Eph, H * 3e8 / 500e-9); });
test('频率低于截止频率：不发生光电效应，光强再大也没有光电流', () => { const v = atom({ light: { nu: 4e14, intensity: 10 }, metal: { W0: 2.25 } }, {}).frame(0).vals; near(v.emit, 0); near(v.Ek, 0); near(v.I, 0); });
test('饱和光电流与光强成正比；反向电压达到 Uc 时电流为 0', () => {
  const a = atom({ light: { nu: 1e15, intensity: 1 }, metal: { W0: 2.25 }, tube: { U: 2 } }, {}).frame(0).vals, b = atom({ light: { nu: 1e15, intensity: 2 }, metal: { W0: 2.25 }, tube: { U: 2 } }, {}).frame(0).vals;
  near(b.Is, 2 * a.Is); near(a.I, a.Is);
  const c = atom({ light: { nu: 1e15 }, metal: { W0: 2.25 }, tube: { U: -(H * 1e15 - 2.25) } }, {}).frame(0).vals; near(c.I, 0, 1e-9);
});
test('频率随 t 增大越过截止频率时有节点', () => { const o = atom({ light: { nu: '3e14+6e14*t/3' }, metal: { W0: 2.25 }, duration: 3 }, {}); assert.ok(o.marks?.some((m) => m.label === '达到截止频率')); });
console.log(`\n光电效应测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
