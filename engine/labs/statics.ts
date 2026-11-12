// 共点力平衡与动态平衡：结点、物体、轻绳（可跨定滑轮、穿过光滑挂钩）、轻杆、弹簧、接触面、外力。
// 每个不固定的结点列 ΣF = 0；未知力（张力、杆力、支持力、静摩擦、待求外力）和未知位置（只给绳长时结点的位置）一起解。
// 绳只能拉：算出负张力就当松弛去掉重解；接触力为负就当分离去掉重解；静摩擦超过 μN 就是开始滑动，平衡到此为止。
// 几何和外力可以含 t（缓慢变化），按 t 扫描得到动态平衡过程，自动标出某力最大/最小、绳松弛、开始滑动等节点。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber, green, violet } from './common.ts';
import type { Num } from '../sim.ts';

type P2 = [Num, Num];
export type StaticsSpec = {
  duration?: Num; g?: Num; triangle?: string; plot?: { y: string };
  points: { id: string; at?: P2; guess?: P2; fixed?: boolean; m?: Num; look?: 'block' | 'ball' | 'knot' | 'ring' }[];
  ropes?: { id: string; a: string; b: string; via?: (string | P2)[]; length?: Num }[];
  rods?: { id: string; a: string; b: string; length?: Num }[];
  springs?: { id: string; a: string; b: string; k: Num; L0: Num }[];
  surfaces?: { id: string; on: string; angle?: Num; normal?: P2; mu?: Num; through?: P2 }[];
  forces?: { id: string; on: string; F?: P2; mag?: Num; dir?: Num; unknown?: boolean }[];
};
type Vec = [number, number];
const unit = (a: Vec, b: Vec): Vec => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 1e-12) throw new Error('静力平衡：绳/杆两端重合，方向不确定'); return [dx / L, dy / L]; };
const deg = Math.PI / 180;

/** 一组要解的未知量及其含义 */
type Unk = { kind: 'x' | 'y' | 'T' | 'F' | 'N' | 'f' | 'mag'; id: string };
type State = { pos: Record<string, Vec>; T: Record<string, number>; F: Record<string, number>; N: Record<string, number>; f: Record<string, number>; mag: Record<string, number>; slack: Set<string>; off: Set<string>; slip: string | null };

export function statics(sp: StaticsSpec, vars: Record<string, number>): LabOut {
  const g = num(sp.g, vars, vars.g ?? 10), T = num(sp.duration, vars, 1);
  const ropes = sp.ropes ?? [], rods = sp.rods ?? [], springs = sp.springs ?? [], surfs = sp.surfaces ?? [], forces = sp.forces ?? [];
  const P = new Map(sp.points.map((p) => [p.id, p]));
  const at = (x: Num | undefined, t: number, d = 0) => num(x, vars, d, t);
  const free = sp.points.filter((p) => !p.fixed);
  const unknownPos = sp.points.filter((p) => !p.at);
  for (const p of sp.points) if (p.fixed && !p.at) throw new Error(`静力平衡：固定点 ${p.id} 必须写 at`);

  /** 在时刻 t、给定松弛/分离集合下求平衡；guess 给未知位置和力的初值（连续扫描时用上一刻的解） */
  function solveAt(t: number, slack: Set<string>, off: Set<string>, guess?: State): State {
    const known: Record<string, Vec> = {}; for (const p of sp.points) if (p.at) known[p.id] = [at(p.at[0], t), at(p.at[1], t)];
    const unk: Unk[] = [];
    for (const p of unknownPos) unk.push({ kind: 'x', id: p.id }, { kind: 'y', id: p.id });
    for (const r of ropes) if (!slack.has(r.id)) unk.push({ kind: 'T', id: r.id });
    for (const r of rods) unk.push({ kind: 'F', id: r.id });
    for (const s of surfs) if (!off.has(s.id)) { unk.push({ kind: 'N', id: s.id }); if (s.mu !== undefined) unk.push({ kind: 'f', id: s.id }); }
    for (const f of forces) if (f.unknown) unk.push({ kind: 'mag', id: f.id });
    const nEq = free.length * 2 + ropes.filter((r) => r.length !== undefined && !slack.has(r.id)).length + rods.filter((r) => r.length !== undefined).length + surfs.filter((s) => s.through && !P.get(s.on)!.at && !off.has(s.id)).length;
    if (unk.length > nEq) throw new Error(`静力平衡：未知量 ${unk.length} 个（${unk.map((u) => `${u.kind}_${u.id}`).join('、')}）多于方程 ${nEq} 个，属于静不定或条件不够；请补充已知力、绳长或说明摩擦是否已达最大`);
    const z0 = unk.map((u) => {
      if (u.kind === 'x' || u.kind === 'y') { const gp = guess?.pos[u.id] ?? (P.get(u.id)!.guess ? [at(P.get(u.id)!.guess![0], t), at(P.get(u.id)!.guess![1], t)] as Vec : null); if (gp) return u.kind === 'x' ? gp[0] : gp[1]; const fx = Object.values(known); const cx = fx.reduce((s, p) => s + p[0], 0) / Math.max(1, fx.length), cy = fx.reduce((s, p) => s + p[1], 0) / Math.max(1, fx.length); return u.kind === 'x' ? cx + .01 : cy - 1; }
      const prev = guess ? (guess as unknown as Record<string, Record<string, number>>)[u.kind]?.[u.id] : undefined; return prev ?? 1;
    });
    const read = (z: number[]) => { const pos: Record<string, Vec> = { ...known }, val: Record<string, Record<string, number>> = { T: {}, F: {}, N: {}, f: {}, mag: {} };
      unk.forEach((u, i) => { if (u.kind === 'x') pos[u.id] = [z[i], pos[u.id]?.[1] ?? 0]; else if (u.kind === 'y') pos[u.id] = [pos[u.id]?.[0] ?? 0, z[i]]; else val[u.kind][u.id] = z[i]; });
      return { pos, val }; };
    const pathOf = (r: (typeof ropes)[number], pos: Record<string, Vec>): { pts: Vec[]; ids: (string | null)[] } => {
      const ids: (string | null)[] = [r.a, ...(r.via ?? []).map((v) => typeof v === 'string' ? v : null), r.b];
      const pts = [pos[r.a], ...(r.via ?? []).map((v) => typeof v === 'string' ? pos[v] : [at(v[0], t), at(v[1], t)] as Vec), pos[r.b]];
      return { pts, ids };
    };
    const resid = (z: number[]) => {
      const { pos, val } = read(z), F: Record<string, Vec> = {}; for (const p of free) F[p.id] = [0, -at(p.m, t) * g];
      const add = (id: string | null, v: Vec, k: number) => { if (id && F[id]) { F[id][0] += v[0] * k; F[id][1] += v[1] * k; } };
      for (const f of forces) { if (!F[f.on]) continue; if (f.F) add(f.on, [at(f.F[0], t), at(f.F[1], t)], 1); else { const d = at(f.dir, t) * deg, m = f.unknown ? val.mag[f.id] : at(f.mag, t); add(f.on, [Math.cos(d), Math.sin(d)], m); } }
      const eq: number[] = [];
      for (const r of ropes) { if (slack.has(r.id)) continue; const { pts, ids } = pathOf(r, pos), Tn = val.T[r.id];
        for (let i = 0; i < pts.length; i++) { if (i > 0) add(ids[i], unit(pts[i], pts[i - 1]), Tn); if (i < pts.length - 1) add(ids[i], unit(pts[i], pts[i + 1]), Tn); }
        if (r.length !== undefined) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); eq.push(L - at(r.length, t)); } }
      for (const r of rods) { const a = pos[r.a], b = pos[r.b], u = unit(a, b), Fr = val.F[r.id]; add(r.a, u, Fr); add(r.b, u, -Fr); if (r.length !== undefined) eq.push(Math.hypot(b[0] - a[0], b[1] - a[1]) - at(r.length, t)); }
      for (const s of springs) { const a = pos[s.a], b = pos[s.b], u = unit(a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]), Fs = at(s.k, t) * (L - at(s.L0, t)); add(s.a, u, Fs); add(s.b, u, -Fs); }
      for (const s of surfs) { if (off.has(s.id)) continue; const [n, tg] = frameOf(s, t); add(s.on, n, val.N[s.id]); if (s.mu !== undefined) add(s.on, tg, val.f[s.id]);
        if (s.through && !P.get(s.on)!.at) { const p = pos[s.on], q: Vec = [at(s.through[0], t), at(s.through[1], t)]; eq.push(n[0] * (p[0] - q[0]) + n[1] * (p[1] - q[1])); } }
      return [...free.flatMap((p) => F[p.id]), ...eq];
    };
    // 阻尼最小二乘（位置已知时就是一次线性求解）
    let z = z0.slice(), r = resid(z), lam = 1e-9; const n = z.length, scale = Math.max(1, ...free.map((p) => at(p.m, t) * g), ...forces.map((f) => Math.abs(f.unknown ? 0 : at(f.mag, t, 0))));
    const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    let J: number[][] = [];
    for (let it = 0; it < 80; it++) {
      J = r.map(() => new Array(n).fill(0));
      for (let j = 0; j < n; j++) { const h = 1e-7 * Math.max(1, Math.abs(z[j])), zp = z.slice(), zm = z.slice(); zp[j] += h; zm[j] -= h; const rp = resid(zp), rm = resid(zm); for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h); }
      if (norm(r) < 1e-11 * scale) break;
      const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0) + (a === b ? lam : 0))), gv = Array.from({ length: n }, (_, a) => -J.reduce((s, row, i) => s + row[a] * r[i], 0));
      const dz = gauss(A, gv); if (!dz) { lam = Math.max(lam * 10, 1e-6); continue; }
      let step = 1, ok = false; const r0 = norm(r);
      for (let k = 0; k < 30; k++) { const zt = z.map((v, i) => v + dz[i] * step), rt = resid(zt); if (norm(rt) < r0 || norm(rt) < 1e-12 * scale) { z = zt; r = rt; ok = true; break; } step /= 2; }
      if (!ok) { lam = Math.max(lam * 10, 1e-6); if (lam > 1e6) break; } else lam = Math.max(lam / 10, 1e-12);
    }
    if (norm(r) > 1e-7 * scale) throw new Error(`静力平衡：t=${fixed(t, 4)} 时找不到平衡位置（残差 ${norm(r).toExponential(2)} N）；检查几何、绳长和受力，或者物体本来就不能静止`);
    if (rank(J) < n) throw new Error(`静力平衡：t=${fixed(t, 4)} 时未知力不能唯一确定（静不定），未知量：${unk.map((u) => `${u.kind}_${u.id}`).join('、')}；请补充已知力或去掉多余约束`);
    const { pos, val } = read(z);
    return { pos, T: val.T, F: val.F, N: val.N, f: val.f, mag: val.mag, slack: new Set(slack), off: new Set(off), slip: null };
  }
  const frameOf = (s: (typeof surfs)[number], t: number): [Vec, Vec] => {
    if (s.normal) { const nx = at(s.normal[0], t), ny = at(s.normal[1], t), L = Math.hypot(nx, ny) || 1; return [[nx / L, ny / L], [ny / L, -nx / L]]; }
    const a = at(s.angle, t) * deg; return [[-Math.sin(a), Math.cos(a)], [Math.cos(a), Math.sin(a)]];
  };
  /** 绳松弛、接触分离：去掉最负的那一个重解，直到所有绳张力 ≥ 0、支持力 ≥ 0；再查静摩擦 */
  function equilibrium(t: number, guess?: State, slack0?: Set<string>, off0?: Set<string>): State {
    const slack = new Set(slack0 ?? []), off = new Set(off0 ?? []);
    for (let k = 0; k < 2 * (ropes.length + surfs.length) + 2; k++) {
      let s: State;
      try { s = solveAt(t, slack, off, guess); }
      catch (e) {   // 给了绳长的绳可能其实是松的（两端距离不到绳长）：拉直的方案解不出来时，逐根试着让它松弛
        for (const r of ropes) if (r.length !== undefined && !slack.has(r.id)) { try { return equilibrium(t, guess, new Set([...slack, r.id]), off); } catch { /* 换下一根 */ } }
        throw e;
      }
      // 松弛的绳不能比绳长还远：给了绳长的松绳若两端已拉开超过绳长，说明它其实是绷紧的
      for (const r of ropes) if (r.length !== undefined && slack.has(r.id)) { const ids = [r.a, ...(r.via ?? []), r.b], line = ids.map((x) => typeof x === 'string' ? s.pos[x] : [at(x[0], t), at(x[1], t)] as Vec); let L = 0; for (let i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); if (L > at(r.length, t) * (1 + 1e-9) + 1e-12) throw new Error(`静力平衡：t=${fixed(t, 4)} 时绳 ${r.id} 松弛的方案不成立（两端距离超过绳长）`); }
      const tol = 1e-9 * Math.max(1, ...Object.values(s.T).map(Math.abs), ...Object.values(s.N).map(Math.abs));
      // 已经松弛的绳若两端距离又大于绳长……这里只处理张力符号；给了 length 的松弛绳不再约束
      let worst: { kind: 'rope' | 'surf'; id: string; v: number } | null = null;
      for (const [id, v] of Object.entries(s.T)) if (v < -tol && (!worst || v < worst.v)) worst = { kind: 'rope', id, v };
      for (const [id, v] of Object.entries(s.N)) if (v < -tol && (!worst || v < worst.v)) worst = { kind: 'surf', id, v };
      if (!worst) {
        for (const sf of surfs) if (sf.mu !== undefined && !off.has(sf.id) && Math.abs(s.f[sf.id]) > at(sf.mu, t) * s.N[sf.id] * (1 + 1e-9) + 1e-12) s.slip = sf.on;
        return s;
      }
      if (worst.kind === 'rope') slack.add(worst.id); else off.add(worst.id);
    }
    throw new Error(`静力平衡：t=${fixed(t, 4)} 时绳/接触的状态无法确定`);
  }

  // ---------- 按 t 扫描 ----------
  const N = 240, hist: { t: number; s: State }[] = [], marks: { t: number; label: string }[] = [];
  let last: State | undefined, Tend = T, slipAt: number | null = null;
  for (let i = 0; i <= N; i++) {
    const t = T * i / N, s = equilibrium(t, last);
    if (last) {
      for (const id of s.slack) if (!last.slack.has(id)) marks.push({ t, label: `${id} 松弛` });
      for (const id of last.slack) if (!s.slack.has(id)) marks.push({ t, label: `${id} 绷紧` });
      for (const id of s.off) if (!last.off.has(id)) marks.push({ t, label: `${surfs.find((x) => x.id === id)!.on} 离开 ${id}` });
    }
    if (s.slip) { if (i === 0) throw new Error(`静力平衡：一开始 ${s.slip} 受到的静摩擦就超过最大静摩擦，不能静止；检查 μ 或受力`); slipAt = t; marks.push({ t, label: `${s.slip} 开始滑动` }); Tend = t; hist.push({ t, s }); break; }
    hist.push({ t, s }); last = s;
  }
  const valsOf = (s: State, t = 0): Record<string, number> => {
    const v: Record<string, number> = {};
    for (const [id, x] of Object.entries(s.T)) v[`T_${id}`] = x; for (const r of ropes) if (s.slack.has(r.id)) v[`T_${r.id}`] = 0;
    for (const [id, x] of Object.entries(s.F)) v[`F_${id}`] = x;
    for (const sf of surfs) { v[`N_${sf.id}`] = s.off.has(sf.id) ? 0 : s.N[sf.id]; if (sf.mu !== undefined) v[`f_${sf.id}`] = s.off.has(sf.id) ? 0 : s.f[sf.id]; }
    for (const f of forces) v[`F_${f.id}`] = f.unknown ? s.mag[f.id] : f.F ? Math.hypot(at(f.F[0], t), at(f.F[1], t)) : at(f.mag, t);
    for (const [id, p] of Object.entries(s.pos)) { v[`x_${id}`] = p[0]; v[`y_${id}`] = p[1]; }
    for (const r of ropes) { const a = s.pos[r.a], nx = r.via?.length ? (typeof r.via[0] === 'string' ? s.pos[r.via[0]] : null) : s.pos[r.b]; if (nx) v[`ang_${r.id}`] = Math.atan2(nx[1] - a[1], nx[0] - a[0]) / deg; }
    for (const sp2 of springs) { const a = s.pos[sp2.a], b = s.pos[sp2.b], L = Math.hypot(b[0] - a[0], b[1] - a[1]); v[`L_${sp2.id}`] = L; v[`Fs_${sp2.id}`] = at(sp2.k, t) * (L - at(sp2.L0, t)); }
    return v;
  };
  // 力的极值节点：内部的局部最小/最大（三点抛物线细化时刻）
  if (hist.length > 4) {
    const series = Object.keys(valsOf(hist[0].s)).filter((k) => /^(T|F|N|f|Fs)_/.test(k));
    for (const k of series) {
      const ys = hist.map((h) => Math.abs(valsOf(h.s, h.t)[k] ?? 0)), lo = Math.min(...ys), hi = Math.max(...ys); if (hi - lo < 1e-6 * Math.max(1, hi)) continue;
      for (let i = 1; i < ys.length - 1; i++) {
        const a = ys[i - 1], b = ys[i], c = ys[i + 1], isMin = b < a && b <= c, isMax = b > a && b >= c; if (!isMin && !isMax) continue;
        const den = a - 2 * b + c, off = Math.abs(den) > 1e-18 ? .5 * (a - c) / den : 0, dt = hist[1].t - hist[0].t;
        marks.push({ t: Math.min(Tend, Math.max(0, hist[i].t + off * dt)), label: `${k} ${isMin ? '最小' : '最大'}` });
      }
    }
  }
  // ---------- 画面 ----------
  const pts = hist.flatMap((h) => Object.values(h.s.pos)), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  for (const r of ropes) for (const v of r.via ?? []) if (typeof v !== 'string') { xs.push(at(v[0], 0)); ys.push(at(v[1], 0)); }
  const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys), size = Math.max(X1 - X0, Y1 - Y0, 1);
  let Fmax = 1e-12; for (const h of hist) { const s = h.s; for (const p of free) Fmax = Math.max(Fmax, at(p.m, h.t) * g); for (const x of [...Object.values(s.T), ...Object.values(s.F), ...Object.values(s.N), ...Object.values(s.f), ...Object.values(s.mag)]) Fmax = Math.max(Fmax, Math.abs(x)); }
  const Lmax = size * .32, kF = Lmax / Fmax, tri = sp.triangle ?? free.slice().sort((a, b) => forcesOn(b.id).length - forcesOn(a.id).length)[0]?.id;
  /** 某结点受的各个力（和画箭头的顺序一致），用于力三角形 */
  function forceVecs(s: State, t: number, id: string): Vec[] {
    const out: Vec[] = [], pos = s.pos, p = P.get(id)!; if (p.m) out.push([0, -at(p.m, t) * g]);
    for (const r of ropes) { if (s.slack.has(r.id)) continue; const ids = [r.a, ...(r.via ?? []), r.b], line = ids.map((x) => typeof x === 'string' ? pos[x] : [at(x[0], t), at(x[1], t)] as Vec); ids.forEach((x, i) => { if (x !== id) return; if (i > 0) out.push(scaleV(unit(line[i], line[i - 1]), s.T[r.id])); if (i < line.length - 1) out.push(scaleV(unit(line[i], line[i + 1]), s.T[r.id])); }); }
    for (const r of rods) { const u = unit(pos[r.a], pos[r.b]); if (r.a === id) out.push(scaleV(u, s.F[r.id])); if (r.b === id) out.push(scaleV(u, -s.F[r.id])); }
    for (const sf of surfs) if (sf.on === id && !s.off.has(sf.id)) { const [n, tg] = frameOf(sf, t); out.push(scaleV(n, s.N[sf.id])); if (sf.mu !== undefined) out.push(scaleV(tg, s.f[sf.id])); }
    for (const sp2 of springs) { const a = pos[sp2.a], b = pos[sp2.b], u = unit(a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]), Fs = at(sp2.k, t) * (L - at(sp2.L0, t)); if (sp2.a === id) out.push(scaleV(u, Fs)); if (sp2.b === id) out.push(scaleV(u, -Fs)); }
    for (const f of forces) if (f.on === id) out.push(f.F ? [at(f.F[0], t), at(f.F[1], t)] : scaleV([Math.cos(at(f.dir, t) * deg), Math.sin(at(f.dir, t) * deg)], f.unknown ? s.mag[f.id] : at(f.mag, t)));
    return out.filter((v) => Math.hypot(v[0], v[1]) > Fmax * 1e-6);
  }
  function forcesOn(id: string) { return [...ropes.filter((r) => r.a === id || r.b === id || r.via?.includes(id)), ...rods.filter((r) => r.a === id || r.b === id), ...surfs.filter((s) => s.on === id), ...forces.filter((f) => f.on === id)]; }
  const triX = X1 + size * .75, triY = (Y0 + Y1) / 2;
  // 会缓慢移动的固定点（绳端沿墙移动、绕圈）：画出走过的路径
  const moving = sp.points.filter((p) => p.fixed && hist.some((h) => Math.hypot(h.s.pos[p.id][0] - hist[0].s.pos[p.id][0], h.s.pos[p.id][1] - hist[0].s.pos[p.id][1]) > size * 1e-3)).map((p) => hist.map((h) => h.s.pos[p.id]));
  // 力三角形全程的外框（以“全程最大的力”为单位），用来居中
  const triBox = (() => { if (!tri) return { cx: 0, cy: 0, h: 0 }; let x0 = 0, x1 = 0, y0 = 0, y1 = 0; for (const h of hist) { let c: Vec = [0, 0]; for (const v of forceVecs(h.s, h.t, tri)) { c = [c[0] + v[0], c[1] + v[1]]; x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } } return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: y1 - y0 }; })();
  const view: [number, number, number, number] = [X0 - size * .45, Y0 - size * .55, (tri ? triX + size * .55 : X1 + size * .45), Y1 + size * .35];
  const fmt = (x: number) => Math.abs(x) >= 100 ? x.toPrecision(3) : fixed(x, 2);
  const blendState = (t: number) => { let i = 0; while (i < hist.length - 1 && hist[i + 1].t <= t) i++; return hist[i]; };
  const frame = (t: number) => {
    const tt = Math.min(t, Tend), h = blendState(tt), s = Math.abs(h.t - tt) < 1e-12 ? h.s : (() => { try { return equilibrium(tt, h.s, h.s.slack, h.s.off); } catch { return h.s; } })();
    const d: Prim[] = [], pos = s.pos, list: { at: string; v: Vec; c: string; s: string }[] = [];
    const ang = (v: Vec) => Math.atan2(v[1], v[0]);
    for (const sf of surfs) { const [n, tg] = frameOf(sf, tt), p = pos[sf.on], L = size * .45, a: Vec = [p[0] - tg[0] * L / 2, p[1] - tg[1] * L / 2], b: Vec = [p[0] + tg[0] * L / 2, p[1] + tg[1] * L / 2];
      d.push({ k: 'line', p: [a, b], c: ink, w: 2.2 }); for (let i = 0; i <= 8; i++) { const q: Vec = [a[0] + (b[0] - a[0]) * i / 8, a[1] + (b[1] - a[1]) * i / 8]; d.push({ k: 'line', p: [q, [q[0] - n[0] * size * .03 - tg[0] * size * .02, q[1] - n[1] * size * .03 - tg[1] * size * .02]], c: ink, w: 1 }); } void ang; }
    for (const r of ropes) { const ids = [r.a, ...(r.via ?? []), r.b], line = ids.map((x) => typeof x === 'string' ? pos[x] : [at(x[0], tt), at(x[1], tt)] as Vec);
      d.push({ k: 'line', p: line, c: s.slack.has(r.id) ? '#9aa39e' : ink, w: 1.6, dash: s.slack.has(r.id) ? [5, 4] : undefined });
      for (const v of r.via ?? []) if (typeof v !== 'string') d.push({ k: 'circle', at: [at(v[0], tt), at(v[1], tt)], rp: 9, c: ink, fill: '#dfe6e6', w: 1.4 }); }
    for (const r of rods) { d.push({ k: 'line', p: [pos[r.a], pos[r.b]], c: '#8a5a24', w: 5 }); for (const e of [r.a, r.b]) d.push({ k: 'circle', at: pos[e], rp: 3.5, fill: '#fff', c: ink, w: 1.2 }); }
    for (const sp2 of springs) { const a = pos[sp2.a], b = pos[sp2.b], u = unit(a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]), nrm: Vec = [-u[1], u[0]], zz: number[][] = [a]; for (let i = 1; i < 12; i++) { const q = i / 12, w = (i % 2 ? 1 : -1) * size * .025; zz.push([a[0] + u[0] * L * q + nrm[0] * w, a[1] + u[1] * L * q + nrm[1] * w]); } zz.push(b); d.push({ k: 'line', p: zz, c: ink, w: 1.4 }); }
    for (const p of sp.points) { const q = pos[p.id]; if (!q) continue;
      if (p.fixed) {   // 固定点：墙面/天花板画在连着的绳、杆的反方向一侧（铰在墙上就画竖墙，挂在天花板就画横线）
        let mx = 0, my = 0; for (const r of [...ropes, ...rods, ...springs]) { const other = r.a === p.id ? r.b : r.b === p.id ? r.a : null; const via = (r as { via?: (string | P2)[] }).via; const nb = other === null ? null : via?.length ? (r.a === p.id ? via[0] : via[via.length - 1]) : other; const o = nb === null ? null : typeof nb === 'string' ? pos[nb] : [at(nb[0], tt), at(nb[1], tt)] as Vec; if (o) { const u = unit(q, o); mx += u[0]; my += u[1]; } }
        const L = Math.hypot(mx, my); let n: Vec = L > 1e-6 ? [-mx / L, -my / L] : [0, 1]; n = Math.abs(n[0]) > Math.abs(n[1]) ? [Math.sign(n[0]), 0] : [0, Math.sign(n[1]) || 1];
        const tg: Vec = [-n[1], n[0]], w = size * .05; d.push({ k: 'circle', at: q, rp: 3.5, fill: ink }); d.push({ k: 'line', p: [[q[0] - tg[0] * w, q[1] - tg[1] * w], [q[0] + tg[0] * w, q[1] + tg[1] * w]], c: ink, w: 2 });
        for (let i = 0; i < 5; i++) { const b: Vec = [q[0] + tg[0] * (-w + i * w / 2), q[1] + tg[1] * (-w + i * w / 2)]; d.push({ k: 'line', p: [b, [b[0] + n[0] * size * .025 + tg[0] * size * .02, b[1] + n[1] * size * .025 + tg[1] * size * .02]], c: ink, w: 1 }); } }
      else if ((p.look ?? (p.m ? 'block' : 'knot')) === 'block') { const w = size * .06; d.push({ k: 'rect', x0: q[0] - w, y0: q[1] - w, x1: q[0] + w, y1: q[1] + w, fill: '#3d7fb8', c: ink, w: 1.4 }); }
      else if (p.look === 'ball') d.push({ k: 'circle', at: q, rp: 9, fill: '#c8473b', c: ink, w: 1.4 });
      else d.push({ k: 'circle', at: q, rp: p.look === 'ring' ? 5 : 3.5, fill: p.look === 'ring' ? '#fff' : ink, c: ink, w: 1.4 });
      d.push({ k: 'text', at: q, s: p.id, c: ink, size: 14, bold: true, dx: 12, dy: -12 }); }
    // 受力箭头：从结点画出，长度和力的大小成正比（同一比例，矢量三角形才首尾相接）
    const put = (id: string, v: Vec, c: string, lab: string) => { if (Math.hypot(v[0], v[1]) > Fmax * 1e-6) list.push({ at: id, v, c, s: lab }); };
    for (const p of free) { const m = at(p.m, tt); if (m) put(p.id, [0, -m * g], amber, `G = ${fmt(m * g)} N`); }
    for (const r of ropes) { if (s.slack.has(r.id)) continue; const ids = [r.a, ...(r.via ?? []), r.b], line = ids.map((x) => typeof x === 'string' ? pos[x] : [at(x[0], tt), at(x[1], tt)] as Vec);
      ids.forEach((x, i) => { if (typeof x !== 'string' || !free.some((p) => p.id === x)) return; const lab = `T(${r.id}) = ${fmt(s.T[r.id])} N`; if (i > 0) put(x, scaleV(unit(line[i], line[i - 1]), s.T[r.id]), blue, lab); if (i < line.length - 1) put(x, scaleV(unit(line[i], line[i + 1]), s.T[r.id]), blue, lab); }); }
    for (const r of rods) { const u = unit(pos[r.a], pos[r.b]), lab = `F(${r.id}) = ${fmt(Math.abs(s.F[r.id]))} N（${s.F[r.id] >= 0 ? '拉' : '压'}）`; if (free.some((p) => p.id === r.a)) put(r.a, scaleV(u, s.F[r.id]), '#8a5a24', lab); if (free.some((p) => p.id === r.b)) put(r.b, scaleV(u, -s.F[r.id]), '#8a5a24', lab); }
    for (const sf of surfs) { if (s.off.has(sf.id)) continue; const [n, tg] = frameOf(sf, tt); put(sf.on, scaleV(n, s.N[sf.id]), green, `N(${sf.id}) = ${fmt(s.N[sf.id])} N`); if (sf.mu !== undefined) put(sf.on, scaleV(tg, s.f[sf.id]), violet, `f = ${fmt(Math.abs(s.f[sf.id]))} N`); }
    for (const sp2 of springs) { const a = pos[sp2.a], b = pos[sp2.b], u = unit(a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]), Fs = at(sp2.k, tt) * (L - at(sp2.L0, tt)); if (free.some((p) => p.id === sp2.a)) put(sp2.a, scaleV(u, Fs), '#556', `F弹 = ${fmt(Math.abs(Fs))} N`); if (free.some((p) => p.id === sp2.b)) put(sp2.b, scaleV(u, -Fs), '#556', `F弹 = ${fmt(Math.abs(Fs))} N`); }
    for (const f of forces) { if (!free.some((p) => p.id === f.on)) continue; const v: Vec = f.F ? [at(f.F[0], tt), at(f.F[1], tt)] : scaleV([Math.cos(at(f.dir, tt) * deg), Math.sin(at(f.dir, tt) * deg)], f.unknown ? s.mag[f.id] : at(f.mag, tt)); put(f.on, v, red, `F(${f.id}) = ${fmt(Math.hypot(v[0], v[1]))} N`); }
    for (const a of list) { const p = pos[a.at]; d.push({ k: 'line', p: [p, [p[0] + a.v[0] * kF, p[1] + a.v[1] * kF]], c: a.c, w: 2.4, arrow: true }); d.push({ k: 'text', at: [p[0] + a.v[0] * kF, p[1] + a.v[1] * kF], s: a.s, c: a.c, size: 12.5, dx: a.v[0] >= 0 ? 6 : -6, dy: a.v[1] > 0 ? -6 : 14, align: a.v[0] >= 0 ? 'left' : 'right' }); }
    // 力的矢量三角形（图解法）：同一比例首尾相接，平衡时回到起点
    // 三角形只看形状：单独放大（全程最大的力约占画面高度的 0.6 倍），按全程外框居中，播放时位置不跳
    if (tri) { const own = list.filter((a) => a.at === tri);
      if (own.length >= 2) { const kT = size * .6 / Fmax; let c: Vec = [triX - triBox.cx * kT, triY - triBox.cy * kT];
        d.push({ k: 'text', at: [triX, triY + triBox.h * kT / 2 + size * .12], s: `${tri} 的力三角形`, c: soft, size: 12.5, align: 'center' });
        for (const a of own) { const e: Vec = [c[0] + a.v[0] * kT, c[1] + a.v[1] * kT]; d.push({ k: 'line', p: [c, e], c: a.c, w: 2.2, arrow: true }); d.push({ k: 'text', at: [(c[0] + e[0]) / 2, (c[1] + e[1]) / 2], s: a.s.split(' = ')[0], c: a.c, size: 12, dx: 8 }); c = e; } } }
    for (const pth of moving) d.push({ k: 'line', p: pth, c: '#9aa39e', w: 1.2, dash: [4, 4] });
    return { draw: d, vals: valsOf(s, tt) };
  };
  const plotKey = sp.plot?.y ?? (T > 0 && hist.length > 4 ? Object.keys(valsOf(hist[0].s)).find((k) => /^(T|F|N)_/.test(k) && hist.some((h) => Math.abs((valsOf(h.s)[k] ?? 0) - (valsOf(hist[0].s)[k] ?? 0)) > 1e-9)) : undefined);
  const plot = plotKey ? { x: 't', y: plotKey, pts: hist.map((h) => [h.t, valsOf(h.s, h.t)[plotKey] ?? 0, h.t] as [number, number, number]) } : undefined;
  void slipAt;
  return { name: '受力平衡', T: Tend > 0 ? Tend : 1e-9, view, frame, marks: marks.sort((a, b) => a.t - b.t), plot, n: 240 };
}
const scaleV = (v: Vec, k: number): Vec => [v[0] * k, v[1] * k];
function gauss(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; if (Math.abs(M[p][c]) < 1e-300) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => r[n] / r[i]);
}
/** 列满秩判断（相对容差）：未知力能不能唯一确定 */
function rank(J: number[][]): number {
  if (!J.length) return 0; const M = J.map((r) => r.slice()), m = M.length, n = M[0].length, big = Math.max(1e-300, ...M.flat().map(Math.abs)); let rk = 0;
  for (let c = 0; c < n && rk < m; c++) { let p = rk; for (let r = rk + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; if (Math.abs(M[p][c]) < 1e-9 * big) continue; [M[rk], M[p]] = [M[p], M[rk]];
    for (let r = rk + 1; r < m; r++) { const f = M[r][c] / M[rk][c]; for (let k = c; k < n; k++) M[r][k] -= f * M[rk][k]; } rk++; }
  return rk;
}
