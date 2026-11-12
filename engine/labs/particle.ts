// 带电粒子：三维洛伦兹力积分（Boris 推进）。场区可以是矩形、圆、任意多边形或直线的一侧；挡板可吸收、可开孔。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber, green } from './common.ts';
import type { Num } from '../sim.ts';

type Reg = { x?: [Num, Num]; y?: [Num, Num] } | { center: [Num, Num]; radius: Num; half?: 'left' | 'right' | 'up' | 'down' } | { poly: [Num, Num][] } | { side: { from: [Num, Num]; to: [Num, Num] } };   // side：沿 from→to 的左侧
export type ParticleSpec = {
  g?: Num | [Num, Num] | [Num, Num, Num]; duration?: Num; view?: [Num, Num, Num, Num];
  fields: { id?: string; kind: 'B' | 'E' | 'Q'; B?: Num | [Num, Num, Num]; E?: [Num, Num, Num?]; Q?: Num; at?: [Num, Num]; region?: Reg; over?: boolean }[];   // over：这个区域里只算它，盖掉前面的场
  particles: { id: string; q: Num; m: Num; pos: [Num, Num, Num?]; vel: [Num, Num, Num?]; t0?: Num }[];   // t0：从这个时刻才开始运动
  walls?: { id?: string; from: [Num, Num]; to: [Num, Num]; reflect?: boolean; flip?: boolean; e?: Num; hole?: [Num, Num] }[];   // hole：沿挡板 from→to 的距离段；flip：碰后电性反转
  collisions?: { bodies: [string, string]; e?: Num; r?: Num }[];
  kicks?: { on: string; x?: Num; y?: Num; speed: Num; name?: string }[];   // 走到某位置时速率瞬间变成 speed（样品、薄膜）
};
type V3 = [number, number, number];
const inPoly = (x: number, y: number, q: number[][]) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i][1] > y) !== (q[j][1] > y) && x < (q[j][0] - q[i][0]) * (y - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) c = !c; return c; };
export function particle(sp: ParticleSpec, vars: Record<string, number>): LabOut {
  // g 写一个数是竖直向下的重力加速度；也接受向量 [gx,gy(,gz)]
  const G: [number, number, number] = Array.isArray(sp.g) ? [num(sp.g[0], vars), num(sp.g[1], vars), num(sp.g[2], vars, 0)] : [0, -num(sp.g, vars), 0], K = vars.k ?? 9e9;
  const clipOf = (r: Reg | undefined, big: number): number[][] | null => {
    if (!r) return null;
    if ('poly' in r) return r.poly.map((p) => [num(p[0], vars), num(p[1], vars)]);
    if ('side' in r) { const a = [num(r.side.from[0], vars), num(r.side.from[1], vars)], b = [num(r.side.to[0], vars), num(r.side.to[1], vars)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux; return [[a[0] - ux * big, a[1] - uy * big], [b[0] + ux * big, b[1] + uy * big], [b[0] + ux * big + nx * big, b[1] + uy * big + ny * big], [a[0] - ux * big + nx * big, a[1] - uy * big + ny * big]]; }
    if ('center' in r) return null;
    const x = r.x ? [num(r.x[0], vars), num(r.x[1], vars)] : [-big, big], y = r.y ? [num(r.y[0], vars), num(r.y[1], vars)] : [-big, big];
    return [[x[0], y[0]], [x[1], y[0]], [x[1], y[1]], [x[0], y[1]]];
  };
  const F = sp.fields.map((f, i) => {
    const r = f.region; let circle = r && 'center' in r ? [num(r.center[0], vars), num(r.center[1], vars), num(r.radius, vars)] : null, poly = clipOf(r, 1e7);
    if (circle && r && 'half' in r && r.half) { const a0 = { right: -90, left: 90, up: 0, down: 180 }[r.half] * Math.PI / 180, [cx, cy, R] = circle; poly = Array.from({ length: 61 }, (_, i) => [cx + R * Math.cos(a0 + Math.PI * i / 60), cy + R * Math.sin(a0 + Math.PI * i / 60)]); circle = null; }
    const name = f.id ?? `${f.kind}${i + 1}`;
    return { ...f, name, circle, poly, at: f.at ? [num(f.at[0], vars), num(f.at[1], vars)] : null };
  });
  const inside = (f: typeof F[number], x: number, y: number) => f.circle ? Math.hypot(x - f.circle[0], y - f.circle[1]) <= f.circle[2] : f.poly ? inPoly(x, y, f.poly) : true;
  const field = (x: number, y: number, z: number, t: number) => {
    const E: V3 = [0, 0, 0], B: V3 = [0, 0, 0];
    for (const f of F) {
      if (!inside(f, x, y)) continue;
      if (f.over) { E.fill(0); B.fill(0); }
      const e = { ...vars, t, x, y };
      if (f.kind === 'B') { if (Array.isArray(f.B)) { B[0] += num(f.B[0], e); B[1] += num(f.B[1], e); B[2] += num(f.B[2], e); } else B[2] += num(f.B, e); }
      else if (f.kind === 'E') { E[0] += num(f.E![0], e); E[1] += num(f.E![1], e); E[2] += num(f.E![2], e); }
      else { const dx = x - f.at![0], dy = y - f.at![1], r = Math.hypot(dx, dy, z) + 1e-30, c = K * num(f.Q, e) / r ** 3; E[0] += c * dx; E[1] += c * dy; E[2] += c * z; }
    }
    return { E, B };
  };
  const walls = (sp.walls ?? []).map((w) => ({ id: w.id, a: [num(w.from[0], vars), num(w.from[1], vars)], b: [num(w.to[0], vars), num(w.to[1], vars)], reflect: !!w.reflect, flip: !!w.flip, e: num(w.e, vars, 1), hole: w.hole ? [num(w.hole[0], vars), num(w.hole[1], vars)] : null }));
  // 时长：缺省取最小回旋周期的若干倍
  const Ps = sp.particles.map((p) => ({ t0: num(p.t0, vars), id: p.id, q: num(p.q, vars), m: num(p.m, vars), p: [num(p.pos[0], vars), num(p.pos[1], vars), num(p.pos[2], vars)] as V3, v: [num(p.vel[0], vars), num(p.vel[1], vars), num(p.vel[2], vars)] as V3 }));
  let Bmax = 0; for (const f of F) if (f.kind === 'B') Bmax = Math.max(Bmax, Math.abs(Array.isArray(f.B) ? Math.hypot(num(f.B[0], vars, 0, 0), num(f.B[1], vars, 0, 0), num(f.B[2], vars, 0, 0)) : num(f.B, vars, 0, 0)));
  const Tc = Bmax ? Math.min(...Ps.map((p) => 2 * Math.PI * p.m / (Math.abs(p.q) * Bmax))) : 0, T = sp.duration !== undefined ? num(sp.duration, vars) : Tc ? 3 * Tc : 10;
  const N = Math.min(240000, Math.max(8000, Math.ceil(T / (Tc ? Tc / 10000 : T / 8000)))), h = T / N, every = Math.max(1, Math.floor(N / 8000));
  const marks: { t: number; label: string }[] = [];
  type Rec = { t: number; p: V3; v: V3; alive: boolean; q: number };
  const hist = Ps.map(() => [] as Rec[]), passes = Ps.map(() => [0] as number[]);
  const live = Ps.map((P) => ({ p: [...P.p] as V3, v: [...P.v] as V3, q: P.q, alive: true, was: F.map((f) => inside(f, P.p[0], P.p[1])) }));
  live.forEach((L, i) => hist[i].push({ t: 0, p: [...L.p], v: [...L.v], alive: true, q: L.q }));
  const pairs = (sp.collisions ?? []).map((c) => ({ a: Ps.findIndex((P) => P.id === c.bodies[0]), b: Ps.findIndex((P) => P.id === c.bodies[1]), e: num(c.e, vars, 1), r: num(c.r, vars, 0), last: -Infinity }));
  const kicks = (sp.kicks ?? []).map((k) => ({ i: Ps.findIndex((P) => P.id === k.on), x: k.x === undefined ? undefined : num(k.x, vars), y: k.y === undefined ? undefined : num(k.y, vars), speed: num(k.speed, vars), name: k.name, done: false }));
  const cross = (u: V3, w: V3): V3 => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], lerp = (a: V3, b: V3, f: number): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  const scale = Math.max(...Ps.map((P) => Math.hypot(...P.v))) * T * .002 || 1e-3;
  let t = 0;
  for (let n = 1; n <= N; n++) {
    live.forEach((L, i) => {
      const P = Ps[i]; if (!L.alive || t < P.t0) return;
      // 一步之内碰到场区边界或挡板，就在交点处切开，交点之后按新的场继续走
      let rem = h, tt = t;
      for (let guard = 0; guard < 6 && rem > h * 1e-9 && L.alive; guard++) {
        const push = (dt: number) => {
          const { E, B } = field(L.p[0], L.p[1], L.p[2], tt + dt / 2), a = dt / 2 * L.q / P.m, vm: V3 = [L.v[0] + a * E[0] + G[0] * dt / 2, L.v[1] + a * E[1] + G[1] * dt / 2, L.v[2] + a * E[2] + G[2] * dt / 2], tv: V3 = [a * B[0], a * B[1], a * B[2]], t2 = tv[0] ** 2 + tv[1] ** 2 + tv[2] ** 2, s: V3 = [2 * tv[0] / (1 + t2), 2 * tv[1] / (1 + t2), 2 * tv[2] / (1 + t2)];
          const c1 = cross(vm, tv), vp: V3 = [vm[0] + c1[0], vm[1] + c1[1], vm[2] + c1[2]], c2 = cross(vp, s), vq: V3 = [vm[0] + c2[0], vm[1] + c2[1], vm[2] + c2[2]], nv: V3 = [vq[0] + a * E[0] + G[0] * dt / 2, vq[1] + a * E[1] + G[1] * dt / 2, vq[2] + a * E[2] + G[2] * dt / 2];
          return { nv, np: [L.p[0] + (L.v[0] + nv[0]) / 2 * dt, L.p[1] + (L.v[1] + nv[1]) / 2 * dt, L.p[2] + (L.v[2] + nv[2]) / 2 * dt] as V3 };
        };
        const { nv, np } = push(rem);
        // 走到指定位置时速率瞬间改变：在交点切开，换了速度再继续走
        const kick = kicks.find((k) => k.i === i && !k.done && (k.x !== undefined ? (L.p[0] - k.x) * (np[0] - k.x) <= 0 : k.y !== undefined ? (L.p[1] - k.y) * (np[1] - k.y) <= 0 : false));
        if (kick) { kick.done = true; const c = kick.x !== undefined ? (kick.x - L.p[0]) / ((np[0] - L.p[0]) || 1) : (kick.y! - L.p[1]) / ((np[1] - L.p[1]) || 1), part = rem * Math.min(1, Math.max(0, c)), s3 = push(part); L.p = s3.np; L.v = s3.nv; tt += part; rem -= part; const v = Math.hypot(...L.v) || 1; L.v = [L.v[0] / v * kick.speed, L.v[1] / v * kick.speed, L.v[2] / v * kick.speed]; marks.push({ t: tt, label: kick.name ?? `${P.id}变速` }); hist[i].push({ t: tt, p: [...L.p], v: [...L.v], alive: true, q: L.q }); continue; }
        let f = 1, hitWall: typeof walls[number] | null = null, hole = false, hitField = -1;
        F.forEach((q, k) => {
          if (!q.region || inside(q, np[0], np[1]) === L.was[k]) return;
          let lo = 0, hi = 1; for (let c = 0; c < 40; c++) { const m = (lo + hi) / 2, p = lerp(L.p, np, m); if (inside(q, p[0], p[1]) === L.was[k]) lo = m; else hi = m; }
          if (hi < f) { f = hi; hitField = k; hitWall = null; }
        });
        for (const w of walls) {
          const ex = w.b[0] - w.a[0], ey = w.b[1] - w.a[1], dx = np[0] - L.p[0], dy = np[1] - L.p[1], den = dx * ey - dy * ex; if (Math.abs(den) < 1e-30) continue;
          const s1 = ((w.a[0] - L.p[0]) * ey - (w.a[1] - L.p[1]) * ex) / den, u = ((w.a[0] - L.p[0]) * dy - (w.a[1] - L.p[1]) * dx) / den, Lw = Math.hypot(ex, ey);
          if (s1 <= 1e-12 || s1 > f + 1e-7 || u < 0 || u > 1) continue;   // 挡板和场区边界重合时算碰到挡板
          f = s1; hitWall = w; hole = !!(w.hole && u * Lw >= w.hole[0] && u * Lw <= w.hole[1]); hitField = -1;
        }
        if (f >= 1) { L.p = np; L.v = nv; rem = 0; break; }
        const part = rem * f, s2 = push(part); L.p = s2.np; L.v = s2.nv; tt += part; rem -= part;
        const rec = (alive = L.alive) => hist[i].push({ t: tt, p: [...L.p], v: [...L.v], alive, q: L.q });
        if (hitField >= 0) { const q = F[hitField]; L.was[hitField] = !L.was[hitField]; marks.push({ t: tt, label: `${P.id}${L.was[hitField] ? '进入' : '离开'}${q.name}` }); rec(); }
        else if (hitWall) {
          const w = hitWall;
          if (hole) { marks.push({ t: tt, label: `${P.id}穿过${w.id ?? '挡板'}` }); rec(); passes[i].push(hist[i].length - 1); L.p = [L.p[0] + L.v[0] * h * 1e-6, L.p[1] + L.v[1] * h * 1e-6, L.p[2]]; continue; }
          const ex = w.b[0] - w.a[0], ey = w.b[1] - w.a[1], Lw = Math.hypot(ex, ey);
          if (w.flip) L.q = -L.q;
          if (w.reflect || w.flip) { const nx = -ey / Lw, ny = ex / Lw, d = L.v[0] * nx + L.v[1] * ny; L.v = [L.v[0] - (1 + w.e) * d * nx, L.v[1] - (1 + w.e) * d * ny, L.v[2]]; marks.push({ t: tt, label: `${P.id}碰${w.id ?? '挡板'}` }); rec(); L.p = [L.p[0] + L.v[0] * h * 1e-6, L.p[1] + L.v[1] * h * 1e-6, L.p[2]]; }
          else { L.alive = false; marks.push({ t: tt, label: `${P.id}打到${w.id ?? '挡板'}` }); rec(false); }
        }
      }
    });
    t += h;
    for (const c of pairs) {
      const A = live[c.a], Bq = live[c.b]; if (!A.alive || !Bq.alive || t - c.last < 50 * h) continue;
      const d: V3 = [Bq.p[0] - A.p[0], Bq.p[1] - A.p[1], Bq.p[2] - A.p[2]], dist = Math.hypot(...d); if (dist > (c.r || scale)) continue;
      const rel: V3 = [A.v[0] - Bq.v[0], A.v[1] - Bq.v[1], A.v[2] - Bq.v[2]], m1 = Ps[c.a].m, m2 = Ps[c.b].m, nrm: V3 = dist > 1e-12 && (rel[0] * d[0] + rel[1] * d[1] + rel[2] * d[2]) > 0 ? [d[0] / dist, d[1] / dist, d[2] / dist] : (() => { const v = Math.hypot(...rel) || 1; return [rel[0] / v, rel[1] / v, rel[2] / v] as V3; })(), vn = rel[0] * nrm[0] + rel[1] * nrm[1] + rel[2] * nrm[2]; if (vn <= 0) continue;
      const J = (1 + c.e) * vn / (1 / m1 + 1 / m2); for (let k = 0; k < 3; k++) { A.v[k] -= J / m1 * nrm[k]; Bq.v[k] += J / m2 * nrm[k]; } c.last = t;
      marks.push({ t, label: `${Ps[c.a].id}${Ps[c.b].id}相碰` }); hist[c.a].push({ t, p: [...A.p], v: [...A.v], alive: true, q: A.q }); hist[c.b].push({ t, p: [...Bq.p], v: [...Bq.v], alive: true, q: Bq.q });
    }
    if (n % every === 0 || n === N) live.forEach((L, i) => hist[i].push({ t, p: [...L.p], v: [...L.v], alive: L.alive, q: L.q }));
  }
  const passT = passes.map((list, i) => list.map((n) => hist[i][n]?.t ?? 0));
  hist.forEach((H) => H.sort((a, b) => a.t - b.t));
  const all = hist.flat(), xs = all.map((r) => r.p[0]), ys = all.map((r) => r.p[1]), zmax = Math.max(...all.map((r) => Math.abs(r.p[2])));
  // 取景跟着运动走：很远的场区边界、挡板只露出和运动有关的一段
  const mx0 = Math.min(...xs), mx1 = Math.max(...xs), my0 = Math.min(...ys), my1 = Math.max(...ys), reach = Math.max(mx1 - mx0, my1 - my0, 1e-30) * .7;
  const nearBox = (x: number, y: number) => x > mx0 - reach && x < mx1 + reach && y > my0 - reach && y < my1 + reach;
  const gx: number[] = [...xs], gy: number[] = [...ys], keep = (x: number, y: number) => { if (nearBox(x, y)) { gx.push(x); gy.push(y); } };
  for (const f of F) { if (f.circle) { keep(f.circle[0] - f.circle[2], f.circle[1]); keep(f.circle[0] + f.circle[2], f.circle[1]); keep(f.circle[0], f.circle[1] - f.circle[2]); keep(f.circle[0], f.circle[1] + f.circle[2]); } else if (f.poly) for (const p of f.poly) keep(p[0], p[1]); if (f.at) keep(f.at[0], f.at[1]); }
  for (const w of walls) { keep(w.a[0], w.a[1]); keep(w.b[0], w.b[1]); }
  let X0 = Math.min(...gx), X1 = Math.max(...gx), Y0 = Math.min(...gy), Y1 = Math.max(...gy); const pad = Math.max(X1 - X0, Y1 - Y0, 1e-30) * .08;
  if (sp.view) [X0, Y0, X1, Y1] = sp.view.map((v) => num(v, vars)); else { X0 -= pad; X1 += pad; Y0 -= pad; Y1 += pad; }
  const colors = [red, blue, green, amber];
  const frame = (t: number) => {
    const d: Prim[] = [], vals: Record<string, number> = {};
    for (const f of F) {
      const clip = f.circle ? { circle: f.circle } : f.poly ? { poly: f.poly } : {};
      const here = { ...vars, t, x: (X0 + X1) / 2, y: (Y0 + Y1) / 2 };
      if (f.kind === 'B' && Array.isArray(f.B) && !num(f.B[2], here)) d.push({ k: 'efield', x0: X0, y0: Y0, x1: X1, y1: Y1, E: [num(f.B[0], here), num(f.B[1], here)], magnetic: true, ...clip });
      else if (f.kind === 'B') d.push({ k: 'field', x0: X0, y0: Y0, x1: X1, y1: Y1, B: Array.isArray(f.B) ? num(f.B[2], here) : num(f.B, here), ...clip });
      else if (f.kind === 'E') { const e = [num(f.E![0], here), num(f.E![1], here)]; d.push({ k: 'efield', x0: X0, y0: Y0, x1: X1, y1: Y1, E: e, ...clip }); }
      else d.push({ k: 'circle', at: f.at!, rp: 12, fill: num(f.Q, vars) > 0 ? red : blue, c: ink }, { k: 'text', at: f.at!, s: num(f.Q, vars) > 0 ? '+' : '−', c: '#fff', size: 15, dy: 5, bold: true });
    }
    // 场区的名字标在区域里靠近运动的位置
    for (const f of F) if (f.region && f.kind !== 'Q' && f.name && !/^[BE]\d+$/.test(f.name)) {
      const pts = f.circle ? [[f.circle[0], f.circle[1] + f.circle[2] * .8]] : (f.poly ?? []).map((p) => [Math.max(X0, Math.min(X1, p[0])), Math.max(Y0, Math.min(Y1, p[1]))]), cx = pts.reduce((a, p) => a + p[0], 0) / (pts.length || 1), cy = pts.reduce((a, p) => a + p[1], 0) / (pts.length || 1);
      d.push({ k: 'text', at: [cx, cy], s: f.name, c: f.kind === 'B' ? blue : amber, size: 14, bold: true });
    }
    for (const w of walls) {
      if (!w.hole) d.push({ k: 'line', p: [w.a, w.b], c: ink, w: 3.5 });
      else { const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L; d.push({ k: 'line', p: [w.a, [w.a[0] + ux * w.hole[0], w.a[1] + uy * w.hole[0]]], c: ink, w: 3.5 }, { k: 'line', p: [[w.a[0] + ux * w.hole[1], w.a[1] + uy * w.hole[1]], w.b], c: ink, w: 3.5 }); }
    }
    Ps.forEach((P, i) => {
      const H = hist[i]; let lo = 0, hi = H.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (H[m].t <= t) lo = m; else hi = m; }
      const k = lo, A = H[lo], Z = H[hi], f = Z.t > A.t ? Math.min(1, Math.max(0, (t - A.t) / (Z.t - A.t))) : 0, mix = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], r: Rec = A.alive && Z.alive ? { t, p: mix(A.p, Z.p), v: mix(A.v, Z.v), alive: true, q: A.q } : A, col = colors[i % 4];
      d.push({ k: 'circle', at: [r.p[0], r.p[1]], rp: 7.5, fill: col, c: ink, w: 1.4 }, { k: 'text', at: [r.p[0], r.p[1]], s: A.q > 0 ? '+' : A.q < 0 ? '−' : '',  c: '#fff', size: 12, dy: 4, bold: true }, { k: 'text', at: [r.p[0], r.p[1]], s: P.id, c: ink, size: 13, dy: -13 });
      const v = Math.hypot(...r.v), L = Math.max(X1 - X0, Y1 - Y0) * .09, vxy = Math.hypot(r.v[0], r.v[1]);
      if (vxy > 0 && r.alive) d.push({ k: 'line', p: [[r.p[0], r.p[1]], [r.p[0] + r.v[0] / vxy * L, r.p[1] + r.v[1] / vxy * L]], c: blue, w: 2.2, arrow: true });
      const since = hist[i].findIndex((u) => u.t >= (passT[i].filter((x) => x <= t).at(-1) ?? 0)); let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity; for (let q = since; q <= k; q++) { const u = H[q].p; if (u[0] < xmin) xmin = u[0]; if (u[0] > xmax) xmax = u[0]; if (u[1] < ymin) ymin = u[1]; if (u[1] > ymax) ymax = u[1]; }
      Object.assign(vals, { [`xmin_${P.id}`]: xmin, [`xmax_${P.id}`]: xmax, [`ymin_${P.id}`]: ymin, [`ymax_${P.id}`]: ymax });
      const { B, E } = field(r.p[0], r.p[1], r.p[2], t), Bm = Math.hypot(...B);
      // 合力箭头：只有洛伦兹力时指向圆心，学生一眼看到是什么在拉着它转
      if (r.alive && r.q) { const fx = r.q * (E[0] + r.v[1] * B[2] - r.v[2] * B[1]) + G[0] * P.m, fy = r.q * (E[1] + r.v[2] * B[0] - r.v[0] * B[2]) + G[1] * P.m, fm = Math.hypot(fx, fy), Lf = Math.max(X1 - X0, Y1 - Y0) * .08; if (fm > 1e-30) { const hasB = Math.abs(B[2]) > 0 && vxy > 0, hasE = Math.hypot(E[0], E[1]) > 0; d.push({ k: 'line', p: [[r.p[0], r.p[1]], [r.p[0] + fx / fm * Lf, r.p[1] + fy / fm * Lf]], c: amber, w: 2.4, arrow: true }, { k: 'text', at: [r.p[0] + fx / fm * Lf, r.p[1] + fy / fm * Lf], s: hasB && hasE ? 'F合' : hasB ? 'qvB' : 'qE', c: amber, size: 13, dy: -6, bold: true }); } }
      Object.assign(vals, { [`x_${P.id}`]: r.p[0], [`y_${P.id}`]: r.p[1], [`z_${P.id}`]: r.p[2], [`v_${P.id}`]: v, [`vx_${P.id}`]: r.v[0], [`vy_${P.id}`]: r.v[1], [`vz_${P.id}`]: r.v[2], [`KE_${P.id}`]: .5 * P.m * v * v, [`r_${P.id}`]: Bm && r.q ? P.m * v / (Math.abs(r.q) * Bm) : 0, [`T_${P.id}`]: Bm && r.q ? 2 * Math.PI * P.m / (Math.abs(r.q) * Bm) : 0 });
      // 圆心和半径：在匀强磁场里，粒子绕着哪转看得见
      if (Bm && r.q && Math.abs(B[2]) > 0 && vxy > 0 && r.alive) { const R = P.m * vxy / (Math.abs(r.q) * Math.abs(B[2])), s = (r.q * B[2] > 0 ? 1 : -1), cx = r.p[0] + s * r.v[1] / vxy * R, cy = r.p[1] - s * r.v[0] / vxy * R; if (R < (X1 - X0) * 3) d.push({ k: 'line', p: [[r.p[0], r.p[1]], [cx, cy]], c: soft, w: 1, dash: [3, 3] }, { k: 'circle', at: [cx, cy], rp: 2.5, fill: soft }); }
    });
    // 有 z 方向运动时，加一个侧视投影
    if (zmax > 1e-12 * Math.max(X1 - X0, 1e-30)) { const P = hist[0], k = Math.min(P.length - 1, Math.round(t / T * (P.length - 1))), sc = (Y1 - Y0) * .16 / zmax, y0 = Y0 + (Y1 - Y0) * .12, tr: number[][] = []; for (let q = 0; q <= k; q += Math.max(1, Math.floor(k / 400))) tr.push([P[q].p[0], y0 + P[q].p[2] * sc]); d.push({ k: 'line', p: [[X0, y0], [X1, y0]], c: soft, w: 1, dash: [4, 4] }, { k: 'text', at: [X0, y0], s: '侧视（z 方向）', c: soft, size: 12, align: 'left', dx: 6, dy: -6 }); if (tr.length > 1) d.push({ k: 'line', p: tr, c: amber, w: 1.8 }); }
    void fixed;
    return { draw: d, vals };
  };
  marks.sort((a, b) => a.t - b.t);
  return { name: '带电粒子', T, view: [X0, Y0, X1, Y1], frame, marks: marks.slice(0, 60), n: 300, paths: Ps.map((_, i) => { const H = hist[i], st = Math.max(1, Math.floor(H.length / 900)); return { c: colors[i % 4], w: 2, dash: [6, 4], pts: H.filter((_, q) => q % st === 0).map((q) => [q.p[0], q.p[1], q.t]) }; }) };
}
