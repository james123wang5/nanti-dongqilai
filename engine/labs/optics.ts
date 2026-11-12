// 几何光学：真实光线追踪。介质是多边形或圆，光线在界面按折射定律走，超过临界角全反射。
import { type LabOut, type Prim, type V, num, fixed, ink, soft, red, blue, glass, amber } from './common.ts';
import type { Num } from '../sim.ts';

export type OpticsSpec = {
  n0?: Num; duration?: Num;
  media: { id: string; n: Num; poly?: [Num, Num][]; circle?: [Num, Num, Num]; arc?: { center: [Num, Num]; radius: Num; from: Num; to: Num } }[];
  mirrors?: { id?: string; from: [Num, Num]; to: [Num, Num] }[];
  rays: { id: string; from: [Num, Num]; dir: Num | [Num, Num]; color?: string; n?: Num }[];   // dir 是角度（度，可含 t）或方向向量
  screens?: { id: string; from: [Num, Num]; to: [Num, Num] }[];
};
type Edge = { a: V; b: V; mirror?: boolean; screen?: string; circle?: { c: V; R: number; a0?: number; a1?: number } };
type Med = { id: string; n: number; poly?: V[]; circle?: [number, number, number]; arc?: { c: V; R: number; a0: number; a1: number } };

const inPoly = (p: V, q: V[]) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i][1] > p[1]) !== (q[j][1] > p[1]) && p[0] < (q[j][0] - q[i][0]) * (p[1] - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) c = !c; return c; };
const inside = (m: Med, p: V) => m.poly ? inPoly(p, m.poly) : m.circle ? Math.hypot(p[0] - m.circle[0], p[1] - m.circle[1]) < m.circle[2] : false;
const norm = (v: V): V => { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };

export function optics(sp: OpticsSpec, vars: Record<string, number>): LabOut {
  const n0 = num(sp.n0, vars, 1), T = num(sp.duration, vars, 6), C = vars.c ?? 3e8;
  const media: Med[] = sp.media.map((m) => {
    if (m.arc) {   // 半圆形玻璃砖：圆弧加直径，转成多边形
      const c: V = [num(m.arc.center[0], vars), num(m.arc.center[1], vars)], R = num(m.arc.radius, vars), a0 = num(m.arc.from, vars) * Math.PI / 180, a1 = num(m.arc.to, vars) * Math.PI / 180, N = 180;
      return { id: m.id, n: num(m.n, vars), poly: Array.from({ length: N + 1 }, (_, i) => [c[0] + R * Math.cos(a0 + (a1 - a0) * i / N), c[1] + R * Math.sin(a0 + (a1 - a0) * i / N)] as V), arc: { c, R, a0, a1 } };
    }
    return { id: m.id, n: num(m.n, vars), poly: m.poly?.map((p) => [num(p[0], vars), num(p[1], vars)] as V), circle: m.circle ? [num(m.circle[0], vars), num(m.circle[1], vars), num(m.circle[2], vars)] : undefined };
  });
  const edges: Edge[] = [];
  for (const m of media) {
    if (m.poly) m.poly.forEach((p, i) => { const q = m.poly![(i + 1) % m.poly!.length]; edges.push({ a: p, b: q, ...(m.arc && i < m.poly!.length - 1 ? { circle: { c: m.arc.c, R: m.arc.R } } : {}) }); });
    if (m.circle) edges.push({ a: [0, 0], b: [0, 0], circle: { c: [m.circle[0], m.circle[1]], R: m.circle[2] } });
  }
  for (const m of sp.mirrors ?? []) edges.push({ a: [num(m.from[0], vars), num(m.from[1], vars)], b: [num(m.to[0], vars), num(m.to[1], vars)], mirror: true });
  for (const s of sp.screens ?? []) edges.push({ a: [num(s.from[0], vars), num(s.from[1], vars)], b: [num(s.to[0], vars), num(s.to[1], vars)], screen: s.id });
  const nAt = (p: V, own?: number) => { let n = n0; for (const m of media) if (inside(m, p)) n = m.n; return own && n !== n0 ? own : n; };
  const hit = (o: V, d: V) => {
    let best: { s: number; p: V; nrm: V; e: Edge } | null = null;
    for (const e of edges) {
      if (e.circle && !media.some((m) => m.arc)) {
        const c = e.circle, ox = o[0] - c.c[0], oy = o[1] - c.c[1], B = ox * d[0] + oy * d[1], D = B * B - (ox * ox + oy * oy - c.R ** 2); if (D < 0) continue;
        for (const s of [-B - Math.sqrt(D), -B + Math.sqrt(D)]) if (s > 1e-9 && (!best || s < best.s)) { const p: V = [o[0] + d[0] * s, o[1] + d[1] * s]; best = { s, p, nrm: norm([p[0] - c.c[0], p[1] - c.c[1]]), e }; }
        continue;
      }
      const ex = e.b[0] - e.a[0], ey = e.b[1] - e.a[1], den = d[0] * ey - d[1] * ex; if (Math.abs(den) < 1e-14) continue;
      const s = ((e.a[0] - o[0]) * ey - (e.a[1] - o[1]) * ex) / den, u = ((e.a[0] - o[0]) * d[1] - (e.a[1] - o[1]) * d[0]) / den;
      if (s > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && (!best || s < best.s)) { const p: V = [o[0] + d[0] * s, o[1] + d[1] * s]; best = { s, p, nrm: e.circle ? norm([p[0] - e.circle.c[0], p[1] - e.circle.c[1]]) : norm([-ey, ex]), e }; }
    }
    return best;
  };
  type Seg = { a: V; b: V; n: number; len: number; weak?: boolean };
  const trace = (o0: V, d0: V, own?: number) => {
    const segs: Seg[] = [], hits: { p: V; nrm: V; i: number; r: number | null; tir: boolean; d: V }[] = [];
    let o = o0, d = norm(d0), n1 = nAt([o[0] + d[0] * 1e-6, o[1] + d[1] * 1e-6], own), screen: { id: string; p: V } | undefined;
    for (let k = 0; k < 40; k++) {
      const h = hit(o, d);
      if (!h) { const L = 1e3; segs.push({ a: o, b: [o[0] + d[0] * L, o[1] + d[1] * L], n: n1, len: Infinity }); break; }
      segs.push({ a: o, b: h.p, n: n1, len: h.s });
      if (h.e.screen) { screen = { id: h.e.screen, p: h.p }; break; }
      let nn = h.nrm; if (nn[0] * d[0] + nn[1] * d[1] > 0) nn = [-nn[0], -nn[1]];
      const ci = -(nn[0] * d[0] + nn[1] * d[1]), i = Math.acos(Math.min(1, ci));
      const refl: V = [d[0] + 2 * ci * nn[0], d[1] + 2 * ci * nn[1]];
      if (h.e.mirror) { hits.push({ p: h.p, nrm: nn, i, r: i, tir: false, d }); o = h.p; d = refl; continue; }
      const n2 = nAt([h.p[0] + d[0] * 1e-6, h.p[1] + d[1] * 1e-6], own), eta = n1 / n2, k2 = 1 - eta * eta * (1 - ci * ci);
      if (k2 < 0) { hits.push({ p: h.p, nrm: nn, i, r: null, tir: true, d }); o = h.p; d = refl; continue; }
      const out: V = norm([eta * d[0] + (eta * ci - Math.sqrt(k2)) * nn[0], eta * d[1] + (eta * ci - Math.sqrt(k2)) * nn[1]]);
      hits.push({ p: h.p, nrm: nn, i, r: Math.asin(Math.min(1, eta * Math.sin(i))), tir: false, d }); o = h.p; d = out; n1 = n2;
    }
    return { segs, hits, screen };
  };
  const xs: number[] = [], ys: number[] = [];
  for (const m of media) { for (const p of m.poly ?? []) { xs.push(p[0]); ys.push(p[1]); } if (m.circle) { xs.push(m.circle[0] - m.circle[2], m.circle[0] + m.circle[2]); ys.push(m.circle[1] - m.circle[2], m.circle[1] + m.circle[2]); } }
  for (const e of edges) if (!e.circle) { xs.push(e.a[0], e.b[0]); ys.push(e.a[1], e.b[1]); }
  for (const r of sp.rays) { xs.push(num(r.from[0], vars, 0, 0)); ys.push(num(r.from[1], vars, 0, 0)); }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pad = Math.max(x1 - x0, y1 - y0, 1e-6) * .28, span = Math.max(x1 - x0, y1 - y0);
  const stat: Prim[] = [];
  for (const m of media) {
    if (m.poly) stat.push({ k: 'line', p: m.poly, close: true, fill: '#cfe4ee99', c: '#6f96aa', w: 1.6 });
    if (m.circle) stat.push({ k: 'circle', at: [m.circle[0], m.circle[1]], r: m.circle[2], fill: '#cfe4ee99', c: '#6f96aa', w: 1.6 });
    if (m.id.length <= 6) stat.push({ k: 'text', at: m.circle ? [m.circle[0], m.circle[1]] : [m.poly!.reduce((a, p) => a + p[0], 0) / m.poly!.length, m.poly!.reduce((a, p) => a + p[1], 0) / m.poly!.length], s: `${m.id}  n = ${fixed(m.n, 3)}`, c: '#4a6b7c', size: 14, dy: 20 });
  }
  for (const m of sp.mirrors ?? []) stat.push({ k: 'line', p: [[num(m.from[0], vars), num(m.from[1], vars)], [num(m.to[0], vars), num(m.to[1], vars)]], c: ink, w: 3.5 });
  for (const q of sp.screens ?? []) stat.push({ k: 'line', p: [[num(q.from[0], vars), num(q.from[1], vars)], [num(q.to[0], vars), num(q.to[1], vars)]], c: soft, w: 3 });
  const frame = (t: number) => {
    const u = T ? t / T : 0, draw: Prim[] = [], vals: Record<string, number> = { n0 };
    for (const m of media) vals[`n_${m.id}`] = m.n;
    for (const r of sp.rays) {
      const o: V = [num(r.from[0], vars, 0, t), num(r.from[1], vars, 0, t)];
      const d: V = Array.isArray(r.dir) ? [num(r.dir[0], vars, 0, t), num(r.dir[1], vars, 0, t)] : [Math.cos(num(r.dir, vars, 0, t) * Math.PI / 180), Math.sin(num(r.dir, vars, 0, t) * Math.PI / 180)];
      const tr = trace(o, d, r.n !== undefined ? num(r.n, vars) : undefined), color = r.color ?? red;
      let total = 0, inMedium = 0, time = 0; const finite = tr.segs.filter((s) => Number.isFinite(s.len));
      for (const s of finite) { total += s.len; time += s.len * s.n / C; if (s.n !== n0) inMedium += s.len; }
      // 光脉冲：前面先走完，再把全路径留下，学生看得到光走到哪了
      const show = Math.min(1, u * 1.35) * (total + span * .9); let left = show;
      for (const s of tr.segs) {
        if (left <= 0) break;
        const L = Number.isFinite(s.len) ? s.len : span * .9, f = Math.min(1, left / L), dx = Number.isFinite(s.len) ? (s.b[0] - s.a[0]) / L : (s.b[0] - s.a[0]) / s.len * 1, dy = Number.isFinite(s.len) ? (s.b[1] - s.a[1]) / L : (s.b[1] - s.a[1]) / s.len * 1;
        const e: V = [s.a[0] + dx * L * f, s.a[1] + dy * L * f];
        draw.push({ k: 'line', p: [s.a, e], c: color, w: 2.2, arrow: f >= 1 || left < L });
        left -= L;
      }
      let done = 0; const hs = tr.hits;
      hs.forEach((h, i) => {
        const id = `${r.id}${i + 1}`; vals[`i_${id}`] = h.i * 180 / Math.PI; if (h.r !== null) vals[`r_${id}`] = h.r * 180 / Math.PI; vals[`tir_${id}`] = h.tir ? 1 : 0; vals[`x_${id}`] = h.p[0]; vals[`y_${id}`] = h.p[1];
        done += tr.segs[i].len;
        if (done > show) return;
        const L = span * .17, a: V = [h.p[0] - h.nrm[0] * L, h.p[1] - h.nrm[1] * L], b: V = [h.p[0] + h.nrm[0] * L, h.p[1] + h.nrm[1] * L];
        draw.push({ k: 'line', p: [b, a], c: soft, w: 1.2, dash: [5, 4] });
        const dIn = Math.atan2(-h.d[1], -h.d[0]), nIn = Math.atan2(-(-h.nrm[1]) * -1, -(-h.nrm[0]) * -1);
        draw.push({ k: 'angle', at: h.p, a0: dIn, a1: Math.atan2(h.nrm[1], h.nrm[0]), rp: 30, c: amber, s: `${fixed(h.i * 180 / Math.PI, 1)}°` });
        void nIn;
        if (h.tir) draw.push({ k: 'text', at: h.p, s: '全反射', c: red, size: 13, dy: -14, bold: true });
      });
      vals[`path_${r.id}`] = total; vals[`in_${r.id}`] = inMedium; vals[`time_${r.id}`] = time; vals[`hits_${r.id}`] = tr.hits.length;
      if (tr.screen) { vals[`x_${r.id}_${tr.screen.id}`] = tr.screen.p[0]; vals[`y_${r.id}_${tr.screen.id}`] = tr.screen.p[1]; }
      const last = tr.segs.at(-1); if (last) { vals[`exit_${r.id}`] = Math.atan2(last.b[1] - last.a[1], last.b[0] - last.a[0]) * 180 / Math.PI; }
    }
    for (const m of media) vals[`C_${m.id}`] = Math.asin(Math.min(1, n0 / m.n)) * 180 / Math.PI;
    return { draw, vals };
  };
  void blue; void glass;
  return { name: '光路', T, view: [x0 - pad, y0 - pad, x1 + pad, y1 + pad], frame, stat };
}
