// 只决定画法，既不修改快照，也不参与物理计算。
import type { ForceVec, SimResult } from '../engine/sim.ts';
export const BODY_COLORS = ['#4b5563', '#a0703c', '#2f8f83', '#8c8c3a', '#b0567a', '#6b6b6b'];
export const MEANING = { velocity: '#1c5fc4', force: '#c9711a', resultant: '#8a4a0c', displacement: '#5a4bb0', target: '#c4372c', verified: '#1f7a57', ink: '#1a262a', ink2: '#38474a', paper: '#f6f2e8' };
export const MIN_FONT = 13;
export const chartHeight = (ratio: number, total: number) => ratio > 3.2 ? Math.min(320, Math.max(200, total * .4)) : 160;
export const arrowScale = (width: number) => Math.min(1, Math.max(.55, width / 900));
export const flatIconRadius = (height: number) => Math.min(28, Math.max(19, height * .13));
export const readableFont = (font: string) => font.replace(/([\d.]+)px/, (_, size) => `${Math.max(MIN_FONT, +size)}px`);
export function forceSymbol(n: string) {
  return ({ 重力: 'mg', 支持力: 'N', 滑动摩擦力: 'f', 静摩擦力: 'f', 摩擦力: 'f', 弹力: 'F弹', 绳的拉力: 'T', 外力: 'F', 电场力: 'qE', 洛伦兹力: 'qvB', 库仑力: 'F库', 万有引力: 'F引', 管壁弹力: 'N', 杆的弹力: 'F杆' } as Record<string, string>)[n] ?? (/摩擦/.test(n) ? 'f' : /压力/.test(n) ? 'N' : n);
}
/** 力的箭头比例尺：取这一问里最大的力；skip 的物体（例如用大质量代替“固定”的东西）不参与，免得别的箭头都被压成示意长度 */
export function forceMax(sim: SimResult, w0: number, w1: number, skip: (id: string) => boolean = () => false) {
  let max = 1e-9;
  const snaps = [sim.start, ...sim.samples, ...sim.events.flatMap((e) => [...(e.before ? [e.before] : []), e.snap, ...(e.after ? [e.after] : [])]), sim.end];
  for (const s of snaps) if (s.t >= w0 - 1e-9 && s.t <= w1 + 1e-9) for (const [id, b] of Object.entries(s.bodies)) {
    if (skip(id)) continue; let x = 0, y = 0;
    for (const f of b.fs ?? []) { max = Math.max(max, Math.hypot(f.x, f.y)); x += f.x; y += f.y; }
    max = Math.max(max, Math.hypot(x, y));
  }
  return max;
}
export type ForceGlyph = { x: number; y: number; magnitude: number; length: number; schematic: boolean; label: string; color: string; width: number; resultant: boolean; by?: string };
export function forceGlyphs(fs: ForceVec[], max: number, scale = 1, symbolsOnly = false, mass?: string): ForceGlyph[] {
  const fmt = (m: number) => String(+m.toPrecision(3));
  const make = (x: number, y: number, symbol: string, resultant: boolean, by?: string): ForceGlyph => {
    const magnitude = Math.hypot(x, y), raw = magnitude / Math.max(max, 1e-9) * 96 * scale, zero = resultant && magnitude <= Math.max(1e-8, max * Number.EPSILON * 16);
    const schematic = !zero && raw < 14;
    return { x, y, magnitude: zero ? 0 : magnitude, length: zero ? 0 : Math.max(14, raw), schematic,
      label: `${symbol}${symbolsOnly && !zero ? '' : ` = ${zero ? '0' : fmt(magnitude)}${zero ? '' : ' N'}`}${schematic ? '（长度为示意）' : ''}`,
      color: resultant ? MEANING.resultant : MEANING.force, width: resultant ? 3 : 2, resultant, by };
  };
  const live = fs.filter((f) => Math.hypot(f.x, f.y) > 1e-9), symbols = live.map((f) => forceSymbol(f.n));
  const out = live.map((f, i) => make(f.x, f.y, `${f.n === '重力' && mass ? `${mass}g` : symbols[i]}${symbols.filter((s) => s === symbols[i]).length > 1 ? `(${f.by ?? '来源未注明'})` : ''}`, false, f.by));
  out.push(make(live.reduce((v, f) => v + f.x, 0), live.reduce((v, f) => v + f.y, 0), 'F合', true));
  return out;
}
/** 合力恰好等于某一个分力时两根箭头尖重合：标签并成一个“f = F合 = 4 N”，合力箭头照画、不再单独标 */
export function mergeEqualResultant(glyphs: ForceGlyph[]) {
  const sum = glyphs.find((a) => a.resultant && a.magnitude), same = sum && glyphs.find((a) => !a.resultant && Math.hypot(a.x - sum.x, a.y - sum.y) <= sum.magnitude * 1e-6);
  if (sum && same) {
    const tail = same.label.endsWith('（长度为示意）') ? '（长度为示意）' : '', body = same.label.slice(0, same.label.length - tail.length);
    same.label = (body.includes(' = ') ? body.replace(' = ', ' = F合 = ') : `${body} = F合`) + tail; sum.label = '';
  }
  return glyphs;
}
/**
 * 受力箭头的排法（平面、立体共用）：同一方向的几个力共用一条线，只是箭头尖位置不同；按比例短到伸不出物体的拉长到 minLen，
 * 同一条线上的箭头尖至少错开 14px（大小相同的力重合），被拉长的标“长度为示意”。返回顺序是画的顺序：长的先画，短的压在上面。
 */
export function layoutForceLines(glyphs: ForceGlyph[], dirOf: (g: ForceGlyph) => [number, number], minLen: number, memory?: Map<string, number>, scope = '') {
  // 排序带“惯性”：两个力长度相差不到 8% 时沿用上一帧的先后，不在相等那一瞬对调箭头尖（播放时标签不跳）
  const keyOf = (g: ForceGlyph) => `${scope}|${g.resultant ? 'F合' : `${g.label.split(' ')[0]}|${g.by ?? ''}`}`;
  const byLength = (a: ForceGlyph, b: ForceGlyph) => {
    const pa = memory?.get(keyOf(a)), pb = memory?.get(keyOf(b));
    if (pa !== undefined && pb !== undefined && Math.abs(a.length - b.length) < .08 * Math.max(a.length, b.length)) return pa - pb;
    return a.length - b.length;
  };
  const lines: { ux: number; uy: number; items: ForceGlyph[] }[] = [];
  for (const glyph of glyphs.filter((a) => a.magnitude)) {
    const [ux, uy] = dirOf(glyph), line = lines.find((l) => l.ux * ux + l.uy * uy > .985);
    if (line) line.items.push(glyph); else lines.push({ ux, uy, items: [glyph] });
  }
  const out: { glyph: ForceGlyph; ux: number; uy: number; len: number; label: string; bumped: boolean }[] = [];
  for (const line of lines) {
    const items = line.items.sort(byLength), lens: number[] = [];
    items.forEach((g, k) => memory?.set(keyOf(g), k));
    items.forEach((glyph, k) => { const prev = items[k - 1], twin = prev && Math.hypot(prev.x - glyph.x, prev.y - glyph.y) <= glyph.magnitude * 1e-6;
      lens.push(twin ? lens[k - 1] : Math.max(glyph.length, minLen, k ? lens[k - 1] + 14 : 0)); });
    for (let k = items.length - 1; k >= 0; k--) {
      const glyph = items[k], len = lens[k], bumped = len > glyph.length + .5;
      out.push({ glyph, ux: line.ux, uy: line.uy, len, bumped, label: glyph.label && bumped && !glyph.schematic ? `${glyph.label}（长度为示意）` : glyph.label });
    }
  }
  return out;
}
export function toolbarCaption(step: { say: string } | undefined, index: number, phase: string, event: string, until: number, now: number) {
  return event && now < until ? { badge: '转折点', text: event, kind: 'event' }
    : step && index >= 0 ? { badge: `第 ${index + 1} 步`, text: step.say, kind: 'step' }
    : { badge: '', text: phase, kind: 'phase' };
}

/** 同名、同向的分力合成一个带完整来源清单的图示力；只用于密集受力画面。 */
export function groupDenseForces(fs: ForceVec[]): ForceVec[] {
  const groups: ForceVec[][] = [];
  for (const f of fs) {
    const magnitude = Math.hypot(f.x, f.y);
    const group = groups.find((g) => forceSymbol(g[0].n) === forceSymbol(f.n) && magnitude > 0 && Math.abs(g[0].x*f.y-g[0].y*f.x) <= Math.hypot(g[0].x,g[0].y)*magnitude*1e-6 && g[0].x*f.x+g[0].y*f.y > 0);
    if (group) group.push(f); else groups.push([f]);
  }
  return groups.map((g) => g.length === 1 ? g[0] : ({ ...g[0], x:g.reduce((s,f)=>s+f.x,0), y:g.reduce((s,f)=>s+f.y,0), n:`${forceSymbol(g[0].n)}(${g.map((f)=>f.by ?? '来源未注明').join('、')})共${g.length}个`, by:g.map((f)=>f.by ?? '来源未注明').join('、') }));
}
