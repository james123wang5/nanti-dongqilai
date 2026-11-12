// 读题目 JSON：代入参数，按"条件"反解未知数，再在指定事件时刻算出每一问，和参考答案比对。
// 每一问可以改条件（with）、带自己的未知数和条件——这时为这一问单独再算一遍。

import { evaluate, evaluateBoolean, dependencies, SNAP_ARITY, type Env } from './expr.ts';
import { sampleAt } from '../player/timeline.ts';
import { exactSnap } from './labs/common.ts';
import { simulate, findEvent as findRecorded, type SceneSpec, type EventSpec, type SimResult, type Snapshot, type Num } from './sim.ts';
import { nice, same, sameAnswer } from './num.ts';
import { diagnose, repairPrompt, verdictOf, type StepResult } from './check.ts';
import { validate, formatRepair } from './validate.ts';
import { expressionSource, verificationCounts, type Source } from './source.ts';

export type Param = number | string | [Num, string?, string?];  // 值，或 [值, 单位, 题目原文]
type Unknowns = Record<string, { range: [Num, Num] }>;
type Times = Record<string, EventSpec>;          // 把某些事件的时刻取成变量，例如 {"t1": {...}, "t2": {...}}
type Vals = Record<string, { at: EventSpec; expr: string }>;  // 把某事件时刻某量的值取成变量，例如第 1 次碰撞时的路程
// eq：在某事件时刻某式子等于 0；just：某事件"恰好发生 / 恰好不发生"的分界（只能有一个未知数）
export type Condition = { at?: EventSpec; eq?: string; just?: EventSpec; times?: Times; vals?: Vals; say?: string };
export type Ask = {
  option?: { label: string; text: string; correct?: boolean; claim?: string };   // 选择题：一个选项是一项
  think?: string[]; unit?: string; answerText?: string;         // 两三句思路；答案原文，用于不便写成表达式的答案
  focus?: { body: string; label?: string };                     // 所求量画在哪个物体上
  plot?: { x: string; y: string; xLabel?: string; yLabel?: string };   // 这一问要看的关系图：选项是图像时用
  id: string; text: string; at?: EventSpec; expr?: string; times?: Times; vals?: Vals; answer?: Num; unit?: string;
  with?: Record<string, Num>; unknowns?: Unknowns; conditions?: Condition[];
  scene?: SceneSpec;                         // 无法连接的确定阶段，可按问给独立场景，不伪造中间过程
  predict?: Predict;
  keep?: Keep[];                             // 考点：必须画准并标出真实数值的角度、长度、间距
};
/** 考点标注：angle 是某段直轨道的倾角，length 是木板或直轨道的长度，gap 是两个物体之间的距离 */
export type Keep = { angle?: string; length?: string; gap?: [string, string] };
/** 播放前先让学生预测：一道选择题，answer 是正确选项的序号（从 1 开始） */
export type Predict = { q: string; options: string[]; answer: number };
/** 解题过程的一步：讲解、公式，以及可选的核对项（在某事件时刻用 expr 算，应等于 value） */
export type Show = { forces?: string[]; span?: string[]; gap?: [string, string]; label?: string };
export type Step = { say: string; tex?: string; at?: EventSpec; show?: Show; check?: { at?: EventSpec; times?: Times; vals?: Vals; expr: string; value: Num } };
export type Problem = {
  story?: string[];                              // 可选的过程地图文字，不参与求解
  idea?: string;                                 // 一两句话说清这题的核心
  spec: string; title?: string; stem?: string; view?: '2d' | '3d';
  model?: { from: string; to: string }[];        // 情景到物理模型的对应：运动员 → 质点
  unsupported?: string;
  constants?: Record<string, Num>;
  params?: Record<string, Param>;
  samples?: Record<string, number>[];            // 第二组示例值；第一组仍写在 params
  unknowns?: Unknowns;
  scene: SceneSpec;
  conditions?: Condition[];
  asks: Ask[];
  solution?: Record<string, Step[]>;             // 按小问 id 分组的解题过程（学生的 AI 写，或官方答案整理）
};

export type PlotContext = { vars: Record<string, number>; times?: Times; vals?: Vals; at?: EventSpec; window: [number, number] };
export type AskResult = { verified?: boolean; answerMatch?: boolean | null; valueSource?: Source; claimValue?: boolean; claimOk?: boolean | null; claimSource?: Source; plotError?: string; plotSource?: Source; plotContext?: PlotContext; plotData?: [number, number, number][]; id: string; text: string; value: number; shown: string; answer?: number; ok: boolean | null; source?: Source; t?: number; error?: string; sim?: SimResult; times?: Record<string, number>; steps?: StepResult[]; span?: [number, number] };
/** 已核验：有参考答案，且答案与过程全部对上；引擎复核一致：没有参考答案，过程与引擎一致；有问题：有对不上的 */
export type Label = '已核验' | '引擎算出，未对照答案' | '按 AI 方程/自定义量算出，未核验物理' | 'AI 给出，未核验' | '引擎复核一致' | '部分核验' | '仅代数，未模拟验证' | '有问题' | '超出引擎能力，未经验证';
export type SampleResult = { counts?: ReturnType<typeof verificationCounts>; vars: Record<string, number>; sim?: SimResult; asks: AskResult[]; residual: number; label: Label; repair: string };
export type SampleReport = Omit<SampleResult, 'sim'> & { sim?: SimResult; error?: string };
export type Solved = SampleResult & { samples?: SampleReport[]; pending?: boolean };

const paramValue = (p: Param): Num => (Array.isArray(p) ? p[0] : p);

/** 快照里的取值函数：x(B)、cx(B)、vx(A)、v(A)、dx(B)、rel(A)、angle(A)、KE(A)、Q()、Q(A,B)、path(A, 轨道) */
function snapFns(s: Snapshot, start: Snapshot, masses: Record<string, number>, g: number, stages: SimResult['stages'] = []): Env['fns'] {
  const b = (id: number | string) => {
    const r = s.bodies[String(id)];
    if (!r) throw new Error(`没有物体 ${id}`);
    return r;
  };
  const b0 = (id: number | string) => start.bodies[String(id)];
  const sumBy = (rec: Record<string, number>, a?: number | string, c?: number | string) =>
    Object.entries(rec).reduce((q, [k, v]) => {
      const [p, r] = k.split('|');
      if (a === undefined || (c === undefined && (p === String(a) || r === String(a))) || (p === String(a) && r === String(c)) || (r === String(a) && p === String(c))) return q + v;
      return q;
    }, 0);
  return {
    x: (id) => b(id).x, y: (id) => b(id).y, cx: (id) => b(id).cx,
    vx: (id) => b(id).vx, vy: (id) => b(id).vy, v: (id) => Math.hypot(b(id).vx, b(id).vy),
    dx: (id) => b(id).x - b0(id).x, dy: (id) => b(id).y - b0(id).y,
    rel: (id) => b(id).rel ?? NaN,
    // 沿轨道的加速度：取这一时刻之前那一段的；那一段没有（比如刚从圆弧滑上木板）就取之后那一段的
    a: (id) => b(id).a ?? b(id).af ?? stages.find((st) => Math.abs(st.t0 - s.t) < 1e-9 && st.acc[String(id)] !== undefined)?.acc[String(id)] ?? NaN,
    N: (id) => b(id).N ?? NaN,                    // 圆弧对物体的支持力（指向圆心为正）
    polar: (id) => { const a = (Math.atan2(b(id).y, b(id).x) * 180) / Math.PI; return a < -1e-9 ? a + 360 : a; },  // 绕原点的方位角（度，0–360）
    angle: (id) => (Math.atan2(-b(id).vy, Math.abs(b(id).vx)) * 180) / Math.PI,  // 速度与水平方向夹角（向下为正，度）
    KE: (id) => 0.5 * masses[String(id)] * (b(id).vx ** 2 + b(id).vy ** 2),
    PE: (id) => masses[String(id)] * g * b(id).y,
    z: (id) => b(id).z ?? 0,
    I: (id) => { const r = s.circuit?.I[String(id)]; if (r === undefined) throw new Error(`电路里没有元件 ${id}`); return Math.abs(r); },
    Is: (id) => { const r = s.circuit?.Is?.[String(id)]; if (r === undefined) throw new Error(`电路里没有元件 ${id}`); return r; },
    U: (id) => { const r = s.circuit?.U[String(id)]; if (r === undefined) throw new Error(`电路里没有元件 ${id}`); return Math.abs(r); },
    P: (id) => { const c = s.circuit; if (!c || c.I[String(id)] === undefined) throw new Error(`电路里没有元件 ${id}`); return Math.abs(c.I[String(id)] * c.U[String(id)]); },
    val: (id) => { const r = s.vals?.[String(id)]; if (r === undefined) throw new Error(`这一刻没有量 ${id}，可用的有：${Object.keys(s.vals ?? {}).slice(0, 30).join('、')}`); return r; },
    Vn: (id) => { const r = s.circuit?.V[String(id)]; if (r === undefined) throw new Error(`电路里没有节点 ${id}`); return r; },
    T: (id?) => { const r = s.ropes ?? {}; const k = id === undefined ? Object.keys(r)[0] : String(id); if (!(k in r)) throw new Error(`没有绳 ${id ?? ''}`); return r[k]; },
    Q: (a?, c?) => a === undefined ? sumBy(s.heat) - (s.heat['爆炸'] ?? 0) : sumBy(s.heat, a, c) + sumBy(s.lost ?? {}, a, c),   // 爆炸释放的能量不算生热，单独用 Q(爆炸) 读   // 指定物体时把它们相碰损失的能量也算上
    count: (a?, c?) => sumBy(s.counts, a, c),
    Ep: (id) => s.springs[String(id)]?.Ep ?? NaN,   // 弹簧弹性势能
    Fs: (id) => s.springs[String(id)]?.F ?? NaN,    // 弹簧弹力（拉为正）
    path: (a, c) => sumBy(s.path, a, c),
  };
}

function baseVars(P: Problem, unknown: Record<string, number>) {
  const vars: Record<string, number> = { g: 9.8, ...unknown };
  const env: Env = { vars };
  for (const [k, v] of Object.entries(P.constants ?? {})) vars[k] = evaluate(v, env);
  for (const [k, v] of Object.entries(P.params ?? {})) if (!(k in unknown)) vars[k] = evaluate(paramValue(v), env);
  return vars;
}

const usesWhen = (P: Problem) => /"event":"when"/.test(JSON.stringify([P.asks, P.conditions]));
function run(P: Problem, unknown: Record<string, number>, sample = 0, stopAfter?: EventSpec[], partial = false, visuals = true) {
  const vars = baseVars(P, unknown);
  const times = new Set<number>();
  const scan = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    const v = x as EventSpec;
    if (v.event === 'time' && v.t !== undefined) times.add(evaluate(v.t, { vars }));
    for (const v of Object.values(x)) scan(v);
  };
  // 每问另改条件或反解的参数，只在该问的情景中求值。
  const asks = P.asks.filter((a) => !a.with && !a.unknowns && !a.conditions && !a.scene);
  scan({ scene: P.scene, conditions: P.conditions, asks, steps: asks.flatMap((a) => solutionFor(P, a.id) ?? []) });
  // 用到“某量到达某值”时要有足够密的采样才找得准
  const fine = sample || (usesWhen(P) ? Math.max(1e-4, evaluate(P.scene.tMax ?? 30, { vars }) / 1500) : asks.some((a) => a.plot) ? evaluate(P.scene.tMax ?? 30, { vars }) / 300 : 0);
  // 撤力、施力、点火、停止写成 when 时，模拟过程中按快照求 expr
  const masses = Object.fromEntries((P.scene.bodies ?? []).map((b) => [b.id, evaluate(b.m, { vars })]));
  const whenValue = (expr: string, s: Snapshot, start: Snapshot) => evaluate(expr, { vars: { ...vars, t: s.t }, fns: snapFns(s, start, masses, vars.g) });
  return { vars, sim: simulate(P.scene, vars, { partial, forces: visuals, sample: fine, stopAfter, times: [...times], whenValue }) };
}

/** 条件用到的全部事件；有条件取的是结束时刻（没写 at 或写 end）时返回 undefined，只能算完整过程 */
function eventsOf(conds: Condition[]): EventSpec[] | undefined {
  const out: EventSpec[] = [];
  for (const c of conds) {
    const specs = [c.at ?? c.just, ...Object.values(c.times ?? {}), ...Object.values(c.vals ?? {}).map((v) => v.at)];
    if (specs.some((sp) => !sp || sp.event === 'end' || sp.event === 'when')) return undefined;
    out.push(...(specs as EventSpec[]));
  }
  return out;
}

/** 关系图的点：在这一问的时段内逐帧取值 */
export function plotPoints(P: Problem, vars: Record<string, number>, sim: SimResult, plot: NonNullable<Ask['plot']>, w0: number, w1: number, context?: PlotContext): [number, number, number][] {
  vars = context?.vars ?? vars;
  const list = sim.samples.filter((s) => s.t >= w0 - 1e-9 && s.t <= w1 + 1e-9), step = Math.max(1, Math.floor(list.length / 240)), out: [number, number, number][] = [];
  for (let i = 0; i < list.length; i += step) {
    const e = { type: 'plot', a: '', t: list[i].t, snap: list[i] }, x = evalOn(P, vars, sim, e, plot.x, context?.times, context?.vals), y = evalOn(P, vars, sim, e, plot.y, context?.times, context?.vals);
    if (Number.isFinite(x.value) && Number.isFinite(y.value)) out.push([x.value, y.value, list[i].t]);
  }
  return out;
}

/** 某个量到达某值的时刻：{event:"when", expr:"…", dir?:1|-1, n?:第几次}。expr 穿过 0 的时刻就是事件，通用于所有场景。 */
const crossings = new WeakMap<SimResult, Map<string, SimResult['events']>>();
let scope: { P: Problem; vars: Record<string, number> } | undefined;
function crossingsOf(sim: SimResult, expr: string, dir?: number) {
  const key = `${expr}|${dir ?? 0}`; let table = crossings.get(sim); if (!table) crossings.set(sim, table = new Map());
  const hit = table.get(key); if (hit) return hit;
  const exact = exactSnap.get(sim), snapAt = (t: number) => exact ? exact(t) : sampleAt(sim, t);
  const value = (t: number) => { try { const r = evalOn(scope!.P, scope!.vars, sim, { type: 'when', a: '', t, snap: snapAt(t) }, expr); return r.value; } catch { return NaN; } };
  const N = 1200, T = sim.end.t, out: SimResult['events'] = [];
  const cross = (t0: number, v0: number, t1: number, v1: number) => {
    if (Number.isFinite(v0) && Number.isFinite(v1) && v0 * v1 <= 0 && v0 !== v1 && !(dir && Math.sign(v1 - v0) !== dir) && !(v0 === 0 && out.length)) {
      let a = t0, b = t1, fa = v0; for (let k = 0; k < 40; k++) { const m = (a + b) / 2, fm = value(m); if (fa * fm <= 0) b = m; else { a = m; fa = fm; } }
      out.push({ type: 'when', a: '', t: b, snap: snapAt(b) });
    }
  };
  // 一格里两端同号，但两端和中点定出的二次式在格内越过 0：可能一格内穿过 0 两次（短暂满足条件），继续细分找出来
  const scan = (t0: number, v0: number, t1: number, v1: number, depth: number) => {
    if (!(Number.isFinite(v0) && Number.isFinite(v1)) || v0 * v1 <= 0 || depth >= 16) { cross(t0, v0, t1, v1); return; }
    const tm = (t0 + t1) / 2, vm = value(tm); if (!Number.isFinite(vm)) return;
    if (vm * v0 <= 0) { scan(t0, v0, tm, vm, depth + 1); scan(tm, vm, t1, v1, depth + 1); return; }
    const B = 4 * vm - 3 * v0 - v1, C = 2 * v1 + 2 * v0 - 4 * vm, u = C ? -B / (2 * C) : -1;
    if (!(u > 0 && u < 1) || (v0 + B * u + C * u * u) * v0 > 0) return;
    scan(t0, v0, tm, vm, depth + 1); scan(tm, vm, t1, v1, depth + 1);
  };
  let t0 = 0, v0 = value(0);
  for (let i = 1; i <= N; i++) { const t1 = T * i / N, v1 = value(t1); scan(t0, v0, t1, v1, 0); t0 = t1; v0 = v1; }
  table.set(key, out); return out;
}
function findEvent(sim: SimResult, sp: EventSpec) { return sp.event === 'when' ? crossingsOf(sim, sp.expr ?? '0', sp.dir)[(sp.n ?? 1) - 1] : findRecorded(sim, sp); }

function evalAt(P: Problem, vars: Record<string, number>, sim: SimResult, at: EventSpec | undefined, expr: string, times?: Times, vals?: Vals, boolean = false, active = new Set<string>()): { value: number; t?: number; missing: boolean } {
  scope = { P, vars };
  // 中止不是 end：只允许明确指向已完成事件，或与终态无关的代数量。
  if (sim.failure && (!at || at.event === 'end') && (SNAP_FN.test(expr) || dependencies(expr).names.has('t'))) throw new Error(sim.failure.message);
  const e = at ? findEvent(sim, at) : sim.failure ? sim.events[0] : sim.events[sim.events.length - 1];
  if (!e && sim.failure) throw new Error(sim.failure.message);
  return evalOn(P, vars, sim, e, expr, times, vals, boolean, active);
}

function evalOn(P: Problem, vars: Record<string, number>, sim: SimResult, e: SimResult['events'][number] | undefined, expr: string, times?: Times, vals?: Vals, boolean = false, active = new Set<string>()): { value: number; t?: number; missing: boolean } {
  scope = { P, vars };
  if (!e) return { value: NaN, t: undefined, missing: true };
  const extra: Record<string, number> = { t: e.t };
  const dependency = dependencies(expr), used = dependency.names;
  for (const [k, spec] of Object.entries(times ?? {})) {
    if (!used.has(k)) continue;
    const te = findEvent(sim, spec);
    if (!te) { if (sim.failure) throw new Error(sim.failure.message); return { value: NaN, t: undefined, missing: true }; }
    extra[k] = te.t;
  }
  for (const [k, v] of Object.entries(vals ?? {})) {
    if (!used.has(k)) continue;
    if (active.has(k)) throw new Error(`vals 别名循环引用：${[...active, k].join(' → ')}`);
    active.add(k);
    let r: ReturnType<typeof evalAt>; try { r = evalAt(P, vars, sim, v.at, v.expr, times, vals, false, active); } finally { active.delete(k); }
    if (r.missing) return { value: NaN, t: undefined, missing: true };
    extra[k] = r.value;
  }
  const masses = Object.fromEntries(sim.geo.bodies.map((b) => [b.id, b.m]));
  const base = snapFns(e.snap, sim.start, masses, vars.g, sim.stages), fns: NonNullable<Env['fns']> = { ...base };
  for (const name of dependency.calls) { const fn = base?.[name]; if (!fn) continue; fns[name] = (...args) => {
    const n = SNAP_ARITY[name];
    if (['Q', 'path', 'count'].includes(name)) {
      const bodies = new Set(sim.geo.bodies.map((b) => b.id)), surfaces = new Set(sim.geo.surfaces.map((b) => b.id));
      for (let i = 0; i < Math.min(n, args.length); i++) {
        const id = String(args[i]); if (args.length <= n && times?.[id]) throw new Error(`${name}() 的对象参数与时刻别名 ${id} 有歧义，请用 vals 的 at 转发`);
        const valid = name === 'path' ? (i === 0 ? bodies : surfaces).has(id) : bodies.has(id) || surfaces.has(id) || name === 'Q' && (id === '碰撞' || id === '爆炸');
        if (!valid) throw new Error(`${name}() 引用的对象 ${id} 不存在`);
      }
    }
    if (args.length <= n) return fn(...args);
    if (args.length !== n + 1) throw new Error(`${name}() 参数个数不对`);
    const alias = args[n], sp = typeof alias === 'string' ? times?.[alias] : undefined;
    if (!sp) throw new Error(`${name}() 的时刻参数必须是 asks.times 中声明的事件别名，如 v(A,t1)`);
    const selected = findEvent(sim, sp); if (!selected) throw new Error(sim.failure?.message ?? `事件别名 ${alias} 没有发生`);
    return snapFns(selected.snap, sim.start, masses, vars.g, sim.stages)![name](...args.slice(0, n));
  }; }
  const env = { vars: { ...vars, ...extra }, fns }, value = boolean ? +evaluateBoolean(expr, env) : evaluate(expr, env);
  if (!Number.isFinite(value)) throw new Error(`取值 ${expr} 不是有限数值，请检查除零、根号及事件时刻`);
  return { value, t: e.t, missing: false };
}

/** expr 里有没有取某一时刻的量（快照里的取值函数） */
const SNAP_FN = /\b(val|z|T|Is|I|U|P|Vn|x|y|cx|vx|vy|v|dx|dy|rel|a|N|polar|angle|KE|PE|Q|Ep|Fs|path|count)\s*\(/;
const CUMULATIVE = /\b(Q|path|dx|dy|count)\s*\(/;

/** 过程实际结束的时刻：到时长上限时物体若早已全部停下，就截到最后一次转折 */
function settledEnd(sim: SimResult): number {
  const moving = Object.values(sim.end.bodies).some((b) => Math.hypot(b.vx, b.vy) > 1e-6);
  const evs = sim.events.filter((e) => e.type !== 'end');
  return moving || !evs.length ? sim.end.t : Math.max(...evs.map((e) => e.t));
}

/** 一处取值用到的全部事件时刻：at（没写或写 end 时，取 expr 最后一次变化的时刻）、times 里的、vals 里的 */
function usedTimes(P: Problem, vars: Record<string, number>, sim: SimResult, at: EventSpec | undefined, expr: string, times?: Times, vals?: Vals): number[] {
  const ts: number[] = [];
  const add = (sp: EventSpec | undefined, ex: string) => {
    if (sp && sp.event !== 'end') { const e = findEvent(sim, sp); if (e) ts.push(e.t); return; }
    if (!SNAP_FN.test(ex)) return;                              // 不取任何时刻的量（常量 v0，或只用 times、vals 里的时刻和值）
    ts.push(settleTime(P, vars, sim, ex, times, vals));
    if (CUMULATIVE.test(ex) && !times && !vals) ts.push(0);       // 生热、路程、位移是从开始累积的
  };
  add(at, expr);
  for (const sp of Object.values(times ?? {})) add(sp, '0');
  for (const v of Object.values(vals ?? {})) add(v.at, v.expr);
  return ts;
}

/** "结束时"的量最后一次变化的时刻：从后往前看各事件时刻的值，直到和结束时的值不同为止 */
function settleTime(P: Problem, vars: Record<string, number>, sim: SimResult, expr: string, times?: Times, vals?: Vals): number {
  const evs = sim.events;
  const at = (i: number) => { try { return evalOn(P, vars, sim, evs[i], expr, times, vals).value; } catch { return NaN; } };
  const last = at(evs.length - 1);
  if (!Number.isFinite(last)) return sim.end.t;
  let k = evs.length - 1;
  while (k > 0) { const v = at(k - 1); if (!(Math.abs(v - last) <= 1e-9 * Math.max(1, Math.abs(last)))) break; k--; }
  return evs[k].t;
}

/** 这一问播放的时段：从用到的最早事件到最晚事件（问题本身、各步核对项都算）。
 *  求反解出的量（如 L、λ，expr 里不取任何时刻的值）取它所用条件的事件时刻；只用到一个时刻时从开始播到它 */
function spanOf(P: Problem, vars: Record<string, number>, sim: SimResult, a: Ask, steps: Step[]): [number, number] {
  const conds = P.conditions ?? [];
  const timeless = !a.at && !a.times && !a.vals && !SNAP_FN.test(a.option?.claim ?? a.expr ?? '');
  const own = timeless && !a.option?.claim && conds.some((c) => c.at || c.just)
    // "恰好发生 / 不发生"的分界：那个事件在解出的结果里可能不出现，播到运动结束
    ? conds.flatMap((c) => [...(c.at ? usedTimes(P, vars, sim, c.at, c.eq ?? '0', c.times, c.vals) : []), ...(c.just ? [findEvent(sim, c.just)?.t ?? settledEnd(sim)] : [])])
    : usedTimes(P, vars, sim, a.at, a.option?.claim ?? a.expr ?? '0', a.times, a.vals);
  const stepTs = [...steps.flatMap((st) => { const e = st.at ? findEvent(sim, st.at) : undefined; return e ? [e.t] : []; }), ...steps.flatMap((st) => (st.check ? usedTimes(P, vars, sim, st.check.at, st.check.expr, { ...a.times, ...st.check.times }, { ...a.vals, ...st.check.vals }) : []))].filter(Number.isFinite);
  const ownTs = own.filter(Number.isFinite), ts = [...ownTs, ...stepTs];
  const end = settledEnd(sim);
  if (!ts.length) return [0, end];
  let lo = Math.min(...ts); const hi = Math.max(...ts);
  // 最早的时刻来自讲解步骤：步骤讲的是“到这一刻为止”的过程，从这一段的开头播起
  if (stepTs.length && Math.min(...stepTs) <= lo + 1e-9 && (!ownTs.length || Math.min(...stepTs) < Math.min(...ownTs) - 1e-9)) lo = Math.max(0, ...sim.events.filter((e) => e.type !== 'time' && e.t < lo - 1e-9).map((e) => e.t));
  // 由已知条件反解出来的量（求直径、质量）：条件说的是整个过程，从头播，学生先看到前因
  if (own !== undefined && timeless && conds.some((c) => c.at || c.just) && hi > 1e-6) return [0, hi];
  if (hi - lo > 1e-6) return [lo, hi];
  if (hi > 1e-6) return [0, hi];
  // 只用到开始时刻（如开始时的加速度）：播到第一次转折
  const next = sim.events.find((e) => e.t > 1e-6);
  return [0, next ? next.t : end];
}

// 反解保留原有采样时刻与插值，只关闭表达式无法访问的画面受力清单。
function residuals(P: Problem, u: Record<string, number>): number[] {
  try {
    const { vars, sim } = run(P, u, 0, eventsOf(P.conditions ?? []), false, false);
    return (P.conditions ?? []).map((c) => evalAt(P, vars, sim, c.at, c.eq!, c.times, c.vals).value);
  } catch { return (P.conditions ?? []).map(() => NaN); }
}

/** 反解未知数：先在范围里粗扫，再用阻尼最小二乘（LM）细化；"恰好"类条件用二分 */
function solveUnknowns(P: Problem): { values: Record<string, number>; determined: Set<string>; customDetermined: Set<string> } {
  const names = Object.keys(P.unknowns ?? {});
  if (names.length > 3) throw new Error('最多同时反解 3 个未知数；请补充已知量或拆分独立阶段，不能把有限搜索当作高维唯一性证明');
  if (!names.length) return { values: {}, determined: new Set(), customDetermined: new Set() };
  const known: Record<string, number> = { g: 9.8 }, unknownDependent = new Set(names);
  for (const [k, v] of Object.entries(P.constants ?? {})) known[k] = evaluate(v, { vars: known });
  for (const [k, p] of Object.entries(P.params ?? {})) {
    if (unknownDependent.has(k)) continue;
    const value = paramValue(p);
    if (typeof value === 'string' && [...dependencies(value).names].some((name) => unknownDependent.has(name))) { unknownDependent.add(k); continue; }
    known[k] = evaluate(value, { vars: known });
  }
  const ranges = names.map((n): [number, number] => {
    const [lo, hi] = P.unknowns![n].range.map((v) => evaluate(v, { vars: known }));
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) throw new Error(`unknowns.${n}.range 必须由已知参数给出有限且递增的范围`);
    return [lo, hi];
  });
  const just = P.conditions?.find((c) => c.just);
  if (just) {
    if (names.length !== 1) throw new Error('"恰好"类条件目前只支持一个未知数');
    const [lo0, hi0] = ranges[0];
    const happens = (x: number) => { try { const r = run(P, { [names[0]]: x }, 0, [just.just!], false, false); scope = { P, vars: r.vars }; return !!findEvent(r.sim, just.just!); } catch (e) { throw new Error(`临界试算 ${names[0]}=${x} 失败：${(e as Error).message}。这不等于事件未发生；请修正场景或范围`); } };
    let lo = lo0, hi = hi0;
    const hLo = happens(lo), hHi = happens(hi);
    if (hLo === hHi) throw new Error(`unknowns.${names[0]}.range 两端事件是否发生的情况相同，找不到"恰好"的分界；请让范围两端分别发生和不发生 ${JSON.stringify(just.just)}，并检查 tMax 与 until`);
    for (let it = 0; it < 45; it++) { const mid = (lo + hi) / 2; if (happens(mid) === hLo) lo = mid; else hi = mid; }
    // 保留发生侧的夹逼端点，才能在临界事件处读数；区间宽度已收敛至浮点精度。
    const source = expressionSource(P, 't', just.just);
    return { values: { [names[0]]: hLo ? lo : hi }, determined: new Set(source === 'engine' ? names : []), customDetermined: new Set(source === 'custom' ? names : []) };
  }
  if ((P.conditions ?? []).filter((c) => c.eq).length < names.length) throw new Error('未知数未由足够的条件决定，不能作为引擎反解结果');
  const norm = (r: number[]) => (r.some((x) => !Number.isFinite(x)) ? Infinity : Math.hypot(...r));
  const G = names.length === 1 ? 40 : names.length === 2 ? 16 : 7;
  const scanned: { x: number; value: number }[] = [];
  let best: number[] = ranges.map(([a, b]) => (a + b) / 2), bestN = Infinity;
  const grid: { x: number[]; r: number[] }[] = [], residualCache = new Map<string, number[]>();
  const raw = (x: number[]) => { const key = JSON.stringify(x); if (!residualCache.has(key)) residualCache.set(key, residuals(P, Object.fromEntries(names.map((nm, i) => [nm, x[i]])))); return residualCache.get(key)!; };
  for (let c = 0; c < G ** names.length; c++) {
    let k = c;
    const x = ranges.map(([a, b]) => { const i = k % G; k = Math.floor(k / G); return a + ((b - a) * (i + 0.5)) / G; });
    grid.push({ x, r: raw(x) });
  }
  // 每个条件按它在范围内的典型大小（粗扫残差绝对值的中位数）归一：条件整体乘一个常数不改变反解结果和多根判断
  const scale = (grid[0]?.r ?? []).map((_, i) => { const v = grid.map((g) => Math.abs(g.r[i])).filter((y) => Number.isFinite(y) && y > 0).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : 1; });
  const unit = (r: number[]) => r.map((v, i) => v / (scale[i] || 1));
  for (const g of grid) {
    const residual = unit(g.r);
    if (names.length === 1 && residual.length === 1) scanned.push({ x: g.x[0], value: residual[0] });
    const n = norm(residual);
    if (n < bestN) { bestN = n; best = g.x; }
  }
  const explain = (values: number[]) => {
    const u = Object.fromEntries(names.map((n, i) => [n, values[i]]));
    try {
      const { vars, sim } = run(P, u, 0, eventsOf(P.conditions ?? []), false, false);
      return (P.conditions ?? []).map((c, i) => {
        try { const r = evalAt(P, vars, sim, c.at, c.eq!, c.times, c.vals); return `条件${i + 1} ${JSON.stringify(c.at ?? { event: 'end' })}：${r.missing ? '所用事件未发生' : `残差 ${r.value}`}`; }
        catch (e) { return `条件${i + 1}：${(e as Error).message}`; }
      }).join('；');
    } catch (e) { return `试算 ${JSON.stringify(u)} 失败：${(e as Error).message}`; }
  };
  if (!Number.isFinite(bestN)) throw new Error(`在给定范围里找不到有效条件。${explain(best).replace(/[。；]+$/, '')}。请检查事件名字、n、轨道接续、初始状态及 tMax/until；不要把答案写回条件`);
  const F = (x: number[]) => unit(raw(x));
  const refine = (seed: number[], fn = F, iterations = 60) => {
  let x = seed.slice(), lambda = 1e-3, r = fn(x);
  for (let it = 0; it < iterations && norm(r) > 1e-11; it++) {
    const J = names.map((_, j) => {
      const h = 1e-7 * Math.max(1, Math.abs(x[j]));
      const xp = x.slice(); xp[j] += h;
      return fn(xp).map((v, i) => (v - r[i]) / h);
    });
    const m = names.length;
    const A = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => r.reduce((s, _v, i) => s + J[a][i] * J[b][i], 0) + (a === b ? lambda : 0)));
    const gr = names.map((_, a) => r.reduce((s, v, i) => s + J[a][i] * v, 0));
    const d = solveLin(A, gr.map((v) => -v));
    if (!d) break;
    const xn = x.map((v, i) => Math.max(ranges[i][0], Math.min(ranges[i][1], v + d[i])));
    const rn = fn(xn);
    if (norm(rn) < norm(r)) { x = xn; r = rn; lambda = Math.max(1e-12, lambda / 10); } else lambda *= 10;
  }
  return { x, r };
  };
  const result = refine(best); let { x, r } = result;
  if (!r.length || r.some((v) => !Number.isFinite(v) || !same(v, 0))) throw new Error(`给定范围内条件残差未收敛，未知数没有求出。${explain(x)}。请检查条件符号、单位和物理可行性；range 要覆盖真实解，不能用答案替代条件`);
  if (names.length > 1) {
    // 粗扫已经覆盖全范围：选各残差盆地和远处种子，多起点复用缓存，额外试算限额避免反解耗时失控。
    const distance = (a: number[], b: number[]) => Math.max(...a.map((v, j) => Math.abs(v - b[j]) / (ranges[j][1] - ranges[j][0])));
    const scores = grid.map((g) => norm(unit(g.r))), seeds: number[][] = [];
    grid.forEach((g, i) => {
      if (!Number.isFinite(scores[i]) || distance(g.x, best) < 1e-12) return;
      let stride = 1;
      const local = names.every(() => { const pos = Math.floor(i / stride) % G, a = pos ? scores[i - stride] : Infinity, b = pos + 1 < G ? scores[i + stride] : Infinity; stride *= G; return scores[i] <= a && scores[i] <= b; });
      if (local) seeds.push(g.x);
    });
    seeds.sort((a, b) => norm(F(a)) - norm(F(b)));
    const far = grid.filter((g, i) => Number.isFinite(scores[i])).sort((a, b) => distance(b.x, x) - distance(a.x, x))[0]?.x;
    if (far && !seeds.some((s) => distance(s, far) < 1e-12)) seeds.push(far);
    const roots = [x]; let extra = 0;
    const limited = (p: number[]) => { const key = JSON.stringify(p); if (!residualCache.has(key) && ++extra > 48) return (P.conditions ?? []).map(() => NaN); return F(p); };
    for (const seed of seeds.slice(0, 4)) {
      const candidate = refine(seed, limited, 18);
      if (norm(candidate.r) <= 1e-10 && !roots.some((root) => distance(root, candidate.x) <= 1e-6)) {
        roots.push(candidate.x);
        throw new Error(`给定范围内条件存在多解（多个根）：${JSON.stringify(roots.map((p) => Object.fromEntries(names.map((name, j) => [name, p[j]]))))}；可能条件不独立或存在多个孤立解，请补充独立条件、事件先后或缩窄范围，不能任取一支作为已核验答案`);
      }
      if (extra >= 48) break;
    }
  }
  // 不过零的切触根也可能多解。从粗扫的各个残差极小点独立求根，不能只保留最优种子的一支。
  for (let i = 1; i + 1 < scanned.length; i++) {
    const seed = scanned[i];
    if (!Number.isFinite(seed.value) || Math.abs(seed.value) > Math.abs(scanned[i - 1].value) || Math.abs(seed.value) > Math.abs(scanned[i + 1].value)) continue;
    let other = seed.x;
    for (let it = 0; it < 60; it++) {
      const value = F([other])[0]; if (!Number.isFinite(value) || Math.abs(value) <= 1e-11) break;
      const h = 1e-7 * Math.max(1, Math.abs(other)), derivative = (F([other + h])[0] - value) / h;
      if (!Number.isFinite(derivative) || derivative === 0) break;
      let accepted = false;
      for (let back = 0; back < 30; back++) {
        const trial = Math.max(ranges[0][0], Math.min(ranges[0][1], other - value / derivative / 2 ** back)), next = F([trial])[0];
        if (Number.isFinite(next) && Math.abs(next) < Math.abs(value)) { other = trial; accepted = true; break; }
      }
      if (!accepted) break;
    }
    if (same(F([other])[0], 0) && !same(other, x[0])) throw new Error(`给定范围内条件存在多个根（${names[0]}=${other} 或 ${x[0]}）；请补充事件先后条件或缩窄范围，不能任取一支作为已核验答案`);
  }
  // 标量方程的粗扫若另有过零分支，不能把其中任意一个根当作唯一反解。
  for (let i = 1; i < scanned.length; i++) {
    const a = scanned[i - 1], b = scanned[i];
    if (!Number.isFinite(a.value) || !Number.isFinite(b.value) || a.value * b.value >= 0 || (x[0] >= a.x && x[0] <= b.x)) continue;
    let lo = a.x, hi = b.x, left = a.value, valid = true;
    for (let it = 0; it < 45; it++) {
      const mid = (lo + hi) / 2, value = F([mid])[0];
      if (!Number.isFinite(value)) { valid = false; break; }
      if (Math.sign(value) === Math.sign(left)) { lo = mid; left = value; } else hi = mid;
    }
    const other = (lo + hi) / 2;
    if (valid && same(F([other])[0], 0) && !same(other, x[0])) throw new Error(`给定范围内条件存在多个根（${names[0]}=${other} 或 ${x[0]}）；请补充事件先后条件或缩窄范围，不能任取一支作为已核验答案`);
  }
  for (let j = 0; j < names.length; j++) {
    const h = 1e-4 * (ranges[j][1] - ranges[j][0]);
    const changes = [-1, 1].some((sign) => {
      const xp = x.slice(); xp[j] = Math.max(ranges[j][0], Math.min(ranges[j][1], x[j] + sign * h));
      const shifted = F(xp);
      return shifted.some((v, k) => Number.isFinite(v) && !same(v, r[k]));
    });
    if (!changes) throw new Error(`条件不能在核对精度内分辨未知数 ${names[j]}，可能是守恒恒等式或没有有效条件`);
  }
  const J = names.map((_, j) => {
    const h = 1e-7 * Math.max(1, Math.abs(x[j])), xp = x.slice(); xp[j] += h;
    return F(xp).map((v, i) => (v - r[i]) / h);
  });
  const scaled = J.map((col) => { const scale = Math.max(...col.map(Math.abs)); return col.map((v) => scale ? v / scale : 0); });
  const gram = names.map((_, a) => names.map((_, b) => scaled[a].reduce((s, v, k) => s + v * scaled[b][k], 0)));
  // 列归一化后检查独立性，拒绝恒等式和缺条件。此阈值只判矩阵秩，不改答案核对容差。
  const rank = gram.map((row) => row.slice());
  for (let k = 0; k < names.length; k++) {
    let p = k; for (let j = k + 1; j < names.length; j++) if (Math.abs(rank[j][k]) > Math.abs(rank[p][k])) p = j;
    if (!Number.isFinite(rank[p][k]) || Math.abs(rank[p][k]) < 1e-9) throw new Error('条件不独立，未知数未被唯一决定');
    [rank[k], rank[p]] = [rank[p], rank[k]];
    for (let j = k + 1; j < names.length; j++) { const f = rank[j][k] / rank[k][k]; for (let q = k; q < names.length; q++) rank[j][q] -= f * rank[k][q]; }
  }
  const determined = new Set<string>(), customDetermined = new Set<string>();
  (P.conditions ?? []).forEach((c, k) => {
    if (!c.eq) return;
    const source = expressionSource(P, c.eq, c.at, c.times, c.vals); if (source !== 'engine' && source !== 'custom') return;
    const response = solveLin(gram, scaled.map((col) => col[k]));
    response?.forEach((v, j) => { if (Math.abs(v) > 1e-9) (source === 'engine' ? determined : customDetermined).add(names[j]); });
  });
  for (const k of customDetermined) determined.delete(k);
  return { values: Object.fromEntries(names.map((nm, i) => [nm, x[i]])), determined, customDetermined };
}

/** 一问所在的"情景"：题目本身，或者这一问改了条件、带了自己的未知数 */
function scenarioOf(P: Problem, a: Ask): Problem {
  if (!a.with && !a.unknowns && !a.conditions && !a.scene) return P;
  const params = { ...(P.params ?? {}) };
  for (const [k, v] of Object.entries(a.with ?? {})) params[k] = v;
  const inherited = { ...(a.scene ? {} : P.unknowns) };
  for (const k of Object.keys(a.with ?? {})) delete inherited[k];
  return { ...P, params, scene: a.scene ?? P.scene, unknowns: a.unknowns ?? inherited, conditions: a.conditions ?? (a.scene ? [] : P.conditions),
    asks: [{ ...a, scene: undefined, with: undefined, unknowns: undefined, conditions: undefined }], solution: { [a.id]: solutionFor(P, a.id) ?? [] } };
}

/** 这一问的解题过程：编号完全一致优先；AI 常把 (1a)(1b) 的过程统一写在 "1" 下，这时按前缀归给该组的第一问 */
export function solutionFor(P: Problem, id: string): Step[] | undefined {
  const sol = P.solution ?? {};
  if (sol[id]) return sol[id];
  const key = Object.keys(sol).find((k) => !P.asks.some((a) => a.id === k) && id.startsWith(k));
  if (!key) return undefined;
  const first = P.asks.find((a) => a.id.startsWith(key));
  return first?.id === id ? sol[key] : undefined;
}

function solveSingle(P: Problem, sample = 0): SampleResult {
  const cache = new Map<string, { vars: Record<string, number>; sim: SimResult; residual: number; P: Problem; determined: Set<string>; customDetermined: Set<string> }>();
  const keyOf = (Q: Problem) => JSON.stringify([Q.scene, Q.params, Q.unknowns, Q.conditions, Q.asks, Q.solution]);
  const unknownCache = new Map<string, ReturnType<typeof solveUnknowns>>();
  const unknownsOf = (Q: Problem) => {
    const key = keyOf(Q);
    if (!unknownCache.has(key)) unknownCache.set(key, solveUnknowns(Q));
    return unknownCache.get(key)!;
  };
  // 顶层可以只声明范围，而把实际条件放在某问。基础展示也必须用这些明确条件求值，不能填范围中点。
  const sharedNames = Object.keys(P.unknowns ?? {});
  if (sharedNames.length && !P.conditions?.length) {
    const candidates = P.asks.filter((a) => a.conditions?.length && !a.scene && sharedNames.every((k) => k in (a.unknowns ?? P.unknowns ?? {})));
    if (!candidates.length) throw new Error('共享未知数没有顶层条件，也没有小问条件，不能填任意演示值');
    const sources = candidates.map((a) => unknownsOf(scenarioOf(P, a)));
    for (const values of sources.slice(1)) for (const k of sharedNames) if (!same(values.values[k], sources[0].values[k])) throw new Error(`各问对共享未知数 ${k} 给出冲突值，请把范围与条件放到各问 unknowns/conditions`);
    unknownCache.set(keyOf(P), { values: sources[0].values, determined: new Set(sharedNames.filter((k) => sources.every((s) => s.determined.has(k)))), customDetermined: new Set(sharedNames.filter((k) => sources.some((s) => s.customDetermined.has(k)))) });
  }
  const solveScenario = (Q: Problem) => {
    const key = keyOf(Q);
    if (!cache.has(key)) {
      const u = unknownsOf(Q);
      const { vars, sim } = run(Q, u.values, sample, undefined, true);
      const residual = Math.hypot(...(Q.conditions ?? []).filter((c) => c.eq).map((c) => evalAt(Q, vars, sim, c.at, c.eq!, c.times, c.vals).value));
      cache.set(key, { vars, sim, residual, P: Q, determined: u.determined, customDetermined: u.customDetermined });
    }
    return cache.get(key)!;
  };
  const main = solveScenario(P);
  const asks = P.asks.map((a): AskResult => {
    try {
      const S = solveScenario(scenarioOf(P, a)); scope = { P: S.P, vars: S.vars };
      const { value, t, missing } = a.expr ? evalAt(S.P, S.vars, S.sim, a.at, a.expr, a.times, a.vals) : { value: NaN, t: undefined, missing: false };
      const times = Object.fromEntries(Object.entries(a.times ?? {}).map(([k, sp]) => [k, findEvent(S.sim, sp)?.t ?? NaN]));
      if (missing) return { id: a.id, text: a.text, value: NaN, shown: '—', ok: false, source: 'unavailable', error: `事件没有发生：${JSON.stringify(a.at ?? a.times)}` };
      const valueSource = a.expr ? expressionSource(S.P, a.expr, a.at, a.times, a.vals, S.determined, S.customDetermined) : 'algebra';
      const claim = a.option?.claim, claimSource = a.option ? claim ? expressionSource(S.P, claim, a.at, a.times, a.vals, S.determined, S.customDetermined) : 'ai' : undefined;
      const cr = claim ? evalAt(S.P, S.vars, S.sim, a.at, claim, a.times, a.vals, true) : undefined;
      if (cr?.missing) throw new Error(`选项判断式的事件没有发生：${JSON.stringify(a.at)}`);
      const claimValue = cr ? !!cr.value : undefined, claimOk = claimValue === undefined || a.option?.correct === undefined ? null : claimValue === a.option.correct;
      const source = claimSource ?? valueSource;
      const answer = !a.expr || a.answer === undefined ? undefined : evaluate(a.answer, { vars: S.vars });
      if (answer !== undefined && !Number.isFinite(answer)) throw new Error('answer 不是有限数值，请检查字母公式的定义域');
      const sol = solutionFor(P, a.id) ?? [];
      const steps = sol.map((st): StepResult => {
        const atT = st.at ? findEvent(S.sim, st.at)?.t : undefined;
        const frameAt = st.at ?? st.check?.at, phase = frameAt?.phase ?? (frameAt?.event === 'collide' ? 'before' : frameAt?.event === 'collided' ? 'after' : 'at');
        const frameEvent = frameAt ? findEvent(S.sim, phase === 'at' ? frameAt : { ...frameAt, phase }) : undefined;
        const frame = frameEvent ? { t: frameEvent.t, phase, snapshot: frameEvent.snap } : undefined, after = phase === 'after';
        if (!st.check) return { say: st.say, tex: st.tex, verdict: 'skip', source: 'ai', verified: false, t: atT, after, frame, show: st.show };
        try {
          const claimed = evaluate(st.check.value, { vars: S.vars });
          if (!Number.isFinite(claimed)) throw new Error('check.value 不是有限数值，请检查字母公式的定义域');
          const r = evalAt(S.P, S.vars, S.sim, st.check.at, st.check.expr, { ...a.times, ...st.check.times }, { ...a.vals, ...st.check.vals });
          const source = expressionSource(S.P, st.check.expr, st.check.at, { ...a.times, ...st.check.times }, { ...a.vals, ...st.check.vals }, S.determined, S.customDetermined);
          const match = r.missing ? 'bad' : verdictOf(claimed, r.value);
          const verdict = match === 'ok' && (source === 'algebra' || source === 'custom') ? source : match;
          return { say: st.say, tex: st.tex, verdict, verified: source === 'engine' && match === 'ok', frame, source: r.missing ? 'unavailable' : source, claimed, engine: r.value, t: atT ?? r.t, after: after || (!st.at && st.check.at?.event === 'collided'), show: st.show,
            reason: verdict === 'bad' ? (r.missing ? '这一步指的事件在过程中没有发生' : diagnose(claimed, r.value)) : undefined };
        } catch (e) { return { say: st.say, tex: st.tex, verdict: 'bad', verified: false, frame, source: 'unavailable', error: (e as Error).message, reason: S.sim.failure && (e as Error).message === S.sim.failure.message ? '模拟已中止，这一步依赖未完成的过程' : '核对项写得不对，引擎读不懂', show: st.show }; }
      });
      const answerMatch = answer === undefined ? null : sameAnswer(answer, value), match = a.option ? answerMatch === false ? false : claimOk : answerMatch;
      const ok = match === false ? false : source === 'engine' ? match : null, verified = source === 'engine' && ok === true;
      const plotSources = a.plot ? [a.plot.x, a.plot.y].map((e) => expressionSource(S.P, e, a.at, a.times, a.vals, S.determined, S.customDetermined)) : [], plotSource = plotSources.includes('custom') ? 'custom' : plotSources.includes('engine') ? 'engine' : 'algebra';
      const span = spanOf(S.P, S.vars, S.sim, a, sol), plotContext: PlotContext | undefined = a.plot ? { vars: S.vars, at: a.at, times: a.times, vals: a.vals, window: span } : undefined;
      let plotData: [number, number, number][] | undefined, plotError: string | undefined;
      if (a.plot) try { plotData = plotPoints(S.P, S.vars, S.sim, a.plot, span[0], span[1], plotContext); if (!plotData.length) throw new Error('该问时间窗内没有可用的关系图采样点'); } catch (e) { plotError = `关系图无法生成：${(e as Error).message}`; }
      return { id: a.id, text: a.text, value, shown: a.expr ? nice(value) : claimValue !== undefined ? claimValue ? '命题成立' : '命题不成立' : String(a.answer ?? '见解答'), answer, answerMatch, valueSource, source, ok, verified,
        ...(a.option ? { claimValue, claimOk, claimSource } : {}), t: cr?.t ?? t, sim: S.sim, times, steps, span, plotContext, plotSource: a.plot ? plotError ? 'unavailable' : plotSource : undefined, plotError, plotData };

    } catch (e) { return { id: a.id, text: a.text, value: NaN, shown: '—', ok: false, verified: false, source: 'unavailable', ...(a.option ? { claimSource: 'unavailable' as const, claimOk: null } : {}), error: (e as Error).message }; }
  });
  const label = labelOf(asks);
  const stepRepair = repairPrompt(asks.flatMap((a) => (a.steps ?? []).map((step, index) => ({ askId: a.id, askText: a.text, index, step })).filter((x) => x.step.verdict === 'bad' && x.step.claimed !== undefined)));
  const claimRepair = asks.filter((a) => a.claimOk === false).map((a) => `第 (${a.id}) 问选项判断式与 correct 不一致：按 ${a.claimSource === 'engine' ? '内置物理' : '自定义计算'} 得出 ${a.claimValue ? '真' : '假'}，请核对命题、参考方向和 correct。`).join('\n');
  return { vars: main.vars, sim: main.sim, asks, residual: main.residual, label, repair: [stepRepair, claimRepair].filter(Boolean).join('\n'), counts: verificationCounts(asks) };
}

function labelOf(asks: AskResult[]): Label {
  if (asks.some((a) => a.ok === false || a.steps?.some((s) => s.verdict === 'bad'))) return '有问题';
  const all = [...asks, ...asks.flatMap((a) => a.steps ?? [])];
  if (asks.every((a) => a.verified) && asks.every((a) => (a.steps ?? []).every((s) => s.verified))) return '已核验';
  if (all.some((a) => a.source === 'engine' && a.verified)) return '部分核验';
  if (all.some((a) => a.source === 'custom')) return '按 AI 方程/自定义量算出，未核验物理';
  if (all.some((a) => a.source === 'ai')) return 'AI 给出，未核验';
  if (all.some((a) => a.source === 'engine')) return '引擎算出，未对照答案';
  return '仅代数，未模拟验证';
}

/** 两组独立反解、模拟、核对。动画只保留第一组采样。 */
export function solveProblem(P: Problem, sample = 0): Solved {
  let result: Solved | undefined;
  for (const current of solveProgressively(P, sample)) result = current;
  return result!;
}

/** 先发布第一组，再完整核对第二组。生成器暂停点允许 worker 立即把动画送回页面。 */
export function* solveProgressively(P: Problem, sample = 0): Generator<Solved> {
  const errors = validate(P);
  if (errors.length) throw new Error(formatRepair(errors));
  if (P.unsupported) { yield { vars: {}, asks: (P.asks ?? []).map((a) => ({ id: a.id, text: a.text, value: NaN, shown: String(a.answer ?? '见解答'), ok: null, source: 'unsupported', steps: (solutionFor(P, a.id) ?? []).map((st) => ({ say: st.say, tex: st.tex, verdict: 'skip', source: 'unsupported' })) })), residual: NaN, label: '超出引擎能力，未经验证', repair: '' }; return; }
  const first = solveSingle(P, sample);
  if (!P.samples?.length) { yield first; return; }
  const pendingAsks = first.asks.map((a) => ({ ...a, verified: false, ok: a.ok === false ? false : null, claimOk: a.claimOk === false ? false : null }));
  yield { ...first, asks: pendingAsks, counts: verificationCounts(pendingAsks), samples: [first], pending: true, label: first.label === '已核验' || first.label === '引擎复核一致' ? '部分核验' : first.label };
  const params = { ...P.params };
  for (const [k, v] of Object.entries(P.samples[0])) params[k] = v;
  let second: SampleReport;
  try { second = solveSingle({ ...P, params }, 0); }
  catch (e) {
    second = { vars: {}, residual: NaN, error: (e as Error).message, label: '有问题', repair: `第二组运行失败：${(e as Error).message}`,
      asks: P.asks.map((a) => ({ id: a.id, text: a.text, value: NaN, shown: '—', ok: false, source: 'unavailable', error: (e as Error).message })) };
  }
  const asks = first.asks.map((a, i) => ({ ...a,
    claimValue: a.claimValue, claimOk: a.claimOk === false || second.asks[i].claimOk === false ? false : a.claimOk === true && second.asks[i].claimOk === true ? true : null,
    verified: !!a.verified && !!second.asks[i].verified,
    answerMatch: a.answerMatch === false || second.asks[i].answerMatch === false ? false : a.answerMatch === true && second.asks[i].answerMatch === true ? true : null,
    claimSource: a.claimSource === 'custom' || second.asks[i].claimSource === 'custom' ? 'custom' as const : a.claimSource,
    source: a.source === 'unavailable' || second.asks[i].source === 'unavailable' ? 'unavailable' as const : a.source === 'custom' || second.asks[i].source === 'custom' ? 'custom' as const : a.source === 'algebra' || second.asks[i].source === 'algebra' ? 'algebra' as const : a.source,
    error: [a.error && `第一组：${a.error}`, second.asks[i].error && `第二组：${second.asks[i].error}`].filter(Boolean).join('；') || undefined,
    ok: a.ok === false || second.asks[i].ok === false ? false : a.ok === true && second.asks[i].ok === true ? true : null,
    steps: a.steps?.map((st, j) => second.asks[i].steps?.[j]?.verdict === 'bad'
      ? { ...second.asks[i].steps![j], t: st.t, frame: st.frame, reason: `第二组：${second.asks[i].steps![j].reason ?? '核对失败'}` }
      : st.verdict === 'ok' && ['algebra', 'custom'].includes(second.asks[i].steps?.[j]?.source ?? '') ? { ...st, source: second.asks[i].steps![j].source, verdict: second.asks[i].steps![j].verdict, verified: false } : st),
  }));
  yield { ...first, asks, counts: verificationCounts(asks), samples: [first, second],
    label: first.label === '有问题' || second.label === '有问题' ? '有问题' : labelOf(asks),
    repair: [first.repair && `第一组：\n${first.repair}`, second.repair && `第二组：\n${second.repair}`].filter(Boolean).join('\n') };
}

function solveLin(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
