// 机械波：由波源算出每一点的位移。行波、叠加、干涉、波前都按相位直接算，不靠 AI 写式子。
import { type LabOut, type Prim, num, fixed, ink, soft, blue, red, amber, green } from './common.ts';
import type { Num } from '../sim.ts';

export type WaveSpec = {
  range: [Num, Num]; duration?: Num; steady?: boolean; plane?: boolean; ymax?: Num;
  sources: { id?: string; x?: Num; crest?: Num; y?: Num; A: Num; T?: Num; f?: Num; v?: Num; lambda?: Num; phase?: Num; t0?: Num; dir?: 1 | -1 | 0; cycles?: Num }[];
  points?: { id: string; x: Num; y?: Num }[];
  wall?: { x: Num; fixed?: boolean };
};
export function wave(sp: WaveSpec, vars: Record<string, number>): LabOut {
  const a = num(sp.range[0], vars), b = num(sp.range[1], vars);
  const S = sp.sources.map((s, i) => {
    const T = s.T !== undefined ? num(s.T, vars) : 1 / num(s.f, vars, 1), v = s.v !== undefined ? num(s.v, vars) : num(s.lambda, vars, 1) / T;
    if (s.x === undefined && s.crest === undefined) throw new Error('机械波：每个波源要写 x（波源位置）；已知 t=0 波形的行波写 crest（t=0 时一个波峰的位置）和 dir');
    return { crest: s.crest === undefined ? undefined : num(s.crest, vars), id: s.id ?? `S${i + 1}`, x: num(s.x, vars, s.crest === undefined ? 0 : num(s.crest, vars)), y: num(s.y, vars), A: num(s.A, vars), T, v, lam: v * T, ph: num(s.phase, vars) * Math.PI / 180, t0: num(s.t0, vars), dir: s.dir ?? 0, cyc: s.cycles === undefined ? Infinity : num(s.cycles, vars) };
  });
  const dur = num(sp.duration, vars, 4 * S[0].T), pts = (sp.points ?? []).map((p) => ({ id: p.id, x: num(p.x, vars), y: num(p.y, vars) }));
  const wall = sp.wall ? { x: num(sp.wall.x, vars), fixed: sp.wall.fixed !== false } : undefined;
  const one = (s: typeof S[number], x: number, y: number, t: number) => {
    // 按 t=0 波形给的行波：t=0 时 x=crest 处是波峰，沿 dir 传播，铺满全程
    if (s.crest !== undefined && !sp.plane) return s.A * Math.cos(2 * Math.PI * ((x - s.crest) / s.lam - (s.dir || 1) * t / s.T));
    const d = sp.plane ? Math.hypot(x - s.x, y - s.y) : Math.abs(x - s.x);
    if (!sp.plane && s.dir && (x - s.x) * s.dir < 0) return 0;
    const τ = t - s.t0 - d / s.v;
    if (!sp.steady && (τ < 0 || τ > s.cyc * s.T)) return 0;
    return s.A * Math.sin(2 * Math.PI * τ / s.T + s.ph);
  };
  const disp = (x: number, y: number, t: number) => {
    let u = 0;
    for (const s of S) { u += one(s, x, y, t); if (wall && (x - wall.x) * (s.x - wall.x) >= 0) u += (wall.fixed ? -1 : 1) * one(s, 2 * wall.x - x, y, t); }
    return u;
  };
  const amp = (x: number, y: number) => { let re = 0, im = 0; for (const s of S) { const d = sp.plane ? Math.hypot(x - s.x, y - s.y) : Math.abs(x - s.x), p = -2 * Math.PI * d / s.lam + s.ph; re += s.A * Math.cos(p); im += s.A * Math.sin(p); } return Math.hypot(re, im); };
  const Amax = sp.ymax !== undefined ? num(sp.ymax, vars) : S.reduce((v, s) => v + Math.abs(s.A), 0) || 1, W = b - a, sc = W * .2 / Amax, N = 200;
  const frame = (t: number) => {
    const draw: Prim[] = [], vals: Record<string, number> = { lambda: S[0].lam, T: S[0].T, v: S[0].v, f: 1 / S[0].T };
    if (sp.plane) {
      for (const s of S) { for (let r = 0; r < W * 1.5; r += s.lam / 2) { const R = r + ((t * s.v) % (s.lam / 2)); const crest = Math.round((R - t * s.v) / (s.lam / 2)) % 2 === 0; if (R / s.v <= t - s.t0 || sp.steady) draw.push({ k: 'circle', at: [s.x, s.y], r: R, c: crest ? '#1c5fc44d' : '#b5302a1f', w: crest ? 1.3 : .8 }); } draw.push({ k: 'circle', at: [s.x, s.y], rp: 6, fill: red }, { k: 'text', at: [s.x, s.y], s: s.id, c: ink, size: 14, dy: -14, bold: true }); }
      for (const p of pts) { const A = amp(p.x, p.y), u = disp(p.x, p.y, t), r = S.map((s) => Math.hypot(p.x - s.x, p.y - s.y)); draw.push({ k: 'circle', at: [p.x, p.y], rp: 6, fill: amber, c: ink }, { k: 'text', at: [p.x, p.y], s: `${p.id}  振幅 ${fixed(A, 3)}`, c: ink, size: 13, dy: -14 }); vals[`y_${p.id}`] = u; vals[`amp_${p.id}`] = A; if (r.length > 1) vals[`dr_${p.id}`] = Math.abs(r[0] - r[1]); }
      return { draw, vals };
    }
    draw.push({ k: 'line', p: [[a, 0], [b, 0]], c: soft, w: 1, dash: [4, 4] });
    const curve: number[][] = []; for (let i = 0; i <= N; i++) { const x = a + W * i / N; curve.push([x, disp(x, 0, t) * sc]); }
    draw.push({ k: 'line', p: curve, c: blue, w: 2.6 });
    for (const s of S) draw.push({ k: 'circle', at: [s.x, disp(s.x, 0, t) * sc], rp: 6, fill: red, c: ink }, { k: 'text', at: [s.x, -Amax * sc * 1.25], s: s.id, c: red, size: 13, bold: true });
    if (wall) draw.push({ k: 'line', p: [[wall.x, -Amax * sc * 1.2], [wall.x, Amax * sc * 1.2]], c: ink, w: 3.5 });
    for (const p of pts) {
      const u = disp(p.x, 0, t), e = S[0].T * 1e-4, vel = (disp(p.x, 0, t + e) - disp(p.x, 0, t - e)) / (2 * e);
      draw.push({ k: 'line', p: [[p.x, 0], [p.x, u * sc]], c: soft, w: 1 }, { k: 'circle', at: [p.x, u * sc], rp: 6.5, fill: amber, c: ink }, { k: 'text', at: [p.x, -Amax * sc * 1.25], s: p.id, c: ink, size: 14, bold: true });
      if (Math.abs(vel) > 1e-9) draw.push({ k: 'line', p: [[p.x, u * sc], [p.x, u * sc + Math.sign(vel) * Amax * sc * .4]], c: green, w: 2, arrow: true });
      vals[`y_${p.id}`] = u; vals[`vy_${p.id}`] = vel; vals[`amp_${p.id}`] = amp(p.x, 0);
    }
    return { draw, vals };
  };
  const p0 = pts[0], M = 240;
  return { name: '机械波', T: dur, view: sp.plane ? [a, a, b, b] : [a - W * .04, -W * .33, b + W * .04, W * .33], frame, flat: !sp.plane,
    plot: p0 ? { x: 't', y: `y_${p0.id}`, pts: Array.from({ length: M + 1 }, (_, i) => { const t = dur * i / M; return [t, disp(p0.x, p0.y, t), t] as [number, number, number]; }) } : undefined };
}
