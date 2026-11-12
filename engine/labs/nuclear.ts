// 原子核：放射性衰变（含衰变链）、核反应方程的质量数/电荷数守恒、质量亏损放出的能量。
// 衰变按 N = N0·(1/2)^(t/T½) 解析计算（衰变链按贝特曼公式逐级算）；点阵里每个原子的衰变时刻按指数分布的分位数分配，
// 任一时刻还没衰变的点数正好等于理论值（取整）。核反应左右两边 A、Z 不守恒时报错，告诉 AI 哪边对不上。
import { type LabOut, type Prim, num, fixed, ink, soft, red, blue, amber, green, violet } from './common.ts';
import type { Num } from '../sim.ts';

type Nuc = [string, number, number];   // [符号, 质量数 A, 电荷数 Z]
export type NuclearSpec = {
  duration?: Num; dots?: number;
  species?: { id: string; N0?: Num; m0?: Num; half?: Num; to?: string; A?: number; Z?: number }[];   // half 省略表示稳定；to 是衰变产物（衰变链）
  reaction?: { left: Nuc[]; right: Nuc[]; masses?: Record<string, Num>; unit?: 'u' | 'kg' };      // masses 按符号给静质量；u 时 1 u = 931.5 MeV
};
const COLORS = [blue, red, green, amber, violet, '#3d7fb8'];
const LN2 = Math.LN2;

export function nuclear(sp: NuclearSpec, vars: Record<string, number>): LabOut {
  const S = (sp.species ?? []).map((s) => ({ id: s.id, N0: num(s.N0, vars, 0), m0: s.m0 === undefined ? undefined : num(s.m0, vars), half: s.half === undefined ? Infinity : num(s.half, vars), to: s.to, A: s.A, Z: s.Z }));
  for (const s of S) { if (!(s.half > 0)) throw new Error(`原子核：${s.id} 的半衰期必须大于 0`); if (s.to && !S.some((x) => x.id === s.to)) throw new Error(`原子核：${s.id} 的衰变产物 ${s.to} 不在 species 里`); }
  const byId = new Map(S.map((s) => [s.id, s]));
  // 核反应方程：A、Z 守恒检查，质量亏损算能量
  let Q: number | undefined, dm: number | undefined, eqText = '', AZ: Record<string, number> = {};
  if (sp.reaction) {
    const sum = (list: Nuc[], k: 1 | 2) => list.reduce((s, n) => s + n[k], 0), L = sp.reaction.left, R = sp.reaction.right;
    const dA = sum(L, 1) - sum(R, 1), dZ = sum(L, 2) - sum(R, 2);
    AZ = { A_in: sum(L, 1), A_out: sum(R, 1), Z_in: sum(L, 2), Z_out: sum(R, 2) };
    if (dA || dZ) throw new Error(`原子核：核反应方程不守恒——左边质量数 ${sum(L, 1)}、电荷数 ${sum(L, 2)}，右边质量数 ${sum(R, 1)}、电荷数 ${sum(R, 2)}；请检查各粒子的 A、Z（中子 [n,1,0]，质子 [p,1,1]，α [He,4,2]，β⁻ [e,0,-1]，β⁺ [e,0,1]，γ [γ,0,0]）`);
    const ms = sp.reaction.masses;
    if (ms) {
      const mass = (n: Nuc) => { if (ms[n[0]] === undefined) throw new Error(`原子核：masses 里没有 ${n[0]} 的质量`); return num(ms[n[0]], vars); };
      dm = L.reduce((s, n) => s + mass(n), 0) - R.reduce((s, n) => s + mass(n), 0);
      Q = (sp.reaction.unit ?? 'u') === 'u' ? dm * 931.5 : dm * (2.99792458e8) ** 2 / 1.602176634e-13;   // MeV
    }
    const show = (n: Nuc) => `${n[0]}(${n[1]},${n[2]})`;
    eqText = `${L.map(show).join(' + ')} → ${R.map(show).join(' + ')}`;
  }
  const maxHalf = Math.max(...S.filter((s) => Number.isFinite(s.half)).map((s) => s.half), 0);
  const T = num(sp.duration, vars, maxHalf ? 4 * maxHalf : 1);
  // 贝特曼：每种母核的初始量沿衰变链传下去
  const lam = (s: (typeof S)[number]) => Number.isFinite(s.half) ? LN2 / s.half : 0;
  const amount = (t: number): Record<string, number> => {
    const out: Record<string, number> = Object.fromEntries(S.map((s) => [s.id, 0]));
    for (const root of S) { if (!root.N0) continue; const chain = [root]; while (chain.at(-1)!.to && chain.length < 12) chain.push(byId.get(chain.at(-1)!.to!)!);
      const L = chain.map(lam);
      chain.forEach((c, n) => { // N_n(t) = N0 · Π_{i<n} λ_i · Σ_i e^{-λ_i t} / Π_{j≠i}(λ_j − λ_i)
        let v = 0; const pre = L.slice(0, n).reduce((p, x) => p * x, 1);
        for (let i = 0; i <= n; i++) { let den = 1; for (let j = 0; j <= n; j++) if (j !== i) den *= (L[j] - L[i]) || 1e-300; v += Math.exp(-L[i] * t) / den; }
        out[c.id] += root.N0 * (n === 0 ? Math.exp(-L[0] * t) : pre * v); }); }
    return out;
  };
  // 点阵：只画第一个有初始量的母核（链上的产物换颜色）
  const root = S.find((s) => s.N0 > 0), nDots = Math.max(16, Math.min(400, Math.round(sp.dots ?? 196))), side = Math.ceil(Math.sqrt(nDots));
  const chain = root ? (() => { const c = [root]; while (c.at(-1)!.to && c.length < 12) c.push(byId.get(c.at(-1)!.to!)!); return c; })() : [];
  // 每个点在链上各级的停留时间按分位数分配，再打乱位置（固定种子），保证每一刻各级的点数等于理论比例
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shuffle = () => { const a = Array.from({ length: nDots }, (_, i) => i); for (let i = nDots - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };   // 均匀洗牌：衰变的点在点阵里随机分布
  const stageTimes = chain.map((c) => { const order = shuffle(); return Array.from({ length: nDots }, (_, i) => { const q = (order[i] + .5) / nDots; return lam(c) ? -Math.log(1 - q) / lam(c) : Infinity; }); });
  const dotStage = (i: number, t: number) => { let acc = 0; for (let k = 0; k < chain.length; k++) { acc += stageTimes[k][i]; if (t < acc) return k; } return chain.length; };   // 链走完（衰变成没列出的产物）算单独一级，画灰色
  const frame = (t: number) => {
    const N = amount(t), d: Prim[] = [], vals: Record<string, number> = {};
    for (const s of S) {
      vals[`N_${s.id}`] = N[s.id]; vals[`half_${s.id}`] = s.half; vals[`lambda_${s.id}`] = lam(s); vals[`A_${s.id}`] = lam(s) * N[s.id];   // 活度：单位时间衰变数
      const total = S.reduce((a, x) => a + (x.N0 || 0), 0); if (s.N0) vals[`frac_${s.id}`] = N[s.id] / s.N0; if (s.m0 !== undefined && s.N0) vals[`m_${s.id}`] = s.m0 * N[s.id] / s.N0; void total;
    }
    if (root) { vals.decayed = root.N0 - N[root.id]; vals.n_half = Number.isFinite(root.half) ? t / root.half : 0; }
    if (Q !== undefined) { vals.Q = Q; vals.dm = dm!; } Object.assign(vals, AZ);
    vals.t = t;
    // 点阵（左边）
    if (root) {
      const shown = [...chain.map(() => 0), 0];
      for (let i = 0; i < nDots; i++) { const k = dotStage(i, t), x = (i % side) / side, y = Math.floor(i / side) / side; shown[k]++; d.push({ k: 'circle', at: [x * .9 + .05, .95 - y * .9], rp: Math.max(2.5, 150 / side / 2.4), fill: k === chain.length ? '#d8d2c4' : COLORS[k % COLORS.length], c: '#00000033', w: .6 }); }
      chain.forEach((c, k) => d.push({ k: 'text', at: [1.08, .9 - k * .08], s: `${c.id}：${fixed(N[c.id] / (root.N0 || 1) * 100, 1)}%`, c: COLORS[k % COLORS.length], size: 13.5, align: 'left', bold: k === 0 }));
      const tail = chain.at(-1)!; if (Number.isFinite(tail.half)) d.push({ k: 'text', at: [1.08, .9 - chain.length * .08], s: `灰点：${tail.id} 已衰变`, c: '#9a937f', size: 12.5, align: 'left' });
      if (Number.isFinite(root.half)) d.push({ k: 'text', at: [1.08, .9 - chain.length * .08 - .12], s: `已过 ${fixed(t / root.half, 2)} 个半衰期`, c: soft, size: 13, align: 'left' });
    }
    if (eqText) d.push({ k: 'text', at: [.5, -.1], s: eqText + (Q !== undefined ? `　放出 ${fixed(Q, 2)} MeV` : ''), c: ink, size: 14, align: 'center', bold: true });
    return { draw: d, vals };
  };
  const marks: { t: number; label: string }[] = [];
  for (const s of S) if (Number.isFinite(s.half) && s.N0) for (let k = 1; k * s.half <= T + 1e-12 && k <= 8; k++) marks.push({ t: k * s.half, label: `${s.id} 第${k}个半衰期` });
  const plot = root ? { x: 't', y: `N_${root.id}`, pts: Array.from({ length: 121 }, (_, i) => { const t = T * i / 120; return [t, amount(t)[root.id], t] as [number, number, number]; }) } : undefined;
  return { name: '原子核', T, view: [-.05, -.2, 1.65, 1.05], frame, marks: marks.sort((a, b) => a.t - b.t), plot, flat: true };
}
void soft;
