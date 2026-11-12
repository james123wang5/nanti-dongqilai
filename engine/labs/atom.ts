// 原子与光电效应：能级跃迁、光子能量、光电子最大初动能、遏止电压。能量单位 eV。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber } from './common.ts';
import type { Num } from '../sim.ts';

export type AtomSpec = {
  levels?: Num[]; hydrogen?: Num;                     // levels 从基态往上；hydrogen: n 表示用 -13.6/n² 列到第 n 级
  jumps?: { from: number; to: number }[];             // 依次演示
  all?: number;                                       // 从第几级往下，列出全部谱线
  metal?: { W0: Num };
  duration?: Num;
  light?: { nu?: Num; lambda?: Num; intensity?: Num };   // 单色光直接照射金属（光电效应）：频率 Hz 或波长 m，可含 t；intensity 相对光强
  tube?: { U?: Num };                                     // 光电管两端电压（阳极电势高为正，可含 t），算光电流
};
const H = 4.1357e-15, C = 3e8;   // eV·s, m/s
export function atom(sp: AtomSpec, vars: Record<string, number>): LabOut {
  if (sp.light) return photo(sp, vars);
  const E = sp.levels ? sp.levels.map((e) => num(e, vars)) : Array.from({ length: Math.round(num(sp.hydrogen, vars, 5)) }, (_, i) => -13.6 / (i + 1) ** 2);
  const W0 = sp.metal ? num(sp.metal.W0, vars) : undefined;
  let jumps = sp.jumps ?? [];
  if (sp.all) { jumps = []; for (let a = sp.all; a > 1; a--) for (let b = a - 1; b >= 1; b--) jumps.push({ from: a, to: b }); }
  const per = 1.6, T = num(sp.duration, vars, Math.max(per * jumps.length, 3));
  // 画面高度用能量的压缩刻度，基态不至于把上面挤成一团
  const order = [...new Set([...E, 0])].sort((a, b) => a - b), Y = (e: number) => order.indexOf(e) / (order.length - 1);   // 能级图是示意图：等距排开，数值写在旁边
  const stat: Prim[] = [];
  E.forEach((e, i) => { stat.push({ k: 'line', p: [[0, Y(e)], [1, Y(e)]], c: ink, w: 2 }, { k: 'text', at: [-.03, Y(e)], s: `n = ${i + 1}`, c: ink, size: 13, align: 'right', dy: 5 }, { k: 'text', at: [1.03, Y(e)], s: `${fixed(e, 2)} eV`, c: soft, size: 13, align: 'left', dy: 5 }); });
  if (E.at(-1)! < 0) stat.push({ k: 'line', p: [[0, Y(0)], [1, Y(0)]], c: soft, w: 1.2, dash: [6, 4] }, { k: 'text', at: [1.03, Y(0)], s: '0 eV（电离）', c: soft, size: 13, align: 'left', dy: 5 });
  const frame = (t: number) => {
    const draw: Prim[] = [], vals: Record<string, number> = { lines: sp.all ? sp.all * (sp.all - 1) / 2 : jumps.length };
    E.forEach((e, i) => { vals[`E_${i + 1}`] = e; });
    jumps.forEach((j, i) => {
      const dE = Math.abs(E[j.from - 1] - E[j.to - 1]), id = `${j.from}${j.to}`, nu = dE / H, lam = H * C / dE; vals[`dE_${id}`] = dE; vals[`nu_${id}`] = nu; vals[`lambda_${id}`] = lam;
      if (W0 !== undefined) { vals[`Ek_${id}`] = dE - W0; vals[`Uc_${id}`] = Math.max(dE - W0, 0); vals[`emit_${id}`] = dE >= W0 ? 1 : 0; }
      const x = .12 + .76 * (i + .5) / Math.max(jumps.length, 1), done = (t / T) * jumps.length, f = Math.max(0, Math.min(1, done - i));
      if (f <= 0) return;
      const a = Y(E[j.from - 1]), b = Y(E[j.to - 1]), hot = W0 !== undefined && dE >= W0, c = hot ? red : blue;
      draw.push({ k: 'line', p: [[x, a], [x, a + (b - a) * f]], c, w: 2.4, arrow: true });
      if (f >= 1) draw.push({ k: 'text', at: [x, (a + b) / 2], s: `${fixed(dE, 2)} eV`, c, size: 12, dx: 6, align: 'left' });
    });
    if (W0 !== undefined) draw.push({ k: 'text', at: [.5, -.08], s: `金属逸出功 W₀ = ${fixed(W0, 2)} eV`, c: amber, size: 13 });
    return { draw, vals };
  };
  return { name: '能级', T, view: [-.2, -.14, 1.24, 1.08], frame, flat: true, stat };
}

/** 光电效应：Ek = hν − W0，遏止电压 Uc = Ek/e，截止频率 νc = W0/h；饱和光电流与光强成正比；
 *  光电管电压 U ≥ 0 时达到饱和，−Uc < U < 0 时按能越过反向电场的光电子比例（最大初动能均匀分布的示意模型）减小，U ≤ −Uc 时为 0 */
function photo(sp: AtomSpec, vars: Record<string, number>): LabOut {
  if (!sp.metal) throw new Error('光电效应：light 要配合 metal.W0（逸出功，eV）');
  const T = num(sp.duration, vars, 3), W0 = num(sp.metal.W0, vars), L = sp.light!;
  const at = (x: Num | undefined, t: number, d = 0) => num(x, vars, d, t);
  const nuOf = (t: number) => { if (L.nu !== undefined) return at(L.nu, t); if (L.lambda !== undefined) return C / at(L.lambda, t); throw new Error('光电效应：light 要写 nu（频率）或 lambda（波长）'); };
  const nuC = W0 / H, nus = Array.from({ length: 41 }, (_, i) => nuOf(T * i / 40)), nuMax = Math.max(...nus, nuC) * 1.25;
  const stat: Prim[] = [];
  // 右边 Ek–ν 图：斜率 h，横截距 νc，纵截距 −W0
  const gx = (nu: number) => .62 + .34 * nu / nuMax, ekMax = H * nuMax - W0, gy = (ek: number) => .5 + .42 * ek / Math.max(ekMax, W0);
  stat.push({ k: 'line', p: [[gx(0), gy(0)], [gx(nuMax), gy(0)]], c: ink, w: 1.4, arrow: true }, { k: 'line', p: [[gx(0), gy(-W0) - .04], [gx(0), gy(ekMax) + .04]], c: ink, w: 1.4, arrow: true });
  stat.push({ k: 'text', at: [gx(nuMax), gy(0)], s: 'ν', c: ink, size: 14, dy: 16 }, { k: 'text', at: [gx(0), gy(ekMax) + .04], s: 'Ek', c: ink, size: 14, dx: -14 });
  stat.push({ k: 'text', at: [gx(nuMax * .85), gy(H * nuMax * .85 - W0)], s: '斜率 h', c: soft, size: 12.5, dx: -10, align: 'right' });
  stat.push({ k: 'line', p: [[gx(0), gy(-W0)], [gx(nuMax), gy(ekMax)]], c: soft, w: 1.2, dash: [5, 4] }, { k: 'text', at: [gx(nuC), gy(0)], s: 'νc', c: soft, size: 13, dy: -8 }, { k: 'text', at: [gx(0), gy(-W0)], s: '−W₀', c: soft, size: 12, dx: -8, align: 'right' });
  const frame = (t: number) => {
    const nu = nuOf(t), I0 = at(L.intensity, t, 1), Eph = H * nu, Ek = Math.max(0, Eph - W0), emit = Eph >= W0 ? 1 : 0, U = sp.tube ? at(sp.tube.U, t) : 0;
    const Is = emit ? I0 : 0, I = !emit ? 0 : U >= 0 ? Is : U <= -Ek ? 0 : Is * (1 + U / Ek);
    const vals: Record<string, number> = { nu, lambda: C / nu, Eph, W0, Ek, Uc: Ek, nu_c: nuC, emit, Is, I, U, intensity: I0 };
    const d: Prim[] = [];
    // 左边：入射光照到金属板，逸出的光电子斜着飞出（和入射光分开），飞出距离表示最大初动能
    d.push({ k: 'rect', x0: .08, y0: .2, x1: .12, y1: .8, fill: '#b9c3c8', c: ink, w: 1.2 }, { k: 'text', at: [.1, .2], s: `金属 W₀ = ${fixed(W0, 2)} eV`, c: ink, size: 12.5, dy: 18 });
    const col = nu < 4.3e14 ? '#b5302a' : nu > 7.5e14 ? '#6d4bb5' : nu > 6e14 ? '#1c5fc4' : '#1b7a5b';
    for (let k = 0; k < 3; k++) { const y = .35 + k * .15, pts: number[][] = []; for (let i = 0; i <= 30; i++) { const x = .42 - .28 * i / 30; pts.push([x, y + .015 * Math.sin(i * 1.2 + t * 6)]); } d.push({ k: 'line', p: pts, c: col, w: 1.8, arrow: true }); }
    d.push({ k: 'text', at: [.3, .82], s: `hν = ${fixed(Eph, 2)} eV`, c: col, size: 13 });
    if (emit) { const len = .05 + .18 * Math.sqrt(Ek / Math.max(ekMax, 1e-9)), n = Math.max(1, Math.round(3 * Math.min(2, I0))); for (let k = 0; k < n; k++) { const y0 = .28 + k * .44 / Math.max(1, n - 1), ph = ((t * .9 + k * .37) % 1), dx = len * .8, dy = -len * .6, x = .12 + dx * ph, y = y0 + dy * ph; d.push({ k: 'line', p: [[.12, y0], [.12 + dx, y0 + dy]], c: '#1c5fc433', w: 1, dash: [3, 3] }, { k: 'circle', at: [x, y], rp: 4, fill: '#1c5fc4', c: ink, w: .8 }); if (k === 0) d.push({ k: 'text', at: [.12 + dx, y0 + dy], s: '光电子', c: '#1c5fc4', size: 12, dx: 6, align: 'left' }); } d.push({ k: 'text', at: [.3, .12], s: `Ek = ${fixed(Ek, 2)} eV，Uc = ${fixed(Ek, 2)} V`, c: '#1c5fc4', size: 13 }); }
    else d.push({ k: 'text', at: [.3, .12], s: 'ν < νc，不发生光电效应', c: red, size: 13 });
    if (sp.tube) d.push({ k: 'text', at: [.3, .04], s: `U = ${fixed(U, 2)} V，光电流 I = ${fixed(I, 3)}（饱和 ${fixed(Is, 3)}）`, c: amber, size: 12.5 });
    d.push({ k: 'circle', at: [gx(nu), gy(Eph - W0)], rp: 5, fill: emit ? '#1c5fc4' : red, c: ink, w: 1 });
    return { draw: d, vals };
  };
  const marks: { t: number; label: string }[] = [];
  for (let i = 1; i < nus.length; i++) if ((nus[i - 1] - nuC) * (nus[i] - nuC) < 0) marks.push({ t: T * i / 40, label: '达到截止频率' });
  return { name: '光电效应', T, view: [0, -.05, 1.02, 1], frame, flat: true, stat, marks };
}
