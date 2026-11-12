// 双缝干涉（含单缝衍射包络、缝前插薄片）：屏上光强按两束光的光程差精确计算，不用小角度近似；
// 条纹间距 Δx = Lλ/d、各级亮暗纹位置、某点光程差与级数都可取。λ、d、L、薄片厚度可含 t，演示条件变化时条纹怎样移动。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber } from './common.ts';
import type { Num } from '../sim.ts';

export type SlitSpec = {
  lambda: Num; d: Num; L: Num; a?: Num;                    // 波长、缝间距、缝到屏距离、单缝宽度（给了才画衍射包络）
  film?: { slit: 1 | 2; n: Num; e: Num };                  // 在第 1（上）或第 2（下）条缝前插入折射率 n、厚 e 的薄片
  probes?: { id: string; x: Num }[];                       // 屏上的点（距中心的坐标，向上为正）
  range?: Num; duration?: Num; color?: string;
};
export function slit(sp: SlitSpec, vars: Record<string, number>): LabOut {
  const T = num(sp.duration, vars, 1);
  const at = (x: Num | undefined, t: number, d = 0) => num(x, vars, d, t);
  const P0 = (t: number) => {
    const lam = at(sp.lambda, t), d = at(sp.d, t), L = at(sp.L, t), a = sp.a === undefined ? 0 : at(sp.a, t);
    if (!(lam > 0 && d > 0 && L > 0)) throw new Error('双缝：lambda、d、L 都必须大于 0');
    const extra = sp.film ? (at(sp.film.n, t) - 1) * at(sp.film.e, t) * (sp.film.slit === 1 ? 1 : -1) : 0;   // 上缝多出的光程（正：上缝光程长）
    return { lam, d, L, a, extra };
  };
  const p0 = P0(0), dx0 = p0.L * p0.lam / p0.d, R = sp.range === undefined ? 4.5 * dx0 : num(sp.range, vars);
  // 屏上 x 点：两缝（y = ±d/2）到该点的光程差 δ = r2 − r1 − extra（上缝为 1）
  const delta = (x: number, p: ReturnType<typeof P0>) => Math.hypot(p.L, x + p.d / 2) - Math.hypot(p.L, x - p.d / 2) - p.extra;
  const inten = (x: number, p: ReturnType<typeof P0>) => { const ph = Math.PI * delta(x, p) / p.lam, env = p.a > 0 ? (() => { const b = Math.PI * p.a * (x / Math.hypot(p.L, x)) / p.lam; return Math.abs(b) < 1e-9 ? 1 : (Math.sin(b) / b) ** 2; })() : 1; return env * Math.cos(ph) ** 2; };
  // 画面坐标：缝在 x=0，屏在 X=1；屏上竖直方向按 R 归一到 ±0.45
  const ys = (x: number) => x / R * .45, col = sp.color ?? red;
  const frame = (t: number) => {
    const p = P0(t), dx = p.L * p.lam / p.d, d: Prim[] = [], vals: Record<string, number> = {};
    // 零级亮纹：光程差 δ = 0 的位置（二分精确求；插片后移向插片那条缝一侧）
    let lo = -10 * p.L, hi = 10 * p.L; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (delta(m, p) > 0) hi = m; else lo = m; } const shift = (lo + hi) / 2;
    Object.assign(vals, { dx, lambda: p.lam, d: p.d, L: p.L, shift, x0: shift });   // x0：零级亮纹位置（插片后移向光程长的一侧）
    for (let k = -3; k <= 3; k++) { vals[`xb_${k < 0 ? 'm' + -k : k}`] = shift + k * dx; vals[`xd_${k < 0 ? 'm' + -k : k}`] = shift + (k + .5) * dx; }
    for (const pr of sp.probes ?? []) { const x = at(pr.x, t), dl = delta(x, p); vals[`delta_${pr.id}`] = dl; vals[`order_${pr.id}`] = dl / p.lam; vals[`I_${pr.id}`] = inten(x, p); const o = dl / p.lam, f = o - Math.floor(o); vals[`bright_${pr.id}`] = Math.min(f, 1 - f) < .01 ? 1 : 0; vals[`dark_${pr.id}`] = Math.abs(f - .5) < .01 ? 1 : 0; }   // 亮/暗按级数差 0.01 以内判（课本数据用小角度近似）
    // 装置：光源、双缝挡板、屏
    const gap = Math.min(.12, Math.max(.03, ys(p.d) * 1.0 || .05));
    d.push({ k: 'circle', at: [-.45, 0], rp: 6, fill: amber, c: ink, w: 1 }, { k: 'text', at: [-.45, 0], s: '光源', c: soft, size: 12, dy: 22 });
    d.push({ k: 'line', p: [[0, .5], [0, gap / 2 + .012]], c: ink, w: 3 }, { k: 'line', p: [[0, gap / 2 - .012], [0, -gap / 2 + .012]], c: ink, w: 3 }, { k: 'line', p: [[0, -gap / 2 - .012], [0, -.5]], c: ink, w: 3 });
    d.push({ k: 'text', at: [0, gap / 2], s: 'S₁', c: ink, size: 12, dx: -14, dy: -2 }, { k: 'text', at: [0, -gap / 2], s: 'S₂', c: ink, size: 12, dx: -14, dy: 12 });
    if (sp.film) { const y = sp.film.slit === 1 ? gap / 2 : -gap / 2; d.push({ k: 'rect', x0: -.03, y0: y - .02, x1: -.008, y1: y + .02, fill: '#9fd3e0', c: ink, w: 1 }); }
    d.push({ k: 'line', p: [[1, .5], [1, -.5]], c: ink, w: 2.2 }, { k: 'text', at: [1, .5], s: '屏', c: soft, size: 12, dy: -6 });
    for (const y of [gap / 2, -gap / 2]) d.push({ k: 'line', p: [[-.45, 0], [0, y]], c: '#d9730d55', w: 1 });
    // 屏上的条纹（亮度按光强）和光强曲线（屏右侧）
    const N = 220; let prev: number[] | null = null; const curve: number[][] = [];
    for (let i = 0; i <= N; i++) { const x = -R + 2 * R * i / N, I = inten(x, p), y = ys(x); curve.push([1.03 + .22 * I, y]);
      if (prev) d.push({ k: 'line', p: [[1, prev[1]], [1, y]], c: `rgba(200,40,40,${(.08 + .92 * I).toFixed(3)})`, w: 12 }); prev = [I, y]; }
    d.push({ k: 'line', p: curve, c: col, w: 1.6 });
    // 中央亮纹和条纹间距标注
    const yb = ys(shift), y1 = ys(shift + dx);
    d.push({ k: 'line', p: [[.93, yb], [.93, y1]], c: blue, w: 1.4, arrow: true }, { k: 'text', at: [.93, (yb + y1) / 2], s: `Δx = ${fmtLen(dx)}`, c: blue, size: 13, dx: -8, align: 'right' });
    d.push({ k: 'line', p: [[.0, -.56], [1, -.56]], c: soft, w: 1, dash: [4, 4] }, { k: 'text', at: [.5, -.56], s: `L = ${fmtLen(p.L)}　d = ${fmtLen(p.d)}　λ = ${fmtLen(p.lam)}`, c: soft, size: 12.5, dy: 16 });
    if (Math.abs(shift) > dx * 1e-6) d.push({ k: 'text', at: [1, yb], s: '零级', c: blue, size: 12, dx: 40, align: 'left' });
    for (const pr of sp.probes ?? []) { const y = ys(at(pr.x, t)); if (Math.abs(y) > .5) continue; d.push({ k: 'line', p: [[.975, y], [1.005, y]], c: ink, w: 2 }, { k: 'text', at: [.975, y], s: pr.id, c: ink, size: 13, bold: true, dx: -6, align: 'right' }); }
    return { draw: d, vals };
  };
  return { name: '双缝干涉', T, view: [-.55, -.68, 1.35, .62], frame, flat: true };
}
const fmtLen = (L: number) => { const a = Math.abs(L); return a >= 1 ? `${fixed(L, 3)} m` : a >= 1e-2 ? `${fixed(L * 100, 2)} cm` : a >= 1e-4 ? `${fixed(L * 1e3, 3)} mm` : a >= 1e-6 ? `${fixed(L * 1e6, 2)} μm` : `${fixed(L * 1e9, 1)} nm`; };
