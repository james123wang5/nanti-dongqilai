// 气体：汽缸里若干段气体被活塞或液柱隔开。每一步由力平衡和 pV=nRT 解出活塞位置，不用 AI 写的结论。
import { type LabOut, type Prim, num, fixed, blend, ink, soft, blue, red, amber } from './common.ts';
import type { Num } from '../sim.ts';

export type GasSpec = {
  A?: Num; patm?: Num; angle?: Num;     // 截面积；大气压；缸轴与水平的夹角（度），90 为竖直开口向上
  // 沿缸轴从底到口的顺序：气体段和活塞交替
  chambers: { id: string; p?: Num; L: Num; T: Num; Cv?: Num }[];   // 初态：压强（缺省由平衡算）、长度、温度
  pistons: { id: string; m?: Num; len?: Num; stops?: [Num, Num]; F?: Num; rho?: Num }[];   // 第 i 个活塞在第 i 段气体上方；F 可含 t、x（向缸口为正）
  open?: boolean;                        // 最上面通大气；false 时最后一段气体被缸口封住，要写 total
  total?: Num;
  steps: { label?: string; duration?: Num; line?: { chamber: string; V: Num; T: Num }; T?: Record<string, Num>; adiabatic?: string[]; leak?: Record<string, Num>; force?: Num; tilt?: Num; patm?: Num; add?: Record<string, Num> }[];   // T 里的式子用 u（0→1）
};

export function gas(sp: GasSpec, vars: Record<string, number>): LabOut {
  if (sp.pistons.some((q) => (q as NetPiston).out || (q as NetPiston).to)) return gasNet(sp as unknown as NetSpec, vars);
  const g = vars.g ?? 10, A = num(sp.A, vars, 1), n = sp.chambers.length, gamma = 5 / 3;
  const R = 8.314;
  const base = { patm: num(sp.patm, vars, 1e5), tilt: num(sp.angle, vars, 90) };
  const st = sp.chambers.map((c) => ({ id: c.id, L: num(c.L, vars), T: num(c.T, vars), p: 0, nR: 0, Cv: c.Cv === undefined ? 1.5 : num(c.Cv, vars) }));
  const pis = sp.pistons.map((p) => ({ id: p.id, m: num(p.m, vars), len: num(p.len, vars, 0), stops: p.stops?.map((x) => num(x, vars)) as [number, number] | undefined, spec: p }));
  const open = sp.open !== false, total = num(sp.total, vars, 0);
  // 活塞 i 的外力（向缸口为正）：重力沿缸轴分量 + 题给力
  const load = (i: number, patm: number, tilt: number, u: number, extra: number, xs: number[]) => -pis[i].m * g * Math.sin(tilt * Math.PI / 180) / A + (pis[i].spec.F !== undefined ? num(pis[i].spec.F, { ...vars, x: xs[i], u }, 0) / A : 0) + extra / A + (0 * patm);
  // 初始压强：从最上面向下推
  const startP = (patm: number, tilt: number) => { const ps = new Array(n).fill(0); const xs = sp.chambers.map(() => 0); let above = open ? patm : 0; for (let i = n - 1; i >= 0; i--) { const given = sp.chambers[i].p; if (given !== undefined) ps[i] = num(given, vars); else { const j = i; ps[i] = above - (j < pis.length ? load(j, patm, tilt, 0, 0, xs) : 0); } above = ps[i]; } return ps; };
  const p0 = startP(base.patm, base.tilt);
  st.forEach((c, i) => { c.p = p0[i]; c.nR = c.p * c.L * A / c.T; });
  type State = { t: number; p: number[]; L: number[]; T: number[]; W: number[]; label: string; patm: number; tilt: number; nR: number[] };
  const hist: State[] = [{ t: 0, p: st.map((c) => c.p), L: st.map((c) => c.L), T: st.map((c) => c.T), W: st.map(() => 0), label: '初态', patm: base.patm, tilt: base.tilt, nR: st.map((c) => c.nR) }];
  const marks: { t: number; label: string }[] = [];
  let tNow = 0, patm = base.patm, tilt = base.tilt;
  for (const step of sp.steps) {
    const D = num(step.duration, vars, 3), N = 120, s0 = hist.at(-1)!, patm0 = patm, tilt0 = tilt, patm1 = step.patm !== undefined ? num(step.patm, vars) : patm, tilt1 = step.tilt !== undefined ? num(step.tilt, vars) : tilt;
    const T0 = [...s0.T], ad = new Set(step.adiabatic ?? []);
    const add0 = s0.nR.slice();
    for (let k = 1; k <= N; k++) {
      const u = k / N, prev = hist.at(-1)!, Tn = [...prev.T], nR = [...prev.nR];
      st.forEach((c, i) => {
        const e = step.T?.[c.id]; if (e !== undefined) Tn[i] = num(e, { ...vars, u, T0: T0[i] });
        const lk = step.leak?.[c.id]; if (lk !== undefined) nR[i] = add0[i] * (1 + (num(lk, vars) - 1) * u);
        const ad2 = step.add?.[c.id]; if (ad2 !== undefined) nR[i] = add0[i] + num(ad2, vars) * u;
      });
      const pa = patm0 + (patm1 - patm0) * u, ti = tilt0 + (tilt1 - tilt0) * u, ex = step.force !== undefined ? num(step.force, { ...vars, u }) : 0;
      // 未知数：每段长度。方程：相邻气体的压强差等于活塞受的外力
      const L = [...prev.L], pressure = (Lc: number[], i: number) => ad.has(st[i].id) ? prev.p[i] * (prev.L[i] / Lc[i]) ** gamma : nR[i] * Tn[i] / (Lc[i] * A);
      const heights = (Lc: number[]) => { const xs: number[] = []; let h = 0; for (let i = 0; i < n; i++) { h += Lc[i]; xs.push(h); h += pis[i]?.len ?? 0; } return xs; };
      const res = (Lc: number[]) => { const xs = heights(Lc), out: number[] = []; for (let i = 0; i < n; i++) { const up = i < n - 1 ? pressure(Lc, i + 1) : open ? pa : null; if (up === null) { out.push(Lc.reduce((a, b) => a + b, 0) + pis.reduce((a, b) => a + b.len, 0) - total); continue; } const lim = pis[i]?.stops; if (lim && ((xs[i] <= lim[0] + 1e-12 && pressure(Lc, i) - up + (i < pis.length ? load(i, pa, ti, u, i === pis.length - 1 ? ex : 0, xs) : 0) < 0) || (xs[i] >= lim[1] - 1e-12 && pressure(Lc, i) - up + load(i, pa, ti, u, i === pis.length - 1 ? ex : 0, xs) > 0))) { out.push(xs[i] - (xs[i] <= lim[0] + 1e-12 ? lim[0] : lim[1])); continue; } out.push(pressure(Lc, i) - up + (i < pis.length ? load(i, pa, ti, u, i === pis.length - 1 ? ex : 0, xs) : 0)); } return out; };
      for (let it = 0; it < 40; it++) {
        const r = res(L); if (r.every((x, i) => Math.abs(x) < 1e-9 * Math.max(1, Math.abs(prev.p[i])))) break;
        const J = Array.from({ length: n }, () => new Array(n + 1).fill(0));
        for (let j = 0; j < n; j++) { const e = Math.max(L[j] * 1e-6, 1e-9), Lp = [...L]; Lp[j] += e; const rp = res(Lp); for (let i = 0; i < n; i++) J[i][j] = (rp[i] - r[i]) / e; }
        for (let i = 0; i < n; i++) J[i][n] = -r[i];
        for (let c = 0; c < n; c++) { let b = c; for (let i = c; i < n; i++) if (Math.abs(J[i][c]) > Math.abs(J[b][c])) b = i; [J[c], J[b]] = [J[b], J[c]]; if (Math.abs(J[c][c]) < 1e-30) continue; for (let i = 0; i < n; i++) if (i !== c) { const f = J[i][c] / J[c][c]; for (let q = c; q <= n; q++) J[i][q] -= f * J[c][q]; } }
        for (let i = 0; i < n; i++) { const d = Math.abs(J[i][i]) < 1e-30 ? 0 : J[i][n] / J[i][i]; L[i] = Math.max(L[i] + Math.max(-L[i] * .5, Math.min(L[i] * .5 + 1e-9, d)), 1e-9); }
        for (let i = 0; i < n; i++) { const lim = pis[i]?.stops; if (lim) { const xs = heights(L); if (xs[i] < lim[0]) L[i] += lim[0] - xs[i]; if (xs[i] > lim[1]) L[i] -= xs[i] - lim[1]; } }
      }
      // p-V 图上走直线：终点由状态方程定，途中压强和体积一起线性变
      if (step.line) { const i = st.findIndex((c) => c.id === step.line!.chamber), V1 = num(step.line.V, vars), T1 = num(step.line.T, vars), p1 = s0.nR[i] * T1 / V1, V = s0.L[i] * A + (V1 - s0.L[i] * A) * u, pp = s0.p[i] + (p1 - s0.p[i]) * u; L[i] = V / A; Tn[i] = pp * V / nR[i]; }
      const p = L.map((_, i) => pressure(L, i)), Tt = Tn.map((T, i) => ad.has(st[i].id) ? p[i] * L[i] * A / nR[i] : T);
      const W = prev.W.map((w, i) => w + (p[i] + prev.p[i]) / 2 * (L[i] - prev.L[i]) * A);
      hist.push({ t: tNow + D * u, p, L, T: Tt, W, label: step.label ?? '', patm: pa, tilt: ti, nR });
    }
    tNow += D; patm = patm1; tilt = tilt1; if (step.label) marks.push({ t: tNow, label: step.label });
  }
  const T = tNow || 1, maxLen = Math.max(...hist.map((h) => h.L.reduce((a, b) => a + b, 0) + pis.reduce((a, b) => a + b.len, 0))), bore = maxLen * .36, wallTop = maxLen * 1.14;
  const at = (t: number) => blend(hist, t);
  const pmax = Math.max(...hist.flatMap((h) => h.p));
  const frame = (t: number) => {
    const s = at(t), draw: Prim[] = [], vals: Record<string, number> = { patm: s.patm };
    const X = (h: number) => [0, h];
    draw.push({ k: 'line', p: [[-bore / 2, wallTop], [-bore / 2, 0], [bore / 2, 0], [bore / 2, wallTop]], c: ink, w: 3.5 });
    if (!open) draw.push({ k: 'line', p: [[-bore / 2, wallTop], [bore / 2, wallTop]], c: ink, w: 3.5 });
    let h = 0;
    s.L.forEach((L, i) => {
      const dens = s.p[i] / pmax, c = st[i], heat = Math.max(0, Math.min(1, (s.T[i] - hist[0].T[i]) / (Math.abs(hist[0].T[i]) * .5 + 1) + .5));
      draw.push({ k: 'rect', x0: -bore / 2, x1: bore / 2, y0: h, y1: h + L, fill: `rgba(${Math.round(60 + 170 * heat)},${Math.round(130 - 60 * heat)},${Math.round(210 - 150 * heat)},${.12 + .3 * dens})` });
      // 分子点：疏密看压强
      const m = Math.round(26 * L / (maxLen * .5) * (s.nR[i] / (hist[0].nR[i] || 1)) + 6);
      for (let q = 0; q < m; q++) { const a = Math.sin(q * 12.9898 + i * 78.233) * 43758.5453, b = Math.sin(q * 39.3468 + i * 11.135) * 24634.6345, ph = t * (1 + (s.T[i] / hist[0].T[i])) * 1.5 + q; draw.push({ k: 'circle', at: [(((a % 1) + 1) % 1 - .5) * bore * .9 + Math.sin(ph) * bore * .02, h + (((b % 1) + 1) % 1) * L * .94 + L * .03], rp: 1.8, fill: '#3a6ea0aa' }); }
      draw.push({ k: 'text', at: X(h + L / 2), s: `${c.id}  p = ${pv(s.p[i])}  T = ${fixed(s.T[i], 1)} K`, c: ink, size: 13 });
      vals[`p_${c.id}`] = s.p[i]; vals[`L_${c.id}`] = L; vals[`V_${c.id}`] = L * A; vals[`T_${c.id}`] = s.T[i]; vals[`W_${c.id}`] = s.W[i]; vals[`dU_${c.id}`] = c.Cv * (s.nR[i] * s.T[i] - hist[0].nR[i] * hist[0].T[i]); vals[`Q_${c.id}`] = vals[`dU_${c.id}`] + s.W[i]; vals[`m_${c.id}`] = s.nR[i] / (hist[0].nR[i] || 1);
      h += L;
      const P = pis[i];
      if (P) {
        const th = Math.max(P.len, maxLen * .035);
        draw.push({ k: 'rect', x0: -bore / 2 + bore * .01, x1: bore / 2 - bore * .01, y0: h, y1: h + th, fill: P.spec.rho ? '#9aa7ad' : '#c4a877', c: ink, w: 1.5 });
        draw.push({ k: 'text', at: [bore / 2 + bore * .08, h + th / 2], s: P.id, c: ink, size: 14, align: 'left', bold: true });
        vals[`x_${P.id}`] = h; h += P.len;
        if (P.stops) for (const y of P.stops) if (y > 0) { draw.push({ k: 'line', p: [[-bore / 2, y], [-bore / 2 + bore * .06, y]], c: red, w: 3 }, { k: 'line', p: [[bore / 2, y], [bore / 2 - bore * .06, y]], c: red, w: 3 }); }
      }
    });
    if (open) { draw.push({ k: 'text', at: [0, wallTop * 1.02], s: `大气压 ${pv(s.patm)}`, c: soft, size: 12 }); }
    vals.W = s.W.reduce((a, b) => a + b, 0);
    if (s.label) draw.push({ k: 'text', at: [-bore * .75, wallTop], s: s.label, c: amber, size: 13, align: 'right', bold: true });
    void blue;
    return { draw, vals };
  };
  const first = st[0].id, stride = Math.max(1, Math.floor(hist.length / 240));
  return { name: '气体', T, view: [-bore * 1.6, -maxLen * .05, bore * 1.6, wallTop * 1.08], frame, marks, plot: { x: `V_${first}`, y: `p_${first}`, pts: hist.filter((_, i) => i % stride === 0).map((h) => [h.L[0] * A, h.p[0], h.t]) } };
}
const pv = (p: number) => { if (p >= 1e4) return `${(p / 1e5).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}×10⁵ Pa`; return `${fixed(p, 2)} Pa`; };


// ---------- 任意连接：几段气体、几个活塞，活塞可有摩擦、卡环、被拉动 ----------
type NetPiston = { id: string; A?: Num; of?: string; to?: string; out?: 'up' | 'down' | 'left' | 'right'; m?: Num; load?: Num; F?: Num; f?: Num; stops?: [Num, Num]; x?: Num };
type NetStep = { force?: Record<string, Num>; label?: string; duration?: Num; T?: Record<string, Num>; adiabatic?: string[]; move?: Record<string, Num>; add?: Record<string, Num>; patm?: Num; open?: [string, string] };
type NetSpec = { valves?: { from: string; to: string; dp: Num }[]; patm?: Num; chambers: { id: string; p?: Num; V?: Num; L?: Num; A?: Num; T: Num; Cv?: Num }[]; pistons: NetPiston[]; steps: NetStep[]; g?: Num };

function gasNet(sp: NetSpec, vars: Record<string, number>): LabOut {
  const g = num(sp.g, vars, vars.g ?? 10), gam = 5 / 3;
  const C = sp.chambers.map((c) => { const A = num(c.A, vars, 1), V = c.V !== undefined ? num(c.V, vars) : num(c.L, vars) * A, T = num(c.T, vars); return { id: c.id, V0: V, T0: T, Cv: c.Cv === undefined ? 1.5 : num(c.Cv, vars), p0spec: c.p }; });
  const idx = (id?: string) => C.findIndex((c) => c.id === id);
  const Pn = sp.pistons.map((q) => ({ id: q.id, A: num(q.A, vars, 1), a: q.of ? idx(q.of) : 0, b: q.to ? idx(q.to) : -1, out: q.out ?? 'right', m: num(q.m, vars), load: num(q.load, vars), Fx: q.F, f: num(q.f, vars), stops: q.stops?.map((x) => num(x, vars)) as [number, number] | undefined, x0: num(q.x, vars) }));
  // 重力沿活塞外法线的分量：向下为正
  const gdir = (o: string) => o === 'down' ? 1 : o === 'up' ? -1 : 0;
  let patm = num(sp.patm, vars, 1e5);
  let stepForce: Record<string, Num> = {};
  const force = (i: number, x: number[], p: number[], pa: number, u: number) => { const q = Pn[i], outside = q.b >= 0 ? p[q.b] : pa, extra = stepForce[q.id]; return (p[q.a] - outside) * q.A + (q.m * g + q.load) * gdir(q.out) + (q.Fx === undefined ? 0 : num(q.Fx, { ...vars, x: x[i], u })) + (extra === undefined ? 0 : num(extra, { ...vars, u, x: x[i] })); };
  const p0 = C.map((c) => c.p0spec !== undefined ? num(c.p0spec, vars) : NaN);
  // 没写压强的气体：按没有摩擦时的平衡算（只处理一个活塞通大气的常见情形）
  C.forEach((_, k) => { if (Number.isNaN(p0[k])) { const q = Pn.find((r) => r.a === k && r.b < 0); p0[k] = patm - (q ? ((q.m * g + q.load) * gdir(q.out)) / q.A : 0); } });
  const nR = C.map((c, k) => p0[k] * c.V0 / c.T0);
  type St = { t: number; x: number[]; V: number[]; T: number[]; p: number[]; n: number[]; W: number[]; Wd: number[]; Wf: number[]; Fd: number[]; label: string; patm: number };
  const first: St = { t: 0, x: Pn.map((q) => q.x0), V: C.map((c) => c.V0), T: C.map((c) => c.T0), p: [...p0], n: [...nR], W: C.map(() => 0), Wd: Pn.map(() => 0), Wf: Pn.map(() => 0), Fd: Pn.map(() => 0), label: '初态', patm };
  const hist: St[] = [first], marks: { t: number; label: string }[] = [];
  const volumes = (x: number[], base: St) => { const V = [...base.V]; Pn.forEach((q, i) => { const d = (x[i] - base.x[i]) * q.A; V[q.a] += d; if (q.b >= 0) V[q.b] -= d; }); return V; };
  for (const step of sp.steps) {
    const D = num(step.duration, vars, 4), M = 240, s0 = hist.at(-1)!, T0 = [...s0.T], pa0 = patm, pa1 = step.patm !== undefined ? num(step.patm, vars) : patm, ad = new Set(step.adiabatic ?? []);
    let mode = Pn.map((_, i) => step.move?.[Pn[i].id] !== undefined ? 'drive' : 'hold');
    stepForce = { ...stepForce, ...(step.force ?? {}) };
    for (let k = 1; k <= M; k++) {
      const u = k / M, prev = hist.at(-1)!, pa = pa0 + (pa1 - pa0) * u, Tn = C.map((c, j) => { const e = step.T?.[c.id]; return e !== undefined ? num(e, { ...vars, u, T0: T0[j] }) : prev.T[j]; });
      let n = [...prev.n]; for (const [id, e] of Object.entries(step.add ?? {})) { const j = idx(id); n[j] = s0.n[j] + num(e, { ...vars, u }) * u; }
      const pres = (x: number[]) => { const V = volumes(x, prev); return C.map((c, j) => ad.has(c.id) ? prev.p[j] * (prev.V[j] / V[j]) ** gam : n[j] * Tn[j] / V[j]); };
      let x = [...prev.x]; Pn.forEach((q, i) => { const e = step.move?.[q.id]; if (e !== undefined) x[i] = s0.x[i] + num(e, { ...vars, u }); });
      const settle = () => {
      // 准静态：先按“都不动”试，受力超过摩擦的放开；放开的活塞解力平衡；解出来反向的再卡住
      const dirn = Pn.map(() => 0);
      for (let round = 0; round < 8; round++) {
        const free = Pn.map((_, i) => mode[i] === 'drive' ? false : dirn[i] !== 0), ids = Pn.map((_, i) => i).filter((i) => free[i]);
        for (let it = 0; it < 40 && ids.length; it++) {
          const res = (y: number[]) => { const p = pres(y); return ids.map((i) => force(i, y, p, pa, u) - dirn[i] * Pn[i].f); }, r = res(x);
          if (r.every((v, j) => Math.abs(v) < 1e-9 * (Math.abs(prev.p[0]) * Pn[ids[j]].A + 1))) break;
          const m = ids.length, J = Array.from({ length: m }, () => new Array(m + 1).fill(0));
          ids.forEach((i, c) => { const e = Math.max(Math.abs(prev.V[Pn[i].a]) / Pn[i].A * 1e-6, 1e-9), y = [...x]; y[i] += e; const rp = res(y); for (let q = 0; q < m; q++) J[q][c] = (rp[q] - r[q]) / e; });
          for (let q = 0; q < m; q++) J[q][m] = -r[q];
          for (let c = 0; c < m; c++) { let b = c; for (let q = c; q < m; q++) if (Math.abs(J[q][c]) > Math.abs(J[b][c])) b = q; [J[c], J[b]] = [J[b], J[c]]; if (Math.abs(J[c][c]) < 1e-30) continue; for (let q = 0; q < m; q++) if (q !== c) { const f = J[q][c] / J[c][c]; for (let w = c; w <= m; w++) J[q][w] -= f * J[c][w]; } }
          ids.forEach((i, c) => { const d = Math.abs(J[c][c]) < 1e-30 ? 0 : J[c][m] / J[c][c], lim = Math.abs(prev.V[Pn[i].a]) / Pn[i].A * .3 + 1e-9; x[i] += Math.max(-lim, Math.min(lim, d)); });
        }
        let changed = false; const p = pres(x);
        Pn.forEach((q, i) => {
          if (mode[i] === 'drive') return;
          if (q.stops) { if (x[i] < q.stops[0]) { x[i] = q.stops[0]; dirn[i] = 0; changed = true; } if (x[i] > q.stops[1]) { x[i] = q.stops[1]; dirn[i] = 0; changed = true; } }
          if (dirn[i] === 0) { const F = force(i, x, p, pa, u), atStop = q.stops && ((x[i] <= q.stops[0] && F < 0) || (x[i] >= q.stops[1] && F > 0)); if (!atStop && Math.abs(F) > q.f * (1 + 1e-9) + 1e-9) { dirn[i] = Math.sign(F); changed = true; } }
          else if ((x[i] - prev.x[i]) * dirn[i] < -1e-12) { x[i] = prev.x[i]; dirn[i] = 0; changed = true; }
        });
        if (!changed) break;
      }
      };
      settle();
      // 差压阀：压差超过设定值就放气，直到压差回到设定值
      for (const v of sp.valves ?? []) {
        const a = idx(v.from), b = idx(v.to), dp = num(v.dp, vars), x0 = [...x], n0 = [...n], over = (d: number) => { n = [...n0]; n[a] -= d; n[b] += d; x = [...x0]; settle(); const q = pres(x); return q[a] - q[b] - dp; };
        if (over(0) <= 0) { n = n0; x = x0; settle(); continue; }
        let lo = 0, hi = n0[a] * .5; for (let q = 0; q < 50; q++) { const m = (lo + hi) / 2; if (over(m) > 0) lo = m; else hi = m; } over(hi);
      }
      const V = volumes(x, prev), p = pres(x), T = C.map((c, j) => ad.has(c.id) ? p[j] * V[j] / n[j] : Tn[j]), pm = prev.p.map((v, j) => (v + p[j]) / 2), W = prev.W.map((w, j) => w + pm[j] * (V[j] - prev.V[j]));
      const Fd = Pn.map((_, i) => mode[i] === 'drive' ? -force(i, x, p, pa, u) : 0), Wd = prev.Wd.map((w, i) => w + (Fd[i] + (prev.Fd[i] || Fd[i])) / 2 * (x[i] - prev.x[i])), Wf = prev.Wf.map((w, i) => w + Pn[i].f * Math.abs(x[i] - prev.x[i]));
      hist.push({ t: prev.t + D / M, x, V, T, p, n, W, Wd, Wf, Fd, label: step.label ?? '', patm: pa });
    }
    patm = pa1; if (step.label) marks.push({ t: hist.at(-1)!.t, label: step.label }); mode = [];
  }
  const T = hist.at(-1)!.t || 1, at = (t: number) => blend(hist, t);
  // 画法：每段气体一个缸体，每个活塞从缸体向 out 方向伸出一段缸筒
  const Amax = Math.max(...Pn.map((q) => q.A), 1e-12), maxDx = Pn.map((q, i) => Math.max(...hist.map((h) => Math.abs(h.x[i] - q.x0)), 1e-12)), box = 1.5, span = 3.5;
  const frame = (t: number) => {
    const s = at(t), d: Prim[] = [], vals: Record<string, number> = { patm: s.patm };
    C.forEach((c, j) => {
      const cx = j * (span * 2 + 1), heat = Math.max(0, Math.min(1, (s.T[j] - c.T0) / (Math.abs(c.T0) * .5 + 1) + .5));
      d.push({ k: 'rect', x0: cx - box, y0: -box, x1: cx + box, y1: box, c: ink, w: 3, fill: `rgba(${Math.round(60 + 170 * heat)},${Math.round(130 - 60 * heat)},${Math.round(210 - 150 * heat)},${.12 + .28 * Math.min(1, s.p[j] / Math.max(...hist.map((h) => h.p[j])))})` });
      d.push({ k: 'text', at: [cx, .1], s: c.id, c: ink, size: 14, bold: true }, { k: 'text', at: [cx, -.25], s: `p = ${pv(s.p[j])}`, c: ink, size: 13 }, { k: 'text', at: [cx, -.55], s: `V = ${fixed(s.V[j], 5)} m³  T = ${fixed(s.T[j], 1)} K`, c: soft, size: 12 });
      vals[`p_${c.id}`] = s.p[j]; vals[`V_${c.id}`] = s.V[j]; vals[`T_${c.id}`] = s.T[j]; vals[`W_${c.id}`] = s.W[j]; vals[`dU_${c.id}`] = c.Cv * (s.p[j] * s.V[j] - p0[j] * c.V0); vals[`Q_${c.id}`] = vals[`dU_${c.id}`] + s.W[j]; vals[`n_${c.id}`] = s.n[j] / nR[j];
    });
    Pn.forEach((q, i) => {
      const cx = q.a * (span * 2 + 1), half = Math.max(.25, Math.sqrt(q.A / Amax) * .75), L = 1 + (s.x[i] - q.x0) / maxDx[i] * .9 + .9, dx = q.out === 'right' ? 1 : q.out === 'left' ? -1 : 0, dy = q.out === 'up' ? 1 : q.out === 'down' ? -1 : 0;
      const ex = cx + dx * box, ey = dy * box, far = 2.9, nx = -dy, ny = dx;
      const edge = (o: number) => [[ex + nx * half * o, ey + ny * half * o], [ex + nx * half * o + dx * far, ey + ny * half * o + dy * far]];
      d.push({ k: 'line', p: edge(1), c: ink, w: 3 }, { k: 'line', p: edge(-1), c: ink, w: 3 });
      const gx = ex + dx * L, gy = ey + dy * L; d.push({ k: 'line', p: [[ex + nx * half, ey + ny * half], [gx + nx * half, gy + ny * half], [gx - nx * half, gy - ny * half], [ex - nx * half, ey - ny * half]], close: true, fill: '#cfd9e288' });
      d.push({ k: 'line', p: [[gx + nx * half, gy + ny * half], [gx - nx * half, gy - ny * half]], c: '#8a5a24', w: 7 }, { k: 'text', at: [gx + nx * (half + .12) + dx * .12, gy + ny * (half + .12) + dy * .12], s: q.id, c: ink, size: 14, bold: true });
      if (q.load && q.out === 'down') d.push({ k: 'line', p: [[gx, gy], [gx, gy - .6]], c: ink, w: 1.4 }, { k: 'rect', x0: gx - .3, y0: gy - 1.05, x1: gx + .3, y1: gy - .6, fill: '#9aa7ad', c: ink, w: 1.4 });
      if (s.Fd[i]) d.push({ k: 'line', p: [[gx, gy], [gx + dx * .9, gy + dy * .9]], c: amber, w: 2.6, arrow: true }, { k: 'text', at: [gx + dx * .9, gy + dy * .9], s: `F = ${fixed(Math.abs(s.Fd[i]), 2)} N`, c: amber, size: 13, dy: -8 });
      vals[`x_${q.id}`] = s.x[i] - q.x0; vals[`Wd_${q.id}`] = s.Wd[i]; vals[`F_${q.id}`] = s.Fd[i]; vals[`Wf_${q.id}`] = s.Wf[i];
    });
    vals.W = s.W.reduce((a, b) => a + b, 0);
    void blue; void red;
    return { draw: d, vals };
  };
  const first0 = C[0].id, stride = Math.max(1, Math.floor(hist.length / 240)), n = C.length;
  return { name: '气体', T, view: [-6, -6, 6 + (n - 1) * (span * 2 + 1), 6], frame, marks, plot: { x: `V_${first0}`, y: `p_${first0}`, pts: hist.filter((_, i) => i % stride === 0).map((h) => [h.V[0], h.p[0], h.t]) } };
}
