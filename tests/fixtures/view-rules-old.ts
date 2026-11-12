// 第二批修正的历史对照，仅由测试引用。
import { tidyCJK } from '../../player/typeset.ts';
// 默认用 2D 还是 3D，以及把过程切成阶段。都只看场景结构，不看具体题目。
import type { SimResult, Snapshot } from '../../engine/sim.ts';
import { sampleAt } from '../../player/timeline.ts';

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
  return '力学';
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

export type Phase = { t0: number; t1: number; label: string };
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
export function phasesOf(sim: SimResult, w0: number, w1: number): Phase[] {
  if (sim.script || sim.board) {   // 解析演示和实验室按给的节点分段
    const cuts = [w0, ...sim.events.filter((e) => e.type === 'mark' && e.t > w0 && e.t < w1).map((e) => e.t), w1], names = sim.events.filter((e) => e.type === 'mark').map((e) => e.a);
    return cuts.slice(0, -1).map((t0, i) => ({ t0, t1: cuts[i + 1], label: tidyCJK(i ? names[i - 1] : cuts.length > 2 ? '开始' : '') }));
  }
  const out: Phase[] = [], cuts = sim.stages.map((st) => ({ t0: Math.max(st.t0, w0), t1: Math.min(st.t1, w1), modes: st.modes })).filter((c) => c.t1 > c.t0 + 1e-9);
  for (const c of cuts) {
    const label = describe(sim, sampleAt(sim, (c.t0 + c.t1) / 2), c.modes), last = out.at(-1);
    if (last && last.label === label) last.t1 = c.t1; else out.push({ t0: c.t0, t1: c.t1, label });
  }
  // 太短的段并给相邻段，否则阶段条读不清
  const min = (w1 - w0) * 0.03;
  for (let i = out.length - 1; i > 0; i--) if (out[i].t1 - out[i].t0 < min) { out[i - 1].t1 = out[i].t1; out.splice(i, 1); }
  for (const o of out) o.label = tidyCJK(o.label);
  return out.length ? out : [{ t0: w0, t1: w1, label: '运动过程' }];
}
