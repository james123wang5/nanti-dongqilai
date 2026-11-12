import { tidyCJK } from './typeset.ts';
// 默认用 2D 还是 3D，以及把过程切成阶段。都只看场景结构，不看具体题目。
import type { SimResult, Snapshot } from '../engine/sim.ts';
import { sampleAt, timelineFrames } from './timeline.ts';

/**
 * 系统自己决定怎么画，不让学生选。判断依据是这道题的空间结构，不是难度：
 * 运动都在一个平面里时，平面图最清楚，和题图也对得上；
 * 有离开平面的运动或结构（螺旋、圆锥摆、导轨上的棒、电路实物）才用 3D。
 */
export function chooseDim(sim: SimResult): '2d' | '3d' {
  const depth = sim.samples.some((p) => Object.values(p.bodies).some((q) => Math.abs(q.z ?? 0) > 1e-9)) || sim.samples.some((p) => p.script?.curves.some((c) => c.pts.some((q) => Math.abs(q[2]) > 1e-9)) || p.script?.links.some((l) => Math.abs(l.a[2] ?? 0) + Math.abs(l.b[2] ?? 0) > 1e-9));
  return depth ? '3d' : '2d';
}

/** 题库分组：只看题目结构 */
export function topicOf(P: { scene?: { circuit?: unknown; em?: unknown[]; fields?: unknown[]; script?: unknown; surfaces?: { rails?: unknown }[] }; title?: string }): string {
  const c = (P.scene ?? {}) as Record<string, unknown> & typeof P.scene & object, t = P.title ?? '';
  const lab: Record<string, string> = { optics: '光学', gas: '热学', wave: '振动与波', electro: '电场与磁场', atom: '原子物理', ac: '交变电流', induction: '电磁感应', gravity: '万有引力与航天', experiment: '实验', particle: '电场与磁场' };
  for (const k of Object.keys(lab)) if (c[k]) return lab[k];
  if (c.circuit) return '电路';
  if (c.surfaces?.some((s) => s.rails !== undefined)) return '电磁感应';
  if (c.em?.length) return '电场与磁场';
  if (c.fields?.length) return '万有引力与航天';
  if (/波|振动/.test(t)) return '振动与波';
  if (/折射|全反射|干涉|棱镜/.test(t)) return '光学';
  if (/半衰期|衰变|原子|光电效应/.test(t)) return '原子物理';
  if (/LC|交变|输电/.test(t)) return '交变电流';
  if (/电场|带电|极板/.test(t)) return '电场与磁场';
  if (c.surfaces?.length || (c as { bodies?: unknown[] }).bodies?.length) return '力学';
  return '其他';
}

const nameList = (ids: string[]) => ids.join('、');
/** 这个物体此刻受哪些力，按场景里实际存在的东西列 */
function forcesOn(sim: SimResult, st: SimResult['stages'][number], s: Snapshot, id: string): string[] {
  const g = sim.geo.bodies.find((b) => b.id === id)!, b = s.bodies[id], out: string[] = [];
  const horizontal = sim.geo.plane === 'horizontal', surf = sim.geo.surfaces.find((q) => q.id === b.on);
  if (!horizontal) out.push('重力');
  if (surf) out.push(surf.kind === 'arc' ? (surf.side === 'tube' ? '管壁的弹力' : horizontal ? '环的弹力（指向圆心）' : '轨道的弹力') : '支持力');
  else if (b.on) out.push('支持力');
  for (const m of st.modes) if ((m.upper === id || m.lower === id) && m.mode !== 'none' && Math.abs(m.f) > 1e-9) { const other = m.upper === id ? m.lower : m.upper; out.push(`${m.mode === 'slip' ? '滑动' : '静'}摩擦力 ${+Math.abs(m.f).toFixed(3)} N（来自${other}）`); }
  for (const r of sim.ropes ?? []) if (r.a === id || r.b === id) out.push('绳的拉力');
  if (Object.values(s.springs ?? {}).some((p) => (p as { a?: string; b?: string }).a === id || (p as { a?: string; b?: string }).b === id)) out.push('弹簧弹力');
  if (sim.fields?.length) out.push('万有引力');
  if (g.q) for (const f of sim.em ?? []) {
    const inside = f.rect ? b.x >= f.rect[0] && b.x <= f.rect[2] && b.y >= f.rect[1] && b.y <= f.rect[3] : f.circle ? Math.hypot(b.x - f.circle[0], b.y - f.circle[1]) <= f.circle[2] : true;
    if (!inside) continue;
    out.push(f.kind === 'B' ? '洛伦兹力（指向圆心）' : f.kind === 'Q' ? '库仑力' : '电场力');
  }
  return out;
}
/** 每一段的受力说明；说不出来的段不写，绝不写“不受力”糊弄 */
export function stageLines(sim: SimResult, w0: number, w1: number) {
  if (sim.script || sim.circuit || sim.board) return [];
  const fmt = (x: number) => +x.toPrecision(3);
  const out: { t0: number; time: string; lines: string[] }[] = [];
  for (const st of sim.stages) {
    const a = Math.max(st.t0, w0), b = Math.min(st.t1, w1); if (b - a < (w1 - w0) * 1e-3) continue;
    const s = sampleAt(sim, (a + b) / 2), lines: string[] = [];
    for (const g of sim.geo.bodies) {
      const q = s.bodies[g.id]; if (!q) continue;
      const moving = Math.hypot(q.vx, q.vy) > 1e-6, acc = st.acc[g.id];
      if (!moving && !acc) continue;
      const f = forcesOn(sim, st, s, g.id);
      lines.push(`${g.id}：${f.length ? f.join('、') : '合力为零'}${!st.dynamic && acc !== undefined && Math.abs(acc) > 1e-9 ? `，加速度大小 ${fmt(Math.abs(acc))} m/s²` : ''}`);
    }
    if (!lines.length) continue;
    const key = lines.join('|'), last = out.at(-1);
    if (last && last.lines.join('|') === key) { last.time = `${last.time.split(' → ')[0]} → ${fmt(b)} s`; continue; }
    out.push({ t0: a, time: `${fmt(a)} → ${fmt(b)} s`, lines });
  }
  return out;
}

export type Phase = { t0: number; t1: number; label: string; bodies?: string[]; coarse?: boolean; contentEnd?: number; eventLabel?: boolean };
const describe = (sim: SimResult, s: Snapshot, modes: SimResult['stages'][number]['modes']) => {
  const moving = sim.geo.bodies.filter((g) => { const b = s.bodies[g.id]; return b && Math.hypot(b.vx, b.vy) > 1e-6; });
  if (!moving.length) return '静止';
  const parts: string[] = [], bodyIds = new Set(sim.geo.bodies.map((g) => g.id));
  const free = moving.filter((g) => !s.bodies[g.id].on);
  if (free.length) {
    const ids = nameList(free.map((g) => g.id));
    if (sim.fields?.length) parts.push(`${ids} 绕中心天体运动`);
    else if (free.some((g) => g.q) && sim.em?.length) parts.push(`${ids} 在场中运动`);
    else parts.push(`${ids} 在空中运动`);
  }
  const slip = modes.filter((m) => m.mode === 'slip'), stick = modes.filter((m) => m.mode === 'stick');
  const onBody = slip.filter((m) => bodyIds.has(m.lower));
  if (slip.length) parts.push((onBody.length ? onBody : slip).map((m) => `${m.upper} 在 ${m.lower} 上滑动`).join('，'));
  const together = stick.filter((m) => bodyIds.has(m.lower) && moving.some((g) => g.id === m.upper));
  if (together.length) parts.push(`${nameList([...new Set(together.flatMap((m) => [m.upper, m.lower]))])} 一起运动`);
  if (!parts.length) {
    const by = new Map<string, string[]>();   // 同一条轨道上的物体合成一句
    for (const g of moving) { const on = s.bodies[g.id].on; if (on) { if (!by.has(on)) by.set(on, []); by.get(on)!.push(g.id); } }
    parts.push([...by].slice(0, 2).map(([on, ids]) => `${nameList(ids)} 沿 ${on} 运动`).join('，'));
  }
  return parts.join('；');
};

type V2 = [number, number];
type State = '缺席' | '静止' | '匀速' | '加速' | '减速' | '曲线';
export type Motion = { state: State; direction: string; label: string; acceleration: V2; curved?: boolean };
const short = (s: string, n = 16) => { const cs = [...tidyCJK(s)]; return cs.length <= n ? cs.join('') : cs.slice(0, n - 1).join('') + '…'; };
/** acceleration 必须来自速度差分或已有加速度，受力清单不参与运动状态判定。 */
export function motionAt(s: Snapshot, id: string, acceleration?: V2, vTol = 1e-8, aTol = 1e-8): Motion {
  const b = s.bodies[id];
  if (!b) return { state: '缺席', direction: '', label: '', acceleration: [0, 0] };
  const a: V2 = acceleration ?? (Number.isFinite(b.a) ? [b.a! * Math.cos(b.ang ?? 0), b.a! * Math.sin(b.ang ?? 0)] : [0, 0]);
  const v = Math.hypot(b.vx, b.vy), norm = Math.hypot(...a), along = v > vTol && norm > aTol ? (a[0] * b.vx + a[1] * b.vy) / (v * norm) : 1;
  const state: State = v <= vTol && norm <= aTol ? '静止' : norm <= aTol ? '匀速' : Math.abs(along) < .04 ? '曲线' : along > 0 ? '加速' : '减速';
  // 方向词由整段一致性决定，这里不按某一帧生成方向。
  return { state, direction: '', label: `${id}${state === '曲线' ? '匀速曲线运动' : state}`, acceleration: a };
}
const scales = new WeakMap<SimResult, Map<string, number>>();
function velocityScales(sim: SimResult) {
  let out = scales.get(sim); if (out) return out;
  out = new Map();
  for (const frame of timelineFrames(sim)) for (const s of [frame.before, frame.after]) for (const [id, b] of Object.entries(s.bodies)) out.set(id, Math.max(out.get(id) ?? 0, Math.hypot(b.vx, b.vy)));
  const global = Math.max(...out.values(), Number.MIN_VALUE);
  for (const [id, v] of out) out.set(id, Math.max(v, global * 1e-3));
  scales.set(sim, out); return out;
}
/** 真实采样速度的转角；位置弦与速度不共线时，也识别半周两端的反向速度。 */
function rotationBetween(a: Snapshot['bodies'][string], b: Snapshot['bodies'][string]): number {
  const sa = Math.hypot(a.vx, a.vy), sb = Math.hypot(b.vx, b.vy); if (!sa || !sb) return 0;
  const cross = a.vx * b.vy - a.vy * b.vx, dot = a.vx * b.vx + a.vy * b.vy;
  const dx = b.cx - a.cx, dy = b.y - a.y, distance = Math.hypot(dx, dy), side = a.vx * dy - a.vy * dx;
  const bend = distance > 0 && (Math.abs(side) > sa * distance * 1e-4 || Math.abs(b.vx * dy - b.vy * dx) > sb * distance * 1e-4);
  if (Math.abs(cross) <= sa * sb * 1e-4 && !bend) return 0;
  let angle = Math.atan2(cross, dot);
  if (bend && Math.sign(side) && Math.sign(angle) !== Math.sign(side)) angle = Math.sign(side) * (2 * Math.PI - Math.abs(angle));
  return angle;
}

/** 在相邻采样帧内部差分，避开碰撞/点火的左右极限，不把冲量摊成连续加速度。 */
export function motionDuring(sim: SimResult, from: number, to: number, id: string): Motion {
  const frames = timelineFrames(sim), mid = (from + to) / 2;
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) { const k = (lo + hi) >> 1; if (frames[k].t <= mid) lo = k; else hi = k; }
  const left = Math.max(from, frames[lo]?.t ?? from), right = Math.min(to, frames[hi]?.t ?? to);
  const t0 = left + (right - left) * .2, t1 = right - (right - left) * .2;
  const start = sampleAt(sim, t0).bodies[id], end = sampleAt(sim, t1, 'before').bodies[id], snap = sampleAt(sim, mid);
  const scale = velocityScales(sim).get(id) ?? Number.MIN_VALUE, duration = Math.max(sim.end.t - sim.start.t, Number.MIN_VALUE);
  let acc: V2 | undefined = start && end && t1 > t0 ? [(end.vx - start.vx) / (t1 - t0), (end.vy - start.vy) / (t1 - t0)] : undefined;
  const u = frames[lo]?.after.bodies[id], v = frames[hi]?.before.bodies[id], body = snap.bodies[id];
  // 稀疏圆弧的弦内插值会虚构零速：分别差分真实速率与转角，
  // 只在这个局部估计中沿弧插值方向，不改引擎快照和画面数据。
  const angle = u && v ? rotationBetween(u, v) : 0;
  if (u && v && body && angle && frames[hi].t > frames[lo].t) {
    const dt = frames[hi].t - frames[lo].t, k = (mid - frames[lo].t) / dt;
    const su = Math.hypot(u.vx, u.vy), sv = Math.hypot(v.vx, v.vy), speed = su + (sv - su) * k, theta = Math.atan2(u.vy, u.vx) + angle * k;
    const tx = Math.cos(theta), ty = Math.sin(theta), rate = (sv - su) / dt, normal = speed * angle / dt;
    const estimated = { ...snap, bodies: { ...snap.bodies, [id]: { ...body, vx: speed * tx, vy: speed * ty } } };
    return { ...motionAt(estimated, id, [rate * tx - normal * ty, rate * ty + normal * tx], scale * 1e-7, scale / duration * 1e-5), curved: true };
  }
  return motionAt(snap, id, acc, scale * 1e-7, scale / duration * 1e-5);
}
type Run = { t0: number; t1: number; key: string; states: string; motions: Map<string, State> };
const mergeEqual = (runs: Run[], eps: number) => {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.t1 - run.t0 <= eps) continue;
    const last = out.at(-1);
    if (last && last.key === run.key && Math.abs(last.t1 - run.t0) <= eps) last.t1 = run.t1;
    else out.push({ ...run });
  }
  return out;
};
/** 小于窗口1%的段只并给同状态的一侧；两侧都不同时保留物理转折。 */
function mergeShort(runs: Run[], min: number, eps: number) {
  let out = mergeEqual(runs, eps), changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      if (out[i].t1 - out[i].t0 >= min) continue;
      const left = out[i - 1], right = out[i + 1], sameLeft = left?.states === out[i].states, sameRight = right?.states === out[i].states;
      if (sameLeft && (!sameRight || left.t1 - left.t0 >= right.t1 - right.t0)) { left.t1 = out[i].t1; out.splice(i, 1); }
      else if (sameRight) { right.t0 = out[i].t0; out.splice(i, 1); }
      else continue;
      out = mergeEqual(out, eps); changed = true; break;
    }
  }
  return out;
}
function cleanCuts(times: number[], w0: number, w1: number, eps: number) {
  const out = [w0];
  for (const t of times.filter((t) => t > w0 + eps && t < w1 - eps).sort((a, b) => a - b)) if (t - out.at(-1)! > eps) out.push(t);
  out.push(w1); return out;
}
/** 方向仅在整段直线、没有反向时描述；沿曲线绕行不会反复变成“向左/上升”。 */
function directionDuring(sim: SimResult, from: number, to: number, id: string): string {
  const scale = velocityScales(sim).get(id) ?? 0, tol = scale * 1e-7, frames = timelineFrames(sim);
  const snaps = [sampleAt(sim, from), ...frames.filter((f) => f.t > from && f.t < to).flatMap((f) => [f.before, f.after]), sampleAt(sim, to, 'before')];
  // 即使本段只是稀疏圆弧内插值的一小截，也不能因此称为直线运动。
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t <= from || frames[i - 1].t >= to) continue;
    const a = frames[i - 1].after.bodies[id], b = frames[i].before.bodies[id]; if (!a || !b) continue;
    if (rotationBetween(a, b)) return '';
  }
  let axis: V2 | undefined;
  for (const s of snaps) {
    const b = s.bodies[id]; if (!b) continue;
    const v = Math.hypot(b.vx, b.vy); if (v <= tol) continue;
    const u: V2 = [b.vx / v, b.vy / v];
    if (!axis) axis = u;
    else if (axis[0] * u[0] + axis[1] * u[1] < .9999) return '';
  }
  if (!axis) return '';
  return Math.abs(axis[1]) > .98 ? axis[1] > 0 ? '上升' : '下降' : Math.abs(axis[0]) > .98 ? axis[0] > 0 ? '向右' : '向左' : '斜向运动';
}
function labelsFor(sim: SimResult, run: Run, before?: Run, after?: Run): Pick<Phase, 'label' | 'bodies'> {
  const eligible = [...run.motions].filter(([id, state]) => state !== '缺席' && (state !== '静止' || before && before.motions.get(id) !== state || after && after.motions.get(id) !== state));
  eligible.sort(([a, sa], [b, sb]) => Number(sb !== before?.motions.get(b)) - Number(sa !== before?.motions.get(a)));
  const chosen = eligible.slice(0, 2), bodies = chosen.map(([id]) => id);
  const labels = chosen.map(([id, state]) => `${short(id, chosen.length > 1 ? 4 : 8)}${state === '曲线' ? '匀速曲线运动' : state}${state === '静止' || state === '曲线' ? '' : directionDuring(sim, run.t0, run.t1, id)}`);
  return { label: short(labels.join('；') || '保持静止', eligible.length > 2 ? 15 : 16) + (eligible.length > 2 ? '等' : ''), bodies };
}
/** 事件合并保留左段起点名；原生极短段沿用吸收方的说明。 */
function combine(phases: Phase[], i: number, useRight = false) {
  const left = phases[i], right = phases[i + 1], keep = useRight && !left.eventLabel ? right : left;
  phases[i] = { ...keep, t0: left.t0, t1: right.t1, coarse: true };
  phases.splice(i + 1, 1);
}
function mergeLabels(phases: Phase[]) {
  const out: Phase[] = [];
  for (const p of phases) {
    const last = out.at(-1);
    if (last && last.label === p.label) { last.t1 = p.t1; last.coarse = true; }
    else out.push({ ...p });
  }
  return out;
}
/** 不可见的0.2%短段无条件吸收；更多段时优先合并总时长最短的相邻两段。 */
function readablePhases(input: Phase[], span: number): Phase[] {
  let phases = mergeLabels(input);
  while (phases.length > 1) {
    const tiny = phases.findIndex((p) => p.t1 - p.t0 < span * .002 - span * 1e-12);
    if (tiny < 0 && phases.length <= 8) break;
    let pair: number;
    if (tiny >= 0) pair = tiny === 0 ? 0 : tiny === phases.length - 1 ? tiny - 1 : phases[tiny - 1].t1 - phases[tiny - 1].t0 <= phases[tiny + 1].t1 - phases[tiny + 1].t0 ? tiny - 1 : tiny;
    else { pair = 0; for (let i = 1; i < phases.length - 1; i++) if (phases[i + 1].t1 - phases[i].t0 < phases[pair + 1].t1 - phases[pair].t0) pair = i; }
    combine(phases, pair, tiny >= 0 && pair === tiny); phases = mergeLabels(phases);
  }
  return phases;
}
/** 复杂原生运动按每个原阶段描述，再合并重复标签；不会均匀挑8个时刻丢掉轨道变化。 */
function coarsePhases(sim: SimResult, w0: number, w1: number, eps: number): Phase[] {
  const cuts = cleanCuts(sim.stages.flatMap((st) => [st.t0, st.t1]), w0, w1, eps);
  return cuts.slice(0, -1).map((t0, i) => {
    const t1 = cuts[i + 1], mid = (t0 + t1) / 2;
    const moving = (s: Snapshot) => Object.entries(s.bodies).some(([id, b]) => Math.hypot(b.vx, b.vy) > (velocityScales(sim).get(id) ?? 0) * 1e-7);
    let snap = sampleAt(sim, mid);
    // 周期运动的中点可能恰好是转折点，不能据此把整个粗段写成静止。
    if (!moving(snap)) snap = [sampleAt(sim, t0 + (t1 - t0) / 4), sampleAt(sim, t0 + (t1 - t0) * .75), ...timelineFrames(sim).filter((f) => f.t > t0 && f.t < t1).map((f) => f.after)].find(moving) ?? snap;
    const st = sim.stages.find((s) => s.t0 <= snap.t && s.t1 >= snap.t);
    const active = sim.geo.bodies.filter((g) => { const b = snap.bodies[g.id]; return b && Math.hypot(b.vx, b.vy) > (velocityScales(sim).get(g.id) ?? 0) * 1e-7; });
    const bodies = active.slice(0, 2), ids = new Set(bodies.map((b) => b.id)), allIds = new Set(sim.geo.bodies.map((b) => b.id));
    const modes = (st?.modes ?? []).filter((m) => ids.has(m.upper) && (ids.has(m.lower) || !allIds.has(m.lower)));
    const label = describe({ ...sim, geo: { ...sim.geo, bodies } }, snap, modes) || '运动过程', extra = active.length > 2 ? '等' : '';
    return { t0, t1, label: short(label, 16 - extra.length) + extra, coarse: true, bodies: bodies.map((b) => b.id) };
  });
}
export type PhaseOptions = { contentEnd?: number };
export function phasesOf(sim: SimResult, w0: number, w1: number, options: PhaseOptions = {}): Phase[] {
  // 零时长不是一个可播放窗口：先恢复模拟的完整区间；单帧场景按静止画面展示1秒。
  if (!(w1 > w0)) { w0 = sim.start.t; w1 = sim.end.t > w0 ? sim.end.t : w0 + 1; }
  const displayEnd = w1, span = w1 - w0;
  if (options.contentEnd !== undefined && options.contentEnd > w0 && options.contentEnd < w1) w1 = options.contentEnd;
  const eps = Math.min((w1 - w0) * .01, Math.max(span * 1e-9, Math.max(Math.abs(w0), Math.abs(w1)) * Number.EPSILON * 16));
  const finish = (raw: Phase[]) => {
    const out = readablePhases(raw, span);
    if (!out.length) out.push({ t0: w0, t1: w1, label: '运动过程', coarse: true });
    if (displayEnd > w1) { out.at(-1)!.contentEnd = w1; out.at(-1)!.t1 = displayEnd; }
    return out;
  };
  if (sim.script || sim.board || sim.circuit || sim.events.some((e) => e.type === 'mark')) {
    const marks = sim.events.filter((e) => e.type === 'mark'), cuts = cleanCuts(marks.map((e) => e.t), w0, w1, eps);
    return finish(cuts.slice(0, -1).map((t0, i) => {
      const mark = marks.filter((e) => Math.abs(e.t - t0) <= eps).at(-1);
      return { t0, t1: cuts[i + 1], label: short(mark?.a || (i === 0 && cuts.length > 2 ? '开始' : '运动过程')), coarse: true, eventLabel: true };
    }));
  }
  const frames = timelineFrames(sim), turns: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].after, b = frames[i].before;
    if (b.t <= w0 || a.t >= w1 || b.t - a.t <= eps) continue;
    for (const [id, u] of Object.entries(a.bodies)) {
      const v = b.bodies[id]; if (!v || rotationBetween(u, v) || u.vx * v.vx + u.vy * v.vy >= 0) continue;
      const dx = v.vx - u.vx, dy = v.vy - u.vy, k = -(u.vx * dx + u.vy * dy) / (dx * dx + dy * dy);
      const scale = velocityScales(sim).get(id) ?? 0;
      if (k > 0 && k < 1 && Math.hypot(u.vx + k * dx, u.vy + k * dy) < scale * 1e-5) turns.push(a.t + k * (b.t - a.t));
    }
  }
  const cuts = cleanCuts([...frames.map((f) => f.t), ...turns, ...sim.stages.flatMap((st) => [st.t0, st.t1])], w0, w1, eps);
  const runs: Run[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const t0 = cuts[i - 1], t1 = cuts[i], mid = (t0 + t1) / 2, snap = sampleAt(sim, mid);
    const motions = new Map(sim.geo.bodies.map((g) => [g.id, motionDuring(sim, t0, t1, g.id).state]));
    const states = JSON.stringify([...motions]), stage = sim.stages.find((st) => st.t0 <= mid && st.t1 >= mid);
    const support = [...motions].map(([id, state]) => [id, state === '缺席' ? null : snap.bodies[id]?.on ?? null]);
    const contacts = (stage?.modes ?? []).filter((m) => m.mode !== 'none').map((m) => [m.upper, m.lower, m.mode]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    runs.push({ t0, t1, states, motions, key: JSON.stringify([states, support, contacts]) });
  }
  const merged = mergeShort(runs, span * .01, eps);
  if (merged.length > 8) return finish(coarsePhases(sim, w0, w1, eps));
  return finish(merged.map((run, i) => ({ t0: run.t0, t1: run.t1, ...labelsFor(sim, run, merged[i - 1], merged[i + 1]) })));
}
