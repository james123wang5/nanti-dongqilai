// 画面尺寸与物理尺寸分开：相机只看本问附近的运动，长木板显示局部。
import type { SimResult, Snapshot, GeoSurface, V2 } from '../engine/sim.ts';
import { arcPointPlan } from './arc-layout.ts';
import { sampleAt } from './timeline.ts';

export { BODY_COLORS as COLORS } from './visual-rules.ts';
// content 是物体和轨道实际占的范围（相机紧贴它取景）；body 是物体显示直径的下限。
export type Frame = { x0: number; x1: number; y0: number; y1: number; span: number; size: number; thick: number; body: number; content: { x0: number; x1: number; y0: number; y1: number }; outline: V2[] };
export const offsetOf = (g: GeoSurface, s: Snapshot): V2 => g.host && s.bodies[g.host] ? [s.bodies[g.host].x, s.bodies[g.host].y] : [0, 0];
export function surfacePoints(g: GeoSurface): V2[] {
  if (g.kind === 'seg') return [g.p0!, g.p1!];
  if (g.kind === 'ground') return [];
  return Array.from({ length: 97 }, (_, i) => {
    const a = g.a0! + (g.a1! - g.a0!) * i / 96;
    return [g.c![0] + g.R! * Math.cos(a), g.c![1] + g.R! * Math.sin(a)];
  });
}
export function hostBox(r: SimResult, id: string, size: number) {
  const own = r.geo.surfaces.filter((g) => g.host === id);
  if (!own.length) return null;
  const ps: V2[] = [[0, 0], [r.geo.bodies.find((b) => b.id === id)?.L ?? 0, 0], ...own.flatMap(surfacePoints)];
  const pad = size * 0.8;
  return { x0: Math.min(...ps.map((p) => p[0])) - pad, x1: Math.max(...ps.map((p) => p[0])) + pad,
    y0: Math.min(...ps.map((p) => p[1])) - pad, y1: Math.max(...ps.map((p) => p[1])) + pad };
}
export function fitFrame(r: SimResult, w0: number, w1: number): Frame {
  const ps: V2[] = [];
  const snaps = [r.start, ...r.samples, ...r.events.map((e) => e.snap), r.end].filter((s) => s.t >= w0 - 1e-9 && s.t <= w1 + 1e-9);
  if (!snaps.length) snaps.push(r.start);
  for (const g of r.geo.surfaces) for (const s of g.host ? snaps : [snaps[0]]) {
    const o = offsetOf(g, s);
    for (const p of surfacePoints(g)) ps.push([p[0] + o[0], p[1] + o[1]]);
  }
  const gx = ps.map((p) => p[0]), gy = ps.map((p) => p[1]);
  const min = (xs: number[]) => xs.reduce((a, b) => Math.min(a, b), Infinity);
  const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), -Infinity);
  const xmin = min(gx), xmax = max(gx), ymin = min(gy), ymax = max(gy), hasGeometry = ps.length > 0;
  const base = hasGeometry ? Math.max(xmax - xmin, ymax - ymin, 0.5) : Infinity;
  const near = (x: number, y: number, on: string | null) => !hasGeometry || !!on || (x >= xmin - base && x <= xmax + base && y >= ymin - base * 0.5 && y <= ymax + base);
  const movers: V2[] = [];
  for (const s of snaps) for (const g of r.geo.bodies) {
    const b = s.bodies[g.id];
    if (g.kind === 'board' || !b || !near(b.x, b.y, b.on)) continue;
    const rad = g.L / 2;
    movers.push([b.x, b.y]); ps.push([b.x - rad, b.y - rad], [b.x + rad, b.y + rad]);
  }
  const mx = movers.map((p) => p[0]), lo = min(mx), hi = max(mx), reach = Math.max(hi - lo, Number.isFinite(base) ? base * 0.4 : 1) * 0.6;
  for (const s of snaps) for (const g of r.geo.bodies) {
    const b = s.bodies[g.id];
    if (g.kind !== 'board' || !b) continue;
    const box = hostBox(r, g.id, Number.isFinite(base) ? base * 0.025 : 0.05);
    if (box) { ps.push([b.x + box.x0, b.y + box.y0], [b.x + box.x1, b.y + box.y1]); continue; }
    if (!near(b.x, b.y, b.on)) continue;
    for (const d of [0, g.L]) {
      const x = b.x + d * Math.cos(b.ang), y = b.y + d * Math.sin(b.ang);
      ps.push([movers.length ? Math.max(lo - reach, Math.min(hi + reach, x)) : x, y]);
    }
  }
  for (const s of [r.start, r.end]) if (s.script) { for (const l of s.script.links) ps.push([l.a[0], l.a[1]], [l.b[0], l.b[1]]); for (const c of s.script.curves) for (const p of c.pts) ps.push([p[0], p[1]]); }
  if (!ps.length) ps.push([-1, 0], [1, 1]);
  for (const g of r.geo.surfaces) if (g.kind === 'ground') ps.push([ps[0][0], g.y!]);
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  const left = min(xs), right = max(xs), low = min(ys), high = max(ys);   // 只算一次：这里的点可能有几万个
  const span = Math.max(right - left, (high - low) * 1.2, 0.5);
  // 显示下限取场景的 6%，但不能大过题里最小的圆弧，否则小弯道里放不下。
  const arcs = r.geo.surfaces.filter((g) => g.kind === 'arc').map((g) => g.R! * 0.85);
  const body = Math.max(span * 0.022, Math.min(span * 0.04, ...arcs));
  const stride = Math.max(1, Math.floor(ps.length / 320));
  return { x0: left - span * 0.1, x1: right + span * 0.1,
    y0: low - span * 0.08, y1: high + span * 0.15, span, size: span * 0.035, thick: span * 0.024, body,
    content: { x0: left - body / 2, x1: right + body / 2, y0: low - span * 0.02, y1: high + body },
    outline: ps.filter((_, i) => i % stride === 0).concat(ps.filter((p) => p[0] === left || p[0] === right || p[1] === high || p[1] === low)) };
}
/** 一维最小位移投影。相邻图标边贴边，成对时等量反向移动；端点约束同时参与投影。 */
function pointPlan(r: SimResult, f: Frame, s: Snapshot): Record<string, { offset: number; width: number }> {
  const result: Record<string, { offset: number; width: number }> = {};
  type Item = { id: string; x: number; initial: number; low: number; high: number; direction: number };
  const lines: { u: V2; normal: number; items: Item[] }[] = [];
  for (const g of r.geo.bodies) {
    const b = s.bodies[g.id], surface = r.geo.surfaces.find((g) => g.id === b?.on);
    if (g.L || !b?.on || surface?.kind === 'arc') continue;
    let u: V2 = [Math.cos(b.ang), Math.sin(b.ang)];
    const direction = u[0] < -1e-12 || (Math.abs(u[0]) < 1e-12 && u[1] < 0) ? -1 : 1;
    u = [u[0] * direction, u[1] * direction];
    const normal = -b.x * u[1] + b.y * u[0];
    let line = lines.find((l) => Math.abs(l.u[0] * u[1] - l.u[1] * u[0]) < 1e-9 && Math.abs(l.normal - normal) < 1e-9);
    if (!line) { line = { u, normal, items: [] }; lines.push(line); }
    const coord = (id: string, snap: Snapshot) => snap.bodies[id].x * u[0] + snap.bodies[id].y * u[1];
    let low = -Infinity, high = Infinity;
    if (surface?.kind === 'seg') {
      const off = offsetOf(surface, s);
      const a = (surface.p0![0] + off[0]) * u[0] + (surface.p0![1] + off[1]) * u[1];
      const b = (surface.p1![0] + off[0]) * u[0] + (surface.p1![1] + off[1]) * u[1];
      low = Math.min(a, b); high = Math.max(a, b);
    } else if (s.bodies[b.on]) {
      const host = r.geo.bodies.find((g) => g.id === b.on)!;
      const a = coord(b.on, s), end = a + host.L * direction;
      low = Math.min(a, end); high = Math.max(a, end);
    }
    for (const obstacle of r.geo.bodies) {
      const ob = s.bodies[obstacle.id];
      if (!ob || obstacle.L <= 0 || obstacle.kind === 'board' || ob.on !== b.on) continue;
      const initial = r.start.bodies[g.id]?.on === b.on && r.start.bodies[obstacle.id]?.on === b.on;
      if (coord(g.id, initial ? r.start : s) <= coord(obstacle.id, initial ? r.start : s)) high = Math.min(high, coord(obstacle.id, s) - obstacle.L / 2);
      else low = Math.max(low, coord(obstacle.id, s) + obstacle.L / 2);
    }
    line.items.push({ id: g.id, x: coord(g.id, s), initial: coord(g.id, r.start), low, high, direction });
  }
  for (const { items } of lines) {
    // 以初态次序处理重合点。碰撞时不因舍入交换图标。
    items.sort((a, b) => a.initial - b.initial || a.id.localeCompare(b.id));
    let width = f.body;
    // 所有端点约束共同决定能放下的最大图标宽度。
    for (let i = 0; i < items.length; i++) for (let j = i; j < items.length; j++) width = Math.min(width, Math.max(0, (items[j].high - items[i].low) / (j - i + 1)));
    type Block = { start: number; end: number; sum: number; n: number; low: number; high: number; value: number };
    const blocks: Block[] = [];
    const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
    items.forEach((item, i) => {
      const sum = item.x - i * width, low = item.low + width / 2 - i * width, high = item.high - width / 2 - i * width;
      blocks.push({ start: i, end: i, sum, n: 1, low, high, value: clamp(sum, low, high) });
      while (blocks.length > 1 && blocks.at(-2)!.value > blocks.at(-1)!.value) {
        const b = blocks.pop()!, a = blocks.pop()!, sum = a.sum + b.sum, n = a.n + b.n;
        const low = Math.max(a.low, b.low), high = Math.min(a.high, b.high);
        blocks.push({ start: a.start, end: b.end, sum, n, low, high, value: clamp(sum / n, low, high) });
      }
    });
    for (const block of blocks) for (let i = block.start; i <= block.end; i++) result[items[i].id] = { offset: (block.value + i * width - items[i].x) * items[i].direction, width };
  }
  return result;
}
export function pointLayout(r: SimResult, f: Frame, s: Snapshot): Record<string, number> {
  return { ...Object.fromEntries(Object.entries(pointPlan(r, f, s)).map(([id, p]) => [id, p.offset])), ...Object.fromEntries(Object.entries(arcPointPlan(r, f.body, s)).map(([id, p]) => [id, p.offset])) };
}
/** 弹簧画在物体中心高度；一端固定在木板上时，那一端抬到另一端的高度，并不缩进木板厚度 */
export function springEnds(r: SimResult, f: Frame, s: Snapshot, sp: Snapshot['springs'][string]): { p: V2; q: V2; ia: number; ib: number } {
  const a = bodyPose(r, f, sp.a, s), b = bodyPose(r, f, sp.b, s), kind = (id: string) => r.geo.bodies.find((g) => g.id === id)?.kind;
  let p = sp.endpoints?.[0] ?? a.c, q = sp.endpoints?.[1] ?? b.c;
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, u: V2 = [dx / L, dy / L], boardA = kind(sp.a) === 'board', boardB = kind(sp.b) === 'board';
  if (boardA && !boardB) { q = b.c; p = [q[0] - u[0] * L, q[1] - u[1] * L]; }
  else if (boardB && !boardA) { p = a.c; q = [p[0] + u[0] * L, p[1] + u[1] * L]; }
  else { p = a.c; q = b.c; }
  return { p, q, ia: boardA ? 0 : a.size / 2, ib: boardB ? 0 : b.size / 2 };
}
function rawBodyPose(r: SimResult, f: Frame, id: string, s: Snapshot): { c: V2; ang: number; size: number; length: number } {
  const g = r.geo.bodies.find((g) => g.id === id)!, b = s.bodies[id];
  if (r.script) { const size = g.L || f.body * 1.15; return { c: [b.x, b.y], ang: 0, size, length: size }; }
  let size = g.kind === 'board' ? f.thick : g.L || f.body;
  let length = g.kind === 'board' ? Math.min(g.L, f.span * 1.6) : size;
  const surf = r.geo.surfaces.find((g) => g.id === b.on);
  if (surf?.kind === 'arc') {
    const icon = !g.L ? arcPointPlan(r, f.body, s)[id] : undefined;
    if (icon) {
      size = icon.size; length = size;
      const o = offsetOf(surf, s), sign = surf.side === 'tube' ? 0 : surf.side === 'outside' ? 1 : -1, radius = surf.R! + sign * size / 2;
      return { c: [surf.c![0] + o[0] + radius * Math.cos(icon.angle), surf.c![1] + o[1] + radius * Math.sin(icon.angle)], ang: icon.angle + (surf.side === 'outside' ? -1 : 1) * Math.PI / 2, size, length };
    }
    const o = offsetOf(surf, s), dx = b.x - surf.c![0] - o[0], dy = b.y - surf.c![1] - o[1], R = Math.hypot(dx, dy) || 1;
    const sign = surf.side === 'tube' ? 0 : surf.side === 'outside' ? 1 : -1;
    return { c: [b.x + dx / R * sign * size / 2, b.y + dy / R * sign * size / 2], ang: Math.atan2(dy, dx) + (surf.side === 'outside' ? -1 : 1) * Math.PI / 2, size, length };
  }
  let depth = 0, host = b.on;
  const visited = new Set<string>();
  while (host && !visited.has(host) && r.geo.bodies.some((g) => g.id === host)) {
    visited.add(host); if (!hostBox(r, host, f.size)) depth += f.thick;
    host = s.bodies[host]?.on ?? null;
  }
  let along = g.kind === 'board' ? length / 2 : 0;
  let ang = b.ang;
  if (!g.L) {
    const layout = pointPlan(r, f, s)[id];
    const direction = Math.cos(b.ang) < -1e-12 || (Math.abs(Math.cos(b.ang)) < 1e-12 && Math.sin(b.ang) < 0) ? -1 : 1;
    along = (layout?.offset ?? 0) * direction;
    if (direction < 0) ang += Math.PI;
    length = layout?.width ?? length;
  }
  if (g.kind === 'board' && g.L > length) {
    const mid: V2 = [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2];
    along = Math.max(length / 2, Math.min(g.L - length / 2, (mid[0] - b.x) * Math.cos(b.ang) + (mid[1] - b.y) * Math.sin(b.ang)));
  }
  const up = depth + size / 2;
  return { c: [b.x + Math.cos(ang) * along - Math.sin(ang) * up, b.y + Math.sin(ang) * along + Math.cos(ang) * up], ang, size, length };
}

/** 支撑切换后沿用边界瞬间的显示偏移，再连续收敛到新支撑的布局。 */
export function bodyPose(r: SimResult, f: Frame, id: string, s: Snapshot) {
  const pose = rawBodyPose(r, f, id, s);
  if (r.geo.bodies.find((g) => g.id === id)!.L) return pose;
  let previous = r.start.bodies[id];
  let change: { snap: Snapshot; before: typeof previous } | undefined;
  for (const e of r.events) {
    if (e.t > s.t + 1e-12) break;
    const b = e.snap.bodies[id];
    if (e.a === id && (e.type === 'leave' || e.type === 'enter')) change = { snap: e.snap, before: e.type === 'leave' ? b : previous };
    previous = b;
  }
  if (!change) return pose;
  // 切换前后的样子都取引擎在那一刻记下的真实状态（各自轨道上的弧长、角度对得上）；有的事件快照记的是切换前、有的是切换后，不直接用
  const before = sampleAt(r, change.snap.t, 'before'), after = sampleAt(r, change.snap.t, 'after');
  if (!before.bodies[id] || !after.bodies[id] || before.bodies[id].on === after.bodies[id].on || s.bodies[id]?.on !== after.bodies[id].on) return pose;   // 还没真正换到新轨道（差在舍入误差里）就不过渡
  const b = after.bodies[id], elapsed = Math.max(0, s.t - change.snap.t);
  const phase = Math.min(1, elapsed * Math.max(Math.hypot(b.vx, b.vy), f.body) / f.body);
  if (phase >= 1) return pose;
  const p = rawBodyPose(r, f, id, before), q = rawBodyPose(r, f, id, after);
  const weight = (1 - phase) ** 2;
  pose.c = [pose.c[0] + (p.c[0] - q.c[0]) * weight, pose.c[1] + (p.c[1] - q.c[1]) * weight];
  return pose;
}

/**
 * 落地结构（通用规则，只看几何）：轨道背面朝下的部分，从轨道一直填到下方的轨道或桌面，成实心台体；
 * 有物体从下方经过的位置不填。填不了的（回环上半圈、管道、悬空段）在后方立一块背板。
 */
export type Supports = { fills: V2[][]; boards: { x0: number; x1: number; y0: number; y1: number }[] };
export function supportPlan(r: SimResult, f: Frame, floor: number): Supports {
  const out: Supports = { fills: [], boards: [] };
  if (r.geo.plane === 'horizontal') return out;
  const fixed = r.geo.surfaces.filter((g) => !g.host && g.kind !== 'ground' && !g.tether);
  const line = (g: GeoSurface): V2[] => {
    if (g.kind !== 'seg') return surfacePoints(g);
    return Array.from({ length: 41 }, (_, i) => [g.p0![0] + (g.p1![0] - g.p0![0]) * i / 40, g.p0![1] + (g.p1![1] - g.p0![1]) * i / 40]);
  };
  const lines = new Map(fixed.map((g) => [g.id, line(g)]));
  const stride = Math.max(1, Math.floor(r.samples.length / 400));
  const traffic: { x: number; y: number; on: string | null }[] = [];
  for (let i = 0; i < r.samples.length; i += stride) for (const g of r.geo.bodies) {
    const b = r.samples[i].bodies[g.id];
    if (b && g.kind !== 'board') traffic.push({ x: b.x, y: b.y, on: b.on });
  }
  const below = (self: string, p: V2) => {
    let top = floor;
    for (const [id, ps] of lines) if (id !== self) for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1], b = ps[i];
      if ((a[0] - p[0]) * (b[0] - p[0]) > 0 || a[0] === b[0]) continue;
      const y = a[1] + (b[1] - a[1]) * (p[0] - a[0]) / (b[0] - a[0]);
      if (y < p[1] - f.size * 0.5) top = Math.max(top, y - f.thick);
    }
    return top;
  };
  for (const g of fixed) {
    const ps = lines.get(g.id)!;
    const ok = ps.map((p) => {
      if (g.side === 'tube') return false;
      if (g.kind === 'seg') { if (Math.abs(g.p1![0] - g.p0![0]) < Math.abs(g.p1![1] - g.p0![1]) * 0.12) return false; }
      else { const back = (p[1] - g.c![1]) / g.R! * (g.side === 'outside' ? -1 : 1); if (back > -0.03) return false; }
      return !traffic.some((b) => b.on !== g.id && Math.abs(b.x - p[0]) < f.body * 0.6 && b.y < p[1] - f.body * 1.6);
    });
    for (let i = 0; i < ps.length;) {
      if (!ok[i]) { i++; continue; }
      let j = i; while (j + 1 < ps.length && ok[j + 1]) j++;
      if (j > i) {
        // 台体顶面压到轨道板下面，不和轨道面共面
        const drop = f.thick * 0.8, run = ps.slice(i, j + 1).map((p): V2 => {
          if (g.kind === 'seg') return [p[0], p[1] - drop];
          const k = (g.side === 'outside' ? -1 : 1) * drop / g.R!; return [p[0] + (p[0] - g.c![0]) * k, p[1] + (p[1] - g.c![1]) * k];
        }), base = run.map((p): V2 => [p[0], below(g.id, p)]).reverse();
        if (run.some((p, k) => p[1] - base[run.length - 1 - k][1] > f.thick)) out.fills.push([...run, ...base]);
      }
      i = j + 1;
    }
    const left = ps.filter((_, i) => !ok[i]);
    if (left.length > ps.length * 0.15) {
      const xs = left.map((p) => p[0]), ys = left.map((p) => p[1]), pad = f.body * 0.9;
      out.boards.push({ x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: floor, y1: Math.max(...ys) + pad });
    }
  }
  // 重叠的背板并成一块
  out.boards.sort((a, b) => a.x0 - b.x0);
  out.boards = out.boards.reduce<Supports['boards']>((list, b) => {
    const last = list.at(-1);
    if (last && b.x0 <= last.x1) { last.x1 = Math.max(last.x1, b.x1); last.y1 = Math.max(last.y1, b.y1); } else list.push({ ...b });
    return list;
  }, []);
  return out;
}
