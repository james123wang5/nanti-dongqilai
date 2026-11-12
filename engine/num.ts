// 把引擎算出的浮点数认成高考答案常见的形式：整数、a/b、a√r/b、aπ/b；认不出就给小数。

const EPS = 1e-9;   // 引擎算到 1e-10 左右，认形式时要求足够贴合，避免把普通小数硬认成根式

function frac(x: number, maxDen = 200): [number, number] | null {
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < EPS * Math.max(1, Math.abs(x))) return [n, d];
  }
  return null;
}

const fmtFrac = (n: number, d: number, tail = '') => {
  if (d === 1) return n === 1 && tail ? tail : n === -1 && tail ? `-${tail}` : `${n}${tail}`;
  const head = n === 1 && tail ? tail : n === -1 && tail ? `-${tail}` : `${n}${tail}`;
  return `${head}/${d}`;
};

export function nice(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (Math.abs(x) < 1e-30) return '0';
  if (Math.abs(x) < 1e-4 || Math.abs(x) >= 1e7) return Number(x.toPrecision(3)).toExponential();   // 微观量和大数用科学计数法
  const f = frac(x);
  // 分母只含 2 和 5、三位小数以内的（1/20、3/8）写成小数，试卷上就是这样写的
  if (f && f[1] > 1 && f[1] <= 1000 && 1000 % f[1] === 0 && Math.abs(x) < 1e4) return String(Number(x.toFixed(3)));
  if (f && (f[1] === 1 || Math.abs(f[0]) < 1e5)) return fmtFrac(f[0], f[1]);
  for (const r of [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23, 26, 29, 30, 31, 33, 34, 35, 37, 38, 39, 41, 42, 43, 46, 47]) {
    const g = frac(x / Math.sqrt(r), 36);
    if (g && g[0] !== 0 && Math.abs(g[0]) < 2000) return fmtFrac(g[0], g[1], `√${r}`);
  }
  const pi = frac(x / Math.PI, 36);
  if (pi && pi[0] !== 0 && Math.abs(pi[0]) < 2000) return fmtFrac(pi[0], pi[1], 'π');
  return Number(x.toPrecision(4)).toString();
}

/** 两个数在答案意义上相等（相对 1e-3，或绝对 1e-6） */
export const same = (a: number, b: number, rel = 1e-3) => Math.abs(a - b) <= Math.max(1e-6, rel * Math.max(Math.abs(a), Math.abs(b)));
/**
 * 核对答案：所给答案和引擎结果相对误差 1e-3 以内算一致。
 * 只有所给答案恰好是 0 时才用绝对容差 1e-6（零值没有相对尺度，引擎会有极小的数值噪声）；
 * 所给答案是很小的非零数（微观能量、电荷、微秒时间）时只按相对误差比，不会因为“都很小”就判一致。
 */
export const sameAnswer = (claimed: number, engine: number, rel = 1e-3) => claimed === 0 ? Math.abs(engine) <= 1e-6 : Math.abs(claimed - engine) <= rel * Math.max(Math.abs(claimed), Math.abs(engine));
