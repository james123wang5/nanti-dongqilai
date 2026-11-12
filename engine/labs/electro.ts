// 静电场：点电荷叠加。电场线沿场强积分，等势线从电势网格提取，试探电荷按受力运动。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber } from './common.ts';
import type { Num } from '../sim.ts';

export type ElectroSpec = {
  charges?: { id?: string; q: Num; at: [Num, Num] }[];
  uniform?: [Num, Num]; k?: Num; range?: [Num, Num, Num, Num]; duration?: Num;
  probes?: { id: string; at: [Num, Num] }[];
  scan?: { from: [Num, Num]; to: [Num, Num] };      // 探针沿直线走，得到 φ-x、E-x
  mover?: { id: string; q: Num; m: Num; at: [Num, Num]; v?: [Num, Num] };
};
export function electro(sp: ElectroSpec, vars: Record<string, number>): LabOut {
  const K = num(sp.k, vars, vars.k ?? 9e9), Q = (sp.charges ?? []).map((c, i) => ({ id: c.id ?? `Q${i + 1}`, q: num(c.q, vars), x: num(c.at[0], vars), y: num(c.at[1], vars) })), U: [number, number] = sp.uniform ? [num(sp.uniform[0], vars), num(sp.uniform[1], vars)] : [0, 0];
  const E = (x: number, y: number): [number, number] => { let ex = U[0], ey = U[1]; for (const c of Q) { const dx = x - c.x, dy = y - c.y, r2 = dx * dx + dy * dy + 1e-18, r3 = r2 * Math.sqrt(r2); ex += K * c.q * dx / r3; ey += K * c.q * dy / r3; } return [ex, ey]; };
  const phi = (x: number, y: number) => { let v = -(U[0] * x + U[1] * y); for (const c of Q) v += K * c.q / (Math.hypot(x - c.x, y - c.y) + 1e-12); return v; };
  // 只有匀强电场（不写点电荷）时，按运动电荷、探针的位置取景
  const pts = Q.length ? Q : [...(sp.mover ? [{ x: num(sp.mover.at[0], vars), y: num(sp.mover.at[1], vars) }] : []), ...(sp.probes ?? []).map((p) => ({ x: num(p.at[0], vars), y: num(p.at[1], vars) })), ...(sp.mover || sp.probes?.length ? [] : [{ x: 0, y: 0 }])];
  const xs = pts.map((c) => c.x), ys = pts.map((c) => c.y), sx = Math.max(...xs) - Math.min(...xs), sy = Math.max(...ys) - Math.min(...ys), sp0 = Math.max(sx, sy, 1e-9), pad = sp0 * .7 + (sx + sy === 0 ? 1 : 0);
  const view: [number, number, number, number] = sp.range ? [num(sp.range[0], vars), num(sp.range[1], vars), num(sp.range[2], vars), num(sp.range[3], vars)] : [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  const W = view[2] - view[0], H = view[3] - view[1], stat: Prim[] = [];
  // 等势线
  const G = 90, gx = (i: number) => view[0] + W * i / G, gy = (j: number) => view[1] + H * j / G, grid = Array.from({ length: G + 1 }, (_, i) => Array.from({ length: G + 1 }, (_, j) => phi(gx(i), gy(j))));
  const flat = grid.flat().filter(Number.isFinite).sort((a, b) => a - b), levels = [.12, .24, .36, .5, .64, .76, .88].map((f) => flat[Math.floor(f * (flat.length - 1))]);
  for (const L of levels) for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const c = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]], P = [[gx(i), gy(j)], [gx(i + 1), gy(j)], [gx(i + 1), gy(j + 1)], [gx(i), gy(j + 1)]], hits: number[][] = [];
    for (let e = 0; e < 4; e++) { const a = c[e], b = c[(e + 1) % 4]; if ((a - L) * (b - L) < 0) { const f = (L - a) / (b - a), p = P[e], q = P[(e + 1) % 4]; hits.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); } }
    if (hits.length >= 2) stat.push({ k: 'line', p: [hits[0], hits[1]], c: '#b5302a44', w: 1 });
  }
  // 电场线：从正电荷出发；只有负电荷时从负电荷反向画
  const src = Q.some((c) => c.q > 0) ? Q.filter((c) => c.q > 0) : Q, dirn = Q.some((c) => c.q > 0) ? 1 : -1, r0 = sp0 * .03 + 1e-3 * W;
  for (const c of src) { const n = Math.round(14 * Math.min(2, Math.abs(c.q) / Math.max(...Q.map((q) => Math.abs(q.q))) + .2)); for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * (i + .5) / n; let x = c.x + r0 * Math.cos(a), y = c.y + r0 * Math.sin(a); const line: number[][] = [[x, y]], h = W / 240;
    for (let s = 0; s < 900; s++) { const e = E(x, y), m = Math.hypot(e[0], e[1]) || 1; x += dirn * h * e[0] / m; y += dirn * h * e[1] / m; line.push([x, y]); if (x < view[0] || x > view[2] || y < view[1] || y > view[3] || Q.some((q) => q !== c && Math.hypot(x - q.x, y - q.y) < r0)) break; }
    stat.push({ k: 'line', p: line, c: '#1c5fc488', w: 1.3 });
    const mid = line[Math.floor(line.length * .45)], nx = line[Math.min(line.length - 1, Math.floor(line.length * .45) + 2)]; if (mid && nx) stat.push({ k: 'line', p: [mid, nx], c: '#1c5fc4cc', w: 1.3, arrow: true });
  } }
  for (const c of Q) stat.push({ k: 'circle', at: [c.x, c.y], rp: 11, fill: c.q >= 0 ? red : blue, c: ink }, { k: 'text', at: [c.x, c.y], s: c.q >= 0 ? '+' : '−', c: '#fff', size: 15, dy: 5, bold: true }, { k: 'text', at: [c.x, c.y], s: c.id, c: ink, size: 13, dy: -16 });
  const pr = (sp.probes ?? []).map((p) => ({ id: p.id, x: num(p.at[0], vars), y: num(p.at[1], vars) }));
  const scan = sp.scan ? { a: [num(sp.scan.from[0], vars), num(sp.scan.from[1], vars)], b: [num(sp.scan.to[0], vars), num(sp.scan.to[1], vars)] } : undefined;
  const T = num(sp.duration, vars, 6);
  // 试探电荷
  type S = { t: number; x: number; y: number; vx: number; vy: number };
  const path: S[] = [];
  if (sp.mover) { const m = sp.mover, q = num(m.q, vars), M = num(m.m, vars); let s: S = { t: 0, x: num(m.at[0], vars), y: num(m.at[1], vars), vx: num(m.v?.[0], vars), vy: num(m.v?.[1], vars) }; const N = 8000, h = T / N; const acc = (x: number, y: number) => { const e = E(x, y); return [q * e[0] / M, q * e[1] / M]; }; path.push(s); for (let i = 0; i < N; i++) { const a1 = acc(s.x, s.y), k2x = s.x + s.vx * h / 2, k2y = s.y + s.vy * h / 2, a2 = acc(k2x, k2y), vx2 = s.vx + a1[0] * h / 2, vy2 = s.vy + a1[1] * h / 2; s = { t: s.t + h, x: s.x + vx2 * h, y: s.y + vy2 * h, vx: s.vx + a2[0] * h, vy: s.vy + a2[1] * h }; path.push(s); } }
  const frame = (t: number) => {
    const draw: Prim[] = [], vals: Record<string, number> = {};
    for (const p of pr) { const e = E(p.x, p.y), m = Math.hypot(e[0], e[1]) || 1, L = W * .1; draw.push({ k: 'line', p: [[p.x, p.y], [p.x + e[0] / m * L, p.y + e[1] / m * L]], c: amber, w: 2.4, arrow: true }, { k: 'circle', at: [p.x, p.y], rp: 4.5, fill: ink }, { k: 'text', at: [p.x, p.y], s: p.id, c: ink, size: 14, dy: -11, bold: true }); vals[`E_${p.id}`] = Math.hypot(e[0], e[1]); vals[`Ex_${p.id}`] = e[0]; vals[`Ey_${p.id}`] = e[1]; vals[`phi_${p.id}`] = phi(p.x, p.y); }
    if (scan) { const u = T ? t / T : 0, x = scan.a[0] + (scan.b[0] - scan.a[0]) * u, y = scan.a[1] + (scan.b[1] - scan.a[1]) * u, e = E(x, y); draw.push({ k: 'line', p: [scan.a, scan.b], c: soft, w: 1.2, dash: [5, 4] }, { k: 'circle', at: [x, y], rp: 5, fill: amber, c: ink }); Object.assign(vals, { x_scan: x, y_scan: y, s_scan: Math.hypot(x - scan.a[0], y - scan.a[1]), phi_scan: phi(x, y), E_scan: Math.hypot(e[0], e[1]), Ex_scan: e[0], Ey_scan: e[1] }); }
    if (path.length) { const i = Math.min(path.length - 1, Math.round(t / T * (path.length - 1))), s = path[i], m = sp.mover!, q = num(m.q, vars), M = num(m.m, vars); draw.push({ k: 'circle', at: [s.x, s.y], rp: 7, fill: q > 0 ? red : blue, c: ink }, { k: 'text', at: [s.x, s.y], s: m.id, c: ink, size: 13, dy: -12 }); Object.assign(vals, { [`x_${m.id}`]: s.x, [`y_${m.id}`]: s.y, [`v_${m.id}`]: Math.hypot(s.vx, s.vy), [`KE_${m.id}`]: .5 * M * (s.vx ** 2 + s.vy ** 2), [`EP_${m.id}`]: q * phi(s.x, s.y) }); }
    return { draw, vals };
  };
  const plot = scan ? { x: 's_scan', y: 'phi_scan', pts: Array.from({ length: 241 }, (_, i) => { const u = i / 240, x = scan.a[0] + (scan.b[0] - scan.a[0]) * u, y = scan.a[1] + (scan.b[1] - scan.a[1]) * u; return [Math.hypot(x - scan.a[0], y - scan.a[1]), phi(x, y), u * T] as [number, number, number]; }).filter((p) => Math.abs(p[1]) < 1e30) } : undefined;
  void fixed;
  const paths = path.length ? [{ c: amber, w: 1.8, dash: [5, 4], pts: path.filter((_, i) => i % 8 === 0).map((q) => [q.x, q.y, q.t]) }] : undefined;
  return { name: '静电场', T, view, frame, plot, stat, paths };
}
