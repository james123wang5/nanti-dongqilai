// 实验室：电磁感应、光路、气体等各写一个小模块。每个模块自己做物理计算，把这一刻的画面（图元）和物理量交出来。
// 图元用题目坐标；播放器只管按图元画，不懂具体物理。
import { evaluate } from '../expr.ts';
import type { Geo, Num, SimResult, Snapshot, EventRec } from '../sim.ts';

export type V = [number, number];
export type Prim =
  | { k: 'line'; p: number[][]; c?: string; w?: number; dash?: number[]; arrow?: boolean; close?: boolean; fill?: string; px?: boolean }
  | { k: 'circle'; at: number[]; r?: number; rp?: number; c?: string; fill?: string; w?: number; dash?: number[] }
  | { k: 'rect'; x0: number; y0: number; x1: number; y1: number; c?: string; fill?: string; w?: number; dash?: number[]; round?: number }
  | { k: 'text'; at: number[]; s: string; c?: string; size?: number; align?: 'left' | 'center' | 'right'; dy?: number; dx?: number; bold?: boolean }
  | { k: 'angle'; at: number[]; a0: number; a1: number; rp?: number; c?: string; s?: string }
  | { k: 'field'; x0: number; y0: number; x1: number; y1: number; B: number; c?: string; poly?: number[][]; circle?: number[] }   // 磁场符号：B>0 点（向外），B<0 叉（向里）
  | { k: 'efield'; magnetic?: boolean; x0: number; y0: number; x1: number; y1: number; E: number[]; poly?: number[][]; circle?: number[] };

export type LabFrame = { draw: Prim[]; vals: Record<string, number> };
export type LabPlot = { x: string; y: string; pts: [number, number, number][] };
export type LabPath = { c: string; w?: number; dash?: number[]; pts: number[][] };   // pts: [x, y, t]，播放到哪画到哪
export type LabOut = { stat?: Prim[]; paths?: LabPath[]; name: string; T: number; view: [number, number, number, number]; frame: (t: number) => LabFrame; marks?: { t: number; label: string }[]; plot?: LabPlot; n?: number; flat?: boolean };

export const ink = '#1a262a', soft = '#7c8680', blue = '#1c5fc4', red = '#b5302a', amber = '#c9711a', green = '#1b7a5b', violet = '#6d4bb5', glass = '#bcd7e6';
export const num = (x: Num | undefined, vars: Record<string, number>, d = 0, t?: number) => x === undefined ? d : evaluate(x, { vars: t === undefined ? vars : { ...vars, t } });
export const fixed = (x: number, n = 2) => { const r = Number(x.toFixed(n)); return String(Object.is(r, -0) ? 0 : r); };

/** 记录之间线性插值：数组和数字都按比例混合，保证任意时刻的量连续 */
export function blend<T extends { t: number }>(hist: T[], t: number): T {
  let lo = 0, hi = hist.length - 1; if (t <= hist[0].t) return hist[0]; if (t >= hist[hi].t) return hist[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (hist[m].t <= t) lo = m; else hi = m; }
  const a = hist[lo], b = hist[hi], f = (t - a.t) / (b.t - a.t || 1), out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) { const w = (b as Record<string, unknown>)[k]; out[k] = typeof v === 'number' ? v + ((w as number) - v) * f : Array.isArray(v) ? v.map((x: number, i: number) => x + ((w as number[])[i] - x) * f) : v; }
  return out as T;
}
/** 实验室的结果可以取任意时刻的精确快照；它不随结果序列化，只在求解时用 */
export const exactSnap = new WeakMap<SimResult, (t: number) => Snapshot>();
export function labResult(out: LabOut, opt: { sample?: number; times?: number[] } = {}): SimResult {
  const T = out.T, n = out.n ?? 240, step = opt.sample || T / n;
  const snap = (t: number): Snapshot => { const f = out.frame(t); return { t, bodies: {}, heat: {}, path: {}, counts: {}, springs: {}, draw: f.draw, vals: f.vals }; };
  const samples: Snapshot[] = []; for (let t = 0; t < T - 1e-12; t += step) samples.push(snap(t));
  const start = snap(0), end = snap(T);
  const events: EventRec[] = [{ type: 'start', a: '', t: 0, snap: start },
    ...(out.marks ?? []).map((m) => ({ type: 'mark', a: m.label, b: m.label, t: m.t, snap: snap(m.t) })),
    ...(opt.times ?? []).map((t) => ({ type: 'time', a: '', t, snap: snap(t) })),
    { type: 'end', a: '', t: T, snap: end }].sort((a, b) => a.t - b.t);
  const geo: Geo = { surfaces: [], bodies: [] };
  const r = { events, stages: [{ t0: 0, t1: T, modes: [], acc: {} }], samples, start, end, geo, board: { name: out.name, view: out.view, plot: out.plot, flat: out.flat, stat: out.stat, paths: out.paths } } as unknown as SimResult;
  exactSnap.set(r, snap); return r;
}
