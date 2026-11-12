import { tidyCJK } from './typeset.ts';
// 讲解：把一问拆成一步一步。题目写了解题过程就按它走，没写就由模拟自动讲。
// 每一步绑定一个时刻和画面标注，学生点“下一步”，画面走到那一刻停下来讲。
import type { AskResult, Problem, Show } from '../engine/solve.ts';
import type { SimResult } from '../engine/sim.ts';
import { nice } from '../engine/num.ts';
import { sampleAt } from './timeline.ts';
import { storyLines } from '../engine/validate.ts';
import { phasesOf, motionDuring } from './view-rules.ts';

export type LessonStep = { say: string; tex?: string; t: number; show: Show; verdict?: string; bad?: string; final?: boolean; transition?: boolean };
type Ask = Problem['asks'][number];

export const mapLine = (s: string) => { const chars = [...tidyCJK(s).replace(/\s+/g, ' ').trim()]; return chars.length <= 30 ? chars.join('') : chars.slice(0, 29).join('') + '…'; };
export function formatSpeed(x: number) {
  const exact = nice(x);
  return /^-?\d+(?:[√π]\d*)?\/\d+$/.test(exact) ? exact : String(Number(x.toPrecision(3)));
}
type OverviewResult = { sim?: SimResult; asks: Pick<AskResult, 't' | 'span'>[] };
/** 公式题的[0,0]不是有效演示时长；全是初始时刻或没有时刻时，使用完整模拟。 */
export function overviewContentEnd(S: OverviewResult): number {
  const end = S.sim?.end.t ?? 0;
  const used = S.asks.map((a) => a.span?.[1] ?? a.t).filter((t): t is number => t !== undefined && Number.isFinite(t) && t > 0);
  return end > 0 ? used.length ? Math.min(end, Math.max(...used)) : end : 1;
}
export function overviewWindow(S: OverviewResult): [number, number] {
  const end = S.sim?.end.t ?? 0, content = overviewContentEnd(S);
  return [0, end > 0 ? Math.min(end, content * 1.05) : content];
}
/** 把矢量说成方向 */
export function dirWord(x: number, y: number) {
  const L = Math.hypot(x, y) || 1, ux = x / L, uy = y / L;
  if (Math.abs(uy) < .17) return ux > 0 ? '向右' : '向左';
  if (Math.abs(ux) < .17) return uy > 0 ? '向上' : '向下';
  return `${ux > 0 ? '右' : '左'}${uy > 0 ? '上' : '下'}方`;
}
const EVENT: Record<string, (a: string, b?: string) => string> = {
  same_velocity: (a, b) => `${a}${b ? '、' + b : ''}共速`,
  split: (a) => `${a}分裂：总动量守恒`,
  leave: (a, b) => `${a}离开${b ?? '轨道'}`, enter: (a, b) => `${a}进入${b ?? '轨道'}`,
  land: (a) => `${a}落地`, collided: (a, b) => `${a}、${b}相碰`, stop: (a) => `${a}停下：速度减为零`,
  hit: (a, b) => `${a}撞到${b ?? '挡板'}`, extreme: (a) => `${a}到达转折点`,
  unlock: (a) => `${a}解除固定`, force_off: () => '受力改变：原来的外力撤去', force_on: () => '受力改变：开始施加新的外力',
  apsis: (a) => `${a}到达近点或远点`, kick: (a) => `${a}受到冲量：速度突变`, slip: (a) => `${a}开始相对滑动`, separate: (a) => `${a}分离`,
};
export function buildProcessMap(P: Pick<Problem, 'story'>, sim: SimResult, w0: number, w1: number, letters = false, contentEnd = w1): { steps: LessonStep[]; intro: string[] } {
  const phases = phasesOf(sim, w0, w1, { contentEnd }), story = storyLines(P), match = story.length > 0 && story.length === phases.length;
  const steps: LessonStep[] = [];
  for (const [i, p] of phases.entries()) {
    const phaseEnd = p.contentEnd ?? p.t1, mid = (p.t0 + phaseEnd) / 2, snap = sampleAt(sim, mid);
    if (match || story.length || p.coarse || sim.board || sim.script || sim.circuit) {
      steps.push({ say: mapLine(match ? story[i] : p.label), t: p.t0, show: {} });
    } else {
      for (const g of sim.geo.bodies.filter((g) => !p.bodies || p.bodies.includes(g.id))) {
        const b = snap.bodies[g.id]; if (!b) continue;
        const motion = motionDuring(sim, p.t0, phaseEnd, g.id);
        const [ax, ay] = motion.acceleration, acceleration = Math.hypot(ax, ay);
        const scale = Math.hypot(b.vx, b.vy) / Math.max(w1 - w0, Number.MIN_VALUE);
        const reason = acceleration <= scale * 1e-5 ? '合力为零' : motion.curved ? motion.state === '曲线' ? '合力改变速度方向' : '合力改变速度大小和方向' : `合力${dirWord(ax, ay)}`;
        steps.push({ say: mapLine(`${motion.label}：${reason}`), t: p.t0, show: { forces: [g.id] } });
      }
    }
  }
  const seen = new Set<string>();
  for (const e of sim.events) {
    if (!EVENT[e.type] || e.t <= w0 || e.t > (phases.at(-1)?.contentEnd ?? phases.at(-1)?.t1 ?? w1)) continue;
    // 同一时刻同一转折不重复；速度仅在转折点给，先认分数，再取三位有效数字。
    const key = `${e.t}:${e.type}:${e.a}:${e.b}`; if (seen.has(key)) continue; seen.add(key);
    const b = (e.after ?? e.snap).bodies[e.a], speed = b ? Math.hypot(b.vx, b.vy) : 0;
    const suffix = !letters && b && speed > 1e-7 && ['same_velocity', 'collided', 'hit', 'land', 'kick'].includes(e.type) ? `：速度为${formatSpeed(speed)} m/s` : '';
    steps.push({ say: mapLine(EVENT[e.type](e.a, e.b) + suffix), t: e.t, show: {}, transition: true });
  }
  steps.sort((a, b) => a.t - b.t || Number(!!b.transition) - Number(!!a.transition));
  return { steps, intro: story.length && !match ? story : [] };
}
const narrate = (sim: SimResult, w0: number, w1: number, letters: boolean) => buildProcessMap({}, sim, w0, w1, letters).steps;

export function buildLesson(o: { P: Problem; a?: AskResult; q?: Ask; sim?: SimResult; w0: number; w1: number; keyT: number | null; letters: boolean }): LessonStep[] {
  if (!o.q && o.sim) return buildProcessMap(o.P, o.sim, o.w0, o.w1, o.letters).steps;
  const { a, q, sim, w0, w1, keyT, letters } = o, span = Math.max(w1 - w0, 1e-9), end = keyT ?? w1;
  const written = (a?.steps ?? []).filter((s) => s.say || s.tex);
  let steps: LessonStep[];
  if (written.length) {
    // 写了时刻的按时刻，没写的夹在前后之间
    const ts = written.map((s) => (s.t !== undefined && s.t >= w0 - 1e-9 && s.t <= w1 + 1e-9 ? s.t : NaN));
    const total = written.length; let last = w0;
    steps = written.map((s, i) => {
      let t = ts[i];
      // 最后一个写了时刻的步骤之后：这一问有自己的时刻就继续走向它；没有（由条件反解的量）就是在那一刻往下推导，画面停着不动
      if (!Number.isFinite(t)) { const nxt = ts.slice(i + 1).find(Number.isFinite), anchored = ts.slice(0, i).some(Number.isFinite); if (nxt === undefined && anchored && !(q?.at || q?.times)) t = last; else { const to = nxt ?? end, gap = ts.slice(i).findIndex(Number.isFinite), left = gap < 0 ? total - i : gap; t = last + (to - last) / (left + 1); } }
      last = t;
      return { say: s.say, tex: s.tex, t: Math.min(w1, Math.max(w0, s.after && Number.isFinite(ts[i]) ? t + span * 1e-4 : t - span * 1e-4)), show: s.show ?? {}, verdict: s.verdict, bad: s.verdict === 'bad' ? `这一步写的是 ${s.claimed === undefined ? '—' : nice(s.claimed)}，模拟结果是 ${s.engine === undefined ? '—' : nice(s.engine)}` : undefined };
    });
  } else {
    steps = sim ? narrate(sim, w0, w1, letters).map((st) => ({ ...st, say: tidyCJK(st.say) })) : [];
    if (q?.think?.length) steps = [...q.think.map((say, i) => ({ say, t: w0 + span * (i + .5) / (q.think!.length + 1) * .35, show: {} as Show })), ...steps.filter((s) => s.t > w0 + span * .35)];
  }
  if (q) steps.push({ say: q.text ?? '', t: Math.min(Math.max(end, w0), w1), show: {}, final: true });
  // 没写标注的步骤：句子里说到受力，就把说到的物体的受力画出来
  const ids = sim?.geo.bodies.map((g) => g.id) ?? [];
  for (const s of steps) if (sim && !s.show.forces && /力|牛顿|加速度|F_|mg|\bma\b/.test(`${s.say}${s.tex ?? ''}`) && !s.final) {
    const named = ids.filter((id) => s.say.includes(id)), snap = sampleAt(sim, s.t), moving = ids.filter((id) => { const b = snap.bodies[id]; return b && Math.hypot(b.vx, b.vy) > 1e-6; });
    s.show = { ...s.show, forces: (named.length ? named : moving).slice(0, 3) };
  }
  if (!written.length) steps.sort((x, y) => x.t - y.t);   // 写好的步骤按作者的顺序讲
  return steps;
}
