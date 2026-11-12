// 实验：打点纸带和数据表。逐差法、线性拟合都由引擎算。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber } from './common.ts';
import type { Num } from '../sim.ts';

export type ExperimentSpec = {
  tape?: { d: Num[]; T: Num };                       // 相邻计数点间距（m），时间间隔
  table?: { x: Num[]; y: Num[]; xLabel?: string; yLabel?: string };
  duration?: Num;
};
export function experiment(sp: ExperimentSpec, vars: Record<string, number>): LabOut {
  const T = num(sp.duration, vars, 6);
  if (sp.tape) {
    const d = sp.tape.d.map((x) => num(x, vars)), Ts = num(sp.tape.T, vars), xs = [0]; d.forEach((x) => xs.push(xs.at(-1)! + x));
    const n = d.length, half = Math.floor(n / 2), a = (d.slice(n - half).reduce((p, q) => p + q, 0) - d.slice(0, half).reduce((p, q) => p + q, 0)) / (half * half * Ts * Ts), L = xs.at(-1)!;
    const frame = (t: number) => {
      const draw: Prim[] = [{ k: 'rect', x0: -L * .05, y0: -L * .06, x1: L * 1.05, y1: L * .06, fill: '#f3ead5', c: ink, w: 1.2 }], vals: Record<string, number> = { a, T: Ts }, show = Math.min(n, Math.floor(t / T * (n + 1)));
      xs.forEach((x, i) => { if (i <= show) draw.push({ k: 'circle', at: [x, 0], rp: 3.2, fill: ink }, { k: 'text', at: [x, -L * .06], s: String(i), c: soft, size: 12, dy: 16 }); });
      d.forEach((x, i) => { if (i < show) draw.push({ k: 'text', at: [xs[i] + x / 2, L * .06], s: `${fixed(x * 100, 2)} cm`, c: blue, size: 12, dy: -8 }); });
      for (let i = 1; i < n; i++) vals[`v_${i}`] = (d[i - 1] + d[i]) / (2 * Ts);
      draw.push({ k: 'text', at: [L / 2, L * .16], s: `逐差法 a = ${fixed(a, 3)} m/s²`, c: red, size: 15, bold: true });
      return { draw, vals };
    };
    return { name: '纸带', T, view: [-L * .1, -L * .2, L * 1.1, L * .24], frame, flat: true };
  }
  const x = sp.table!.x.map((v) => num(v, vars)), y = sp.table!.y.map((v) => num(v, vars)), n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  const sxy = x.reduce((a, v, i) => a + (v - mx) * (y[i] - my), 0), sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0), syy = y.reduce((a, v) => a + (v - my) ** 2, 0), k = sxy / sxx, b = my - k * mx, r = sxy / Math.sqrt(sxx * syy);
  const X0 = Math.min(...x, 0), X1 = Math.max(...x), Y0 = Math.min(...y, 0), Y1 = Math.max(...y), W = X1 - X0 || 1, H = Y1 - Y0 || 1, U = (v: number) => (v - X0) / W, V = (v: number) => (v - Y0) / H;
  const frame = (t: number) => {
    const draw: Prim[] = [{ k: 'line', p: [[0, 1.08], [0, 0], [1.1, 0]], c: ink, w: 1.8 }, { k: 'text', at: [1.1, 0], s: sp.table!.xLabel ?? 'x', c: ink, size: 14, dy: 18, align: 'right' }, { k: 'text', at: [0, 1.08], s: sp.table!.yLabel ?? 'y', c: ink, size: 14, dx: 8, align: 'left' }], show = Math.ceil(t / T * n * 1.2);
    x.forEach((v, i) => { if (i < show) draw.push({ k: 'circle', at: [U(v), V(y[i])], rp: 4, fill: red }); });
    if (show >= n) { draw.push({ k: 'line', p: [[U(X0), V(k * X0 + b)], [U(X1), V(k * X1 + b)]], c: blue, w: 2 }); draw.push({ k: 'text', at: [.55, 1.04], s: `拟合：斜率 ${fixed(k, 4)}，截距 ${fixed(b, 4)}`, c: blue, size: 14 }); }
    void amber;
    return { draw, vals: { k, b, r } };
  };
  return { name: '数据处理', T, view: [-.14, -.14, 1.2, 1.18], frame, flat: true };
}
