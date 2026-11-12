// 电磁感应：导轨上的棒、穿过磁场的线框、转动的棒、磁场变化的线圈。
// 电动势和安培力都由引擎按 B、L、v 和磁通量算，不用 AI 手写。
// I/emf 保留大小；Is/emfs 带符号。B>0 朝 +z（纸面外）。
// rails：棒上从上轨到下轨（-y）为正，左端支路从下轨到上轨为正。
// frame/coil：从 +z 看逆时针为正，磁通量法向 +z；rotate：从内端到外端为正，omega>0 为逆时针。
import { type LabOut, type Prim, num, fixed, blend, ink, soft, red, blue, amber, green } from './common.ts';
import type { Num } from '../sim.ts';

type RegionSpec = { x?: [Num, Num]; y?: [Num, Num]; B: Num };
export type InductionSpec = {
  kind: 'rails' | 'frame' | 'rotate' | 'coil'; duration?: Num; g?: Num;
  // 导轨：B 可含 t、x；regions 给分段磁场。load 是导轨左端接的元件
  L?: Num; B?: Num; regions?: RegionSpec[]; incline?: Num; mu?: Num; length?: Num;
  rods?: { id: string; m: Num; r?: Num; x?: Num; v?: Num; F?: Num; fixed?: boolean; drive?: Num }[];
  branches?: { R?: Num; C?: Num; E?: Num; on?: Num; short?: Num; q0?: Num }[];
  load?: { R?: Num; C?: Num; E?: Num; open?: boolean };
  // 线框
  w?: Num; h?: Num; R?: Num; m?: Num; x?: Num; y?: Num; v?: [Num, Num]; F?: [Num, Num]; gravity?: boolean; N?: Num;
  // 对比：同时模拟只改了电阻或质量的线框（如甲、乙并排），值读 vx_乙、Qh_乙，事件“乙开始切割”
  label?: string; also?: { label: string; R?: Num; m?: Num; dy?: Num }[];
  // 转动棒
  omega?: Num; r0?: Num;
  // 线圈
  S?: Num;
};
const tiny = 1e-9;
export function induction(sp: InductionSpec, vars: Record<string, number>): LabOut {
  const g = sp.g !== undefined ? num(sp.g, vars) : vars.g ?? 10, T = num(sp.duration, vars, 6), N = 12000, h = T / N;
  const regs = (sp.regions ?? []).map((r) => ({ x: r.x ? [num(r.x[0], vars), num(r.x[1], vars)] : [-Infinity, Infinity], y: r.y ? [num(r.y[0], vars), num(r.y[1], vars)] : [-Infinity, Infinity], B: r.B }));
  const Bat = (x: number, y: number, t: number) => { if (regs.length) { let b = 0; for (const r of regs) if (x >= r.x[0] && x <= r.x[1] && y >= r.y[0] && y <= r.y[1]) b += num(r.B, { ...vars, x, y, t }); return b; } return num(sp.B, { ...vars, x, y, t }, 0); };
  const marks: { t: number; label: string }[] = [];
  const regionArt = (d: Prim[], X0: number, X1: number, Y0: number, Y1: number, t: number) => {
    if (regs.length) for (const r of regs) { const a = Math.max(r.x[0], X0), b = Math.min(r.x[1], X1), c = Math.max(r.y[0], Y0), e = Math.min(r.y[1], Y1); d.push({ k: 'field', x0: a, y0: c, x1: b, y1: e, B: num(r.B, { ...vars, x: (a + b) / 2, y: (c + e) / 2, t }) }); }
    else d.push({ k: 'field', x0: X0, y0: Y0, x1: X1, y1: Y1, B: num(sp.B, { ...vars, x: (X0 + X1) / 2, y: 0, t }, 0) });
  };
  if (sp.kind === 'rails') {
    const L = num(sp.L, vars, 1), mu = num(sp.mu, vars), inc = num(sp.incline, vars) * Math.PI / 180, rods = (sp.rods ?? []).map((r) => ({ id: r.id, m: num(r.m, vars), r: num(r.r, vars), x: num(r.x, vars), v: num(r.v, vars), F: r.F, fixed: !!r.fixed, drive: r.drive }));
    // 导轨左端接的支路：每条是 R、C、E 串联；short 成立时电容被短接，on 不成立时支路断开
    const ld = sp.load ?? {}, raw = (sp.branches ?? ((ld.R !== undefined || ld.C !== undefined || ld.E !== undefined) && !ld.open ? [ld] : [])) as NonNullable<InductionSpec['branches']>;
    const list = raw.map((b) => ({ R: num(b.R, vars), C: b.C === undefined ? 0 : num(b.C, vars), E: num(b.E, vars), on: b.on, short: b.short, q0: num(b.q0, vars) })), nb = list.length;
    const Rl = list[0]?.R ?? Infinity, C = list[0]?.C ?? 0;
    const open = (k: number, t: number) => list[k].on !== undefined && num(list[k].on, { ...vars, t }) < .5;
    const shorted = (k: number, t: number) => list[k].short !== undefined && num(list[k].short, { ...vars, t }) >= .5;
    type St = { t: number; x: number[]; v: number[]; a: number[]; q: number[]; Qh: number; Q: number[]; Qb: number[]; qp: number; I: number; Ir: number[]; Ib: number[]; emf: number; F: number[]; U: number; W: number; Pext: number };
    const st: St = { t: 0, x: rods.map((r) => r.x), v: rods.map((r) => r.v), a: rods.map(() => 0), q: list.map((b) => b.q0), Qh: 0, Q: rods.map(() => 0), Qb: list.map(() => 0), qp: 0, I: 0, Ir: rods.map(() => 0), Ib: list.map(() => 0), emf: 0, F: rods.map(() => 0), U: 0, W: 0, Pext: 0 };
    const rate = (x: number[], v0: number[], q: number[], t: number) => {
      const v = v0.map((u, i) => rods[i].drive !== undefined ? num(rods[i].drive, { ...vars, t, x: x[i] }) : u);
      const B = rods.map((_, i) => Bat(x[i], 0, t)), e = rods.map((_, i) => B[i] * L * v[i]);
      const ext = rods.map((r, i) => r.F === undefined ? 0 : num(r.F, { ...vars, t, x: x[i], v: v[i] })), gravity = rods.map((r) => r.m * g * Math.sin(inc));
      const friction = (i: number, F: number) => { if (mu === 0) return F; const f = mu * rods[i].m * g * Math.cos(inc); if (Math.abs(v[i]) > 1e-9) return F - Math.sign(v[i]) * f; return Math.abs(F) <= f ? 0 : F - Math.sign(F) * f; };
      // 单棒接纯电容、回路没有电阻：q = C(BLv − E)，电容把质量“加大”成 m + CB²L²
      if (rods.length === 1 && nb === 1 && list[0].C && !list[0].R && !rods[0].r) {
        const c = list[0].C, m = rods[0].m + c * B[0] ** 2 * L ** 2, aa = friction(0, ext[0] + gravity[0]) / m, I = c * B[0] * L * aa;
        return { a: [aa], Ir: [I], Ib: [I], U: e[0], F: [-B[0] * I * L], dq: [I], v, ext };
      }
      // 节点电压法：两根导轨之间只有一个未知电压 U
      let num0 = 0, den = 0, fixedU: number | null = null;
      rods.forEach((r, i) => { if (r.r > 0) { num0 += e[i] / r.r; den += 1 / r.r; } else fixedU = e[i]; });
      list.forEach((b, k) => { if (open(k, t)) return; const cap = b.C && !shorted(k, t) ? q[k] / b.C : 0; if (b.R > 0) { num0 += (cap + b.E) / b.R; den += 1 / b.R; } else fixedU ??= cap + b.E; });
      const U = fixedU ?? (den ? num0 / den : 0);
      const Ib = list.map((b, k) => { if (open(k, t)) return 0; const cap = b.C && !shorted(k, t) ? q[k] / b.C : 0; return b.R > 0 ? (U - cap - b.E) / b.R : NaN; });
      const Ir = rods.map((r, i) => r.r > 0 ? (e[i] - U) / r.r : NaN);
      // 电阻为零的那条由基尔霍夫电流定律补上
      const sumB = Ib.reduce((s, x) => s + (Number.isNaN(x) ? 0 : x), 0), sumR = Ir.reduce((s, x) => s + (Number.isNaN(x) ? 0 : x), 0);
      Ib.forEach((x, k) => { if (Number.isNaN(x)) Ib[k] = sumR - sumB; }); Ir.forEach((x, i) => { if (Number.isNaN(x)) Ir[i] = sumB - sumR; });
      const F = rods.map((_, i) => -B[i] * Ir[i] * L);
      const a = rods.map((r, i) => r.fixed || r.drive !== undefined ? 0 : friction(i, ext[i] + gravity[i] + F[i]) / r.m);
      return { a, Ir, Ib, U, F, dq: Ib.map((x, k) => list[k].C && !shorted(k, t) ? x : 0), v, ext };
    };
    { const r0 = rate(st.x, st.v, st.q, 0); st.v = r0.v; st.I = r0.Ir[0]; st.Ir = r0.Ir; st.Ib = r0.Ib; st.U = r0.U; st.a = r0.a; st.F = r0.F; st.emf = Bat(st.x[0], 0, 0) * L * r0.v[0]; }
    const hist: St[] = [JSON.parse(JSON.stringify(st))];
    let steady = false;
    const step = Math.max(1, Math.floor(N / 1600));
    for (let i = 1; i <= N; i++) {
      const t = st.t, s1 = rate(st.x, st.v, st.q, t), v2 = st.v.map((v, k) => v + s1.a[k] * h / 2), x2 = st.x.map((x, k) => x + s1.v[k] * h / 2), q2 = st.q.map((q, k) => q + s1.dq[k] * h / 2), s2 = rate(x2, v2, q2, t + h / 2);
      st.x = st.x.map((x, k) => rods[k].fixed ? x : x + s2.v[k] * h); st.v = st.v.map((v, k) => rods[k].fixed ? v : rods[k].drive !== undefined ? s2.v[k] : v + s2.a[k] * h); st.q = st.q.map((q, k) => shortedAt(k, t) ? 0 : q + s2.dq[k] * h); st.t = t + h;
      st.qp += Math.abs(s2.Ir[0]) * h; const pb = s2.Ib.map((I, k) => I * I * list[k].R); const pr = s2.Ir.map((I, k) => I * I * rods[k].r);
      st.Qh += (pb.reduce((a, b) => a + b, 0) + pr.reduce((a, b) => a + b, 0)) * h; st.Q = st.Q.map((q, k) => q + pr[k] * h); st.Qb = st.Qb.map((q, k) => q + pb[k] * h);
      st.I = s2.Ir[0]; st.Ir = s2.Ir; st.Ib = s2.Ib; st.U = s2.U; st.emf = Bat(st.x[0], 0, st.t) * L * s2.v[0]; st.a = s2.a; st.F = s2.F;
      const pext = rods.reduce((s, r, k) => s + (r.drive !== undefined ? -s2.F[k] : s2.ext[k]) * s2.v[k], 0); st.Pext = pext; st.W += pext * h;
      if (!steady && i > N * .02 && st.a.every((a) => Math.abs(a) < 1e-3 * Math.max(.1, Math.abs(st.v[0]) / (T / 4))) && st.v.some((v) => Math.abs(v) > 1e-6)) { steady = true; marks.push({ t: st.t, label: '速度稳定' }); }
      if (i % step === 0) hist.push(JSON.parse(JSON.stringify(st)));
    }
    function shortedAt(k: number, t: number) { return list[k].C ? shorted(k, t) : false; }
    // 棒走得很远时镜头跟着棒走，导轨上的刻度往后退，看得出在动
    const xs = hist.flatMap((s) => s.x), lo0 = Math.min(...xs, 0), hi0 = Math.max(...xs, num(sp.length, vars, 0)), follow = hi0 - lo0 > 5 * L, lo = follow ? -1.5 * L : lo0, hi = follow ? 1.5 * L : hi0, pad = Math.max(hi - lo, L) * .2, X0 = lo - pad, X1 = hi + pad;
    const frame = (t: number) => {
      const s = { ...blend(hist, t) }, r = rate(s.x, s.v, s.q, t); s.I = r.Ir[0]; s.Ir = r.Ir; s.Ib = r.Ib; s.v = r.v; s.a = r.a; s.F = r.F; s.U = r.U; s.emf = Bat(s.x[0], 0, t) * L * s.v[0];
      const xc = follow ? s.x.reduce((a, b) => a + b, 0) / s.x.length : 0, d: Prim[] = [], vals: Record<string, number> = { I: Math.abs(s.I), emf: Math.abs(s.emf), Is: s.I, emfs: s.emf, Qh: s.Qh, q: s.qp, U: s.U, W: s.W, Pext: s.Pext };
      list.forEach((b, k) => { const n = k + 1; vals[`I_b${n}`] = Math.abs(s.Ib[k]); vals[`Is_b${n}`] = s.Ib[k]; vals[`Q_b${n}`] = s.Qb[k]; vals[`P_b${n}`] = s.Ib[k] ** 2 * b.R; if (b.C) { vals[`Uc_b${n}`] = s.q[k] / b.C; vals[`q_b${n}`] = s.q[k]; } });
      regionArt(d, X0, X1, -L / 2, L / 2, t);
      d.push({ k: 'line', p: [[X0, L / 2], [X1, L / 2]], c: ink, w: 3 }, { k: 'line', p: [[X0, -L / 2], [X1, -L / 2]], c: ink, w: 3 });
      if (follow) { const step = L * .5; for (let u = Math.ceil((X0 + xc) / step) * step; u < X1 + xc; u += step) for (const y of [L / 2, -L / 2]) d.push({ k: 'line', p: [[u - xc, y - L * .03], [u - xc, y + L * .03]], c: ink, w: 2 }); }
      if (nb && !follow) { const xl = X0 + pad * .12; d.push({ k: 'line', p: [[xl, L / 2], [xl, -L / 2]], c: ink, w: 2 }); if (Rl > 0 && Number.isFinite(Rl)) d.push({ k: 'rect', x0: xl - pad * .05, x1: xl + pad * .05, y0: -L * .2, y1: L * .2, fill: '#fffdf8', c: ink, w: 1.6 }, { k: 'text', at: [xl + pad * .1, 0], s: 'R', c: ink, size: 15, align: 'left', bold: true }); if (C) d.push({ k: 'text', at: [xl + pad * .1, L * .25], s: `C  U = ${fixed(s.q[0] / C, 2)} V`, c: ink, size: 13, align: 'left' }); }
      rods.forEach((r, i) => {
        const x = s.x[i] - xc;
        d.push({ k: 'line', p: [[x, L / 2 * 1.14], [x, -L / 2 * 1.14]], c: '#8a5a24', w: 7 }, { k: 'text', at: [x, L / 2 * 1.14], s: r.id, c: ink, size: 14, dy: -8, bold: true });
        if (Math.abs(s.v[i]) > 1e-6) d.push({ k: 'line', p: [[x, L * .28], [x + Math.sign(s.v[i]) * pad * .6, L * .28]], c: blue, w: 2.5, arrow: true }, { k: 'text', at: [x + Math.sign(s.v[i]) * pad * .65, L * .28], s: `v = ${fixed(s.v[i], 2)} m/s`, c: blue, size: 13, align: s.v[i] > 0 ? 'left' : 'right', dy: 4 });
        if (Math.abs(s.F[i]) > 1e-9) d.push({ k: 'line', p: [[x, -L * .28], [x + Math.sign(s.F[i]) * pad * .5, -L * .28]], c: amber, w: 2.5, arrow: true }, { k: 'text', at: [x + Math.sign(s.F[i]) * pad * .55, -L * .28], s: `F安 = ${fixed(Math.abs(s.F[i]), 2)} N`, c: amber, size: 13, align: s.F[i] > 0 ? 'left' : 'right', dy: 4 });
        if (Math.abs(s.Ir[i]) > 1e-9) { const dirn = s.Ir[i] >= 0 ? -1 : 1; d.push({ k: 'line', p: [[x + pad * .06, -dirn * L * .1], [x + pad * .06, dirn * L * .1]], c: red, w: 2, arrow: true }); }
        Object.assign(vals, { [`v_${r.id}`]: s.v[i], [`x_${r.id}`]: s.x[i], [`a_${r.id}`]: s.a[i], [`F_${r.id}`]: Math.abs(s.F[i]), [`Q_${r.id}`]: s.Q[i], [`I_${r.id}`]: Math.abs(s.Ir[i]), [`Is_${r.id}`]: s.Ir[i], [`emfs_${r.id}`]: Bat(s.x[i], 0, t) * L * s.v[i] });
      });
      d.push({ k: 'text', at: [X1, L / 2 * 1.32], s: `I = ${fixed(Math.abs(s.I), 3)} A   E = ${fixed(Math.abs(s.emf), 3)} V`, c: red, size: 14, align: 'right' });
      if (C) vals.Uc = s.q[0] / C;
      return { draw: d, vals };
    };
    void green; void soft;
    return { name: '电磁感应', T, view: [X0, -L * .95, X1, L * .95], frame, marks, plot: { x: 't', y: `v_${rods[0].id}`, pts: hist.filter((_, i) => i % 6 === 0).map((s) => [s.t, s.v[0], s.t] as [number, number, number]) } };
  }
  if (sp.kind === 'frame') {
    const W = num(sp.w, vars, 1), Hh = num(sp.h, vars, W), R0 = num(sp.R, vars, 1), m0 = num(sp.m, vars, 1), R = R0, m = m0, turns = num(sp.N, vars, 1), v0 = sp.v ?? [0, 0];
    // 磁通量：框内积分。框小时分 48×48 足够，分段区域用解析重叠
    // 三点高斯积分：线性、二次的磁场都是精确的，分段区域按重叠矩形算
    const GX = [-Math.sqrt(.6), 0, Math.sqrt(.6)], GW = [5 / 9, 8 / 9, 5 / 9];
    const patch = (a: number, b: number, c: number, e: number, f: (px: number, py: number) => number) => { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += GW[i] * GW[j] * f((a + b) / 2 + GX[i] * (b - a) / 2, (c + e) / 2 + GX[j] * (e - c) / 2); return s * (b - a) * (e - c) / 4; };
    const flux = (x: number, y: number, t: number) => { let s = 0; if (regs.length) { for (const r of regs) { const a = Math.max(r.x[0], x), b = Math.min(r.x[1], x + W), c = Math.max(r.y[0], y), e = Math.min(r.y[1], y + Hh); if (b > a && e > c) s += typeof r.B === 'number' ? r.B * (b - a) * (e - c) : patch(a, b, c, e, (px, py) => num(r.B, { ...vars, x: px, y: py, t })); } } else s = patch(x, x + W, y, y + Hh, (px, py) => Bat(px, py, t)); return s * turns; };
    const S = { t: 0, x: num(sp.x, vars), y: num(sp.y, vars), vx: num(v0[0], vars), vy: num(v0[1], vars), Qh: 0, q: 0, I: 0, emf: 0, Fx: 0, Fy: 0 };
    const rate = (x: number, y: number, vx: number, vy: number, t: number, R = R0, m = m0) => {
      const e = Math.max(W, Hh) * 1e-4, et = 1e-5, gx = (flux(x + e, y, t) - flux(x - e, y, t)) / (2 * e), gy = (flux(x, y + e, t) - flux(x, y - e, t)) / (2 * e), gt = (flux(x, y, t + et) - flux(x, y, t - et)) / (2 * et);
      const emf = -(gx * vx + gy * vy + gt), I = emf / R, Fx = I * gx, Fy = I * gy;
      const ex = sp.F ? [num(sp.F[0], { ...vars, t, x, y, vx, vy }), num(sp.F[1], { ...vars, t, x, y, vx, vy })] : [0, 0];
      return { ax: (Fx + ex[0]) / m, ay: (Fy + ex[1]) / m - (sp.gravity ? g : 0), I, emf, Fx, Fy };
    };
    { const r0 = rate(S.x, S.y, S.vx, S.vy, 0); S.I = r0.I; S.emf = r0.emf; S.Fx = r0.Fx; S.Fy = r0.Fy; }
    const hist: (typeof S)[] = [{ ...S }], M = 12000, hh = T / M; let inside = flux(S.x, S.y, 0) !== 0;
    for (let i = 1; i <= M; i++) {
      const r1 = rate(S.x, S.y, S.vx, S.vy, S.t), r2 = rate(S.x + S.vx * hh / 2, S.y + S.vy * hh / 2, S.vx + r1.ax * hh / 2, S.vy + r1.ay * hh / 2, S.t + hh / 2);
      const nx = S.x + (S.vx + r1.ax * hh / 2) * hh, ny = S.y + (S.vy + r1.ay * hh / 2) * hh; S.vx += r2.ax * hh; S.vy += r2.ay * hh; S.x = nx; S.y = ny; S.t += hh; S.Qh += r2.I ** 2 * R * hh; S.q += Math.abs(r2.I) * hh; S.I = r2.I; S.emf = r2.emf; S.Fx = r2.Fx; S.Fy = r2.Fy;
      const now = Math.abs(r2.I) > tiny; if (now !== inside) { inside = now; marks.push({ t: S.t, label: now ? '开始切割' : '磁通量不再变' }); }
      hist.push({ ...S });
    }
    // 对比的线框：同样的初始条件，只改电阻、质量，竖直方向错开画
    const others = (sp.also ?? []).map((o) => {
      const Ro = num(o.R, vars, R0), mo = num(o.m, vars, m0), dy = num(o.dy, vars, Hh * 1.6), T2 = { ...hist[0], y: hist[0].y + dy, I: 0, Qh: 0, q: 0 }, h2: (typeof S)[] = [{ ...T2 }]; let on = flux(T2.x, T2.y, 0) !== 0;
      for (let i = 1; i <= M; i++) {
        const r1 = rate(T2.x, T2.y, T2.vx, T2.vy, T2.t, Ro, mo), r2 = rate(T2.x + T2.vx * hh / 2, T2.y + T2.vy * hh / 2, T2.vx + r1.ax * hh / 2, T2.vy + r1.ay * hh / 2, T2.t + hh / 2, Ro, mo);
        const nx = T2.x + (T2.vx + r1.ax * hh / 2) * hh, ny = T2.y + (T2.vy + r1.ay * hh / 2) * hh; T2.vx += r2.ax * hh; T2.vy += r2.ay * hh; T2.x = nx; T2.y = ny; T2.t += hh; T2.Qh += r2.I ** 2 * Ro * hh; T2.q += Math.abs(r2.I) * hh; T2.I = r2.I; T2.emf = r2.emf; T2.Fx = r2.Fx; T2.Fy = r2.Fy;
        const now = Math.abs(r2.I) > tiny; if (now !== on) { on = now; marks.push({ t: T2.t, label: `${o.label}${now ? '开始切割' : '磁通量不再变'}` }); }
        h2.push({ ...T2 });
      }
      return { label: o.label, dy, hist: h2 };
    });
    marks.sort((a, b) => a.t - b.t);
    const xs = hist.flatMap((s) => [s.x, s.x + W]), ys = hist.flatMap((s) => [s.y, s.y + Hh]).concat(others.flatMap((o) => [o.hist[0].y, o.hist[0].y + Hh])), reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), W, Hh), near = (v: number, list: number[]) => Number.isFinite(v) && v > Math.min(...list) - reach * .5 && v < Math.max(...list) + reach * .5, rx = regs.flatMap((r) => r.x.filter((v) => near(v, xs))), ry = regs.flatMap((r) => r.y.filter((v) => near(v, ys)));
    const big = Math.max(W, Hh), rxs = regs.flatMap((r) => r.x.filter(Number.isFinite)), lo = Math.min(...xs, ...rxs), hi = rxs.length ? Math.min(Math.max(...xs), Math.max(...rxs) + 2.5 * big) : Math.max(...xs), X0 = Math.max(lo, Math.min(...xs) - big), X1 = Math.max(hi, ...rx.filter((v) => v < hi + big)), Y0 = Math.min(...ys) - big * .4, Y1 = Math.max(...ys) + big * .4, pad = Math.max(X1 - X0, Y1 - Y0) * .08; void ry;
    const frame = (t: number) => {
      const s = blend(hist, t), d: Prim[] = [], vals = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, v: Math.hypot(s.vx, s.vy), I: Math.abs(s.I), emf: Math.abs(s.emf), Is: s.I, emfs: s.emf, Qh: s.Qh, q: s.q, F: Math.hypot(s.Fx, s.Fy), phi: flux(s.x, s.y, t), ke: .5 * m * (s.vx ** 2 + s.vy ** 2) };
      regionArt(d, X0 - pad, X1 + pad, Y0 - pad, Y1 + pad, t);
      d.push({ k: 'rect', x0: s.x, y0: s.y, x1: s.x + W, y1: s.y + Hh, c: '#8a5a24', w: 4, fill: '#8a5a2412' });
      const v = Math.hypot(s.vx, s.vy), cx = s.x + W / 2, cy = s.y + Hh / 2, L = Math.max(W, Hh) * .6;
      if (v > 1e-6) d.push({ k: 'line', p: [[cx, cy], [cx + s.vx / v * L, cy + s.vy / v * L]], c: blue, w: 2.5, arrow: true }, { k: 'text', at: [cx + s.vx / v * L, cy + s.vy / v * L], s: `v = ${fixed(v, 2)} m/s`, c: blue, size: 13, dy: -6 });
      const F = Math.hypot(s.Fx, s.Fy); if (F > 1e-9) d.push({ k: 'line', p: [[cx, cy], [cx + s.Fx / F * L * .8, cy + s.Fy / F * L * .8]], c: amber, w: 2.5, arrow: true });
      if (Math.abs(s.I) > tiny) { const ccw = s.I > 0; const c = red; d.push({ k: 'line', p: ccw ? [[s.x + W * .3, s.y], [s.x + W * .7, s.y]] : [[s.x + W * .7, s.y], [s.x + W * .3, s.y]], c, w: 2.5, arrow: true }, { k: 'line', p: ccw ? [[s.x + W * .7, s.y + Hh], [s.x + W * .3, s.y + Hh]] : [[s.x + W * .3, s.y + Hh], [s.x + W * .7, s.y + Hh]], c, w: 2.5, arrow: true }); }
      d.push({ k: 'text', at: [X1 + pad, Y1 + pad], s: `I = ${fixed(Math.abs(s.I), 3)} A   E = ${fixed(Math.abs(s.emf), 3)} V`, c: red, size: 14, align: 'right', dy: -6 });
      if (sp.label) d.push({ k: 'text', at: [s.x - W * .08, s.y + Hh / 2], s: sp.label, c: '#8a5a24', size: 15, align: 'right' });
      const all: Record<string, number> = vals;
      for (const o of others) {   // 对比的线框：换一个颜色，名字写在左边
        const q = blend(o.hist, t), ox = q.x + W / 2, oy = q.y + Hh / 2, ov = Math.hypot(q.vx, q.vy);
        d.push({ k: 'rect', x0: q.x, y0: q.y, x1: q.x + W, y1: q.y + Hh, c: '#2f6aa8', w: 4, fill: '#2f6aa812' }, { k: 'text', at: [q.x - W * .08, oy], s: o.label, c: '#2f6aa8', size: 15, align: 'right' });
        if (ov > 1e-6) d.push({ k: 'line', p: [[ox, oy], [ox + q.vx / ov * L, oy + q.vy / ov * L]], c: blue, w: 2.5, arrow: true }, { k: 'text', at: [ox + q.vx / ov * L, oy + q.vy / ov * L], s: `v = ${fixed(ov, 2)} m/s`, c: blue, size: 13, dy: -6 });
        Object.assign(all, { [`x_${o.label}`]: q.x, [`vx_${o.label}`]: q.vx, [`v_${o.label}`]: ov, [`I_${o.label}`]: Math.abs(q.I), [`Is_${o.label}`]: q.I, [`emfs_${o.label}`]: q.emf, [`Qh_${o.label}`]: q.Qh, [`q_${o.label}`]: q.q, [`F_${o.label}`]: Math.hypot(q.Fx, q.Fy) });
      }
      return { draw: d, vals: all };
    };
    return { name: '线框', T, view: [X0 - pad, Y0 - pad, X1 + pad, Y1 + pad], frame, marks, plot: { x: 't', y: 'I', pts: hist.filter((_, i) => i % 32 === 0).map((s) => [s.t, Math.abs(s.I), s.t] as [number, number, number]) } };
  }
  if (sp.kind === 'rotate') {
    const L0 = num(sp.L, { ...vars, a: 0 }, 1), r0 = num(sp.r0, vars), R = num(sp.R, vars, 1), Lmax = Math.max(...Array.from({ length: 91 }, (_, i) => num(sp.L, { ...vars, a: i * Math.PI / 45 }, 1)));
    const frame = (t: number) => {
      const w = num(sp.omega, { ...vars, t }), B = Bat(0, 0, t), a = w * t, L = num(sp.L, { ...vars, a }, 1), emf = .5 * B * w * (L ** 2 - r0 ** 2), I = emf / R, d: Prim[] = [];   // 棒的有效长度可随转角变（L 里可写 a）
      regionArt(d, -Lmax * 1.2, Lmax * 1.2, -Lmax * 1.2, Lmax * 1.2, t);
      d.push({ k: 'circle', at: [0, 0], r: L0, c: soft, w: 1, dash: [4, 4] }, { k: 'line', p: [[r0 * Math.cos(a), r0 * Math.sin(a)], [L * Math.cos(a), L * Math.sin(a)]], c: '#8a5a24', w: 7 }, { k: 'circle', at: [0, 0], rp: 5, fill: ink }, { k: 'text', at: [Lmax * 1.1, Lmax * 1.1], s: `E = ${fixed(Math.abs(emf), 3)} V   I = ${fixed(Math.abs(I), 3)} A`, c: red, size: 14, align: 'right' });
      return { draw: d, vals: { emf: Math.abs(emf), I: Math.abs(I), emfs: emf, Is: I, P: I * I * R, angle: a * 180 / Math.PI, L, F: Math.abs(B * I * L) } };
    };
    return { name: '转动切割', T, view: [-Lmax * 1.3, -Lmax * 1.3, Lmax * 1.3, Lmax * 1.3], frame };
  }
  // 线圈：磁场随时间变
  const S0 = num(sp.S, vars, 1), Nn = num(sp.N, vars, 1), R = num(sp.R, vars, 1), side = Math.sqrt(S0), M = 3000;
  let Qh = 0, q = 0; const qs: { Qh: number; q: number; I: number; emf: number; B: number }[] = [];
  for (let i = 0; i <= M; i++) { const t = T * i / M, e = 1e-5, emf = -Nn * S0 * (Bat(0, 0, t + e) - Bat(0, 0, t - e)) / (2 * e), I = emf / R; Qh += I * I * R * T / M; q += Math.abs(I) * T / M; qs.push({ Qh, q, I, emf, B: Bat(0, 0, t) }); }
  const frame = (t: number) => { const e = 1e-5, emf = -Nn * S0 * (Bat(0, 0, t + e) - Bat(0, 0, t - e)) / (2 * e), s = { ...qs[Math.round(t / T * M)], B: Bat(0, 0, t), emf, I: emf / R }, d: Prim[] = []; regionArt(d, -side, side, -side, side, t); d.push({ k: 'rect', x0: -side / 2, y0: -side / 2, x1: side / 2, y1: side / 2, c: '#8a5a24', w: 4 }, { k: 'text', at: [side, side], s: `B = ${fixed(s.B, 3)} T   I = ${fixed(Math.abs(s.I), 3)} A`, c: red, size: 14, align: 'right', dy: -6 }); return { draw: d, vals: { B: s.B, emf: Math.abs(s.emf), I: Math.abs(s.I), emfs: s.emf, Is: s.I, Qh: s.Qh, q: s.q } }; };
  return { name: '线圈', T, view: [-side * 1.2, -side * 1.2, side * 1.2, side * 1.2], frame, plot: { x: 't', y: 'I', pts: qs.filter((_, i) => i % 12 === 0).map((s, i) => [T * i * 12 / M, Math.abs(s.I), T * i * 12 / M] as [number, number, number]) } };
}
