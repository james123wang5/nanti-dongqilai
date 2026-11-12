// 交变电流与变压器：电源到负载一条链。理想变压器按匝数把电阻折算到原边，从负载倒推到电源。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber } from './common.ts';
import type { Num } from '../sim.ts';

export type AcSpec = {
  source: { Um?: Num; U?: Num; f?: Num; w?: Num; r?: Num; N?: Num; B?: Num; S?: Num; phase?: Num };    // 有效值 U，或峰值 Um，或线圈 N、B、S、ω
  chain: ({ kind: 'R'; id: string; R: Num } | { kind: 'T'; id: string; n1: Num; n2: Num } | { kind: 'load'; id: string; R: Num })[];
  duration?: Num; sweep?: boolean;
};
export function ac(sp: AcSpec, vars: Record<string, number>): LabOut {
  const s = sp.source, w = s.w !== undefined ? num(s.w, vars) : 2 * Math.PI * num(s.f, vars, 50), f = w / (2 * Math.PI), Tp = 1 / f, ph = num(s.phase, vars) * Math.PI / 180;
  const Um = s.N !== undefined ? num(s.N, vars) * num(s.B, vars) * num(s.S, vars) * w : s.Um !== undefined ? num(s.Um, vars) : num(s.U, vars) * Math.SQRT2;
  const coil = s.N !== undefined, r = num(s.r, vars), dur = num(sp.duration, vars, 2 * Tp);
  const frame = (t: number) => {
    const tt = sp.sweep ? 0 : t, vals: Record<string, number> = { Um, E: Um / Math.SQRT2, f, w, T: Tp, r };
    const items = sp.chain.map((c) => c.kind === 'T' ? { ...c, n1v: num(c.n1, { ...vars, t: tt }), n2v: num(c.n2, { ...vars, t: tt }) } : { ...c, Rv: num((c as { R: Num }).R, { ...vars, t: tt }) }) as ({ kind: string; id: string; Rv?: number; n1v?: number; n2v?: number })[];
    // 从负载往回折算
    const eq: number[] = new Array(items.length + 1).fill(0);
    for (let i = items.length - 1; i >= 0; i--) { const c = items[i]; if (c.kind === 'T') eq[i] = eq[i + 1] * (c.n1v! / c.n2v!) ** 2; else eq[i] = eq[i + 1] + c.Rv!; }
    const Erms = Um / Math.SQRT2; let I = Erms / (r + eq[0]), U = Erms - I * r; vals.I0 = I; vals.U0 = U;
    const draw: Prim[] = [], X = (i: number) => 1 + i * 1.7, e = Um * Math.sin(w * t + ph), sgn = Math.sin(w * t + ph);
    vals.e = e; vals.i = e / (r + eq[0]);
    // 电源或线圈
    if (coil) { const a = w * t + ph; draw.push({ k: 'line', p: [[-.5, .7 + Math.cos(a) * .4], [.5, .7 + Math.cos(a) * .4]].map((p, j) => [p[0], .7 + (j ? 1 : -1) * 0 + Math.sin(a) * .45 * (j ? 1 : -1)]), c: amber, w: 4 }, { k: 'rect', x0: -.85, y0: .15, x1: -.65, y1: 1.25, fill: '#c4453b', c: ink }, { k: 'rect', x0: .65, y0: .15, x1: .85, y1: 1.25, fill: '#3b6fc4', c: ink }, { k: 'text', at: [-.75, 1.25], s: 'N', c: ink, size: 13, dy: -6, bold: true }, { k: 'text', at: [.75, 1.25], s: 'S', c: ink, size: 13, dy: -6, bold: true }); }
    else draw.push({ k: 'circle', at: [0, .7], r: .42, c: ink, w: 2, fill: '#fffdf8' }, { k: 'text', at: [0, .7], s: '~', c: ink, size: 22, dy: 7, bold: true });
    draw.push({ k: 'text', at: [0, -.05], s: `U = ${fixed(Erms, 2)} V`, c: red, size: 13 });
    let x = X(0), top = 1.25, bot = .15; const wire = (a: number, b: number) => draw.push({ k: 'line', p: [[a, top], [b, top]], c: ink, w: 2 }, { k: 'line', p: [[a, bot], [b, bot]], c: ink, w: 2 });
    wire(.45, x); const flow = (a: number, b: number) => { const n = Math.max(2, Math.round((b - a) / .35)), I0 = Math.abs(I); for (let k = 0; k < n; k++) { const u = (k + .5) / n + (sgn * .12); draw.push({ k: 'circle', at: [a + (b - a) * u, top], rp: 2.2 + Math.min(1.5, I0 * .1), fill: red }, { k: 'circle', at: [a + (b - a) * (1 - u), bot], rp: 2.2 + Math.min(1.5, I0 * .1), fill: red }); } };
    flow(.45, x);
    for (let i = 0; i < items.length; i++) {
      const c = items[i];
      if (c.kind === 'T') {
        const U2 = U * c.n2v! / c.n1v!, I2 = I * c.n1v! / c.n2v!;
        vals[`U1_${c.id}`] = U; vals[`I1_${c.id}`] = I; vals[`U2_${c.id}`] = U2; vals[`I2_${c.id}`] = I2; vals[`P_${c.id}`] = U * I;
        const n = 7; for (const [dx, cnt] of [[0, Math.min(14, Math.max(3, Math.round(c.n1v! / Math.max(c.n1v!, c.n2v!) * 12)))], [.42, Math.min(14, Math.max(3, Math.round(c.n2v! / Math.max(c.n1v!, c.n2v!) * 12)))]] as const) { const pts: number[][] = []; for (let k = 0; k <= cnt * 8; k++) { const u = k / (cnt * 8); pts.push([x + dx + (dx ? -1 : 1) * .08 * Math.abs(Math.sin(u * cnt * Math.PI)), top - (top - bot) * u]); } draw.push({ k: 'line', p: pts, c: blue, w: 2 }); }
        void n;
        draw.push({ k: 'rect', x0: x + .17, y0: bot - .05, x1: x + .25, y1: top + .05, fill: '#6b7a80', c: ink }, { k: 'text', at: [x + .21, top + .16], s: `${c.id}  ${fixed(c.n1v!, 0)}:${fixed(c.n2v!, 0)}`, c: ink, size: 13, bold: true }, { k: 'text', at: [x + .21, bot - .25], s: `${fixed(U2, 2)} V  ${fixed(I2, 3)} A`, c: red, size: 12 });
        U = U2; I = I2; const nx = x + .42; const end = nx + 1.5; wire(nx, end); flow(nx, end); x = end;
      } else if (c.kind === 'R') {
        const u = I * c.Rv!; vals[`U_${c.id}`] = u; vals[`I_${c.id}`] = I; vals[`P_${c.id}`] = u * I;
        draw.push({ k: 'rect', x0: x, y0: top - .1, x1: x + .6, y1: top + .1, fill: '#fffdf8', c: ink, w: 1.8 }, { k: 'text', at: [x + .3, top + .16], s: c.id, c: ink, size: 13, bold: true }, { k: 'text', at: [x + .3, top - .24], s: `损 ${fixed(u * I, 2)} W`, c: red, size: 12 });
        draw.push({ k: 'line', p: [[x, bot], [x + .6, bot]], c: ink, w: 2 });
        U -= u; const end = x + .6 + .9; wire(x + .6, end); x = end;
      } else {
        const u = I * c.Rv!; vals[`U_${c.id}`] = u; vals[`I_${c.id}`] = I; vals[`P_${c.id}`] = u * I;
        draw.push({ k: 'line', p: [[x, top], [x, (top + bot) / 2 + .24]], c: ink, w: 2 }, { k: 'line', p: [[x, bot], [x, (top + bot) / 2 - .24]], c: ink, w: 2 }, { k: 'rect', x0: x - .1, y0: (top + bot) / 2 - .24, x1: x + .1, y1: (top + bot) / 2 + .24, fill: '#fffdf8', c: ink, w: 1.8 }, { k: 'text', at: [x + .16, (top + bot) / 2 + .1], s: c.id, c: ink, size: 13, align: 'left', bold: true }, { k: 'text', at: [x + .16, (top + bot) / 2 - .16], s: `${fixed(u, 2)} V  ${fixed(I, 3)} A`, c: red, size: 12, align: 'left' });
      }
    }
    void soft;
    return { draw, vals };
  };
  // 外形宽度由链长决定
  let W = 1; for (const c of sp.chain) W += c.kind === 'T' ? 1.92 : c.kind === 'R' ? 1.5 : 1.2;
  const M = 240;
  return { name: '交变电流', T: dur, view: [-1.1, -.45, W + 1, 1.75], frame, plot: { x: 't', y: 'e', pts: Array.from({ length: M + 1 }, (_, i) => { const t = dur * i / M; return [t, Um * Math.sin(w * t + ph), t] as [number, number, number]; }) } };
}
