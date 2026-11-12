// LC（RLC）振荡电路：L·q'' + R·q' + q/C = 0，按 RK4 小步积分（R = 0 时与解析解一致）。
// 取电容上极板电荷 q（上正为正），回路电流 i = dq/dt（给上极板充电的方向为正）。电场能 q²/2C、磁场能 Li²/2 来回转化。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber } from './common.ts';
import type { Num } from '../sim.ts';

export type LcSpec = { L: Num; C: Num; R?: Num; U0?: Num; q0?: Num; I0?: Num; duration?: Num };
export function lc(sp: LcSpec, vars: Record<string, number>): LabOut {
  const L = num(sp.L, vars), C = num(sp.C, vars), R = num(sp.R, vars, 0);
  if (!(L > 0 && C > 0) || R < 0) throw new Error('LC 振荡：L、C 必须大于 0，R 不能为负');
  const q0 = sp.q0 !== undefined ? num(sp.q0, vars) : num(sp.U0, vars, 0) * C, I0 = num(sp.I0, vars, 0);
  if (q0 === 0 && I0 === 0) throw new Error('LC 振荡：要给电容初始电压 U0（或电荷 q0）或初始电流 I0');
  const w0 = 1 / Math.sqrt(L * C), T0 = 2 * Math.PI / w0, T = num(sp.duration, vars, 2 * T0);
  const N = 4000, h = T / N, hist: { t: number; q: number; i: number }[] = [{ t: 0, q: q0, i: I0 }];
  const f = (q: number, i: number): [number, number] => [i, -(R * i + q / C) / L];
  let q = q0, i = I0;
  for (let k = 1; k <= N; k++) { const a = f(q, i), b = f(q + a[0] * h / 2, i + a[1] * h / 2), c = f(q + b[0] * h / 2, i + b[1] * h / 2), d = f(q + c[0] * h, i + c[1] * h); q += (a[0] + 2 * b[0] + 2 * c[0] + d[0]) * h / 6; i += (a[1] + 2 * b[1] + 2 * c[1] + d[1]) * h / 6; hist.push({ t: k * h, q, i }); }
  const at = (t: number) => { const x = Math.min(N, Math.max(0, t / h)), k = Math.min(N - 1, Math.floor(x)), u = x - k, A = hist[k], B = hist[k + 1]; return { q: A.q + (B.q - A.q) * u, i: A.i + (B.i - A.i) * u }; };
  const Emax = q0 * q0 / (2 * C) + L * I0 * I0 / 2, qMax = Math.max(...hist.map((s) => Math.abs(s.q)), 1e-30), iMax = Math.max(...hist.map((s) => Math.abs(s.i)), 1e-30);
  const marks: { t: number; label: string }[] = [];
  for (let k = 1; k <= N; k++) {   // 过零时刻线性插值
    const A = hist[k - 1], B = hist[k];
    if (A.q * B.q < 0 || (B.q === 0 && A.q !== 0)) marks.push({ t: A.t + h * A.q / (A.q - B.q), label: '放电完毕' });
    if (A.i * B.i < 0 || (B.i === 0 && A.i !== 0)) marks.push({ t: A.t + h * A.i / (A.i - B.i), label: '充电完毕' });
  }
  const wd = R ? Math.sqrt(Math.max(0, 1 / (L * C) - (R / (2 * L)) ** 2)) : w0;
  const frame = (t: number) => {
    const s = at(t), di = -(R * s.i + s.q / C) / L, EC = s.q * s.q / (2 * C), EL = L * s.i * s.i / 2;
    const vals: Record<string, number> = { q: s.q, i: s.i, I: Math.abs(s.i), uC: s.q / C, uL: L * di, EC, EL, E: EC + EL, T: wd ? 2 * Math.PI / wd : Infinity, f: wd / (2 * Math.PI), T0, Q: Emax - EC - EL };   // Q：电阻上累计的焦耳热
    const d: Prim[] = [];
    // 回路：左边电容（竖放两块极板），右边线圈，上下导线
    const X0 = .15, X1 = .65, Y0 = .2, Y1 = .8, cy = .5, gap = .06;
    d.push({ k: 'line', p: [[X0, cy + gap / 2], [X0, Y1], [X1, Y1], [X1, .66]], c: ink, w: 2 }, { k: 'line', p: [[X1, .34], [X1, Y0], [X0, Y0], [X0, cy - gap / 2]], c: ink, w: 2 });
    d.push({ k: 'line', p: [[X0 - .07, cy + gap / 2], [X0 + .07, cy + gap / 2]], c: ink, w: 4 }, { k: 'line', p: [[X0 - .07, cy - gap / 2], [X0 + .07, cy - gap / 2]], c: ink, w: 4 });
    const nq = Math.round(5 * Math.abs(s.q) / qMax), top = s.q >= 0 ? '+' : '−', bot = s.q >= 0 ? '−' : '+';
    for (let k = 0; k < nq; k++) { const x = X0 - .055 + k * .11 / Math.max(1, 4); d.push({ k: 'text', at: [x, cy + gap / 2 + .03], s: top, c: top === '+' ? red : blue, size: 13, bold: true }, { k: 'text', at: [x, cy - gap / 2 - .045], s: bot, c: bot === '+' ? red : blue, size: 13, bold: true }); }
    for (let k = 0; k < nq; k++) { const x = X0 - .05 + k * .1 / Math.max(1, 4); d.push({ k: 'line', p: s.q >= 0 ? [[x, cy + gap / 2 - .005], [x, cy - gap / 2 + .005]] : [[x, cy - gap / 2 + .005], [x, cy + gap / 2 - .005]], c: '#c9711a99', w: 1.2, arrow: true }); }   // 极板间电场线，疏密表示电场强弱
    const coil: number[][] = []; for (let k = 0; k <= 120; k++) { const u = k / 120, y = .66 - .32 * u; coil.push([X1 + .035 * Math.sin(u * Math.PI * 12), y]); } d.push({ k: 'line', p: coil, c: '#8a5a24', w: 2 });
    const nb = Math.round(3 * Math.abs(s.i) / iMax); for (let k = 0; k < nb; k++) { const x = X1 + (k - (nb - 1) / 2) * .02; d.push({ k: 'line', p: s.i >= 0 ? [[x, .3], [x, .7]] : [[x, .7], [x, .3]], c: '#1c5fc4aa', w: 1.4, arrow: true }); }   // 线圈里的磁感线（示意），穿过线圈，疏密表示磁场强弱
    if (Math.abs(s.i) > iMax * .02) { const dir = s.i >= 0 ? 1 : -1, len = .06 + .1 * Math.abs(s.i) / iMax; d.push({ k: 'line', p: dir > 0 ? [[.4 + len / 2, Y1], [.4 - len / 2, Y1]] : [[.4 - len / 2, Y1], [.4 + len / 2, Y1]], c: amber, w: 3, arrow: true }); d.push({ k: 'text', at: [.4, Y1], s: `i = ${fmtA(Math.abs(s.i))}`, c: amber, size: 13, dy: -12 }); }   // 上导线：给上极板充电时电流向左
    d.push({ k: 'text', at: [X0, Y0], s: `C = ${fmtSI(C, 'F')}`, c: soft, size: 12.5, dx: -10, dy: 18, align: 'left' }, { k: 'text', at: [X1, Y0], s: `L = ${fmtSI(L, 'H')}${R ? `　R = ${fixed(R, 2)} Ω` : ''}`, c: soft, size: 12.5, dy: 18 });
    // 右边能量条
    const bar = (x: number, v: number, c: string, s2: string) => { const hh = .5 * v / Math.max(Emax, 1e-30); d.push({ k: 'rect', x0: x, y0: .25, x1: x + .06, y1: .25 + hh, fill: c, c: ink, w: 1 }, { k: 'text', at: [x + .03, .25], s: s2, c: ink, size: 12.5, dy: 16 }); };
    d.push({ k: 'line', p: [[.8, .25], [1.02, .25]], c: ink, w: 1 }); bar(.82, EC, '#c9711a', '电场能'); bar(.93, EL, '#1c5fc4', '磁场能');
    return { draw: d, vals };
  };
  const plot = { x: 't', y: 'q', pts: hist.filter((_, k) => k % 20 === 0).map((s) => [s.t, s.q, s.t] as [number, number, number]) };
  return { name: 'LC 振荡', T, view: [0, .05, 1.08, .92], frame, marks: marks.sort((a, b) => a.t - b.t), plot, flat: true };
}
const fmtSI = (x: number, u: string) => { const a = Math.abs(x); return a >= 1 ? `${fixed(x, 3)} ${u}` : a >= 1e-3 ? `${fixed(x * 1e3, 3)} m${u}` : a >= 1e-6 ? `${fixed(x * 1e6, 3)} μ${u}` : a >= 1e-9 ? `${fixed(x * 1e9, 3)} n${u}` : `${fixed(x * 1e12, 3)} p${u}`; };
const fmtA = (x: number) => fmtSI(x, 'A');
