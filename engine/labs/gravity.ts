// 万有引力：任意多个天体互相吸引，能算双星、三星、变轨、追及。轨道整条画出来。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber, green } from './common.ts';
import type { Num } from '../sim.ts';

export type GravitySpec = {
  G?: Num; duration?: Num;
  bodies: { id: string; m: Num; pos: [Num, Num]; vel?: [Num, Num]; fixed?: boolean; size?: Num; look?: 'planet' | 'star' | 'satellite' }[];
  kicks?: { on: string; t?: Num; at?: 'apsis'; n?: number; dv?: Num; factor?: Num }[];
};
export function gravity(sp: GravitySpec, vars: Record<string, number>): LabOut {
  const G = num(sp.G, vars, vars.G ?? 1), T = num(sp.duration, vars, 10), N = 40000, h = T / N, B = sp.bodies.map((b) => ({ id: b.id, m: num(b.m, vars), x: num(b.pos[0], vars), y: num(b.pos[1], vars), vx: num(b.vel?.[0], vars), vy: num(b.vel?.[1], vars), fixed: !!b.fixed, look: b.look ?? 'satellite' }));
  const n = B.length, heavy = B.reduce((a, b) => b.m > a.m ? b : a, B[0]), kicks = (sp.kicks ?? []).map((k) => ({ ...k, t: k.t === undefined ? undefined : num(k.t, vars), done: false, seen: 0 }));
  const acc = (s: number[]) => { const a = new Array(2 * n).fill(0); for (let i = 0; i < n; i++) if (!B[i].fixed) for (let j = 0; j < n; j++) if (i !== j) { const dx = s[4 * j] - s[4 * i], dy = s[4 * j + 1] - s[4 * i + 1], r2 = dx * dx + dy * dy + 1e-30, r3 = r2 * Math.sqrt(r2), f = G * B[j].m / r3; a[2 * i] += f * dx; a[2 * i + 1] += f * dy; } return a; };
  const der = (s: number[]) => { const a = acc(s), d = new Array(4 * n); for (let i = 0; i < n; i++) { d[4 * i] = B[i].fixed ? 0 : s[4 * i + 2]; d[4 * i + 1] = B[i].fixed ? 0 : s[4 * i + 3]; d[4 * i + 2] = a[2 * i]; d[4 * i + 3] = a[2 * i + 1]; } return d; };
  let s = B.flatMap((b) => [b.x, b.y, b.vx, b.vy]);
  const stride = Math.max(1, Math.floor(N / 2400)), hist: number[][] = [s.slice()], marks: { t: number; label: string }[] = [];
  const rOf = (st: number[], i: number) => { const k = B.indexOf(heavy); return Math.hypot(st[4 * i] - st[4 * k], st[4 * i + 1] - st[4 * k + 1]); };
  const prevR = B.map((_, i) => rOf(s, i)), prevD = B.map(() => 0), sweep = B.map(() => 0), period: (number | undefined)[] = B.map(() => undefined), rmin = B.map((_, i) => rOf(s, i)), rmax = B.map((_, i) => rOf(s, i));
  const lastAng = B.map((_, i) => Math.atan2(s[4 * i + 1] - s[4 * B.indexOf(heavy) + 1], s[4 * i] - s[4 * B.indexOf(heavy)]));
  for (let i = 1; i <= N; i++) {
    const add = (a: number[], b: number[], k: number) => a.map((v, q) => v + b[q] * k), k1 = der(s), k2 = der(add(s, k1, h / 2)), k3 = der(add(s, k2, h / 2)), k4 = der(add(s, k3, h));
    s = s.map((v, q) => v + (k1[q] + 2 * k2[q] + 2 * k3[q] + k4[q]) * h / 6);
    const t = i * h;
    B.forEach((b, q) => {
      if (b === heavy) return;
      const r = rOf(s, q), d = r - prevR[q]; rmin[q] = Math.min(rmin[q], r); rmax[q] = Math.max(rmax[q], r);
      const k = B.indexOf(heavy), ang = Math.atan2(s[4 * q + 1] - s[4 * k + 1], s[4 * q] - s[4 * k]); let da = ang - lastAng[q]; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; sweep[q] += da; lastAng[q] = ang; if (period[q] === undefined && Math.abs(sweep[q]) >= 2 * Math.PI) period[q] = t;
      if (i > 2 && prevD[q] * d < 0 && rmax[q] - rmin[q] > r * 1e-3) marks.push({ t, label: `${b.id}${d > 0 ? '近点' : '远点'}` });
      for (const kk of kicks) if (kk.on === b.id && !kk.done) {
        const apsis = kk.at === 'apsis' && prevD[q] * d < 0;
        if (apsis) kk.seen++;
        if ((kk.t !== undefined && t >= kk.t) || (apsis && kk.seen >= (kk.n ?? 1))) {
          const vx = s[4 * q + 2], vy = s[4 * q + 3], v = Math.hypot(vx, vy), nv = kk.factor !== undefined ? v * num(kk.factor, vars) : v + num(kk.dv, vars); s[4 * q + 2] = vx / v * nv; s[4 * q + 3] = vy / v * nv; kk.done = true; marks.push({ t, label: `${b.id} 点火` }); sweep[q] = 0; period[q] = undefined; rmin[q] = r; rmax[q] = r;
        }
      }
      prevD[q] = d; prevR[q] = r;
    });
    if (i % stride === 0) hist.push(s.slice());
  }
  const xs = hist.flatMap((p) => B.map((_, i) => p[4 * i])), ys = hist.flatMap((p) => B.map((_, i) => p[4 * i + 1])), X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys), pad = Math.max(X1 - X0, Y1 - Y0, 1e-9) * .16;
  const colors = [red, blue, green, amber];
  const full = B.map((_, i) => hist.map((p) => [p[4 * i], p[4 * i + 1]]).filter((_, k) => k % 3 === 0));
  const frame = (t: number) => {
    const i = Math.min(hist.length - 1, Math.round(t / T * (hist.length - 1))), p = hist[i], d: Prim[] = [], vals: Record<string, number> = {};
    B.forEach((b, q) => {
      const col = colors[q % 4], c = b === heavy && heavy.m > 1e3 * Math.min(...B.map((x) => x.m || 1)) ? soft : col;
      void c;
      const x = p[4 * q], y = p[4 * q + 1], vx = p[4 * q + 2], vy = p[4 * q + 3], v = Math.hypot(vx, vy), r = rOf(p, q);
      d.push({ k: 'circle', at: [x, y], rp: b === heavy ? 20 : 8, fill: b === heavy ? '#3d7fb8' : col, c: ink, w: 1.4 });
      d.push({ k: 'text', at: [x, y], s: b.id, c: ink, size: 14, dy: b === heavy ? -26 : -14, bold: true });
      if (v > 1e-12 && b !== heavy) { const L = (X1 - X0 + Y1 - Y0) * .07; d.push({ k: 'line', p: [[x, y], [x + vx / v * L, y + vy / v * L]], c: blue, w: 2.2, arrow: true }); }
      const Ek = .5 * b.m * v * v, Ep = b === heavy ? 0 : -G * heavy.m * b.m / r, E = Ek + Ep;
      Object.assign(vals, { [`x_${b.id}`]: x, [`y_${b.id}`]: y, [`v_${b.id}`]: v, [`r_${b.id}`]: r, [`Ek_${b.id}`]: Ek, [`Ep_${b.id}`]: Ep, [`E_${b.id}`]: E, [`a_${b.id}`]: b === heavy ? 0 : G * heavy.m / (r * r), [`rmin_${b.id}`]: rmin[q], [`rmax_${b.id}`]: rmax[q] });
      if (b !== heavy) { vals[`sma_${b.id}`] = -G * heavy.m * b.m / (2 * E); vals[`T_${b.id}`] = period[q] ?? 2 * Math.PI * Math.sqrt(Math.abs(vals[`sma_${b.id}`]) ** 3 / (G * heavy.m)); }
    });
    return { draw: d, vals };
  };
  void fixed;
  const stat: Prim[] = B.flatMap((b, q) => b.fixed ? [] : [{ k: 'line' as const, p: full[q], c: '#7c868055', w: 1.2, dash: [3, 4] }]);
  const stepT = T / (hist.length - 1), paths = B.flatMap((b, q) => b.fixed ? [] : [{ c: colors[q % 4], w: 1.8, pts: full[q].map((p, k) => [p[0], p[1], k * 3 * stepT]) }]);
  return { name: '天体', T, view: [X0 - pad, Y0 - pad, X1 + pad, Y1 + pad], frame, marks, stat, paths };
}
