// 图表放在画面下方的固定条里，时间轴和播放条上下对齐：竖线就是播放进度。
// 坐标轴和曲线只在换问或缩放时生成，播放时只更新游标、面积和读数。
import type { Problem } from '../engine/solve.ts';
import type { SimResult, Snapshot, V2 } from '../engine/sim.ts';
import { MEANING } from './visual-rules.ts';
import { COLORS } from './geometry.ts';
import { chartSnapshots, sampleAt } from './timeline.ts';
const $ = (id: string) => document.getElementById(id)!;
const C = { ink: '#1a262a', soft: '#7c8680', line: '#d8d1bf', red: MEANING.target, amber: '#c9711a', green: MEANING.verified, blue: '#1c5fc4' };
const MATH = '"Times New Roman", "PingFang SC", serif';
export type ChartOptions = { mode?: 'waiting' | 'watching' | 'normal'; letters?: boolean; baseSim?: SimResult; basePlot?: [number, number, number][] };
type State = ChartOptions & { sim: SimResult; P: Problem; view: number; w0: number; w1: number; t: number };
type Series = { name: string; color: string; unit: string; get: (s: Snapshot) => number };
const ids = new WeakMap<object, number>(); let seq = 0;
const identity = (o?: object) => { if (!o) return 0; if (!ids.has(o)) ids.set(o, ++seq); return ids.get(o)!; };
const reading = (s: string, letters?: boolean) => s + (letters ? '（示例）' : '');
function setReading(node: Element, text: string, letters?: boolean) {
  node.textContent = text; if (letters) el('tspan', { fill: C.soft }, node, '（示例）');
}
let cache: { key: string; update: (s: Snapshot, t: number) => void } | undefined;
function el(tag: string, attrs: Record<string, string | number>, parent: Element, text?: string) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e); return e;
}
const fmt = (v: number) => { const a = Math.abs(v); if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2).replace('e+', 'e'); return String(+v.toPrecision(3)); };
/** 时间轴的左右端：和播放条滑块的中心对齐 */
function rail(svg: Element) {
  const s = svg.getBoundingClientRect(), r = $('scrub').getBoundingClientRect();
  const L = Math.max(50, Math.min(90, r.left - s.left + 7)), R = Math.min(s.width - (s.width < 500 ? 90 : 150), r.right - s.left - 7);
  return r.width > 50 ? { L, R: Math.max(L + 80, R) } : { L: 64, R: Math.max(150, s.width - 150) };
}
function clipCurves(svg: Element, L: number, R: number, T: number, B: number) {
  const defs = el('defs', {}, svg), clip = el('clipPath', { id: 'chart-ink-clip' }, defs);
  el('rect', { x: L, y: T - 4, width: Math.max(0, R - L), height: Math.max(0, B - T + 8) }, clip);
  svg.querySelectorAll('polyline,polygon').forEach((e) => e.setAttribute('clip-path', 'url(#chart-ink-clip)'));
}
function frame(svg: Element, L: number, R: number, T: number, B: number, y0: number, y1: number, yName: string, letters = false) {
  const Y = (v: number) => B - (v - y0) / (y1 - y0 || 1) * (B - T);
  for (let k = 1; k <= 3; k++) el('line', { x1: L, y1: B - (B - T) * k / 3, x2: R, y2: B - (B - T) * k / 3, stroke: C.line, 'stroke-dasharray': '2 5' }, svg);
  el('line', { x1: L, y1: B, x2: R, y2: B, stroke: C.soft }, svg); el('line', { x1: L, y1: T - 4, x2: L, y2: B, stroke: C.soft }, svg);
  if (y0 < 0 && y1 > 0) el('line', { x1: L, y1: Y(0), x2: R, y2: Y(0), stroke: C.soft }, svg);
  const tx = (x: number, y: number, s: string, anchor = 'end') => el('text', { x, y, 'text-anchor': anchor, 'font-size': 13, 'font-family': MATH, fill: C.soft }, svg, s);
  if (!letters) { tx(L - 6, Y(y1) + 4, fmt(y1)); tx(L - 6, Y(y0) + 4, fmt(y0)); } else tx(L - 6, Y(0) + 4, '0'); if (!letters && y0 < 0 && y1 > 0) tx(L - 6, Y(0) + 4, '0');
  el('text', { x: L - 6, y: T - 8, 'text-anchor': 'end', 'font-size': 13, 'font-style': 'italic', 'font-family': MATH, fill: C.ink }, svg, yName);
  return Y;
}
const pad = (lo: number, hi: number): [number, number] => { if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) return [Math.min(lo, 0), Math.max(hi, lo + 1)]; return [lo >= 0 && lo < hi * .3 ? 0 : lo, hi]; };

function seriesOf(st: State, rng: Snapshot[]): { list: Series[]; yName: string; relPair?: [Series, Series] } {
  const { sim, P, view } = st, a = view >= 0 ? P.asks[view] : undefined;
  if (sim.circuit) {
    const useU = /U\(|电压|示数/.test(`${a?.expr ?? ''}${a?.text ?? ''}`) && !/I\(/.test(a?.expr ?? '');
    const pick = sim.circuit.elements.filter((e) => useU ? e.kind === 'voltmeter' || e.kind === 'capacitor' : e.kind === 'ammeter' || e.kind === 'battery').slice(0, 3);
    return { yName: useU ? 'U / V' : 'I / A', list: pick.map((e, i) => ({ name: e.id, color: COLORS[i % COLORS.length], unit: useU ? 'V' : 'A', get: (s) => Math.abs(useU ? s.circuit?.U[e.id] ?? 0 : s.circuit?.I[e.id] ?? 0) })) };
  }
  const relId = /rel\(([^)]+)\)/.exec(a?.expr ?? '')?.[1].trim(), relHost = relId ? rng[0]?.bodies[relId]?.on ?? undefined : undefined, ang = relId ? rng[0]?.bodies[relId]?.ang ?? 0 : 0;
  const speed = (s: Snapshot, id: string) => relId ? s.bodies[id].vx * Math.cos(ang) + s.bodies[id].vy * Math.sin(ang) : Math.hypot(s.bodies[id].vx, s.bodies[id].vy);
  const list: Series[] = sim.geo.bodies.map((g, i) => ({ name: g.id, color: COLORS[i % COLORS.length], unit: 'm/s', get: (s: Snapshot) => s.bodies[g.id] ? speed(s, g.id) : 0 })).filter((q) => rng.some((s) => Math.abs(q.get(s)) > 1e-6) || q.name === relId || q.name === relHost).slice(0, 6);
  const up = list.find((q) => q.name === relId), dn = list.find((q) => q.name === relHost);
  return { list, yName: 'v / (m/s)', relPair: up && dn ? [up, dn] : undefined };
}
const wantsEnergy = (st: State) => { if (st.view < 0 || st.sim.circuit) return false; const a = st.P.asks[st.view]; return /Q\(|KE\(|PE\(|Ep\(/.test(a.expr ?? '') || /生热|内能|机械能|动能|势能/.test(a.text ?? ''); };

export function hasChart(sim: SimResult, w0: number, w1: number) {
  if (sim.script || sim.board) return false;
  if (!sim.circuit) return true;
  const list = chartSnapshots(sim, w0, w1), first = list[0]?.circuit?.I ?? {};
  return list.some((s) => Object.keys(first).some((k) => Math.abs((s.circuit?.I[k] ?? 0) - first[k]) > 1e-6 * (1 + Math.abs(first[k]))));
}

export function drawChart(snap: Snapshot, st: State) {
  const svg = $('chart'), width = Math.max(300, svg.clientWidth), height = Math.max(90, svg.clientHeight), { L, R } = rail(svg);
  const key = [st.sim.end.t, st.view, st.w0, st.w1, width, height, L, R, st.P.title, st.mode, st.letters, identity(st.sim), identity(st.baseSim)].join('|');
  if (cache?.key === key && svg.childElementCount) { cache.update(snap, st.t); return; }
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.replaceChildren();
  const rng = chartSnapshots(st.sim, st.w0, st.w1), save = (update: (s: Snapshot, t: number) => void) => { cache = { key, update }; update(snap, st.t); };
  if (st.mode === 'waiting') { frame(svg, L, R, 20, height - 12, 0, 1, wantsEnergy(st) ? 'E / J' : seriesOf(st, rng).yName, true); save(() => {}); return; }
  if (wantsEnergy(st)) { energy(svg, st, rng, width, height, save); return; }
  const { list, yName, relPair } = seriesOf(st, rng), T = 20, B = height - 12, vals = rng.flatMap((s) => list.map((q) => q.get(s))), [y0, y1] = pad(Math.min(0, ...vals), Math.max(...vals, 1e-9));
  const baseRng = st.baseSim ? chartSnapshots(st.baseSim, st.w0, st.w1) : [];
  const baseList = st.baseSim ? seriesOf({ ...st, sim: st.baseSim }, baseRng).list : [];
  const baseVals = baseRng.flatMap((s) => baseList.map((q) => q.get(s)));
  const Y = frame(svg, L, R, T, B, Math.min(y0, ...baseVals), Math.max(y1, ...baseVals), yName, st.letters), X = (t: number) => L + (t - st.w0) / (st.w1 - st.w0 || 1) * (R - L);
  const area = relPair ? el('polygon', { fill: MEANING.displacement, opacity: .13 }, svg) : undefined;
  if (st.mode === 'waiting') { save(() => {}); return; }
  const points = (snaps: Snapshot[], q: Series) => snaps.map((s) => `${X(s.t).toFixed(1)},${Y(q.get(s)).toFixed(1)}`).join(' ');
  baseList.forEach((q) => el('polyline', { points: points(baseRng, q), stroke: q.color, 'stroke-dasharray': '6 4', opacity: .4, 'stroke-width': 2, fill: 'none', 'data-base': q.name }, svg));
  const drawn = list.map((q) => {
    const future = el('polyline', { points: points(rng, q), stroke: q.color, opacity: st.mode === 'watching' ? 0 : .25, 'data-future': q.name, 'stroke-width': 2, fill: 'none' }, svg);
    const past = el('polyline', { points: '', stroke: q.color, 'data-series': q.name, 'stroke-width': 2, 'stroke-linejoin': 'round', fill: 'none' }, svg);
    return { q, future, past, dot: el('circle', { r: 3.6, fill: q.color, stroke: '#fffdf8', 'stroke-width': 1.6 }, svg) };
  });
  clipCurves(svg, L, R, T, B);
  const cursor = el('line', { y1: T - 4, y2: B, stroke: MEANING.ink2, 'stroke-width': 1, class: 'chart-cursor' }, svg);
  // 读数放在时间轴右边的空位，不压在曲线上
  const legend = drawn.map(({ q }, i) => { const row = 18 + i * 20; const y = row > height - 6 ? -99 : row; el('circle', { cx: R + 20, cy: y - 4, r: 3.5, fill: q.color, 'data-legend': q.name }, svg); el('text', { x: R + 29, y, 'font-size': 13, 'font-family': MATH, fill: C.ink }, svg, q.name.length > 5 ? q.name.slice(0, 5) : q.name); return el('text', { x: width - 12, y, 'text-anchor': 'end', 'font-size': 13, 'font-family': MATH, fill: q.color }, svg); });
  save((s, t) => {
    const x = X(t); cursor.setAttribute('x1', String(x)); cursor.setAttribute('x2', String(x));
    drawn.forEach(({ q, dot, past, future }, i) => { const before = rng.filter((p) => p.t < t); past.setAttribute('points', points([...before, s], q)); future.setAttribute('points', points([s, ...rng.filter((p) => p.t > t)], q)); const v = q.get(s); dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(Y(v))); setReading(legend[i], `${fmt(Math.abs(v) < 1e-9 ? 0 : v)} ${q.unit}`, st.letters); });
    if (area && relPair) { const before = rng.filter((p) => p.t < t); const up = [...before, s].map((p) => [X(p.t), Y(relPair[0].get(p))]), dn = [...before, s].map((p) => [X(p.t), Y(relPair[1].get(p))]); area.setAttribute('points', [...up, ...dn.reverse()].map((p) => p.join(',')).join(' ')); }
  });
}

function energy(svg: Element, st: State, rng: Snapshot[], width: number, height: number, save: (u: (s: Snapshot, t: number) => void) => void) {
  const { sim } = st, items: { name: string; color: string; value: (s: Snapshot) => number }[] = sim.geo.bodies.map((g, i) => ({ name: `${g.id} 动能`, color: COLORS[i % COLORS.length], value: (s: Snapshot) => s.bodies[g.id] ? .5 * g.m * (s.bodies[g.id].vx ** 2 + s.bodies[g.id].vy ** 2) : 0 }));
  if (rng.some((s) => Object.entries(s.heat).some(([k, q]) => k !== '碰撞' && q > 0))) items.push({ name: '摩擦生热', color: COLORS[2], value: (s) => Object.entries(s.heat).filter(([k]) => k !== '碰撞').reduce((v, [, q]) => v + q, 0) });
  if (rng.some((s) => (s.heat['碰撞'] ?? 0) > 0)) items.push({ name: '碰撞损失', color: COLORS[3], value: (s) => s.heat['碰撞'] ?? 0 });
  for (const id of Object.keys(sim.start.springs ?? {})) items.push({ name: `${id} 弹性势能`, color: COLORS[5], value: (s) => s.springs[id]?.Ep ?? 0 });
  const baseRng = st.baseSim ? chartSnapshots(st.baseSim, st.w0, st.w1) : [];
  const live = items.filter((it) => [...rng, ...baseRng].some((s) => it.value(s) > 1e-9)), top = Math.max(1e-9, ...[...rng, ...baseRng].flatMap((s) => live.map((it) => it.value(s))));
  const cols = live.length > 4 ? 2 : 1, rows = Math.ceil(live.length / cols), rowH = Math.min(30, (height - 16) / Math.max(rows, 1)), colW = (width - 32) / cols, label = 96, valW = 76;
  if (st.mode === 'waiting') { save(() => {}); return; }
  const bars = live.map((it, i) => {
    const c = Math.floor(i / rows), r = i % rows, x = 16 + c * colW, y = 10 + r * rowH, w = colW - label - valW - 16;
    el('text', { x: x + label - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end', 'font-size': 13, 'font-family': MATH, fill: C.ink }, svg, it.name);
    el('rect', { x: x + label, y: y + rowH / 2 - 6, width: w, height: 12, rx: 3, fill: '#efe8d7' }, svg);
    return { it, w, base: st.baseSim ? el('rect', { x: x + label, y: y + rowH / 2 - 7, width: 0, height: 14, fill: 'none', stroke: it.color, 'stroke-width': 2, opacity: .4, 'stroke-dasharray': '6 4', 'data-base': it.name }, svg) : undefined, bar: el('rect', { x: x + label, y: y + rowH / 2 - 6, width: 0, height: 12, rx: 3, fill: it.color }, svg), val: el('text', { x: x + label + w + 8, y: y + rowH / 2 + 4, 'font-size': 13, 'font-family': MATH, fill: C.ink }, svg) };
  });
  save((s, t) => bars.forEach(({ it, w, bar, val, base }) => { if (base && st.baseSim) base.setAttribute('width', String(Math.max(0, it.value(sampleAt(st.baseSim, t)) / top * w))); const v = it.value(s); bar.setAttribute('width', String(Math.max(0, v / top * w))); setReading(val, `${fmt(v)} J`, st.letters); }));
}

/** 实验室里的量名换成坐标轴写法 */
const AXIS: [RegExp, string][] = [[/^t$/, 't / s'], [/^p_/, 'p / Pa'], [/^V_/, 'V / m³'], [/^T_/, 'T / K'], [/^y_/, 'y / m'], [/^x_/, 'x / m'], [/^s_scan/, 'x / m'], [/^phi/, 'φ / V'], [/^E_/, 'E / (N/C)'], [/^e$/, 'e / V'], [/^i$/, 'i / A'], [/^I$/, 'I / A'], [/^v_/, 'v / (m/s)']];
const axis = (s: string) => AXIS.find(([r]) => r.test(s))?.[1] ?? s;
/** 关系图（如 E-h、p-V）：整条线先画淡色，已走过的部分加深，当前点随时间移动。横轴是时间时和播放条对齐 */
export function drawPlot(pts: [number, number, number][], t: number, xName = '', yName = '', span?: [number, number], opts: ChartOptions = {}) {
  const svg = $('chart'), W = Math.max(300, svg.clientWidth), H = Math.max(90, svg.clientHeight), key = `plot|${pts.length}|${pts[0]?.[0]}|${pts.at(-1)?.[1]}|${W}|${H}|${span}|${xName}|${yName}|${opts.mode}|${opts.letters}|${identity(pts)}|${identity(opts.basePlot ?? opts.baseSim)}`;
  if (cache?.key === key && svg.childElementCount) { cache.update({} as Snapshot, t); return; }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.replaceChildren(); cache = undefined;
  if (pts.length < 2) return;
  const basePts = opts.basePlot ?? opts.baseSim?.board?.plot?.pts ?? [];
  const xLabel = axis(xName), yLabel = axis(yName), isTime = /^t\b/.test(xLabel), xs = pts.map((p) => p[0]), ys = [...pts, ...basePts].map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), tight = lo > 0 && hi - lo < hi * .3, y0 = tight ? lo - (hi - lo) * .15 - 1e-9 : Math.min(0, lo), y1 = hi === y0 ? y0 + 1 : hi;
  const T = 20, B = H - 14, r = rail(svg), L = isTime ? r.L : Math.max(r.L, 70), R = isTime ? r.R : Math.min(r.R, L + (W - L) * .62), x0 = isTime && span ? span[0] : Math.min(...xs), x1 = isTime && span ? span[1] : Math.max(...xs);
  const X = (x: number) => L + (x - x0) / (x1 - x0 || 1) * (R - L), Y = frame(svg, L, R, T, B, y0, y1, yLabel, opts.letters), str = (d: [number, number, number][]) => d.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  if (opts.mode === 'waiting') { cache = { key, update: () => {} }; return; }
  if (basePts.length) el('polyline', { points: str(basePts), fill: 'none', stroke: /^v[ _/]/.test(yLabel) ? MEANING.velocity : COLORS[0], 'stroke-width': 2, opacity: .4, 'stroke-dasharray': '6 4', 'data-base': yName }, svg);
  const future = el('polyline', { points: str(pts), fill: 'none', stroke: /^v[ _/]/.test(yLabel) ? MEANING.velocity : COLORS[0], 'stroke-width': 2, opacity: opts.mode === 'watching' ? 0 : .25, 'data-future': yName }, svg);
  const done = el('polyline', { points: '', fill: 'none', stroke: /^v[ _/]/.test(yLabel) ? MEANING.velocity : COLORS[0], 'stroke-width': 2.4 }, svg), dot = el('circle', { r: 4.5, fill: C.red }, svg);
  el('text', { x: R + 10, y: B + 4, 'font-size': 13, 'font-style': 'italic', 'font-family': MATH, fill: C.ink }, svg, xLabel);
  if (!isTime) { el('text', { x: L, y: B + 12, 'text-anchor': 'middle', 'font-size': 13, 'font-family': MATH, fill: C.soft }, svg, reading(fmt(x0), opts.letters)); el('text', { x: R, y: B + 12, 'text-anchor': 'middle', 'font-size': 13, 'font-family': MATH, fill: C.soft }, svg, reading(fmt(x1), opts.letters)); }
  const read = el('text', { x: W - 12, y: 18, 'text-anchor': 'end', 'font-size': 13, 'font-family': MATH, fill: C.ink }, svg);
  const cursor = isTime ? el('line', { y1: T-4, y2: B, stroke: MEANING.ink2, 'stroke-width': 1, class: 'chart-cursor' }, svg) : undefined;
  clipCurves(svg, L, R, T, B);
  let shown = -1;
  const update = (_: Snapshot, tt: number) => {
    let n = 0; while (n < pts.length && pts[n][2] <= tt + 1e-9) n++; n = Math.max(n, 1);
    if (cursor) { cursor.setAttribute('x1', String(X(tt))); cursor.setAttribute('x2', String(X(tt))); }
    const cur = pts[n - 1]; dot.setAttribute('cx', String(X(cur[0]))); dot.setAttribute('cy', String(Y(cur[1]))); setReading(read, `${yLabel.split(' /')[0]} = ${fmt(cur[1])}`, opts.letters);
    if (n !== shown) { shown = n; done.setAttribute('points', str(pts.slice(0, n))); future.setAttribute('points', str(pts.slice(Math.max(0, n - 1)))); }
  };
  cache = { key, update }; update({} as Snapshot, t);
}
void (0 as unknown as V2);
