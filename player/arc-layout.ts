// 圆弧上的显示布局。用弧坐标投影；闭环把接缝放在最大空隙的中点。
import type { SimResult, Snapshot, GeoSurface } from '../engine/sim.ts';
const histories = new WeakMap<SimResult, Snapshot[]>();
export type ArcIcon = { offset: number; size: number; angle: number };
export function arcPointPlan(r: SimResult, bodySize: number, s: Snapshot): Record<string, ArcIcon> {
  const result: Record<string, ArcIcon> = {};
  for (const arc of r.geo.surfaces.filter((g) => g.kind === 'arc')) {
    const R = arc.R!, sign = Math.sign(arc.a1! - arc.a0!), length = Math.abs(arc.a1! - arc.a0!) * R;
    const mod = (x: number) => ((x % length) + length) % length;
    const coord = (snap: Snapshot, id: string) => {
      const b = snap.bodies[id]; if (b.s !== undefined) return arc.closed ? mod(b.s) : b.s;
      const host = arc.host ? snap.bodies[arc.host] : undefined;
      return mod(sign * (Math.atan2(b.y - arc.c![1] - (host?.y ?? 0), b.x - arc.c![0] - (host?.x ?? 0)) - arc.a0!) * R);
    };
    const points = r.geo.bodies.filter((g) => !g.L && s.bodies[g.id]?.on === arc.id);
    if (!points.length) continue;
    points.sort((a, b) => coord(r.start, a.id) - coord(r.start, b.id) || a.id.localeCompare(b.id));
    let ordered = points, positions = points.map((g) => coord(s, g.id)), lo = 0, hi = length;
    if (arc.closed) {
      const gap = (a: string, b: string) => {
        let d = mod(coord(s, b) - coord(s, a));
        if (d < 1e-9 || length - d < 1e-9) {
          if (!histories.has(r)) histories.set(r, [r.start, ...r.samples, ...r.events.map((e) => e.before ?? e.snap)].sort((a, b) => b.t - a.t));
          for (const p of [...histories.get(r)!, r.start]) {
            if (p.t >= s.t && p !== r.start) continue;
            if (p.bodies[a].on !== arc.id || p.bodies[b].on !== arc.id) continue;
            const before = mod(coord(p, b) - coord(p, a));
            if (before > 1e-9 && length - before > 1e-9) return before > length / 2 ? length : 0;
          }
          d = 0;
        }
        return d;
      };
      const gaps = points.map((g, i) => gap(g.id, points[(i + 1) % points.length].id));
      if (gaps.every((x) => x === 0)) gaps[gaps.length - 1] = length;
      const cut = gaps.indexOf(Math.max(...gaps)), start = (cut + 1) % points.length;
      ordered = points.slice(start).concat(points.slice(0, start));
      positions = [coord(s, ordered[0].id)];
      for (let i = 1; i < points.length; i++) positions.push(positions[i - 1] + gaps[(start + i - 1) % points.length]);
      lo = positions[0] - gaps[cut] / 2; hi = lo + length;
    }
    const radialSign = arc.side === 'tube' ? 0 : arc.side === 'outside' ? 1 : -1;
    const stride = (size: number) => {
      const radius = R + radialSign * size / 2;
      // 球形图标用弦长；方块用两个旋转方块的相邻边条件。
      return Math.max(...points.map((p) => p.kind === 'ball' ? 2 * R * Math.asin(size / (2 * radius)) : 2 * R * Math.atan(size / (2 * radius - size))));
    };
    let size = Math.min(bodySize, R * 0.9);
    if (stride(size) * points.length > length) {
      let a = 0, b = size; for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (stride(m) * points.length <= length) a = m; else b = m; } size = a;
    }
    const width = stride(size);
    type Block = { from: number; to: number; sum: number; n: number; value: number };
    const blocks: Block[] = [];
    positions.forEach((p, i) => {
      blocks.push({ from: i, to: i, sum: p - i * width, n: 1, value: p - i * width });
      while (blocks.length > 1 && blocks.at(-2)!.value > blocks.at(-1)!.value) {
        const b = blocks.pop()!, a = blocks.pop()!, sum = a.sum + b.sum, n = a.n + b.n;
        blocks.push({ from: a.from, to: b.to, sum, n, value: sum / n });
      }
    });
    for (const b of blocks) {
      const q = Math.max(lo + width / 2, Math.min(hi - (points.length - 0.5) * width, b.value));
      for (let i = b.from; i <= b.to; i++) {
        const position = q + i * width;
        result[ordered[i].id] = { offset: position - positions[i], size, angle: arc.a0! + sign * position / R };
      }
    }
  }
  return result;
}
