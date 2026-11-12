// 通用运动方程：其他模块装不下的题，由 AI 写状态量、变化率和“碰到什么就怎样”，引擎负责积分和找事件时刻。
// 这是最后的通用手段：方程是 AI 写的，积分和时序是引擎算的。
import { evaluate } from '../expr.ts';
import { type LabOut, type Prim, ink, soft, red, blue, amber, green } from './common.ts';
import type { Num } from '../sim.ts';

type P2 = [Num, Num];
type Shape = { point?: P2; label?: string; color?: string; size?: number; line?: P2[]; kind?: string; arrow?: [P2, P2]; rect?: [Num, Num, Num, Num]; circle?: [Num, Num, Num]; fill?: string; B?: Num; E?: P2; text?: P2; s?: string; trail?: P2; when?: Num; arc?: { center: P2; radius: Num; from: Num; to: Num } };
export type OdeSpec = {
  state: Record<string, Num>; rates: Record<string, Num>; vals?: Record<string, Num>;
  events?: { name?: string; when: Num; dir?: 1 | -1; set?: Record<string, Num>; stop?: boolean; once?: boolean }[];
  duration?: Num; steps?: number; draw: Shape[]; view: [Num, Num, Num, Num]; plot?: { x: string; y: string };
};
const colors: Record<string, string> = { v: blue, F: amber, red, blue, amber, green, ink, soft };
export function ode(sp: OdeSpec, vars: Record<string, number>): LabOut {
  const names = Object.keys(sp.state), T = evaluate(sp.duration ?? 10, { vars }), N = Math.max(2000, Math.min(200000, sp.steps ?? 40000)), h = T / N;
  const env = (s: number[], t: number, extra: Record<string, number> = {}) => { const v: Record<string, number> = { ...vars, t, ...extra }; names.forEach((k, i) => { v[k] = s[i]; }); return { vars: v }; };
  const derived = (s: number[], t: number) => { const d: Record<string, number> = {}; for (const [k, e] of Object.entries(sp.vals ?? {})) { const v = evaluate(e, env(s, t, d)); d[k] = v; } return d; };
  const f = (s: number[], t: number) => { const e = env(s, t, derived(s, t)); return names.map((k) => evaluate(sp.rates[k] ?? 0, e)); };
  const rk = (s: number[], t: number, dt: number) => { const add = (a: number[], b: number[], c: number) => a.map((x, i) => x + b[i] * c), k1 = f(s, t), k2 = f(add(s, k1, dt / 2), t + dt / 2), k3 = f(add(s, k2, dt / 2), t + dt / 2), k4 = f(add(s, k3, dt), t + dt); return s.map((x, i) => x + (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * dt / 6); };
  const ev = (sp.events ?? []).map((e) => ({ ...e, fired: 0 })), g = (e: typeof ev[number], s: number[], t: number) => evaluate(e.when, env(s, t, derived(s, t)));
  let s = names.map((k) => evaluate(sp.state[k], { vars })), t = 0, stop = false; const hist: { t: number; s: number[] }[] = [{ t, s }], marks: { t: number; label: string }[] = [], stride = Math.max(1, Math.floor(N / 2400));
  // 按时间推进：事件切步后，本步剩下的时间下一轮接着走，不会少算；总时长一定走满 T
  for (let i = 1; t < T - h * 1e-9 && !stop && i <= N * 4; i++) {
    const step = Math.min(h, T - t);
    let next = rk(s, t, step), dt = step, hit: typeof ev[number] | null = null;
    for (const e of ev) {
      if (e.once && e.fired) continue;
      const a = g(e, s, t), b = g(e, next, t + step);
      if (a === 0 || a * b > 0 || (e.dir && Math.sign(b - a) !== e.dir)) continue;
      let lo = 0, hi = step; for (let q = 0; q < 50; q++) { const m = (lo + hi) / 2, c = g(e, rk(s, t, m), t + m); if (c * a > 0) lo = m; else hi = m; }
      if (hi < dt || !hit) { dt = hi; hit = e; }
    }
    if (hit) next = rk(s, t, dt);
    s = next; t += dt;
    if (hit) {
      hit.fired++; if (hit.name) marks.push({ t, label: hit.name });
      if (hit.set) { hist.push({ t, s }); const e = env(s, t, derived(s, t)); const out = [...s]; for (const [k, x] of Object.entries(hit.set)) { const j = names.indexOf(k); if (j >= 0) out[j] = evaluate(x, e); } s = out; hist.push({ t, s }); }   // 突变前后各记一条，事件前的读数不会被插值成突变后的值
      if (hit.stop) stop = true;
    }
    if (i % stride === 0 || hit) hist.push({ t, s });
  }
  const end = t, at = (u: number) => { let lo = 0, hi = hist.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (hist[m].t <= u) lo = m; else hi = m; } const a = hist[lo], b = hist[hi], k = b.t > a.t ? Math.min(1, Math.max(0, (u - a.t) / (b.t - a.t))) : 1; return { s: a.s.map((x, i) => x + (b.s[i] - x) * k), lo }; };
  const view = sp.view.map((v) => evaluate(v, { vars })) as [number, number, number, number];
  const frame = (u: number) => {
    const uu = Math.min(u, end), r = at(uu), d = derived(r.s, uu), e = env(r.s, uu, d), n = (x: Num) => evaluate(x, e), draw: Prim[] = [], vals: Record<string, number> = { ...d, t: uu }; names.forEach((k, i) => { vals[k] = r.s[i]; });
    for (const q of sp.draw) {
      if (q.when !== undefined && n(q.when) < .5) continue;
      if (q.rect) { const [a, b, c, f2] = q.rect.map(n); draw.push({ k: 'rect', x0: a, y0: b, x1: c, y1: f2, fill: q.fill, c: q.color ?? ink, w: 1.5 }); }
      if (q.circle) { const [a, b, c] = q.circle.map(n); draw.push({ k: 'circle', at: [a, b], r: c, c: q.color ?? ink, w: 1.5, fill: q.fill }); }
      if (q.B !== undefined) { const b = q.rect ? q.rect.map(n) : view; draw.push({ k: 'field', x0: b[0], y0: b[1], x1: b[2], y1: b[3], B: n(q.B) }); }
      if (q.E) { const b = q.rect ? q.rect.map(n) : view; draw.push({ k: 'efield', x0: b[0], y0: b[1], x1: b[2], y1: b[3], E: q.E.map(n) }); }
      if (q.line) draw.push({ k: 'line', p: q.line.map((p) => [n(p[0]), n(p[1])]), c: colors[q.color ?? ''] ?? q.color ?? ink, w: q.kind === 'rod' ? 3.5 : q.kind === 'wall' ? 4 : 1.6, dash: q.kind === 'dash' ? [5, 4] : undefined });
      if (q.arc) { const c = q.arc.center.map(n), R = n(q.arc.radius), a0 = n(q.arc.from) * Math.PI / 180, a1 = n(q.arc.to) * Math.PI / 180; draw.push({ k: 'line', p: Array.from({ length: 65 }, (_, i) => [c[0] + R * Math.cos(a0 + (a1 - a0) * i / 64), c[1] + R * Math.sin(a0 + (a1 - a0) * i / 64)]), c: q.color ?? ink, w: 2 }); }
      if (q.arrow) { const a = q.arrow[0].map(n), b = q.arrow[1].map(n); draw.push({ k: 'line', p: [a, [a[0] + b[0], a[1] + b[1]]], c: colors[q.kind ?? q.color ?? 'v'] ?? blue, w: 2.4, arrow: true }); if (q.label) draw.push({ k: 'text', at: [a[0] + b[0], a[1] + b[1]], s: q.label, c: colors[q.kind ?? 'v'] ?? blue, size: 13, dy: -6 }); }
      if (q.point) { const p = q.point.map(n); if (q.kind === 'block') { const w = (q.size ?? 9); draw.push({ k: 'circle', at: p, rp: w, fill: colors[q.color ?? ''] ?? q.color ?? red, c: ink, w: 1.4 }); } else draw.push({ k: 'circle', at: p, rp: q.size ?? 8, fill: colors[q.color ?? ''] ?? q.color ?? red, c: ink, w: 1.4 }); if (q.label) draw.push({ k: 'text', at: p, s: q.label, c: ink, size: 14, dy: -(q.size ?? 8) - 6, bold: true }); }
      if (q.text) draw.push({ k: 'text', at: q.text.map(n), s: q.s ?? '', c: ink, size: 13 });
    }
    return { draw, vals };
  };
  let plot: LabOut['plot'];
  if (sp.plot) { const st = Math.max(1, Math.floor(hist.length / 400)); const val = (i: number, k: string) => { const q = hist[i], d = derived(q.s, q.t), e = env(q.s, q.t, d); return evaluate(k, e); }; plot = { x: sp.plot.x, y: sp.plot.y, pts: hist.filter((_, i) => i % st === 0).map((q, i) => [val(i * st, sp.plot!.x), val(i * st, sp.plot!.y), q.t]) }; }
  const paths = sp.draw.filter((q) => q.trail).map((q) => { const st = Math.max(1, Math.floor(hist.length / 900)); return { c: colors[q.color ?? ''] ?? q.color ?? soft, w: 1.6, dash: [5, 4], pts: hist.filter((_, i) => i % st === 0).map((h) => { const e = env(h.s, h.t, derived(h.s, h.t)); return [evaluate(q.trail![0], e), evaluate(q.trail![1], e), h.t]; }) }; });
  return { name: '运动方程', T: end, view, frame, marks, plot, paths };
}
