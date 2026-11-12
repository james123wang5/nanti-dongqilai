// 连续区间内插值；事件时间同时保存左右极限，默认展示碰后值。
import type { Snapshot, SimResult, BodySnap } from '../engine/sim.ts';
import type { Prim } from '../engine/labs/common.ts';
export type TimelineFrame = { t: number; before: Snapshot; after: Snapshot };
const cache = new WeakMap<SimResult, TimelineFrame[]>();
export function timelineFrames(r: SimResult): TimelineFrame[] {
  const previous = cache.get(r); if (previous) return previous;
  const map = new Map<number, TimelineFrame>();
  for (const s of [r.start, ...r.samples, r.end]) map.set(s.t, { t: s.t, before: s, after: s });
  const eventTimes = new Set<number>();
  for (const e of r.events) {
    if (!eventTimes.has(e.t)) { map.set(e.t, { t: e.t, before: e.before ?? e.snap, after: e.after ?? e.snap }); eventTimes.add(e.t); }
    else map.get(e.t)!.after = e.after ?? e.snap;
  }
  const out = [...map.values()].sort((a, b) => a.t - b.t); cache.set(r, out); return out;
}
/** 相邻两帧的图元按比例混合：结构相同就连续过渡，所以 240 帧的结果也能 60 帧每秒地放 */
function mixDraw(a?: Prim[], b?: Prim[], k = 0): Prim[] | undefined {
  if (!a || !b || a.length !== b.length) return k < .5 ? a : b;
  const m = (x: number, y: number) => x + (y - x) * k;
  return a.map((p, i) => {
    const q = b[i] as Prim & Record<string, unknown>;
    if (q.k !== p.k) return k < .5 ? p : q;
    if (p.k === 'line') { const r = q as typeof p; return r.p.length === p.p.length ? { ...p, p: p.p.map((u, j) => [m(u[0], r.p[j][0]), m(u[1], r.p[j][1])]) } : k < .5 ? p : r; }
    if (p.k === 'circle') { const r = q as typeof p; return { ...p, at: [m(p.at[0], r.at[0]), m(p.at[1], r.at[1])], r: p.r === undefined ? undefined : m(p.r, r.r ?? p.r) }; }
    if (p.k === 'rect') { const r = q as typeof p; return { ...p, x0: m(p.x0, r.x0), y0: m(p.y0, r.y0), x1: m(p.x1, r.x1), y1: m(p.y1, r.y1) }; }
    if (p.k === 'text') { const r = q as typeof p; return { ...(k < .5 ? p : r), at: [m(p.at[0], r.at[0]), m(p.at[1], r.at[1])] }; }
    return k < .5 ? p : q;
  });
}
export function sampleAt(r: SimResult, t: number, side: 'before' | 'after' = 'after'): Snapshot {
  const frames = timelineFrames(r);
  let lo = 0, hi = frames.length - 1;
  if (t <= frames[0].t) return frames[0][side];
  if (t >= frames[hi].t) return frames[hi][side];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m].t <= t) lo = m; else hi = m; }
  if (t === frames[lo].t) return frames[lo][side];
  if (t === frames[hi].t) return frames[hi][side];
  const a = frames[lo].after, b = frames[hi].before, k = (t - a.t) / (b.t - a.t);
  const mix = (x: number, y: number) => x + (y - x) * k;
  const optional = (x?: number, y?: number) => x === undefined || y === undefined ? x : mix(x, y);
  const bodies: Record<string, BodySnap> = {};
  for (const [id, p] of Object.entries(a.bodies)) {
    const q = b.bodies[id] ?? p;   // 分裂瞬间前后物体集合不同：这一帧有、下一帧没有时按这一帧
    bodies[id] = { ...(k < .5 ? p : q), x: mix(p.x, q.x), y: mix(p.y, q.y), cx: mix(p.cx, q.cx), vx: mix(p.vx, q.vx), vy: mix(p.vy, q.vy), a: optional(p.a, q.a), s: optional(p.s, q.s), rel: optional(p.rel, q.rel) };
  }
  const record = (x: Record<string, number>, y: Record<string, number>) => Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((key) => [key, mix(x[key] ?? 0, y[key] ?? 0)]));
  const springs: Snapshot['springs'] = {};
  for (const [id, p] of Object.entries(a.springs)) { const q = b.springs[id]; springs[id] = { ...p, x: mix(p.x, q.x), F: mix(p.F, q.F), Ep: mix(p.Ep, q.Ep), endpoints: p.endpoints && q.endpoints ? p.endpoints.map((v, i) => v.map((x, j) => mix(x, q.endpoints![i][j])) as [number, number]) as [[number, number], [number, number]] : p.endpoints }; }
  for (const [id, p] of Object.entries(a.bodies)) if (p.z !== undefined) bodies[id].z = mix(p.z, b.bodies[id].z ?? p.z);
  return { t, bodies, springs, draw: mixDraw(a.draw, b.draw, k), vals: a.vals && b.vals ? record(a.vals, b.vals) : a.vals, ropes: a.ropes, script: k < .5 ? a.script : b.script, circuit: k < .5 ? a.circuit : b.circuit, heat: record(a.heat, b.heat), path: record(a.path, b.path), counts: { ...a.counts } };
}
/** 图表在事件时刻画竖直跳线；面积中竖直边的时间宽度为零。 */
export function chartSnapshots(r: SimResult, from: number, to: number): Snapshot[] {
  const out = [sampleAt(r, from)];
  for (const f of timelineFrames(r)) if (f.t > from && f.t <= to) { out.push(f.before); if (f.after !== f.before) out.push(f.after); }
  if (out.at(-1)!.t < to) out.push(sampleAt(r, to));
  return out;
}
