// 理想物理引擎（力学）：竖直平面内的物体沿轨道运动，离开轨道后做抛体运动。
// - 轨道：直线段（水平面、斜面、传送带）、无限长地面、圆弧（内侧、外侧、管道），首尾可平滑连接，也可接到木板上。
// - 直线上的物体可以叠放（木板上放物块），每段开头把"一起动 / 相对滑动"的各种组合都试一遍，选唯一说得通的。
// - 圆弧上的物体单独处理：切向加速度随位置变化，支持力由向心条件算出，支持力减到 0 就离开轨道。
// - 每段里用 RK4 积分（受力恒定时是精确的）；共速、滑离、离开轨道、落地、相碰、经过标记点等转折，
//   先检测符号变化，再二分求出精确时刻，处理后重判接触状态，进入下一段。

import { evaluate, type Env } from './expr.ts';

// ---------- 场景描述（来自 JSON） ----------
import { labOf, simulateLab, type LabSpecs } from './labs/index.ts';
import type { Prim, LabPlot, LabPath } from './labs/common.ts';
export type Num = number | string;           // 数字或表达式
export type SurfaceSpec = {
  tether?: 'rope' | 'rod';   // 圆弧其实是绳或杆的约束：画绳或杆，不画轨道
  id: string; kind?: 'segment' | 'ground' | 'arc';
  from?: [Num, Num]; to?: [Num, Num]; dir?: [Num, Num]; length?: Num;   // 线段：两端点，或起点 + 方向 + 长度
  y?: Num;                                   // 地面：无限长水平面的高度
  center?: [Num, Num]; radius?: Num;          // 圆弧：圆心、半径
  start?: [Num, Num] | Num; end?: [Num, Num] | Num;  // 圆弧起止：从圆心指出的方向向量，或角度（度）
  turn?: 'ccw' | 'cw';                       // 从起点到终点的转向（默认逆时针）
  side?: 'inside' | 'outside' | 'tube';      // 物体在圆的里侧（竖直圆周内轨）、外侧（拱顶），或在管道里
  mu?: Num | [Num, Num];                     // 动摩擦因数；两个数时分别是沿正方向、沿反方向运动时
  speed?: Num;                               // 传送带速度（沿正方向为正）
  next?: string;                             // 正方向末端平滑连接：另一段轨道，或一块木板的左端
  marks?: Record<string, Num | [Num, Num]>;  // 命名点：线段给到起点的距离，圆弧给方向向量或角度
  walls?: { start?: Num; end?: Num };        // 线段两端的挡板（天花板、地面、墙）及恢复系数；0 表示撞上就停住
  resistance?: Num;                         // 沿切线的恒定或表达式阻力，可用 s、v、t
  losses?: { at: Num; energy?: Num; fraction?: Num }[]; // 每次经过的瞬时动能损失
  rails?: Num;                               // 画成两条平行导轨，间距为此值（俯视）
  on?: string;                               // 固定在某块木板上随它运动（可动轨道）；坐标相对于木板左端
};
export type BodySpec = {
  id: string; kind?: 'block' | 'board' | 'ball'; m: Num;
  length?: Num;                              // 木板长度
  on?: string;                               // 放在哪个轨道或哪块木板上
  at?: Num;                                  // 在轨道上：离起点的距离；在木板上：离木板左端的距离
  x?: Num;                                   // 或者给世界 x 坐标（木板给左端，物块给中心；只用于直线轨道）
  v?: Num;                                   // 沿轨道正方向的初速度
  pos?: [Num, Num]; vel?: [Num, Num];        // 不在轨道上时：抛体的初位置和初速度
  from?: string;                             // 分裂（爆炸、反冲）出来的碎片：母体 id。分裂前不出现；分裂后速度用 v（轨道上）或 vel（空中），相对地面；最多一块不写，由动量守恒算出
  walls?: { left?: Num; right?: Num };       // 木板两端的挡板及碰撞恢复系数（1 为弹性碰撞）
  next?: string;                             // 木板右端连接的轨道（固定在木板上的圆弧，构成可动轨道）
  locked?: boolean;                          // 被锁定（固定不动），直到弹簧解锁
  release?: EventSpec;                       // 到这个事件才开始运动（之前停在原处），开始时的速度取 v 或 vel：“甲到 B 时乙恰以 5 m/s 经过 A”
  look?: Look;                               // 情景里它是什么：只影响外观
  q?: Num;                                   // 电荷量
};
export type Look = 'car' | 'person' | 'rocket' | 'satellite' | 'boat' | 'crate' | 'planet' | 'rod' | 'skier' | 'plane' | 'drone' | 'ball';
export type ForceSpec = { on: string; F?: [Num, Num]; along?: Num; until?: EventSpec; after?: EventSpec };   // after：从某事件开始才作用
export type EventSpec = { name?: string; expr?: string; dir?: 1 | -1; event: string; body?: string; from?: string; to?: string; bodies?: [string, string]; t?: Num; n?: number; phase?: 'before' | 'after' };
export type SceneSpec = LabSpecs & {
  notes?: NoteSpec[];
  backdrop?: 'sky' | 'snow' | 'road' | 'water' | 'grass';   // 情景背景：只影响画面
  surfaces: SurfaceSpec[]; bodies: BodySpec[];
  friction?: { between: [string, string]; mu: Num }[];
  forces?: ForceSpec[];
  resistance?: { on: string; magnitude: Num; relativeTo?: string }[];
  collisions?: { bodies: string[]; e: Num }[];   // 列出的配对按几何接触相碰；e=0 为粘连，约束不相容时明确报错
  springs?: { id: string; between: [string, string]; k: Num; L0?: Num; anchors?: [Num, Num]; mode?: 'contact'; unlock?: { body: string; force: Num } }[];  // 轻弹簧（沿线），拉力或压力达到 force 时解除 body 的锁定
  until?: EventSpec; tMax?: Num;
  plane?: 'vertical' | 'horizontal';         // horizontal：俯视的水平面，重力垂直于运动平面，不参与运动
  em?: EmSpec[];                             // 电场、磁场、点电荷，作用在带电物体（q）上
  circuit?: CircuitSpec;                     // 直流电路：节点分析求解
  ropes?: RopeSpec[];                        // 轻绳：两端物体沿各自直线运动，绳长不变，可经过定滑轮
  fields?: { kind: 'central'; center: [Num, Num]; GM: Num }[];   // 中心引力场，作用在空中物体上
  kicks?: { on: string; when: EventSpec; dv?: Num; vel?: [Num, Num] }[];   // 瞬时改变速度：变轨点火、反冲
  splits?: { on: string; when: EventSpec }[];   // 物体在某时刻/事件分裂成 from 指向它的碎片（爆炸、人跳离车、反冲）
  script?: ScriptSpec;                       // 按解析式演示，不做动力学模拟（平衡、圆锥摆、波等）
};
export type Region = { x: [Num, Num]; y: [Num, Num] } | { center: [Num, Num]; radius: Num };
export type EmSpec = { id?: string; kind: 'E' | 'B' | 'Q'; E?: [Num, Num]; B?: Num; Q?: Num; at?: [Num, Num]; region?: Region };   // B>0 垂直纸面向外；表达式可含 t
export type CircuitElement = { curve?: [Num, Num][]; C?: Num; U0?: Num; id: string; kind: 'battery' | 'R' | 'lamp' | 'rheostat' | 'wire' | 'switch' | 'ammeter' | 'voltmeter' | 'capacitor'; a: string; b: string; E?: Num; r?: Num; R?: Num; C?: Num; on?: Num };
export type CircuitSpec = { transient?: boolean; duration?: Num; nodes: Record<string, [Num, Num]>; elements: CircuitElement[]; marks?: { t: Num; label: string }[] };
export type CircuitFrame = { Is?: Record<string, number>; V: Record<string, number>; I: Record<string, number>; U: Record<string, number> };
export type RopeSpec = { id?: string; between: [string, string]; via?: [Num, Num][] };
export type ScriptBody = { x: Num; y: Num; z?: Num; kind?: 'block' | 'ball' | 'board'; m?: Num; length?: Num; look?: Look };
export type ScriptSpec = {
  duration: Num; bodies?: Record<string, ScriptBody>;
  links?: { a: string | [Num, Num, Num?]; b: string | [Num, Num, Num?]; kind?: 'rope' | 'rod' | 'spring' }[];
  curves?: { n?: number; x: Num; y: Num; z?: Num; label?: string }[];   // 表达式里用 u∈[0,1] 和 t
  vectors?: { on: string; v: [Num, Num, Num?]; label?: string; kind?: 'force' | 'velocity' }[];
  marks?: { t: Num; label: string }[];
};

// ---------- 运行时 ----------
export type V2 = [number, number];
type Surface = {
  id: string; ground: boolean; arc: boolean; len: number;
  p0: V2; u: V2; n: V2;                      // 直线
  c: V2; R: number; a0: number; sgn: number; side: string;  // 圆弧：起始角、转向（+1 逆时针）
  tether?: string; muF: number; muB: number; belt: number; next?: string; prev?: string;
  marks: Record<string, number>; wS?: number; wE?: number; host?: string;
};
type Body = {
  id: string; kind: string; m: number; L: number;
  on: string | null;                         // 轨道 id 或木板 id；null 表示抛体
  s: number; v: number;                      // 在轨道或木板上：沿线坐标（木板为左端）和速度
  x: number; y: number; vx: number; vy: number; // 抛体（木板记中心）
  landed: boolean; walls: { left?: number; right?: number }; next?: string; q: number;
  dormant?: boolean;                         // 还没分裂出来的碎片、已经分裂掉的母体：不运动、不参与任何事件、不进快照
};
export type ForceVec = { n: string; x: number; y: number; readonly by?: string };
export type BodySnap = { fs?: ForceVec[]; af?: number; z?: number; x: number; y: number; cx: number; vx: number; vy: number; ang: number; rel?: number; s?: number; on: string | null; a?: number; N?: number };
export type Snapshot = { lost?: Record<string, number>; draw?: Prim[]; vals?: Record<string, number>; circuit?: CircuitFrame; script?: ScriptFrame; ropes?: Record<string, number>; t: number; bodies: Record<string, BodySnap>; heat: Record<string, number>; path: Record<string, number>; counts: Record<string, number>; springs: Record<string, { x: number; F: number; Ep: number; a: string; b: string; contact?: boolean; L0?: number; endpoints?: [V2, V2] }> };
export type EventRec = { type: string; a: string; b?: string; from?: string; t: number; snap: Snapshot; before?: Snapshot; after?: Snapshot };
export type Stage = { t0: number; t1: number; dynamic?: boolean; modes: { upper: string; lower: string; mode: string; f: number; N: number }[]; acc: Record<string, number> };
// 画面用的几何：轨道（世界坐标）和物体的外形
export type GeoSurface = { tether?: string; rough?: boolean; rails?: number; id: string; kind: 'seg' | 'ground' | 'arc'; p0?: V2; p1?: V2; y?: number; c?: V2; R?: number; a0?: number; a1?: number; side?: string; belt?: number; closed?: boolean; marks: Record<string, V2>; host?: string; walls?: { start?: number; end?: number } };  // host：固定在该木板上，坐标相对木板左端
export type Geo = { plane?: 'vertical' | 'horizontal'; surfaces: GeoSurface[]; bodies: { id: string; kind: string; L: number; m: number; look?: Look; q?: number; walls?: { left?: number; right?: number } }[] };
export type ScriptFrame = { links: { a: number[]; b: number[]; kind: string }[]; curves: { pts: number[][]; label?: string }[]; vectors: { on: string; v: number[]; label?: string; kind: string }[] };
export type RopeGeo = { id: string; a: string; b: string; via: V2[] };
export type EmGeo = { id: string; kind: string; E?: [number, number]; B?: number; Q?: number; at?: V2; rect?: [number, number, number, number]; circle?: [number, number, number] };
export type SimFailure = { t: number; code: string; message: string };
// 只保留已确认的物理能力边界；程序错误仍原样抛出。
class SimulationHalt extends Error {
  failure: SimFailure;
  constructor(code: string, t: number, message: string) { super(message); this.failure = { code, t, message }; }
}
export type SimResult = { failure?: SimFailure; notes?: { text?: string; at?: V2; line?: [V2, V2]; dash?: boolean }[]; board?: { name: string; view: [number, number, number, number]; plot?: LabPlot; flat?: boolean; stat?: Prim[]; paths?: LabPath[] }; em?: EmGeo[]; circuit?: { nodes: Record<string, V2>; elements: { id: string; kind: string; a: string; b: string }[] }; script?: boolean; ropes?: RopeGeo[]; fields?: { x: number; y: number; GM: number }[]; events: EventRec[]; stages: Stage[]; samples: Snapshot[]; start: Snapshot; end: Snapshot; geo: Geo; vars: Record<string, number> };

const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const GROUND_X = -1e4;                       // 地面的起点（沿线坐标从这里量起）

/** stopAfter：这些事件都发生了就停；forces:false 仅省略画面受力清单，采样及计算字段保持一致。 */
/** 题图上的字母和参考线：所有场景都能写，只影响画面 */
export type NoteSpec = { text?: string; at?: [Num, Num]; line?: [[Num, Num], [Num, Num]]; dash?: boolean };
export type WhenValue = (expr: string, s: Snapshot, start: Snapshot) => number;
export function simulate(spec: SceneSpec, vars: Record<string, number>, opt: { partial?: boolean; forces?: boolean; sample?: number; stopAfter?: EventSpec[]; times?: number[]; whenValue?: WhenValue } = {}): SimResult {
  const r = simulateCore(spec, vars, opt);
  if (spec.notes?.length) { const n = (x: Num) => evaluate(x, { vars }); r.notes = spec.notes.map((q) => ({ text: q.text, at: q.at ? [n(q.at[0]), n(q.at[1])] as V2 : undefined, line: q.line ? [[n(q.line[0][0]), n(q.line[0][1])], [n(q.line[1][0]), n(q.line[1][1])]] as [V2, V2] : undefined, dash: q.dash })); }
  return r;
}
function simulateCore(spec: SceneSpec, vars: Record<string, number>, opt: { partial?: boolean; forces?: boolean; sample?: number; stopAfter?: EventSpec[]; times?: number[]; whenValue?: WhenValue } = {}): SimResult {
  if (labOf(spec)) return simulateLab(spec, vars, opt);
  if (spec.script) return simulateScript(spec, vars, opt);
  if (spec.circuit) return simulateCircuit(spec, vars, opt);
  const env: Env = { vars };
  const ev = (x: Num | undefined, d = 0) => (x === undefined ? d : evaluate(x, env));
  const g = vars.g ?? 9.8;
  const G: V2 = spec.plane === 'horizontal' ? [0, 0] : [0, -g];
  const angleOf = (d: [Num, Num] | Num) => (Array.isArray(d) ? Math.atan2(ev(d[1]), ev(d[0])) : (ev(d) * Math.PI) / 180);

  // ---------- 轨道 ----------
  const surf = new Map<string, Surface>();
  spec = { ...spec, surfaces: spec.surfaces ?? [] };   // 纯抛体题没有轨道
  for (const s of spec.surfaces) {
    const mu = Array.isArray(s.mu) ? [ev(s.mu[0]), ev(s.mu[1])] : [ev(s.mu), ev(s.mu)];
    const base = { id: s.id, tether: s.tether, muF: mu[0], muB: mu[1], belt: ev(s.speed), next: s.next, marks: {} as Record<string, number>,
      wS: s.walls?.start === undefined ? undefined : ev(s.walls.start), wE: s.walls?.end === undefined ? undefined : ev(s.walls.end), host: s.on };
    const blank = { p0: [0, 0] as V2, u: [1, 0] as V2, n: [0, 1] as V2, c: [0, 0] as V2, R: 0, a0: 0, sgn: 1, side: '' };
    let S: Surface;
    if (s.kind === 'ground' || (s.y !== undefined && !s.from && !s.center)) {
      S = { ...blank, ...base, ground: true, arc: false, len: 2e4, p0: [GROUND_X, ev(s.y)] };
    } else if (s.kind === 'arc' || s.center) {
      const c: V2 = [ev(s.center![0]), ev(s.center![1])], R = ev(s.radius);
      const sgn = s.turn === 'cw' ? -1 : 1;
      const a0 = angleOf(s.start!), a1 = angleOf(s.end!);
      let span = sgn * (a1 - a0);
      while (span <= 1e-12) span += 2 * Math.PI;
      while (span > 2 * Math.PI + 1e-12) span -= 2 * Math.PI;
      S = { ...blank, ...base, ground: false, arc: true, len: R * span, c, R, a0, sgn, side: s.side ?? 'inside' };
    } else {
      const p0: V2 = [ev(s.from![0]), ev(s.from![1])];
      let p1: V2;
      if (s.to) p1 = [ev(s.to[0]), ev(s.to[1])];
      else { const d: V2 = [ev(s.dir![0]), ev(s.dir![1])], k = Math.hypot(...d), L = ev(s.length); p1 = [p0[0] + (d[0] / k) * L, p0[1] + (d[1] / k) * L]; }
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const u: V2 = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
      let n: V2 = [-u[1], u[0]];
      if (n[1] < 0) n = [-n[0], -n[1]];        // 法向朝上
      S = { ...blank, ...base, ground: false, arc: false, len, p0, u, n };
    }
    for (const [k, m] of Object.entries(s.marks ?? {})) {
      if (!S.arc) { S.marks[k] = ev(m as Num) - (S.ground ? GROUND_X : 0); continue; }
      let d = S.sgn * (angleOf(m) - S.a0);
      while (d < -1e-12) d += 2 * Math.PI;
      S.marks[k] = S.R * d;
    }
    surf.set(s.id, S);
  }
  for (const S of surf.values()) if (S.next && surf.has(S.next)) surf.get(S.next)!.prev = S.id;
  for (const b of spec.bodies) if (b.next && surf.has(b.next)) surf.get(b.next)!.prev = b.id;
  const floorY = Math.min(...[...surf.values()].map((S) => (S.ground ? S.p0[1] : S.arc ? S.c[1] - S.R : Math.min(S.p0[1], S.p0[1] + S.u[1] * S.len))), 0);
  const angAt = (S: Surface, s: number) => S.a0 + (S.sgn * s) / S.R;
  // 固定在木板上的轨道随木板运动：坐标加上木板左端的位置
  const hostOff = (S: Surface): V2 => { if (!S.host) return [0, 0]; const w = worldOf(byId.get(S.host)!); return [w.x, w.y]; };
  const centerOf = (S: Surface): V2 => { const o = hostOff(S); return [S.c[0] + o[0], S.c[1] + o[1]]; };
  const posOn = (S: Surface, s: number): V2 => {
    const o = hostOff(S);
    if (!S.arc) return [S.p0[0] + S.u[0] * s + o[0], S.p0[1] + S.u[1] * s + o[1]];
    const a = angAt(S, s);
    return [S.c[0] + S.R * Math.cos(a) + o[0], S.c[1] + S.R * Math.sin(a) + o[1]];
  };
  const tanOn = (S: Surface, s: number): V2 => {
    if (!S.arc) return S.u;
    const a = angAt(S, s);
    return [-S.sgn * Math.sin(a), S.sgn * Math.cos(a)];
  };

  const muPair = new Map<string, number>();
  for (const f of spec.friction ?? []) { const m = ev(f.mu); muPair.set(`${f.between[0]}|${f.between[1]}`, m); muPair.set(`${f.between[1]}|${f.between[0]}`, m); }

  // ---------- 物体 ----------
  const bodies: Body[] = [];
  const byId = new Map<string, Body>();
  for (const b of spec.bodies) {
    const B: Body = {
      q: ev(b.q), id: b.id, kind: b.kind ?? 'block', m: ev(b.m), L: ev(b.length), on: b.on ?? null, s: 0, v: ev(b.v),
      x: 0, y: 0, vx: 0, vy: 0, landed: false,
      walls: { left: b.walls?.left === undefined ? undefined : ev(b.walls.left), right: b.walls?.right === undefined ? undefined : ev(b.walls.right) },
      next: b.next,
    };
    if (b.from) { B.dormant = true; B.landed = true; B.on = null; }   // 碎片：分裂时才出现
    bodies.push(B); byId.set(B.id, B);
  }
  // 物体所在的轨道（木板上的物体用木板所在的轨道）
  const lineOf = (b: Body): Surface => { let o = b.on!; while (byId.has(o)) o = byId.get(o)!.on!; return surf.get(o)!; };
  const onArc = (b: Body) => !!b.on && !b.landed && !byId.has(b.on) && surf.get(b.on)!.arc;
  for (const b of spec.bodies) {
    const B = byId.get(b.id)!;
    if (B.dormant) continue;
    if (!B.on) {
      const p = b.pos ?? [0, 0], v = b.vel ?? [0, 0];
      [B.x, B.y, B.vx, B.vy] = [ev(p[0]), ev(p[1]), ev(v[0]), ev(v[1])];
      continue;
    }
    const S = lineOf(B);
    if (byId.has(B.on)) B.s = byId.get(B.on)!.s + ev(b.at);   // 木板必须先于其上的物体列出
    else if (b.x !== undefined) B.s = (ev(b.x) - S.p0[0]) / S.u[0];
    else B.s = ev(b.at) - (S.ground ? GROUND_X : 0);
  }

  const lost: Record<string, number> = {}; let lostSoFar = 0;
  const forces = (spec.forces ?? []).map((f) => ({ ...f, active: !f.after, begun: !f.after }));

  // 碰撞与粘连
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  const pairs = new Map<string, number>();
  for (const c of spec.collisions ?? []) for (let i = 0; i < c.bodies.length; i++) for (let j = i + 1; j < c.bodies.length; j++) pairs.set(pairKey(c.bodies[i], c.bodies[j]), ev(c.e));
  const canCollide = (a: Body, b: Body) => pairs.has(pairKey(a.id, b.id));
  const collidable = (a: Body) => [...pairs.keys()].some((k) => k.split('|').includes(a.id));
  const parent = new Map<string, string>();
  const root = (id: string): string => { const p = parent.get(id); return p && p !== id ? root(p) : id; };
  const bonds: [Body, Body][] = [];
  const locked = new Set(spec.bodies.filter((b) => b.locked || b.release).map((b) => b.id));
  // release：事件发生前停在原处（锁住、速度为 0），事件发生时按 v / vel 开始运动
  const releases = spec.bodies.filter((b) => b.release).map((b) => ({ id: b.id, when: b.release!, spec: b, done: false }));
  for (const r of releases) { const B = byId.get(r.id); if (B) { B.v = 0; B.vx = 0; B.vy = 0; } }
  // 弹簧：形变 x = 两端距离 − 原长（拉长为正）；原长默认等于初始距离
  const springs = (spec.springs ?? []).map((sp) => ({ id: sp.id, a: byId.get(sp.between[0])!, b: byId.get(sp.between[1])!, k: ev(sp.k), offsets: (sp.anchors ?? [0, 0]).map((x) => ev(x)), contact: sp.mode === 'contact', L0: NaN, L0spec: sp.L0, unlock: sp.unlock ? { body: sp.unlock.body, F: ev(sp.unlock.force) } : null }));
  const springGeometry = (sp: (typeof springs)[number]) => {
    if (!sp.a.on || !sp.b.on) throw new Error(`弹簧 ${sp.id} 两端需保持共线轨道约束；离轨后请另建场景`);
    const A = lineOf(sp.a), B = lineOf(sp.b);
    if (A.arc || B.arc || A.host || B.host) throw new Error(`弹簧 ${sp.id} 只支持共线直线运动，不支持圆弧或可动曲线`);
    const a = posOn(A, sp.a.s + sp.offsets[0]), b = posOn(B, sp.b.s + sp.offsets[1]);
    const d: V2 = [b[0] - a[0], b[1] - a[1]];
    if (Math.abs(dot(A.u, B.u)) < 1 - 1e-12 || Math.abs(d[0] * A.u[1] - d[1] * A.u[0]) > 1e-9) throw new Error(`弹簧 ${sp.id} 两端运动必须共线`);
    return { a, b, distance: dot(d, A.u), directionB: dot(A.u, B.u) };
  };
  for (const sp of springs) sp.L0 = sp.L0spec === undefined ? Math.abs(springGeometry(sp).distance) : ev(sp.L0spec);
  const springX = (sp: (typeof springs)[number]) => { const x = Math.abs(springGeometry(sp).distance) - sp.L0; return sp.contact ? Math.min(0, x) : x; };
  const springOnA = (sp: (typeof springs)[number]) => sp.k * springX(sp) * Math.sign(springGeometry(sp).distance || 1);
  const springRate = (sp: (typeof springs)[number]) => { const g = springGeometry(sp); return (sp.b.v * g.directionB - sp.a.v) * Math.sign(g.distance || 1); };
  const groupOf = (b: Body) => bodies.filter((c) => !c.landed && root(c.id) === root(b.id));

  let t = 0, evalTime = 0;
  const pendingTimes = new Set([...(opt.times ?? []), ...(spec.until?.event === 'time' ? [ev(spec.until.t)] : [])]);
  const counts: Record<string, number> = {};
  const lastImpacts = new Map<string, number>();
  let stage: Stage | null = null;
  const heat: Record<string, number> = {};
  const path: Record<string, number> = {};
  const events: EventRec[] = [];
  const stages: Stage[] = [];
  const samples: Snapshot[] = [];

  // ---------- 快照 ----------
  const worldOf = (b: Body) => {
    if (!b.on) return { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
    const S = lineOf(b), p = posOn(S, b.s), u = tanOn(S, b.s);
    // 在可动轨道上：s、v 是相对轨道的，绝对速度要加上轨道的速度
    const hv = S.host ? worldOf(byId.get(S.host)!) : { vx: 0, vy: 0 };
    return { x: p[0], y: p[1], vx: u[0] * b.v + hv.vx, vy: u[1] * b.v + hv.vy };
  };
  const freeAcc = (b: Body) => { if (b.landed) return 0; const F = extF(b), e = emAcc(b, b.x, b.y, b.vx, b.vy); let ax = G[0] + F[0] / b.m + e[0], ay = G[1] + F[1] / b.m + e[1]; for (const c of fieldList) { const dx = c.x - b.x, dy = c.y - b.y, r3 = Math.hypot(dx, dy) ** 3; ax += c.GM * dx / r3; ay += c.GM * dy / r3; } return Math.hypot(ax, ay); };
  const snap = (): Snapshot => {
    const out: Snapshot['bodies'] = {};
    for (const b of bodies) {
      if (b.dormant) continue;
      const w = worldOf(b);
      const S = b.on ? lineOf(b) : null;
      const half = b.kind === 'board' ? b.L / 2 : 0;
      const cx = S ? w.x + S.u[0] * half : w.x;
      const x = S ? w.x : w.x - half;          // x 统一指木板左端（抛体状态下记的是中心）
      const ang = S ? Math.atan2(S.u[1], S.u[0]) : 0;
      out[b.id] = { ...w, x, cx, ang, on: b.on, s: b.on ? b.s : undefined, rel: b.on && byId.has(b.on) ? b.s - byId.get(b.on)!.s : undefined,
        a: onArc(b) ? undefined : stage?.dynamic ? solveAcc(modes)?.acc.get(b.id) : stage?.acc[b.id], N: onArc(b) ? arcForce(b).N : undefined, af: b.on ? undefined : freeAcc(b), fs: wantForces ? forceList(b) : undefined };
    }
    const rt = Object.fromEntries(ropes.map((r) => [r.id, lastRopeT.get(r.id) ?? 0]));
    const sps: Snapshot['springs'] = {};
    for (const sp of springs) {
      const geometry = springGeometry(sp), extension = Math.abs(geometry.distance) - sp.L0;
      const x = sp.contact ? Math.min(0, extension) : extension;
      sps[sp.id] = { x, F: sp.k * x, Ep: 0.5 * sp.k * x * x, a: sp.a.id, b: sp.b.id, contact: sp.contact, L0: sp.L0, endpoints: [geometry.a, geometry.b] };
    }
    return { t, bodies: out, counts: { ...counts }, lost: { ...lost }, heat: { ...heat }, path: { ...path }, springs: sps, ropes: rt };
  };

  /** 这个物体此刻受的每一个力（世界坐标下的矢量）。只给画面用，不参与计算 */
  const wantForces = !!opt.sample && opt.forces !== false;
  function forceList(b: Body): ForceVec[] {
    const out: ForceVec[] = [], add = (n: string, v: V2, k = 1, by?: string) => { if (Math.hypot(v[0], v[1]) * Math.abs(k) > 1e-9) out.push({ n, x: v[0] * k, y: v[1] * k, ...(by ? { by } : {}) }); };
    try {
      if (b.landed) return out;
      if (spec.plane !== 'horizontal') add('重力', G, b.m, '地球');
      for (const f of forces) if (f.active && f.on === b.id) {
        const w = worldOf(b), at = { vars: { ...vars, ...speeds(), t: evalTime, v: Math.hypot(w.vx, w.vy), vx: w.vx, vy: w.vy } };
        if (f.F) add('外力', [evaluate(f.F[0], at), evaluate(f.F[1], at)], 1, '外界');
        if (f.along && b.on) add('外力', tanOn(lineOf(b), b.s), evaluate(f.along, at), '外界');
      }
      if (b.on && onArc(b)) {
        const S = surf.get(b.on)!, p = posOn(S, b.s), c = centerOf(S), n: V2 = [(c[0] - p[0]) / S.R, (c[1] - p[1]) / S.R], A = arcForce(b), N = S.side === 'outside' ? -A.N : A.N;
        add(S.tether === 'rope' ? '绳的拉力' : S.tether === 'rod' ? '杆的弹力' : S.side === 'tube' ? '管壁弹力' : '支持力', n, N, S.host ?? b.on);
      } else if (b.on) {
        const S = lineOf(b), r = solveAcc(modes);
        if (spec.plane !== 'horizontal') add('支持力', S.n, normalOf(b), S.host ?? b.on);
        if (r?.fixed?.has(b.id)) add('固定装置约束力', r.fixed.get(b.id)!, 1, '固定装置');
        const m = modes.find((q) => q.b.id === b.id), f = m ? (m.kind === 'stick' ? r?.fStick.get(b.id) : r?.fr.get(b.id)) ?? 0 : 0;
        if (m && m.kind !== 'none') add(m.kind === 'stick' ? '静摩擦力' : '滑动摩擦力', S.u, f, S.host ?? b.on);
        for (const c of bodies) if (c.on === b.id && !c.landed) {
          const Sc = lineOf(c), mc = modes.find((q) => q.b.id === c.id), fc = mc ? (mc.kind === 'stick' ? r?.fStick.get(c.id) : r?.fr.get(c.id)) ?? 0 : 0;
          if (spec.plane !== 'horizontal') add(`${c.id} 的压力`, Sc.n, -normalOf(c), c.id);
          if (mc && mc.kind !== 'none') add(mc.kind === 'stick' ? '静摩擦力' : '滑动摩擦力', Sc.u, -fc, c.id);
        }
      }
      if (coupled && b.on) {
        const r = solveAcc(modes);
        // 圆弧切向摩擦也必须出现；宿主承受所有固定轨道的接触反作用。
        if (onArc(b)) { const m = modes.find((m) => m.b === b); if (m) add('摩擦力', tanOn(lineOf(b), b.s), r?.fStick.get(b.id) ?? r?.fr.get(b.id) ?? 0, lineOf(b).host ?? b.on); }
        for (const c of bodies) if (c.on && lineOf(c).host === b.id && !byId.has(c.on)) {
          const S = lineOf(c), p = posOn(S, c.s), cc = centerOf(S);
          const n: V2 = S.arc ? [(cc[0] - p[0]) / S.R, (cc[1] - p[1]) / S.R] : S.n;
          const sign = S.arc && S.side === 'outside' ? -1 : 1;
          add(`${c.id} 的压力`, n, -sign * (r?.normal?.get(c.id) ?? 0), c.id);
          add(`${c.id} 的摩擦反作用`, tanOn(S, c.s), -(r?.fStick.get(c.id) ?? r?.fr.get(c.id) ?? 0), c.id);
        }
      }
      for (const sp of springs) {
        if (sp.a !== b && sp.b !== b) continue;
        if (sp.a.landed || sp.b.landed) continue;
        const F = springOnA(sp); if (!sp.a.on || !sp.b.on) continue;
        add('弹力', lineOf(b).u, sp.a === b ? F : -F * springGeometry(sp).directionB, sp.id);
      }
      for (const r of ropes) {
        if (r.a !== b && r.b !== b) continue;
        const T = lastRopeT.get(r.id) ?? 0, me = worldOf(b), other = r.a === b ? r.via[0] ?? [worldOf(r.b).x, worldOf(r.b).y] : r.via.at(-1) ?? [worldOf(r.a).x, worldOf(r.a).y], d = Math.hypot(other[0] - me.x, other[1] - me.y) || 1;
        add('绳的拉力', [(other[0] - me.x) / d, (other[1] - me.y) / d], T, r.id);
      }
      if (b.q) {
        const w = worldOf(b), at = { vars: { ...vars, t: evalTime } };
        for (const f of emList) {
          if (f.area && insideOf(f.area, w.x, w.y) < 0) continue;
          if (f.kind === 'E') add('电场力', [evaluate(f.E![0], at), evaluate(f.E![1], at)], b.q, f.id);
          else if (f.kind === 'B') { const B = evaluate(f.B!, at); add('洛伦兹力', [w.vy * B, -w.vx * B], b.q, f.id); }
          else { const dx = w.x - ev(f.at![0]), dy = w.y - ev(f.at![1]), r3 = Math.hypot(dx, dy) ** 3 || 1e-12; add('库仑力', [kq * evaluate(f.Q!, at) * dx / r3, kq * evaluate(f.Q!, at) * dy / r3], b.q, f.id); }
        }
      }
      for (const c of fieldList) { const w = worldOf(b), dx = c.x - w.x, dy = c.y - w.y, r = Math.hypot(dx, dy) || 1; add('万有引力', [dx / r, dy / r], c.GM * b.m / (r * r), '引力中心'); }
    } catch { /* 受力只用来显示，算不出就不画 */ }
    return out;
  }

  // ---------- 绳、引力场、瞬时变速 ----------
  let lastRopeT = new Map<string, number>(), lastKick = -1;
  const ropes = (spec.ropes ?? []).map((r, i) => {
    const a = byId.get(r.between[0]), b = byId.get(r.between[1]);
    if (!a || !b) throw new Error(`ropes：没有物体 ${r.between.join('、')}`);
    return { id: r.id ?? (i ? `绳${i + 1}` : '绳'), a, b, via: (r.via ?? []).map((p) => [ev(p[0]), ev(p[1])] as V2) };
  });
  const regionOf = (r?: Region) => r === undefined ? null : 'center' in r ? { cx: ev(r.center[0]), cy: ev(r.center[1]), R: ev(r.radius) } : { x0: Math.min(ev(r.x[0]), ev(r.x[1])), x1: Math.max(ev(r.x[0]), ev(r.x[1])), y0: Math.min(ev(r.y[0]), ev(r.y[1])), y1: Math.max(ev(r.y[0]), ev(r.y[1])) };
  const emList = (spec.em ?? []).map((f, i) => ({ ...f, id: f.id ?? `${f.kind === 'B' ? '磁场' : f.kind === 'E' ? '电场' : '点电荷'}${i + 1}`, area: regionOf(f.region) }));
  /** 区域内为正，边界为 0，区域外为负 */
  // 最窄场区的尺寸：带电体一步走的距离不能超过它的四分之一，否则可能整步跨过一个薄场区，既没有事件也没有受力
  const areaMin = Math.min(...emList.map((f) => f.area ? ('R' in f.area ? 2 * f.area.R : Math.min(f.area.x1 - f.area.x0, f.area.y1 - f.area.y0)) : Infinity).filter((d) => d > 0));
  const insideOf = (a: NonNullable<(typeof emList)[number]['area']>, x: number, y: number) => 'R' in a ? a.R - Math.hypot(x - a.cx, y - a.cy) : Math.min(x - a.x0, a.x1 - x, y - a.y0, a.y1 - y);
  const kq = vars.k ?? 9e9;
  /** 带电物体受的电磁加速度 */
  const emAcc = (b: Body, x: number, y: number, vx: number, vy: number): V2 => {
    if (!b.q) return [0, 0];
    let ax = 0, ay = 0; const at = { vars: { ...vars, t: evalTime } }, s = b.q / b.m;
    for (const f of emList) {
      if (f.area && insideOf(f.area, x, y) < 0) continue;
      if (f.kind === 'E') { ax += s * evaluate(f.E![0], at); ay += s * evaluate(f.E![1], at); }
      else if (f.kind === 'B') { const B = evaluate(f.B!, at); ax += s * vy * B; ay -= s * vx * B; }
      else { const dx = x - ev(f.at![0]), dy = y - ev(f.at![1]), r3 = Math.hypot(dx, dy) ** 3 || 1e-12, Q = evaluate(f.Q!, at); ax += s * kq * Q * dx / r3; ay += s * kq * Q * dy / r3; }
    }
    return [ax, ay];
  };
  const fieldList = (spec.fields ?? []).map((f) => ({ x: ev(f.center[0]), y: ev(f.center[1]), GM: ev(f.GM) }));
  const kicks = (spec.kicks ?? []).map((k) => ({ ...k, done: false }));
  const splits = (spec.splits ?? []).map((k) => ({ ...k, done: false }));
  // “某量到达某值时”撤力、施力、点火、停止：expr 穿过 0 的第 n 次触发，和读数用的 when 事件同一种语义
  const whenTriggers: { expr: string; dir?: number; n: number; count: number; done: boolean; act: () => void }[] = [];
  let stopNow = false;
  const addWhen = (sp: EventSpec | undefined, act: () => void) => {
    if (sp?.event !== 'when') return;
    if (!sp.expr) throw new Error('when 事件需要写 expr');
    if (!opt.whenValue) throw new Error('这里不能用 when 事件控制过程');
    whenTriggers.push({ expr: sp.expr, dir: sp.dir, n: sp.n ?? 1, count: 0, done: false, act });
  };

  // ---------- 直线上的接触与受力 ----------
  const coupled = spec.surfaces.some((s) => !!s.on);
  let legacySolve = false;
  const supported = () => bodies.filter((b) => b.on && !b.landed);
  const contacts = () => coupled ? supported() : onLine();
  const onLine = () => bodies.filter((b) => b.on && !b.landed && !onArc(b));
  const above = (b: Body): Body[] => bodies.filter((c) => c.on === b.id && !c.landed).flatMap((c) => [c, ...above(c)]);
  /** 动摩擦因数；dir 是物体相对支撑面的运动方向（或将要运动的方向） */
  const muOf = (b: Body, dir: number) => {
    const p = muPair.get(`${b.id}|${b.on}`);
    if (p !== undefined) return p;
    const S = surf.get(b.on!);
    return S ? (dir < 0 ? S.muB : S.muF) : 0;
  };
  /** 力的表达式可以用别的物体的速度：v_棒1（导体棒相互影响时要用） */
  const speeds = () => { const o: Record<string, number> = {}; for (const c of bodies) { const w = worldOf(c); o[`v_${c.id}`] = c.on ? c.v : Math.hypot(w.vx, w.vy); } return o; };
  const extF = (b: Body): V2 => {
    if (!forces.some((f) => f.active && f.on === b.id)) return [0, 0];   // 没有外力时无需构造全体速度表达式环境
    let F: V2 = [0, 0];
    const w = worldOf(b), at = { vars: { ...vars, ...speeds(), t: evalTime, v: Math.hypot(w.vx, w.vy), vx: w.vx, vy: w.vy } };   // 力可含时间 t、速率 v 和速度分量（恒定功率、空气阻力）
    for (const f of forces) if (f.active && f.on === b.id) {
      if (f.F) F = [F[0] + evaluate(f.F[0], at), F[1] + evaluate(f.F[1], at)];
      if (f.along && b.on) { const u = tanOn(lineOf(b), b.s), A = evaluate(f.along, at); F = [F[0] + A * u[0], F[1] + A * u[1]]; }
    }
    return F;
  };
  const carried = (b: Body): Body[] => bodies.filter((c) => !c.landed && (c.on === b.id || (c.on && surf.get(c.on)?.host === b.id))).flatMap((c) => [c, ...carried(c)]);
  const baseNormal = (b: Body) => {
    if (spec.plane === 'horizontal') return [b, ...carried(b)].reduce((s, c) => s + c.m * g, 0);
    const S = lineOf(b);
    return [b, ...above(b)].reduce((N, c) => N + c.m * -(spec.plane === 'horizontal' ? -g : dot(G, S.n)) - (spec.plane === 'horizontal' ? 0 : dot(extF(c), S.n)), 0);
  };
  const normalOf = (b: Body) => { const N = coupled && !legacySolve && spec.plane !== 'horizontal' ? solveAcc(modes)?.normal?.get(b.id) ?? baseNormal(b) : baseNormal(b); return locked.has(b.id) ? Math.max(0, N) : N; };
  const lowerVel = (b: Body) => (byId.has(b.on!) ? byId.get(b.on!)!.v : surf.get(b.on!)!.belt);

  // 一个接触单元：粘在一起、压在同一支撑上的一组物体算一个接触，最大摩擦力是各自 μN 之和
  type Mode = { b: Body; kind: 'slip' | 'stick' | 'none'; sign: number; members?: Body[] };
  let modes: Mode[] = [];
  const startingSlip = new Map<string, number>();
  const arcSigns = new Map<string, number>();
  const resistanceOf = (b: Body) => {
    let value = 0;
    for (const r of spec.resistance ?? []) if (r.on === b.id) {
      if (r.relativeTo && r.relativeTo !== b.on) throw new Error(`阻力 ${b.id} 的 relativeTo 必须是当前支撑物；不支持任意方向的干摩擦约束`);
      value += ev(r.magnitude);
    }
    const S = spec.surfaces.find((s) => s.id === b.on);
    if (S?.resistance !== undefined) value += evaluate(S.resistance, { vars: { ...vars, s: b.s + (S.kind === 'ground' ? GROUND_X : 0), v: Math.abs(b.v - (surf.get(b.on!)?.belt ?? 0)), t: evalTime } });
    if (!Number.isFinite(value) || value < 0) throw new Error('阻力大小必须是非负有限数值');
    return value;
  };
  const limitOf = (m: Mode, dir: number, r?: AccResult | null) => (m.members ?? [m.b]).reduce((s, c) => s + muOf(c, dir) * (spec.plane === 'horizontal' ? baseNormal(c) : r?.normal?.get(c.id) ?? normalOf(c)) + resistanceOf(c), 0);

  type Rope = { id: string; a: Body; b: Body; via: V2[] };
  /** 绳在两端的方向与轨道切线的点积。绳必须沿轨道，否则绳长约束不是常系数 */
  function ropeGeometry(r: Rope): [number, number] {
    for (const b of [r.a, r.b]) if (!b.on || onArc(b) || byId.has(b.on) || lineOf(b).host) throw new Error(`绳 ${r.id} 的端点 ${b.id} 已不在固定直线上；不支持离轨/可动支撑绳约束，请用 ode 或 script`);
    const pa = worldOf(r.a), pb = worldOf(r.b), first: V2 = r.via[0] ?? [pb.x, pb.y], last: V2 = r.via.at(-1) ?? [pa.x, pa.y];
    const unit = (p: { x: number; y: number }, q: V2): V2 => { const d = Math.hypot(q[0] - p.x, q[1] - p.y) || 1; return [(q[0] - p.x) / d, (q[1] - p.y) / d]; };
    const ka = dot(unit(pa, first), lineOf(r.a).u), kb = dot(unit(pb, last), lineOf(r.b).u);
    for (const [k, b] of [[ka, r.a], [kb, r.b]] as const) if (Math.abs(Math.abs(k) - 1) > 1e-10) throw new Error(`绳 ${r.id} 在物体 ${b.id} 处没有沿轨道方向，请调整滑轮位置，或改用解析演示 script`);
    if (Math.abs(ka * r.a.v + kb * r.b.v) > 1e-9) throw new Error(`绳 ${r.id} 的速度约束已失效；不支持冲量后松弛/重新绷紧，请用 ode 或 script`);
    return [Math.sign(ka), Math.sign(kb)];
  }
  type AccResult = { acc: Map<string, number>; fStick: Map<string, number>; fr: Map<string, number>; ropeT: Map<string, number>; normal?: Map<string, number>; fixed?: Map<string, V2> };
  let lastCoupledKey = '', lastCoupledModes: Mode[] | null = null, lastCoupledResult: AccResult | null = null;
  // 无弹簧、外力、变阻力及绳几何时，直线接触方程只由接触拓扑和摩擦模式决定。
  // 其它直线场景只复用完全相同的瞬时状态。保存原始量逐项比较，不构造 JSON key。
  const constantLegacy = !coupled && !springs.length && !forces.length && !ropes.length && !spec.surfaces.some((s) => s.resistance !== undefined);
  // bonds 只追加、locked 只删除；长度/大小与 on、landed、模式引用共同判定拓扑失效。
  let legacyModes: Mode[] | undefined, legacyResult: AccResult | null = null;
  let legacyTime = NaN, legacyBonds = -1, legacyLocked = -1;
  const legacyOn: (string | null)[] = [], legacyLanded: boolean[] = [], legacyState: number[] = [];
  function solveLegacy(ms: Mode[]): AccResult | null {
    let hit = legacyModes === ms && legacyBonds === bonds.length && legacyLocked === locked.size && (constantLegacy || legacyTime === evalTime);
    for (let i = 0; hit && i < bodies.length; i++) {
      const b = bodies[i], j = i * 6;
      hit = legacyOn[i] === b.on && legacyLanded[i] === b.landed && (constantLegacy ||
        (legacyState[j] === b.s && legacyState[j + 1] === b.v && legacyState[j + 2] === b.x && legacyState[j + 3] === b.y && legacyState[j + 4] === b.vx && legacyState[j + 5] === b.vy));
    }
    // 有外力的场景还会在同一时刻开关力；不跨调用缓存，保留原有求值及错误行为。
    if (hit && !forces.length) return legacyResult;
    const r = solveAccImpl(ms);
    legacyModes = ms; legacyResult = r; legacyTime = evalTime; legacyBonds = bonds.length; legacyLocked = locked.size;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], j = i * 6;
      legacyOn[i] = b.on; legacyLanded[i] = b.landed;
      if (!constantLegacy) { legacyState[j] = b.s; legacyState[j + 1] = b.v; legacyState[j + 2] = b.x; legacyState[j + 3] = b.y; legacyState[j + 4] = b.vx; legacyState[j + 5] = b.vy; }
    }
    return r;
  }
  function solveAcc(ms: Mode[]): AccResult | null {
    if (!coupled) return solveLegacy(ms);
    // 声明了可动轨道但暂时无人载入：直线板块仍走原来的小矩阵。
    if (!bodies.some((b) => onArc(b) || b.on && lineOf(b).host) && !locked.size) {
      legacySolve = true;
      try { const r = solveAccImpl(ms); return r ? { ...r, normal: new Map(onLine().map((b) => [b.id, baseNormal(b)])) } : null; }
      finally { legacySolve = false; }
    }
    // 只复用完全相同的瞬时状态；RK 子步、事件、锁定和摩擦状态变化都会失效。
    const key = JSON.stringify([evalTime, bodies.map((b) => [b.on, b.s, b.v, b.x, b.y, b.vx, b.vy, b.landed]), forces.map((f) => f.active), [...locked], bonds.length]);
    if (lastCoupledModes === ms && lastCoupledKey === key) return lastCoupledResult;
    const r = solveCoupled(ms); lastCoupledKey = key; lastCoupledModes = ms; lastCoupledResult = r; return r;
  }
  // 可动支撑：每个物体的二维牛顿方程 + 每个接触的摩擦/共速约束一起求解。
  // s 是移动轨道内的相对坐标，普通板块仍沿用绝对坐标；接触力逐层等大反向传给下层。
  function solveCoupled(ms: Mode[]): AccResult | null {
    for (const S of surf.values()) if (S.host) { const H = byId.get(S.host)!; if (!H.on || H.landed || onArc(H) || lineOf(H).host) throw new Error(`可动轨道 ${S.id} 的宿主已脱离固定直线支撑；后续自由/转动运动尚不支持，请用 ode 或 script`); }
    const D = supported(), idx = new Map(D.map((b, i) => [b.id, i])), n = D.length;
    // 初始快照尚未 resolve：只用于读数，先求出合法的接触状态。
    if (D.some((b) => !ms.some((m) => (m.members ?? [m.b]).includes(b)))) return resolve();
    const bs = bonds.filter(([a, b]) => idx.has(a.id) && idx.has(b.id)), lk = D.filter((b) => locked.has(b.id));
    const rp = ropes.filter((r) => idx.has(r.a.id) && idx.has(r.b.id));
    const size = 2 * n + ms.length + bs.length + lk.length + rp.length;
    const A = Array.from({ length: size }, () => new Array(size + 1).fill(0));
    const tangent = D.map((b) => tanOn(lineOf(b), b.s));
    const normal = D.map((b): V2 => {
      const S = lineOf(b); if (!S.arc) return S.n;
      const p = posOn(S, b.s), c = centerOf(S), sign = S.side === 'outside' ? -1 : 1;
      return [sign * (c[0] - p[0]) / S.R, sign * (c[1] - p[1]) / S.R];
    });
    const support = (b: Body) => byId.get(b.on!) ?? byId.get(lineOf(b).host!);
    const force = (b: Body, col: number, v: V2, factor = 1) => { const i = idx.get(b.id); if (i !== undefined) for (let k = 0; k < 2; k++) A[2 * i + k][col] -= factor * v[k]; };
    const accel = (b: Body, row: number, k: number, factor: number) => {
      const i = idx.get(b.id)!; A[row][i] += factor * tangent[i][k];
      const S = lineOf(b); if (S.host) accel(byId.get(S.host)!, row, k, factor);
    };
    D.forEach((b, i) => {
      const S = lineOf(b), F = extF(b);
      for (const sp of springs) { const f = sp.a === b ? springOnA(sp) : sp.b === b ? -springOnA(sp) * springGeometry(sp).directionB : 0; F[0] += f * tangent[i][0]; F[1] += f * tangent[i][1]; }
      const centripetal = S.arc ? (S.side === 'outside' ? -1 : 1) * b.v ** 2 / S.R : 0;
      for (let k = 0; k < 2; k++) { accel(b, 2 * i + k, k, b.m); A[2 * i + k][size] = b.m * (G[k] - normal[i][k] * centripetal) + F[k]; }
      force(b, n + i, normal[i]); const H = support(b); if (H) force(H, n + i, normal[i], -1);
    });
    ms.forEach((m, j) => {
      const col = 2 * n + j, row = 2 * n + j, members = m.members ?? [m.b], mass = members.reduce((a, b) => a + b.m, 0);
      for (const b of members) { const i = idx.get(b.id)!; force(b, col, tangent[i], b.m / mass); const H = support(b); if (H) force(H, col, tangent[i], -b.m / mass); }
      if (m.kind === 'stick') { A[row][idx.get(m.b.id)!] = 1; if (byId.has(m.b.on!)) A[row][idx.get(m.b.on!)!] = -1; }
      else { A[row][col] = 1; if (m.kind === 'slip') for (const b of members) {
        const i = idx.get(b.id)!, mu = muOf(b, m.sign);
        // 水平俯视时摩擦的法向是纸面外的重量；管道负 N 的粗糙接触由校验器拒绝。
        if (spec.plane === 'horizontal') A[row][size] -= m.sign * mu * baseNormal(b);
        else A[row][n + i] += m.sign * mu;
        A[row][size] -= m.sign * resistanceOf(b);
      } }
    });
    bs.forEach(([a, b], j) => { const col = 2 * n + ms.length + j, ia = idx.get(a.id)!, ib = idx.get(b.id)!, sign = dot(tangent[ia], tangent[ib]); force(a, col, tangent[ia]); force(b, col, tangent[ib], -sign); A[col][ia] = 1; A[col][ib] = -sign; });
    lk.forEach((b, j) => { const col = 2 * n + ms.length + bs.length + j; force(b, col, tangent[idx.get(b.id)!]); A[col][idx.get(b.id)!] = 1; });
    rp.forEach((r, j) => { const col = size - rp.length + j, [ka, kb] = ropeGeometry(r); force(r.a, col, tangent[idx.get(r.a.id)!], ka); force(r.b, col, tangent[idx.get(r.b.id)!], kb); A[col][idx.get(r.a.id)!] = ka; A[col][idx.get(r.b.id)!] = kb; });
    const x = gauss(A); if (!x) return null;
    const slack = rp.filter((r, j) => x[size - rp.length + j] < -1e-9);
    if (slack.length) return null;   // 不把松绳后下一步又强行绷紧当成正确的运动
    const fr = new Map<string, number>(), fStick = new Map<string, number>();
    ms.forEach((m, j) => { if (m.kind === 'stick') fStick.set(m.b.id, x[2 * n + j]); else fr.set(m.b.id, x[2 * n + j]); });
    const ropeT = new Map(ropes.map((r) => [r.id, 0])); rp.forEach((r, j) => ropeT.set(r.id, x[size - rp.length + j]));
    const fixed = new Map(lk.map((b, j) => { const i = idx.get(b.id)!, f = x[2 * n + ms.length + bs.length + j]; return [b.id, [normal[i][0] * x[n + i] + tangent[i][0] * f, normal[i][1] * x[n + i] + tangent[i][1] * f] as V2] as const; }));
    // locked 是外界装置完全固定：法向合力由装置承担，普通接触 N 取 0。
    return { acc: new Map(D.map((b, i) => [b.id, x[i]])), normal: new Map(D.map((b, i) => [b.id, locked.has(b.id) ? 0 : x[n + i]])), fixed, fr, fStick, ropeT };
  }
  // 直线接触的系数矩阵在拓扑和模式不变时是常量；只更新右端项。
  // 记录原 Gauss-Jordan 的换行、消元系数及运算顺序，避免 LU/求逆改变舍入结果。
  function makeLegacyLayout(ms: Mode[]) {
    const D = onLine(), idx = new Map(D.map((b, i) => [b.id, i]));
    const sticks = ms.filter((m) => m.kind === 'stick');
    const bs = bonds.filter(([a, b]) => idx.has(a.id) && idx.has(b.id));
    const lk = D.filter((b) => locked.has(b.id));
    const n = D.length + sticks.length + bs.length + lk.length;
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    D.forEach((b, i) => { A[i][i] = b.m; });
    sticks.forEach((m, k) => {
      const col = D.length + k, i = idx.get(m.b.id)!;
      A[i][col] -= 1;
      if (idx.has(m.b.on!)) A[idx.get(m.b.on!)!][col] += 1;
      A[col][i] = 1;
      if (idx.has(m.b.on!)) A[col][idx.get(m.b.on!)!] = -1;
    });
    bs.forEach(([a, b], k) => {
      const col = D.length + sticks.length + k, ia = idx.get(a.id)!, ib = idx.get(b.id)!;
      const sign = dot(lineOf(a).u, lineOf(b).u);
      A[ia][col] += 1; A[ib][col] -= sign;
      A[col][ia] = 1; A[col][ib] = -sign;
    });
    lk.forEach((b, k) => { const col = D.length + sticks.length + bs.length + k, i = idx.get(b.id)!; A[i][col] += 1; A[col][i] = 1; });
    return { ms, D, sticks, bs, lk, n, solve: gaussRhs(A),
      on: bodies.map(b => b.on), landed: bodies.map(b => b.landed), bonds: bonds.length, locked: locked.size,
      rhs: new Array<number>(n).fill(0), springForces: [] as number[], springDirections: [] as number[],
      result: { acc: new Map<string, number>(), fStick: new Map<string, number>(), fr: new Map<string, number>(), ropeT: new Map<string, number>(), fixed: new Map<string, V2>() },
      lines: D.map(lineOf), children: D.map(b => bodies.filter(c => c.on === b.id && !c.landed)) };
  }
  let legacyLayout: ReturnType<typeof makeLegacyLayout> | undefined;
  function solveAccImpl(ms: Mode[]): AccResult | null {
    if (ropes.length) return solveAccWithRopes(ms);
    let layout = legacyLayout;
    if (!layout || layout.ms !== ms || layout.bonds !== bonds.length || layout.locked !== locked.size ||
        bodies.some((b, i) => b.on !== layout!.on[i] || b.landed !== layout!.landed[i])) legacyLayout = layout = makeLegacyLayout(ms);
    const { D, sticks, bs, lk, n } = layout;
    // 每个 layout 私有工作区；求解期间无递归，输出只在本阶段内部读取。
    const result = layout.result, fr = result.fr;
    fr.clear();
    for (const m of ms) if (m.kind === 'slip') fr.set(m.b.id, -m.sign * limitOf(m, m.sign));
    const { rhs, springForces, springDirections } = layout;
    rhs.fill(0); springForces.length = 0; springDirections.length = 0;
    D.forEach((b, i) => {
      const S = layout.lines[i];
      let value = b.m * dot(G, S.u) + dot(extF(b), S.u);
      value += fr.get(b.id) ?? 0;
      for (const c of layout.children[i]) value -= fr.get(c.id) ?? 0;
      for (let j = 0; j < springs.length; j++) {
        const sp = springs[j];
        if ((sp.a === b && !sp.b.landed) || (sp.b === b && !sp.a.landed)) {
          if (springForces[j] === undefined) {
            const geometry = springGeometry(sp), x = Math.abs(geometry.distance) - sp.L0;
            springForces[j] = sp.k * (sp.contact ? Math.min(0, x) : x) * Math.sign(geometry.distance || 1);
            springDirections[j] = geometry.directionB;
          }
          if (sp.a === b) value += springForces[j];
          if (sp.b === b) value -= springForces[j] * springDirections[j];
        }
      }
      rhs[i] = value;
    });
    const x = layout.solve?.(rhs); if (!x) return null;
    D.forEach((b, i) => result.acc.set(b.id, x[i]));
    sticks.forEach((m, k) => result.fStick.set(m.b.id, x[D.length + k]));
    for (let k = 0; k < lk.length; k++) {
      const b = lk[k], S = lineOf(b), f = -x[D.length + sticks.length + bs.length + k], N = Math.min(0, baseNormal(b));
      result.fixed.set(b.id, [S.u[0] * f + S.n[0] * N, S.u[1] * f + S.n[1] * N]);
    }
    return result;
  }

  function solveAccWithRopes(ms: Mode[]) {
    const D = onLine();
    const idx = new Map(D.map((b, i) => [b.id, i]));
    const sticks = ms.filter((m) => m.kind === 'stick');
    const bs = bonds.filter(([a, b]) => idx.has(a.id) && idx.has(b.id));
    const lk = D.filter((b) => locked.has(b.id));
    const rp = ropes.filter((r) => idx.has(r.a.id) && idx.has(r.b.id));
    const n = D.length + sticks.length + bs.length + lk.length + rp.length;
    const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
    const fr = new Map<string, number>();     // 滑动摩擦力（作用在上面的物体上）
    for (const m of ms) if (m.kind === 'slip') fr.set(m.b.id, -m.sign * limitOf(m, m.sign));
    D.forEach((b, i) => {
      const S = lineOf(b);
      A[i][i] = b.m;
      let rhs = b.m * dot(G, S.u) + dot(extF(b), S.u);
      rhs += fr.get(b.id) ?? 0;
      for (const c of bodies) if (c.on === b.id && !c.landed) rhs -= fr.get(c.id) ?? 0;
      for (const sp of springs) {                // 弹簧拉力
        if (sp.a === b && !sp.b.landed) rhs += springOnA(sp);
        if (sp.b === b && !sp.a.landed) rhs -= springOnA(sp) * springGeometry(sp).directionB;
      }
      A[i][n] = rhs;
    });
    sticks.forEach((m, k) => {
      const col = D.length + k, i = idx.get(m.b.id)!;
      A[i][col] -= 1;
      if (idx.has(m.b.on!)) A[idx.get(m.b.on!)!][col] += 1;
      A[col][i] = 1;                           // 约束：a_上 − a_下 = 0
      if (idx.has(m.b.on!)) A[col][idx.get(m.b.on!)!] = -1;
    });
    bs.forEach(([a, b], k) => {                // 粘在一起：a_a = a_b，内力不限
      const col = D.length + sticks.length + k, ia = idx.get(a.id)!, ib = idx.get(b.id)!;
      const sign = dot(lineOf(a).u, lineOf(b).u);
      A[ia][col] += 1; A[ib][col] -= sign;
      A[col][ia] = 1; A[col][ib] = -sign;
    });
    lk.forEach((b, k) => {                     // 锁定：a = 0，约束力不限
      const col = D.length + sticks.length + bs.length + k, i = idx.get(b.id)!;
      A[i][col] += 1; A[col][i] = 1;
    });
    const ropeDir = rp.map((r, k) => {         // 绳拉力 T 对两端的作用：沿绳指向滑轮；绳长不变给出 ka·a_a + kb·a_b = 0
      const col = D.length + sticks.length + bs.length + lk.length + k, ia = idx.get(r.a.id)!, ib = idx.get(r.b.id)!;
      const [ka, kb] = ropeGeometry(r);
      A[ia][col] -= ka; A[ib][col] -= kb; A[col][ia] = ka; A[col][ib] = kb;
      return col;
    });
    const x = gauss(A);
    if (!x) return null;
    const slack = rp.filter((r, k) => x[ropeDir[k]] < -1e-9);
    if (slack.length) return null;   // 松弛/重新绷紧的冲量尚不支持，不能悄悄删掉约束再恢复
    const ropeT = new Map<string, number>(ropes.map((r) => [r.id, 0]));
    rp.forEach((r, k) => ropeT.set(r.id, x[ropeDir[k]]));
    const acc = new Map(D.map((b, i) => [b.id, x[i]]));
    const fStick = new Map(sticks.map((m, k) => [m.b.id, x[D.length + k]]));
    const fixed = new Map(lk.map((b, k) => { const S = lineOf(b), f = -x[D.length + sticks.length + bs.length + k], N = Math.min(0, baseNormal(b)); return [b.id, [S.u[0] * f + S.n[0] * N, S.u[1] * f + S.n[1] * N] as V2] as const; }));
    return { acc, fStick, fr, ropeT, fixed };
  }

  function resolve() {
    const D = contacts();
    const fixed: Mode[] = [], open: Body[] = [];
    const units = new Map<string, Body[]>();
    for (const b of D) { const k = `${root(b.id)}|${b.on}`; (units.get(k) ?? units.set(k, []).get(k)!).push(b); }
    const openM = new Map<Body, Body[]>();
    for (const members of units.values()) {
      const b = members[0], vr = b.v - lowerVel(b);
      const lim = members.reduce((s, c) => s + muOf(c, 1) + muOf(c, -1) + resistanceOf(c), 0);
      const variableResistance = spec.surfaces.some((s) => s.id === b.on && s.resistance !== undefined);
      if (locked.has(b.id)) fixed.push({ b, kind: 'none', sign: 0, members });
      else if (startingSlip.has(b.id)) fixed.push({ b, kind: 'slip', sign: startingSlip.get(b.id)!, members });
      else if (lim === 0 && !variableResistance) fixed.push({ b, kind: 'none', sign: 0, members });
      else if (Math.abs(vr) > 1e-9) fixed.push({ b, kind: 'slip', sign: Math.sign(vr), members });
      else { open.push(b); openM.set(b, members); }
    }
    const opts: Mode['kind'][] = ['stick', 'slip', 'slip'];
    const sticksIn = (code: number) => { let k = 0; for (let i = 0; i < open.length; i++) { if (code % 3 === 0) k++; code = Math.floor(code / 3); } return k; };
    const order = [...Array(3 ** open.length).keys()].sort((p, q) => sticksIn(q) - sticksIn(p));
    let badSupport: { b: Body; N: number } | undefined;
    for (const code of order) {
      let c = code;
      const trial: Mode[] = [...fixed];
      for (const b of open) { const o = c % 3; c = Math.floor(c / 3); trial.push({ b, kind: opts[o], sign: o === 1 ? 1 : o === 2 ? -1 : 0, members: openM.get(b) }); }
      const r = solveAcc(trial);
      if (!r) continue;
      if (spec.plane !== 'horizontal' && !r.normal) { const b = D.find((b) => !locked.has(b.id) && baseNormal(b) < -1e-8); if (b) { badSupport = { b, N: baseNormal(b) }; continue; } }
      if (spec.plane !== 'horizontal' && r.normal) { const b = D.find((b) => !onArc(b) && r.normal!.get(b.id)! < -1e-8); if (b) { badSupport = { b, N: r.normal.get(b.id)! }; continue; } if (D.some((b) => onArc(b) && lineOf(b).side !== 'tube' && r.normal!.get(b.id)! < -1e-8)) continue; }
      const ok = trial.every((m) => {
        // 静摩擦：要的摩擦力不超过最大静摩擦（按将要滑动的方向取 μ）
        if (m.kind === 'stick') { const f = r.fStick.get(m.b.id)!; return Math.abs(f) <= limitOf(m, -Math.sign(f), r) * (1 + 1e-9) + 1e-12; }
        if (m.kind === 'slip' && open.includes(m.b)) { const ar = r.acc.get(m.b.id)! - (byId.has(m.b.on!) ? r.acc.get(m.b.on!)! : 0); return m.sign * ar > 1e-12; }
        return true;
      });
      if (ok) { modes = trial; return r; }
    }
    if (badSupport) throw supportFailure(badSupport.b, badSupport.N);
    throw new Error('接触状态无解：可能发生支撑脱离或绳松弛（暂不支持重新绷紧），也可能约束自相矛盾；请用 ode 自写方程或 script 演示');
  }

  // ---------- 圆弧上的物体 ----------
  /** 支持力（带符号：管道里负值表示外壁压它）和切向加速度 */
  // 可动轨道：轨道（木板）加速度 aH 沿 uH 方向；物块相对轨道沿切线运动。
  // 物块：m(aH uH + T s̈ + n v²/R) = m g + N n + F；切向给出 s̈，法向给出 N（n 指向圆心）
  const arcForce = (b: Body, accMap?: Map<string, number>) => {
    const S = surf.get(b.on!)!, p = posOn(S, b.s), T = tanOn(S, b.s), c = centerOf(S);
    const n: V2 = [(c[0] - p[0]) / S.R, (c[1] - p[1]) / S.R];
    const F = extF(b);
    let aH = 0, uH: V2 = [1, 0];
    if (S.host) {
      const H = byId.get(S.host)!;
      uH = lineOf(H).u;
      aH = (accMap ?? solveAcc(modes)?.acc)?.get(H.id) ?? 0;
    }
    if (coupled) {
      const r = solveAcc(modes); if (!r) throw new Error('可动支撑接触方程无解，请改用 ode 或 script');
      const N = r.normal!.get(b.id)!, at = r.acc.get(b.id)!, drive = dot(G, T) + dot(F, T) / b.m - aH * dot(uH, T);
      return { N, at, drive, cap: (muOf(b, Math.sign(b.v) || Math.sign(drive)) * (spec.plane === 'horizontal' ? b.m * g : Math.abs(N)) + resistanceOf(b)) / b.m };
    }
    const inward = b.m * (b.v * b.v / S.R + aH * dot(uH, n)) - b.m * dot(G, n) - dot(F, n); // 轨道需要指向圆心方向给的力
    const N = S.side === 'outside' ? -inward : inward;
    const drive = dot(G, T) + dot(F, T) / b.m - aH * dot(uH, T);
    const sign = arcSigns.get(b.id) ?? Math.sign(b.v);
    const mu = muOf(b, sign || Math.sign(drive));
    const cap = (mu * (spec.plane === 'horizontal' ? b.m * g : Math.abs(N)) + resistanceOf(b)) / b.m;
    const at = sign ? drive - sign * cap : Math.abs(drive) <= cap ? 0 : drive - Math.sign(drive) * cap;
    return { N, at, drive, cap };
  };

  // ---------- 状态向量与积分 ----------
  type St = number[];
  const pack = (): St => {
    const st = new Array<number>(bodies.length * 6);
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], j = i * 6;
      st[j] = b.s; st[j + 1] = b.v; st[j + 2] = b.x; st[j + 3] = b.y; st[j + 4] = b.vx; st[j + 5] = b.vy;
    }
    return st;
  };
  const unpack = (st: St) => {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], j = i * 6;
      b.s = st[j]; b.v = st[j + 1]; b.x = st[j + 2]; b.y = st[j + 3]; b.vx = st[j + 4]; b.vy = st[j + 5];
    }
  };
  let stageAcc: Map<string, number> | null = null;
  const deriv = (st: St, time: number): St => {
    evalTime = time;
    unpack(st);
    const hasContacts = bodies.some((b) => b.on && !b.landed && (coupled || !onArc(b)));
    const r = !hasContacts ? null : stageAcc ? { acc: stageAcc } : solveAcc(modes);
    if (!r && hasContacts) throw new SimulationHalt('constraint_loss', evalTime, `t=${Number(evalTime.toPrecision(7))} s 的接触/绳约束方程无解（可能已松绳，暂不支持重新绷紧），请用 ode 自写方程或 script 演示`);
    if (r && 'ropeT' in r && r.ropeT) lastRopeT = r.ropeT;
    const out = new Array<number>(bodies.length * 6).fill(0);
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], j = i * 6;
      if (b.landed) continue;
      if (onArc(b)) { out[j] = b.v; out[j + 1] = coupled ? r!.acc.get(b.id)! : arcForce(b, r?.acc).at; continue; }
      if (b.on) { out[j] = b.v; out[j + 1] = r?.acc.get(b.id) ?? 0; continue; }
      const members = groupOf(b), mass = members.reduce((q, c) => q + c.m, 0);
      const F = members.reduce((q, c): V2 => { const f = extF(c); return [q[0] + f[0], q[1] + f[1]]; }, [0, 0] as V2);
      let [fx, fy] = emAcc(b, b.x, b.y, b.vx, b.vy);
      for (const c of fieldList) { const dx = c.x - b.x, dy = c.y - b.y, r3 = Math.hypot(dx, dy) ** 3; fx += c.GM * dx / r3; fy += c.GM * dy / r3; }
      out[j + 2] = b.vx; out[j + 3] = b.vy; out[j + 4] = G[0] + fx + F[0] / mass; out[j + 5] = G[1] + fy + F[1] / mass;
    }
    return out;
  };
  // constAcc：这一步四个采样点的加速度完全相同，即这一段受力恒定，运动是时间的二次式，RK4 对任意步长都精确
  let constAcc = false;
  const rk4 = (st: St, h: number): St => {
    const k1 = deriv(st, t), k2 = deriv(st.map((v, i) => v + (h / 2) * k1[i]), t + h / 2);
    const k3 = deriv(st.map((v, i) => v + (h / 2) * k2[i]), t + h / 2), k4 = deriv(st.map((v, i) => v + h * k3[i]), t + h);
    constAcc = k1.every((a, i) => i % 6 === 0 || i % 6 === 2 || i % 6 === 3 || (a === k2[i] && a === k3[i] && a === k4[i]));
    return st.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  };

  type SupportProbe = { t: number; N: number; near: string };
  const supportProbes = new Map<string, SupportProbe>();
  const nearSupport = (b: Body) => carried(b).filter((c) => c.on && surf.get(c.on)?.host).map((c) => {
    const S = lineOf(c); return `${c.id} 位于轨道 ${S.id}，s=${c.s.toPrecision(7)} m${S.arc ? `，圆弧角=${(angAt(S, c.s) * 180 / Math.PI).toPrecision(7)}°，R=${S.R.toPrecision(7)} m` : ''}`;
  }).join('；') || `${b.id} 位于支撑 ${b.on}`;
  const supportFailure = (b: Body, N: number, time = evalTime) => {
    const p = supportProbes.get(b.id), detail = p ?? { t: time, N, near: nearSupport(b) };
    const need = Math.max(0, -detail.N), num = (v: number) => Number(v.toPrecision(7));
    return new SimulationHalt('support_loss', time, `单侧支撑失效：物体 ${b.id} 在 t=${num(time)} s 失去支撑 ${b.on}（N≈${num(N)} N）；${detail.near}。继续运动的试算 t=${num(detail.t)} s 要求 N=${num(detail.N)} N，即支撑需向下拉 ${num(need)} N，普通地面/木板只能推、不能拉。若题目未给轨道形状，请改用更缓、半径更大的形状，使小球对宿主的向上作用力不超过宿主及其上物体的重力，并重新检查全程 N≥0；若题目明确说宿主被卡住/固定，请给宿主写 locked:true（外界装置完全固定），或把轨道写成固定轨道（删去 surfaces.on），不可为通过校验擅自锁定。需要离地后的耦合运动时，请用 ode 自写方程或 script 演示。`);
  };
  // ---------- 事件函数：符号从正变负即触发 ----------
  // edge：轨道、木板的端点或挡板；piecewise：分段定义（不是位置、速度的光滑函数），不能用大步长
type EvFn = { f: () => number; fire: () => void; immediate?: () => boolean; edge?: boolean; piecewise?: boolean; priority?: number };
  function eventFns(): EvFn[] {
    const out: EvFn[] = [];
    if (!stageAcc && spec.plane !== 'horizontal') for (const b of onLine().filter((b) => !locked.has(b.id) && (coupled || forces.some((f) => f.active && [b, ...above(b)].some((c) => c.id === f.on) && f.F?.some((x, k) => lineOf(b).n[k] !== 0 && typeof x === 'string' && /\b(?:t|v|vx|vy)\b|\bv_/.test(x)))))) out.push({
      f: () => { const N = normalOf(b); if (N < -1e-8 && !supportProbes.has(b.id)) supportProbes.set(b.id, { t: evalTime, N, near: nearSupport(b) }); return N; },
      fire: () => { throw supportFailure(b, normalOf(b), t); },
    });
    for (const m of modes) if (m.kind === 'stick' && !(coupled && stageAcc)) out.push({
      f: () => { const f = solveAcc(modes)?.fStick.get(m.b.id) ?? 0; return limitOf(m, -Math.sign(f)) - Math.abs(f); },
      fire: () => { const f = solveAcc(modes)?.fStick.get(m.b.id) ?? 0; startingSlip.set(m.b.id, -Math.sign(f)); record('slip', m.b.id, m.b.on!); },
      edge: true,
    });
    for (const m of modes) if (m.kind === 'slip') {
      const b = m.b;
      out.push({
        f: () => m.sign * (b.v - lowerVel(b)),
        fire: () => {
          startingSlip.delete(b.id);
          for (const c of groupOf(b)) c.v = lowerVel(b);
          record(byId.has(b.on!) || surf.get(b.on!)!.belt ? 'same_velocity' : 'stop', b.id, b.on!);
        },
      });
    }
    for (const b of bodies) if (b.on && !b.landed) {
      if (byId.has(b.on)) {                    // 在木板上：相对位置离开 [0, L]（有挡板就反弹）
        const host = byId.get(b.on)!;
        const half = b.kind === 'board' ? 0 : b.L / 2;   // 有大小的物体（如小球直径）按边缘碰挡板
        out.push({ f: () => b.s - host.s - half, fire: () => hostEnd(b, host, 'left'), edge: true });
        out.push({ f: () => host.L - (b.s - host.s) - half, fire: () => hostEnd(b, host, 'right'), edge: true });
        continue;
      }
      const S = surf.get(b.on)!;
      if (S.arc) {
        if (S.side !== 'tube') out.push({ f: () => arcForce(b).N, fire: () => { record('leave', b.id, S.id); toFree(b); } });
        const sg = coupled && modes.some((m) => m.b === b && m.kind === 'slip') ? 0 : Math.sign(b.v);             // 这一段开始时的运动方向，速度减到 0 即"到最高点 / 折返"
        if (sg) out.push({ f: () => sg * b.v, fire: () => { b.v = 0; record('stop', b.id, S.id); } });
        else if (!coupled && arcSigns.get(b.id) === 0) out.push({
          f: () => { const f = arcForce(b); return f.cap - Math.abs(f.drive); },
          fire: () => { startingSlip.set(b.id, Math.sign(arcForce(b).drive)); record('slip', b.id, S.id); }, edge: true,
        });
      } else if (!modes.some((m) => m.kind === 'slip' && m.b === b)) {
        // 直线段上没有摩擦时的折返（竖直上抛、光滑斜面上滑）：只记时刻，不改速度
        const sg = Math.sign(b.v);
        if (sg) out.push({ f: () => sg * b.v, fire: () => record('stop', b.id, S.id) });
      }
      for (const [name, sm] of Object.entries(S.marks)) {
        out.push({ f: () => b.s - sm, fire: () => record('pass', b.id, name) });
        out.push({ f: () => sm - b.s, fire: () => record('pass', b.id, name) });
      }
      const source = spec.surfaces.find((s) => s.id === S.id)!;
      for (const loss of source.losses ?? []) {
        const at = ev(loss.at) - (S.ground ? GROUND_X : 0);
        if (!S.ground && (at <= 1e-9 || at >= S.len - 1e-9)) continue;   // 端点上的损失由 endLoss 在离开或撞端时结算
        for (const sign of [-1, 1]) out.push({ f: () => sign * (b.s - at), fire: () => applyLoss(b, S, loss) });
      }
      if (S.ground) {
        // 无限地面的接续点不在其人为起点。回程仍须能沿原连接返回。
        // 地面上的接口：轨道从接口的哪一侧来，物体就要朝那一侧走才回到轨道
        const tail = S.prev ? tanOn(surf.get(S.prev)!, surf.get(S.prev)!.len) : null;
        if (S.prev && dot(tail!, S.u) > 0) {
          const P = surf.get(S.prev)!, p = posOn(P, P.len), join = dot([p[0] - S.p0[0], p[1] - S.p0[1]], S.u);
          out.push({ f: () => b.s - join, fire: () => surfaceEnd(b, S, -1), edge: true,
            immediate: () => Math.abs(b.s - join) <= 1e-12 && b.v < 0 });
        }
        continue;
      }
      const c = () => b.s + (b.kind === 'board' ? b.L / 2 : 0);
      const lowEdge = () => (b.kind === 'board' ? b.s : b.s - b.L / 2), highEdge = () => (b.kind === 'board' ? b.s + b.L : b.s + b.L / 2);
      if (S.wS !== undefined) out.push({ f: () => lowEdge(), fire: () => wallHit(b, S, S.wS!), edge: true });
      else out.push({ priority: S.prev ? -2 : 0, f: () => c(), fire: () => { if (b.on === S.id && b.v < 0) surfaceEnd(b, S, -1); }, edge: true, immediate: () => Math.abs(c()) <= 1e-12 && b.v < 0 });
      if (S.wE !== undefined) out.push({ f: () => S.len - highEdge(), fire: () => wallHit(b, S, S.wE!), edge: true });
      else out.push({ priority: S.next ? -2 : 0, f: () => S.len - c(), fire: () => { if (b.on === S.id && b.v > 0) surfaceEnd(b, S, 1); }, edge: true, immediate: () => Math.abs(S.len - c()) <= 1e-12 && b.v > 0 });
    }
    for (const b of bodies) if (!b.on && !b.landed) {
      if (b.vy > 0) out.push({ f: () => b.vy, fire: () => { b.vy = 0; record('stop', b.id); } });
      // 掉到所有轨道以下 20 m（下面没有东西接住）：记为飞出场景，不再计算
      out.push({ f: () => b.y - (floorY - 20), fire: () => { b.landed = true; record('out', b.id); } });
      for (const S of surf.values()) {
        if (S.arc) continue;
        out.push({
          f: () => {
            const p = posOn(S, 0), k = (b.x - p[0]) / S.u[0];
            if (!(k >= -1e-9 && k <= S.len + 1e-9) || Math.abs(S.u[0]) < 1e-12) return 1;
            return b.y - (p[1] + S.u[1] * k);
          },
          fire: () => { if (S.host) throw new Error('空中物体落到可动轨道尚不支持冲量耦合，请用 ode 或 script'); b.landed = true; record('land', b.id, S.id); },
          piecewise: true,
        });
      }
    }
    // 任意共线物体的共速时刻。只记事件，不施加接触或把速度强行改成相同。
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (a.landed || b.landed || onArc(a) || onArc(b)) continue;
      if (modes.some((m) => m.kind === 'slip' && ((m.b === a && a.on === b.id) || (m.b === b && b.on === a.id)))) continue;
      const aw = worldOf(a), bw = worldOf(b);
      let u: V2;
      if (a.on) u = lineOf(a).u;
      else if (b.on) u = lineOf(b).u;
      else { const dx = bw.x - aw.x, dy = bw.y - aw.y, d = Math.hypot(dx, dy); u = d ? [dx / d, dy / d] : [0, 1]; }
      const cross = (x: number, y: number) => x * u[1] - y * u[0];
      if (Math.abs(cross(bw.x - aw.x, bw.y - aw.y)) > 1e-9 || Math.abs(cross(aw.vx, aw.vy)) > 1e-9 || Math.abs(cross(bw.vx, bw.vy)) > 1e-9) continue;
      const relative = () => { const p = worldOf(a), q = worldOf(b); return (p.vx - q.vx) * u[0] + (p.vy - q.vy) * u[1]; };
      const sign = Math.sign(relative());
      if (sign) out.push({ f: () => sign * relative(), fire: () => {
        const p = worldOf(a), q = worldOf(b);
        if (Math.hypot(p.vx - q.vx, p.vy - q.vy) > 1e-9) return;
        // 参数次序由事件筛选决定；保留唯一记录。
        record('same_velocity', a.id, b.id);
      } });
    }
    // 弹簧：形变最大（两端相对速度为 0）；拉力达到解锁值
    for (const sp of springs) {
      const sg = Math.sign(springRate(sp));
      if (sg && sp.a.on && sp.b.on && (!sp.contact || springX(sp) < 0)) out.push({ f: () => sg * springRate(sp), fire: () => record('extreme', sp.id) });
      if (sp.contact) out.push({ f: () => sp.L0 - Math.abs(springGeometry(sp).distance), fire: () => record('separate', sp.id) });
      if (sp.unlock && locked.has(sp.unlock.body)) {
        const u = sp.unlock;
        out.push({ f: () => u.F - Math.abs(sp.k * springX(sp)), fire: () => { locked.delete(u.body); record('unlock', u.body, sp.id); } });
      }
    }
    // 飞行中的物体砸到线上的可碰物体（顶面）：粘在一起，竖直速度消失
    for (const b of bodies) if (!b.on && !b.landed && collidable(b)) for (const c of onLine()) if (canCollide(b, c) && c.L > 0 && pairs.get(pairKey(b.id, c.id)) === 0) {
      out.push({
        f: () => { const w = worldOf(c); return Math.abs(b.x - w.x) <= c.L / 2 + 1e-9 ? b.y - (w.y + c.L) : 1; },
        fire: () => catchOn(b, c),
        piecewise: true,
      });
    }
    // 同一块木板（或同一轨道）上相邻、未粘连、可碰撞的物体：间距变为 0 即相碰
    const groups = new Map<string, Body[]>();
    for (const b of bodies) if (b.on && !b.landed && collidable(b)) { const k = b.on; (groups.get(k) ?? groups.set(k, []).get(k)!).push(b); }
    for (const [k, list] of groups) {
      list.sort((p, q) => (p.s + (p.kind === 'board' ? p.L / 2 : 0)) - (q.s + (q.kind === 'board' ? q.L / 2 : 0)));
      const eAB = (a: Body, c: Body) => pairs.get(pairKey(a.id, c.id))!;
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i], c = list[i + 1];
        if (root(a.id) === root(c.id) || !canCollide(a, c)) continue;
        const gap = () => (c.kind === 'board' ? c.s : c.s - c.L / 2) - (a.kind === 'board' ? a.s + a.L : a.s + a.L / 2);
        out.push({ f: gap, priority: -1, fire: () => collide(a, c, eAB(a, c)), immediate: () => Math.abs(gap()) <= 1e-12 && a.v > c.v && lastImpacts.get(pairKey(a.id, c.id)) !== t });
      }
      // 首尾相接的环形轨道：最后一个和第一个隔着接缝也相邻
      const S = surf.get(k);
      if (S && S.next === S.id && list.length > 1) {
        const a = list[list.length - 1], c = list[0];
        if (root(a.id) !== root(c.id) && canCollide(a, c)) out.push({ f: () => c.s + S.len - a.s - (a.L + c.L) / 2, priority: -1, fire: () => collide(a, c, eAB(a, c)) });
      }
    }
    // 不同支撑及空中物体：在世界坐标中接触，冲量受各自轨道的切线约束。
    for (const [key, e] of pairs) {
      const [ia, ib] = key.split('|'), a = byId.get(ia)!, b = byId.get(ib)!;
      if (a.landed || b.landed || root(a.id) === root(b.id) || (a.on && a.on === b.on)) continue;
      // 共线接触统一按区间边缘。木板 x 是左端，不能当作圆心再加半个板长。
      if (a.on && b.on && !onArc(a) && !onArc(b)) {
        const u = lineOf(a).u, v = lineOf(b).u, p = worldOf(a), q = worldOf(b);
        if (Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-12 && Math.abs((q.x - p.x) * u[1] - (q.y - p.y) * u[0]) < 1e-9) {
          const extent = (c: Body): [number, number] => { const w = worldOf(c), x = w.x * u[0] + w.y * u[1], dir = dot(lineOf(c).u, u); return c.kind === 'board' ? [Math.min(x, x + dir * c.L), Math.max(x, x + dir * c.L)] : [x - c.L / 2, x + c.L / 2]; };
          const ea = extent(a), eb = extent(b), order = (ea[0] + ea[1]) <= (eb[0] + eb[1]) ? 1 : -1;
          const gap = () => { const x = extent(a), y = extent(b); return order > 0 ? y[0] - x[1] : x[0] - y[1]; };
          const closing = () => { const p = worldOf(a), q = worldOf(b); return order * ((p.vx - q.vx) * u[0] + (p.vy - q.vy) * u[1]); };
          out.push({ f: gap, priority: -1, fire: () => impact(a, b, e, [order * u[0], order * u[1]]), immediate: () => Math.abs(gap()) <= 1e-12 && closing() > 0 && lastImpacts.get(key) !== t });
          continue;
        }
      }
      // 保留“从上方砸到板面并粘住”的面接触；其余接触用圆形或质点几何。
      if (e === 0 && ((!a.on && b.on && b.L > 0) || (!b.on && a.on && a.L > 0))) continue;
      // 一方是直轨道上有长度的木板/物块，另一方是球、质点或圆弧上的物体：把板当成有厚度的长条算接触
      // （以前把木板当成以左端为圆心、板长为直径的圆，摆球撞板端、抛体砸板面都判不准）
      // 长条沿轨道方向占 [0, L]，垂直轨道向上占 [0, 厚度]；厚度取板长的 1/10，物块取它的宽度
      const boxOf = (c: Body) => {
        if (!c.on || onArc(c) || !(c.L > 0) || c.kind === 'ball' || (!surf.has(c.on) && !byId.has(c.on))) return null;
        const w = worldOf(c), u = lineOf(c).u, up: V2 = u[0] >= 0 ? [-u[1], u[0]] : [u[1], -u[0]];
        const p0: V2 = c.kind === 'board' ? [w.x, w.y] : [w.x - u[0] * c.L / 2, w.y - u[1] * c.L / 2];
        return { p0, u, up, L: c.L, H: c.kind === 'board' ? c.L / 10 : c.L, w };
      };
      const ba = boxOf(a), bb = boxOf(b);
      if ((ba && !bb) || (bb && !ba)) {
        const plate = ba ? a : b, ball = ba ? b : a, r = ball.kind === 'ball' ? (ball.L || 0) / 2 : 0;
        // 有符号距离：在长条外为正，进入为负；同时给出法向（从长条指向球）
        const sd = () => {
          const B = boxOf(plate)!, w = worldOf(ball), d: V2 = [w.x - B.p0[0], w.y - B.p0[1]];
          const x = dot(d, B.u), y = dot(d, B.up), dx = Math.max(-x, x - B.L), dy = Math.max(-y, y - B.H);
          const ox = Math.max(dx, 0), oy = Math.max(dy, 0), out = Math.hypot(ox, oy);
          const dist = out > 0 ? out : Math.max(dx, dy);
          let nl: V2 = out > 0 ? [ox * (x > B.L / 2 ? 1 : -1) / out, oy * (y > B.H / 2 ? 1 : -1) / out] : dx > dy ? [x > B.L / 2 ? 1 : -1, 0] : [0, y > B.H / 2 ? 1 : -1];
          const n: V2 = [nl[0] * B.u[0] + nl[1] * B.up[0], nl[0] * B.u[1] + nl[1] * B.up[1]];
          return { dist, n, w, pw: B.w };
        };
        const closing = () => { const { n, w } = sd(), pw = worldOf(plate); return n[0] * (w.vx - pw.vx) + n[1] * (w.vy - pw.vy) < 0; };
        out.push({
          f: () => sd().dist - r,
          immediate: () => lastImpacts.get(key) !== t && Math.abs(sd().dist - r) <= 1e-9 && closing(),
          priority: -1, fire: () => {
            if (!closing()) return;
            const { n } = sd();
            impact(a, b, e, a === ball ? [-n[0], -n[1]] : n);   // 法向从 a 指向 b
          },
        });
        continue;
      }
      const aw = worldOf(a), bw = worldOf(b);
      const dv: V2 = [aw.vx - bw.vx, aw.vy - bw.vy], speed = Math.hypot(...dv);
      if (speed < 1e-12) continue;
      const n: V2 = [dv[0] / speed, dv[1] / speed], R = (a.L + b.L) / 2;
      out.push({
        immediate: () => lastImpacts.get(key) !== t && Math.abs(Math.hypot(bw.x - aw.x, bw.y - aw.y) - R) <= 1e-12 && (R === 0 || (bw.x - aw.x) * dv[0] + (bw.y - aw.y) * dv[1] > 0),
        f: () => {
          const p = worldOf(a), q = worldOf(b), d: V2 = [q.x - p.x, q.y - p.y];
          if (R === 0) return dot(d, n);
          const transverse = d[0] * n[1] - d[1] * n[0];
          return dot(d, n) - Math.sqrt(Math.max(0, R * R - transverse * transverse));
        },
        priority: -1, fire: () => {
          const p = worldOf(a), q = worldOf(b), dx = q.x - p.x, dy = q.y - p.y;
          if (Math.abs(Math.hypot(dx, dy) - R) > 1e-9) return;
          const relative: V2 = [p.vx - q.vx, p.vy - q.vy], length = Math.hypot(...relative);
          const normal: V2 = R ? [dx / R, dy / R] : length ? [relative[0] / length, relative[1] / length] : n;
          impact(a, b, e, normal);
        },
      });
    }
    for (const f of forces) if (!f.begun && f.after?.event === 'time') {
      const T = ev(f.after.t);
      out.push({ f: () => T - evalTime, fire: () => { f.begun = true; f.active = true; record('force_on', f.on); } });
    }
    for (const f of forces) if (f.active && f.until?.event === 'time') {
      const T = ev(f.until.t);
      out.push({ f: () => T - evalTime, fire: () => { const before = snap(); f.active = false; record('force_off', f.on, undefined, before); } });
    }
    for (const time of pendingTimes) out.push({ f: () => time - evalTime, fire: () => { pendingTimes.delete(time); record('time', ''); } });
    for (const w of whenTriggers) if (!w.done) {
      const value = () => { const now = snap(); now.t = evalTime; return opt.whenValue!(w.expr, now, start); }, fire = () => { if (w.done) return; if (++w.count === w.n) { w.done = true; w.act(); } };
      if (w.dir !== -1) out.push({ f: () => -value(), piecewise: true, fire });   // 由负变正
      if (w.dir !== 1) out.push({ f: () => value(), piecewise: true, fire });     // 由正变负
    }
    for (const k of kicks) if (!k.done && k.when.event === 'time') { const T = ev(k.when.t); out.push({ f: () => T - evalTime, fire: () => { const before = snap(); applyKick(k); record('kick', k.on, undefined, before); } }); }
    for (const k of splits) if (!k.done && k.when.event === 'time') { const T = ev(k.when.t); out.push({ f: () => T - evalTime, fire: () => { applySplit(k); record('split', k.on); } }); }
    for (const r of releases) if (!r.done && r.when.event === 'time') { const T = ev(r.when.t); out.push({ f: () => T - evalTime, fire: () => { applyRelease(r); } }); }
    for (const f of emList) if (f.area) for (const b of bodies) if (!b.on && !b.landed && b.q) { const area = f.area;
      out.push({ f: () => -insideOf(area, b.x, b.y), piecewise: true, fire: () => record('enter', b.id, f.id) }, { f: () => insideOf(area, b.x, b.y), piecewise: true, fire: () => record('leave', b.id, f.id) });
    }
    for (const c of fieldList) for (const b of bodies) if (!b.on && !b.landed) for (const sign of [-1, 1]) out.push({ f: () => sign * ((b.x - c.x) * b.vx + (b.y - c.y) * b.vy), fire: () => { const r = Math.hypot(b.x - c.x, b.y - c.y), v2 = b.vx ** 2 + b.vy ** 2; if (Math.abs(v2 - c.GM / r) > 1e-6 * v2 && t - lastKick > 1e-6) record('apsis', b.id); } });   // 圆轨道上径向速度只是数值噪声，不算近远地点
    return out;
  }

  /** 分裂：母体消失，碎片在母体处出现；碎片质量之和等于母体质量，动量守恒（空中按矢量，轨道上沿轨道），
   *  只有一块碎片的速度可以不写，由动量守恒算出；释放的能量（动能增量）记在热量“爆炸”里 */
  // 分裂事件记分裂后的状态（碎片已出现）
  function applySplit(k: (typeof splits)[number]) {
    k.done = true; lastKick = t; const P = byId.get(k.on);
    if (!P || P.dormant) throw new Error(`splits：物体 ${k.on} 不存在或已经分裂过`);
    if (groupOf(P).length > 1) throw new Error('splits：粘连组的分裂尚不支持，请用 ode 或 script');
    const kids = spec.bodies.filter((b) => b.from === P.id).map((b) => ({ spec: b, B: byId.get(b.id)! }));
    if (kids.length < 2) throw new Error(`splits：${P.id} 至少要分成两块（bodies 里 from:"${P.id}" 的碎片）`);
    const M = kids.reduce((a, c) => a + c.B.m, 0); if (Math.abs(M - P.m) > 1e-9 * Math.max(1, P.m)) throw new Error(`splits：碎片质量之和 ${M} 不等于 ${P.id} 的质量 ${P.m}`);
    const w = worldOf(P), KE0 = .5 * P.m * (w.vx ** 2 + w.vy ** 2), unknown = kids.filter((c) => P.on ? c.spec.v === undefined : c.spec.vel === undefined);
    if (unknown.length > 1) throw new Error(`splits：${unknown.map((c) => c.B.id).join('、')} 的速度都没写；最多一块不写，由动量守恒算出`);
    if (P.on) {
      let p = P.m * P.v; for (const c of kids) if (c !== unknown[0]) { c.B.v = ev(c.spec.v); p -= c.B.m * c.B.v; }
      if (unknown[0]) unknown[0].B.v = p / unknown[0].B.m; else if (Math.abs(p) > 1e-9 * Math.max(1, Math.abs(P.m * P.v))) throw new Error(`splits：碎片速度不满足动量守恒（差 ${p.toPrecision(4)} kg·m/s）；去掉其中一块的速度让引擎算`);
      for (const c of kids) { c.B.on = P.on; c.B.s = P.s; c.B.dormant = false; c.B.landed = false; }
    } else {
      let px = P.m * P.vx, py = P.m * P.vy; for (const c of kids) if (c !== unknown[0]) { c.B.vx = ev(c.spec.vel![0]); c.B.vy = ev(c.spec.vel![1]); px -= c.B.m * c.B.vx; py -= c.B.m * c.B.vy; }
      if (unknown[0]) { unknown[0].B.vx = px / unknown[0].B.m; unknown[0].B.vy = py / unknown[0].B.m; } else if (Math.hypot(px, py) > 1e-9 * Math.max(1, P.m * Math.hypot(P.vx, P.vy))) throw new Error('splits：碎片速度不满足动量守恒；去掉其中一块的速度让引擎算');
      for (const c of kids) { c.B.on = null; c.B.x = P.x; c.B.y = P.y; c.B.dormant = false; c.B.landed = false; }
    }
    const KE1 = kids.reduce((a, c) => { const q = worldOf(c.B); return a + .5 * c.B.m * (q.vx ** 2 + q.vy ** 2); }, 0);
    heat['爆炸'] = (heat['爆炸'] ?? 0) + (KE1 - KE0);
    P.dormant = true; P.landed = true;
  }
  function applyRelease(r: (typeof releases)[number]) {
    r.done = true; locked.delete(r.id); const b = byId.get(r.id)!;
    if (b.on) b.v = ev(r.spec.v ?? 0); else if (r.spec.vel) { b.vx = ev(r.spec.vel[0]); b.vy = ev(r.spec.vel[1]); }
    record('release', r.id);
  }
  function applyKick(k: (typeof kicks)[number]) {
    k.done = true; lastKick = t; const b = byId.get(k.on);
    if (!b) throw new Error(`kicks：没有物体 ${k.on}`);
    if (groupOf(b).length > 1) throw new Error('粘连组的单体瞬时变速尚不支持整体冲量耦合，请用 ode 或 script');
    if (k.vel) { if (b.on) throw new Error('kicks.vel 只用于空中物体，轨道上的物体写 dv'); b.vx = ev(k.vel[0]); b.vy = ev(k.vel[1]); return; }
    const dv = ev(k.dv);
    if (b.on) b.v += dv * (Math.sign(b.v) || 1);
    else { const s = Math.hypot(b.vx, b.vy) || 1; b.vx += dv * b.vx / s; b.vy += dv * b.vy / s; }
  }
  function record(type: string, a: string, b?: string, snapshot?: Snapshot) {
    if ((type === 'collided' || type === 'hit') && b) { const k = pairKey(a, b); counts[k] = (counts[k] ?? 0) + 1; lastImpacts.set(k, t); lost[k] = (lost[k] ?? 0) + (heat['碰撞'] ?? 0) - lostSoFar; lostSoFar = heat['碰撞'] ?? 0; }
    const rec: EventRec = { type, a, b, t, snap: snapshot ?? snap() };
    events.push(rec);
    // 触发条件写了 n（第几次）时，数到第 n 次才触发
    const nth = (sp: EventSpec) => matches(rec, sp, vars) && events.filter((e) => matches(e, sp, vars)).length === (sp.n ?? 1);
    for (const k of kicks) if (!k.done && k.when.event !== 'time' && k.when.event !== 'when' && type !== 'kick' && nth(k.when)) { applyKick(k); events.push({ type: 'kick', a: k.on, t, snap: snap() }); }
    for (const k of splits) if (!k.done && k.when.event !== 'time' && k.when.event !== 'when' && type !== 'split' && nth(k.when)) { applySplit(k); events.push({ type: 'split', a: k.on, t, snap: snap() }); }
    for (const r of releases) if (!r.done && r.when.event !== 'time' && r.when.event !== 'when' && type !== 'release' && nth(r.when)) applyRelease(r);
    // 在某事件时开始或撤去的外力
    for (const f of forces) if (!f.begun && f.after && f.after.event !== 'time' && f.after.event !== 'when' && nth(f.after)) { f.begun = true; f.active = true; events.push({ type: 'force_on', a: f.on, t, snap: rec.snap }); }
    for (const f of forces) if (f.active && f.until && f.until.event !== 'time' && f.until.event !== 'when' && nth(f.until)) {
      f.active = false;
      events.push({ type: 'force_off', a: f.on, t, snap: rec.snap });
    }
  }
  /** 光滑接触：只沿接触法线传递冲量，轨道物体仍在原轨道，空中物体保留切向速度。 */
  function impact(a: Body, b: Body, e: number, n: V2) {
    if (groupOf(a).length !== 1 || groupOf(b).length !== 1) throw new Error('不同轨道的粘连物体组碰撞不支持');
    const p = worldOf(a), q = worldOf(b);
    const tangent = (c: Body): V2 | null => c.on ? tanOn(lineOf(c), c.s) : null;
    const ta = tangent(a), tb = tangent(b);
    const mobility = (c: Body, u: V2 | null) => locked.has(c.id) ? 0 : (u ? dot(n, u) ** 2 : 1) / c.m;
    const ma = mobility(a, ta), mb = mobility(b, tb), closing = (p.vx - q.vx) * n[0] + (p.vy - q.vy) * n[1];
    if (closing <= 0) return;
    if (ma + mb < 1e-14) throw new Error('接触法线与两条轨道均垂直，碰撞约束无解');
    if ((a.on && lineOf(a).host) || (b.on && lineOf(b).host)) throw new SimulationHalt('unsupported_impact', t, `t=${Number(t.toPrecision(7))} s 的 ${a.id}/${b.id} 碰撞暂不支持可动轨道冲量耦合，请用 ode 自写方程或 script 演示`);
    if (e === 0 && (a.on || b.on) && (!ta || !tb || Math.abs(dot(ta, tb)) < 1 - 1e-12 || onArc(a) || onArc(b))) throw new Error('不同方向或曲线约束不能粘连，请使用 e>0；不能把 e=0 当作仅法向共速');
    record('collide', a.id, b.id);
    if (e === 0 && !ta && !tb) {
      const vx = (a.m * p.vx + b.m * q.vx) / (a.m + b.m), vy = (a.m * p.vy + b.m * q.vy) / (a.m + b.m);
      heat['碰撞'] = (heat['碰撞'] ?? 0) + (a.m * (p.vx ** 2 + p.vy ** 2) + b.m * (q.vx ** 2 + q.vy ** 2) - (a.m + b.m) * (vx ** 2 + vy ** 2)) / 2;
      a.vx = b.vx = vx; a.vy = b.vy = vy;
      parent.set(root(b.id), root(a.id)); record('collided', a.id, b.id); return;
    }
    const J = (1 + e) * closing / (ma + mb);
    const apply = (c: Body, u: V2 | null, sign: number) => {
      if (locked.has(c.id)) return;
      if (u) c.v += sign * J * dot(n, u) / c.m;
      else { c.vx += sign * J * n[0] / c.m; c.vy += sign * J * n[1] / c.m; }
    };
    apply(a, ta, -1); apply(b, tb, 1);
    heat['碰撞'] = (heat['碰撞'] ?? 0) + (1 - e * e) * closing * closing / (2 * (ma + mb));
    if (e === 0) { parent.set(root(b.id), root(a.id)); if (ta && tb) bonds.push([a, b]); }
    record('collided', a.id, b.id);
  }
  /** 两组物体沿线一维碰撞；e=0 粘在一起 */
  function collide(a: Body, c: Body, e: number) {
    if ((a.on && lineOf(a).host) || (c.on && lineOf(c).host)) throw new Error('可动轨道碰撞/粘连尚不支持冲量耦合，请用 ode 自写方程或 script 演示');
    if (locked.has(a.id) || locked.has(c.id)) { impact(a, c, e, lineOf(a).u); return; }
    const A = groupOf(a), C = groupOf(c);
    if (A.some((b) => b.on && lineOf(b).id !== lineOf(a).id) || C.some((b) => b.on && lineOf(b).id !== lineOf(c).id)) throw new Error('跨轨粘连组再次碰撞不支持');
    record('collide', a.id, c.id);
    const m1 = A.reduce((s, b) => s + b.m, 0), m2 = C.reduce((s, b) => s + b.m, 0);
    const v1 = a.v, v2 = c.v;
    const u1 = (m1 * v1 + m2 * v2 + m2 * e * (v2 - v1)) / (m1 + m2), u2 = (m1 * v1 + m2 * v2 + m1 * e * (v1 - v2)) / (m1 + m2);
    heat['碰撞'] = (heat['碰撞'] ?? 0) + 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2 - 0.5 * m1 * u1 * u1 - 0.5 * m2 * u2 * u2;
    for (const b of A) b.v = u1;
    for (const b of C) b.v = u2;
    if (e === 0) { parent.set(root(c.id), root(a.id)); bonds.push([a, c]); }
    record('collided', a.id, c.id);
  }
  /** 撞到轨道端的挡板：按恢复系数反弹；e=0 视为落地停住 */
  function catchOn(b: Body, c: Body) {
    if (lineOf(c).host) throw new Error('可动轨道上的捕获/粘连尚不支持冲量耦合，请用 ode 或 script');
    record('collide', b.id, c.id);
    const S = lineOf(c), C = groupOf(c), mc = C.reduce((q, x) => q + x.m, 0);
    const along = b.vx * S.u[0] + b.vy * S.u[1];
    const V = (b.m * along + mc * c.v) / (b.m + mc);
    heat['碰撞'] = (heat['碰撞'] ?? 0) + 0.5 * b.m * (b.vx ** 2 + b.vy ** 2) + 0.5 * mc * c.v ** 2 - 0.5 * (b.m + mc) * V * V;
    const w = worldOf(c);
    // 面接触保留沿面的真实落点，不能把落点瞬移到物体中心，否则反解条件会变成恒等式。
    b.s = c.s + dot([b.x - w.x, b.y - w.y], S.u); b.on = c.on; b.v = V;
    for (const x of C) x.v = V;
    parent.set(root(b.id), root(c.id)); bonds.push([c, b]);
    record('collided', b.id, c.id);
  }
  function applyLoss(b: Body, S: Surface, loss: NonNullable<SurfaceSpec['losses']>[number]) {
    if (groupOf(b).length !== 1) throw new Error('瞬时能量损失段暂不支持粘连物体组');
    const K = b.m * b.v * b.v / 2;
    const dK = loss.energy === undefined ? K * ev(loss.fraction) : ev(loss.energy);
    if (dK < 0 || dK > K) throw new Error(`物体 ${b.id} 通过能量损失段时动能不足，或损失值不合法`);
    b.v = Math.sign(b.v) * Math.sqrt(2 * (K - dK) / b.m);
    const key = `${b.id}|${S.id}`;
    heat[key] = (heat[key] ?? 0) + dK;
    record('energy_loss', b.id, S.id);
  }
  function endLoss(b: Body, S: Surface, dirn: number) {   // 损失点正好在轨道端点时，到达该端点算经过一次
    if (S.ground) return;
    const end = dirn > 0 ? S.len : 0;
    for (const loss of spec.surfaces.find((s) => s.id === S.id)?.losses ?? []) if (Math.abs(ev(loss.at) - end) <= 1e-9) applyLoss(b, S, loss);
  }
  function wallHit(b: Body, S: Surface, e: number) {
    endLoss(b, S, Math.sign(b.v));
    // 固定挡板：损失的动能 ½mv²(1−e²) 记进碰撞耗能，再记“撞到”，Q(物体, 轨道) 才算得到
    heat['碰撞'] = (heat['碰撞'] ?? 0) + groupOf(b).reduce((q, c) => q + 0.5 * c.m * c.v * c.v * (1 - e * e), 0);
    const hitAt = snap();
    if (e === 0) { for (const c of groupOf(b)) { c.v = 0; c.landed = true; } record('hit', b.id, S.id, hitAt); record('land', b.id, S.id, hitAt); return; }   // land 和 hit 都取碰地瞬间（碰前）；碰后写 phase:"after"   // 撞上停住：速度为零
    for (const c of groupOf(b)) c.v = -e * c.v;
    record('hit', b.id, S.id, hitAt);
  }
  function hostEnd(b: Body, host: Body, end: 'left' | 'right') {
    if (end === 'right' && host.next) {        // 滑进固定在木板上的圆弧：改记相对轨道的坐标和速度
      b.s = b.s - host.s - host.L; b.v = b.v - host.v; b.on = host.next;
      record('enter', b.id, host.next);
      return;
    }
    const e = host.walls[end];
    if (e !== undefined) { collide(end === 'right' ? b : host, end === 'right' ? host : b, e); return; }
    record('leave', b.id, host.id);
    const S = lineOf(host);
    if (S.ground || (b.s >= -1e-9 && b.s <= S.len + 1e-9)) { b.on = S.id; return; }
    toFree(b);
  }
  function surfaceEnd(b: Body, S: Surface, dirn: number) {
    endLoss(b, S, dirn);
    const to = dirn > 0 ? S.next : S.prev;
    if (to && surf.has(to)) {
      const N = surf.get(to)!;
      if (S.host !== N.host && (S.host || N.host)) throw new Error('不同宿主/固定与可动轨道的直接 next 尚不支持接续冲量，请用 ode 或 script');
      const p = S.ground && dirn < 0 ? posOn(N, N.len) : posOn(S, dirn > 0 ? S.len : 0);
      // 地面用世界坐标，有限段用端点坐标；速度大小保留，方向随 next 的切线转向。
      // 地面用世界坐标，方向可能和轨道相反：速度的正负看运动方向和地面切线是否同向
      const along = tanOn(S, dirn > 0 ? S.len : 0), move: V2 = [along[0] * (Math.sign(b.v) || dirn), along[1] * (Math.sign(b.v) || dirn)];
      b.s = N.ground ? dot([p[0] - N.p0[0], p[1] - N.p0[1]], N.u) : dirn > 0 ? 0 : N.len;
      if (N.ground) { const turn = dot(move, N.u); if (Math.abs(turn) > 1e-9) b.v = Math.abs(b.v) * Math.sign(turn); }
      b.on = to;
      record('enter', b.id, to); events[events.length - 1].from = S.id;   // 记下从哪段来：{"event":"leave","from":S} 也认这一刻
      return;
    }
    if (to && byId.has(to)) {                  // 滑上木板左端
      const host = byId.get(to)!;
      if (S.host && S.host !== host.id) throw new Error('可动轨道接到另一木板尚不支持冲量耦合，请用 ode 或 script');
      if (S.host) b.v += host.v;
      b.s = host.s + (dirn < 0 ? host.L : b.s - S.len);
      b.on = to;
      record('enter', b.id, to); events[events.length - 1].from = S.id;
      return;
    }
    record('leave', b.id, S.id);
    for (const c of above(b)) toFree(c);
    toFree(b);
  }
  function toFree(b: Body) {
    for (const f of forces) if (f.active && f.on === b.id && f.along !== undefined) { f.active = false; events.push({ type: 'force_off', a: f.on, t, snap: snap() }); }   // 沿轨道的力在离开轨道时结束
    const w = worldOf(b);
    const S = lineOf(b), half = b.kind === 'board' ? b.L / 2 : 0;
    b.x = w.x + S.u[0] * half; b.y = w.y + S.u[1] * half; b.vx = w.vx; b.vy = w.vy; b.on = null;
  }

  // ---------- 主循环 ----------
  const tMax = ev(spec.tMax, 30);
  const dt = Math.min(1e-3, tMax / 4000);    // 微观粒子题的时间尺度可能只有微秒
  const sampleDt = Math.min(opt.sample ?? 0, tMax / 600) || 0;
  // 受力恒定的一段用大步长：事件函数此时最多是时间的二次式，加上步中点的值就能查出步内越界又回来的情况
  const bigDt = sampleDt ? Math.min(0.02, sampleDt) : 0.02;
  let steady = false;
  let nextSample = 0;
  const openStage = () => {
    evalTime = t;
    const r = contacts().length ? resolve() : null;
    if (r && 'ropeT' in r && r.ropeT) lastRopeT = r.ropeT as Map<string, number>;
    if (!r) modes = [];
    for (const b of bodies) if (onArc(b) && !coupled) {
      const f = arcForce(b, r?.acc);
      arcSigns.set(b.id, startingSlip.get(b.id) ?? (Math.sign(b.v) || (Math.abs(f.drive) > f.cap ? Math.sign(f.drive) : 0)));
    }
    startingSlip.clear();
    // 有物体在可动轨道的圆弧上时，轨道加速度随位置变，不能整段沿用
    // stageAcc 跨求解保存，复制它以免工作区的下一次读数覆盖本阶段加速度。
    stageAcc = r && !springs.length && !forces.some((f) => f.active && [...(f.F ?? []), f.along ?? 0].some((x) => typeof x === 'string' && /\b(?:t|v|vx|vy)\b|\bv_/.test(x))) && !spec.surfaces.some((s) => s.resistance !== undefined) && !bodies.some((b) => onArc(b) && (coupled || surf.get(b.on!)!.host)) ? new Map(r.acc) : null;
    if (stage) { stage.t1 = t; stages.push(stage); }
    stage = {
      t0: t, t1: t,
      dynamic: !stageAcc,
      modes: modes.map((m) => ({ upper: m.b.id, lower: m.b.on!, mode: m.kind, f: m.kind === 'stick' ? r!.fStick.get(m.b.id)! : r?.fr.get(m.b.id) ?? 0, N: (m.members ?? [m.b]).reduce((s, c) => s + normalOf(c), 0) })),
      acc: Object.fromEntries([...(r?.acc ?? new Map())]),
    };
  };
  // 摩擦生热 = 滑动摩擦力 × 相对滑动的路程；轨道上的路程也一并累加（两次转折之间方向不变，按位移差累加是精确的）
  const ledger = (before: St, h: number) => {
    const after = pack(), endTime = evalTime;
    const variableWork = spec.surfaces.some((s) => s.resistance !== undefined) || forces.some((f) => [...(f.F ?? []), f.along ?? 0].some((x) => typeof x === 'string' && /\b(?:t|v|vx|vy)\b|\bv_/.test(x)));
    const integrateWork = variableWork || bodies.some((b) => onArc(b) && (resistanceOf(b) > 0 || muOf(b, Math.sign(b.v)) > 0));
    if (integrateWork) {
      const power = (st: St, at: number) => {
        unpack(st); evalTime = at;
        const p: Record<string, number> = {};
        for (const m of modes) if (m.kind === 'slip' && m.b.on) p[`${m.b.id}|${m.b.on}`] = limitOf(m, m.sign) * Math.abs(m.b.v - lowerVel(m.b));
        for (const b of bodies) if (onArc(b)) p[`${b.id}|${b.on}`] = (resistanceOf(b) + muOf(b, Math.sign(b.v)) * (spec.plane === 'horizontal' ? b.m * g : Math.abs(arcForce(b).N))) * Math.abs(b.v);
        return p;
      };
      const middle = rk4(before, h / 2), p0 = power(before, t), pm = power(middle, t + h / 2), p1 = power(after, t + h);
      for (const key of new Set([...Object.keys(p0), ...Object.keys(pm), ...Object.keys(p1)])) heat[key] = (heat[key] ?? 0) + h / 6 * ((p0[key] ?? 0) + 4 * (pm[key] ?? 0) + (p1[key] ?? 0));
      unpack(after); evalTime = endTime;
    }
    for (const m of modes) if (!integrateWork && m.kind === 'slip' && m.b.on) {
      const b = m.b, i = bodies.indexOf(b);
      const host = byId.get(b.on!);
      const dLower = host ? host.s - before[bodies.indexOf(host) * 6] : surf.get(b.on!)!.belt * h;
      const key = `${b.id}|${b.on}`;
      heat[key] = (heat[key] ?? 0) + limitOf(m, m.sign) * Math.abs(b.s - before[i * 6] - dLower);
    }
    bodies.forEach((b, i) => {
      if (b.on && !byId.has(b.on) && !b.landed) { const k = `${b.id}|${b.on}`; path[k] = (path[k] ?? 0) + Math.abs(b.s - before[i * 6]); }
    });
  };
  const done = () => bodies.every((b) => b.landed || (b.on && Math.abs(b.v) < 1e-12 && (onArc(b) ? Math.abs(arcForce(b).at) < 1e-12 : Math.abs(stage!.acc[b.id] ?? 0) < 1e-12 && !lineOf(b).belt))) && !pendingTimes.size && !forces.some((f) => f.active && (f.until || [...(f.F ?? []), f.along ?? 0].some((x) => typeof x === 'string' && /\b(?:t|v|vx|vy)\b|\bv_/.test(x))));
  for (const f of forces) {
    addWhen(f.after, () => { if (!f.begun) { f.begun = true; f.active = true; record('force_on', f.on); } });
    addWhen(f.until, () => { if (f.active) { const before = snap(); f.active = false; record('force_off', f.on, undefined, before); } });
  }
  for (const k of kicks) addWhen(k.when, () => { if (!k.done) { const before = snap(); applyKick(k); record('kick', k.on, undefined, before); } });
  for (const k of splits) addWhen(k.when, () => { if (!k.done) { applySplit(k); record('split', k.on); } });
  for (const r of releases) addWhen(r.when, () => { if (!r.done) applyRelease(r); });
  addWhen(spec.until, () => { stopNow = true; });
  for (const r of ropes) { const [ka, kb] = ropeGeometry(r); if (Math.abs(ka * r.a.v + kb * r.b.v) > 1e-9) throw new Error(`绳 ${r.id} 初速度不满足绳长约束；松弛后绷紧尚不支持，请用 ode 或 script`); }
  const start = snap();                      // 初始快照（要在各个函数都定义好之后取）
  openStage();
  const initialActive = forces.filter((f) => f.active).length;
  record('start', '');
  for (const f of forces) if (f.active && f.until?.event === 'time' && ev(f.until.t) === 0) {
    const before = snap(); f.active = false; record('force_off', f.on, undefined, before);
  }
  if (pendingTimes.delete(0)) record('time', '');
  if (forces.filter((f) => f.active).length !== initialActive) openStage();
  let guard = 0, safeTime = t, safeState = pack(), safeEvents = events.length;
  let safeOn = bodies.map((b) => ({ on: b.on, landed: b.landed }));
  let failure: SimFailure | undefined, partialEnd: Snapshot | undefined;
  try { while (t < tMax && guard++ < 2e6) {
    if (sampleDt && t >= nextSample - 1e-12) { samples.push(snap()); nextSample += sampleDt; }
    if (done()) break;
    const st0 = pack(); safeState = st0; safeTime = t; safeEvents = events.length; supportProbes.clear();
    const fns = eventFns();
    const immediate = fns.find((f) => f.immediate?.());
    if (immediate) {
      const index = events.length, before = snap(); partialEnd = before;
      immediate.fire();
      openStage();
      safeOn = bodies.map((b) => ({ on: b.on, landed: b.landed }));
      const after = snap(); for (const e of events.slice(index)) { e.before = before; e.after = after; }
      if (stopNow || (spec.until && spec.until.event !== 'when' && events.filter((e) => matches(e, spec.until!, vars)).length >= (spec.until.n ?? 1))) break;
      if (opt.stopAfter?.length && opt.stopAfter.every((sp) => events.filter((e) => matches(e, sp, vars)).length >= (sp.n ?? 1))) break;
      continue;
    }
    const g0 = fns.map((e) => e.f());
    let h = Math.min(steady && !fns.some((e) => e.piecewise) ? bigDt : dt, Math.max(tMax - t, 1e-9));
    if (Number.isFinite(areaMin)) { const fast = Math.max(0, ...bodies.filter((b) => !b.on && !b.landed && b.q).map((b) => Math.hypot(b.vx, b.vy))); if (fast > 0) h = Math.max(Math.min(h, .25 * areaMin / fast), 1e-15); }
    let st1 = rk4(st0, h);
    if (h > dt && !constAcc) { h = dt; st1 = rk4(st0, h); }
    steady = constAcc;
    unpack(st1);
    let armed = g0.map((g) => g > 1e-12);
    let hit = fns.some((e, k) => armed[k] && e.f() <= 1e-12);
    let lo = 0, hi = h;
    if (!hit && h > dt) {
      // 大步长：由步首、步中、步末三个值定出二次式，最低点越过 0 说明步内越界又回来了
      const g1 = fns.map((e) => e.f());
      unpack(rk4(st0, h / 2));
      const gm = fns.map((e) => e.f());
      fns.forEach((_, k) => {
        if (!armed[k] || g1[k] <= 1e-12) return;
        const B = 4 * gm[k] - 3 * g0[k] - g1[k], C = 2 * g1[k] + 2 * g0[k] - 4 * gm[k];
        if (C <= 0) return;
        const u = -B / (2 * C);
        if (u > 0 && u < 1 && g0[k] - (B * B) / (4 * C) <= 1e-12) { hi = Math.min(hi, u * h); hit = true; }
      });
      unpack(st1);
    }
    if (!hit) {
      // 步首正好在边界上、步末却到了界外：一步之内进来又出去（如以几乎为 0 的速度冲上斜面又滑回，或停在接缝上又滑走）。
      // 在步内细分：找得到它在界内的时刻，就从那里起照常二分；进去的距离小到分辨不出，就在第一个明确越界的时刻触发
      const back = fns.map((e, k) => !!e.edge && Math.abs(g0[k]) <= 1e-9 && e.f() < -1e-9);
      if (back.some(Boolean)) {
        let out = h;
        for (let i = 1; i < 64 && !hit; i++) {
          unpack(rk4(st0, (h * i) / 64));
          const gi = fns.map((e) => e.f());
          if (back.some((b, k) => b && gi[k] > 1e-12)) { lo = (h * i) / 64; armed = armed.map((a, k) => a || (back[k] && gi[k] > 1e-12)); hit = true; }
          else if (out === h && back.some((b, k) => b && gi[k] < -1e-9)) out = (h * i) / 64;
        }
        if (!hit) { armed = back; hit = true; hi = out; lo = out; }
      }
      if (!hit) { unpack(st1); ledger(st0, h); t += h; continue; }
    }
    for (let it = 0; it < 60 && hi > lo; it++) {  // 二分找最早触发的事件时刻
      const mid = (lo + hi) / 2;
      unpack(rk4(st0, mid));
      if (fns.some((e, k) => armed[k] && e.f() <= 1e-12)) hi = mid; else lo = mid;
    }
    st1 = rk4(st0, hi); unpack(st1);
    ledger(st0, hi);
    t += hi;
    const gs = fns.map((e) => e.f());
    const index = events.length, before = snap();
    safeState = pack(); safeTime = t; safeEvents = events.length; partialEnd = before;
    fns.map((e, k) => ({ e, k })).sort((a, b) => (a.e.priority ?? 0) - (b.e.priority ?? 0)).forEach(({ e, k }) => { if (armed[k] && gs[k] <= 1e-9) e.fire(); });
    openStage();
    safeOn = bodies.map((b) => ({ on: b.on, landed: b.landed }));
    const after = snap(); for (const e of events.slice(index)) { e.before = before; e.after = after; }
    if (stopNow || (spec.until && spec.until.event !== 'when' && events.filter((e) => matches(e, spec.until!, vars)).length >= (spec.until.n ?? 1))) break;
    if (opt.stopAfter?.length && opt.stopAfter.every((sp) => events.filter((e) => matches(e, sp, vars)).length >= (sp.n ?? 1))) break;
  } } catch (e) {
    if (!opt.partial || !(e instanceof SimulationHalt) || safeTime <= 0) throw e;
    bodies.forEach((b, i) => { b.on = safeOn[i].on; b.landed = safeOn[i].landed; });
    unpack(safeState); t = safeTime; evalTime = t; events.length = safeEvents;
    failure = { ...e.failure, t }; partialEnd = partialEnd?.t === t ? partialEnd : snap();
  }
  if (stage) { (stage as Stage).t1 = t; stages.push(stage); }
  const end = failure ? partialEnd! : snap();
  if (!failure) record('end', '');
  if (sampleDt) samples.push(end);
  const emGeo: EmGeo[] = emList.map((f) => { const n = (x: Num) => { try { return evaluate(x, { vars: { ...vars, t: 0 } }); } catch { return 0; } }, a = f.area; return { id: f.id, kind: f.kind, E: f.E ? [n(f.E[0]), n(f.E[1])] : undefined, B: f.B === undefined ? undefined : n(f.B), Q: f.Q === undefined ? undefined : n(f.Q), at: f.at ? [n(f.at[0]), n(f.at[1])] : undefined, rect: a && 'x0' in a ? [a.x0, a.y0, a.x1, a.y1] : undefined, circle: a && 'R' in a ? [a.cx, a.cy, a.R] : undefined }; });
  const geo: Geo = {
    plane: spec.plane ?? 'vertical',
    surfaces: [...surf.values()].map((S) => {
      const o = hostOff(S);
      const marks = Object.fromEntries(Object.entries(S.marks).map(([k, sm]) => { const p = posOn(S, sm); return [k, [p[0] - o[0], p[1] - o[1]]]; }));
      if (S.ground) return { id: S.id, kind: 'ground' as const, y: S.p0[1], marks, host: S.host };
      if (S.arc) return { id: S.id, kind: 'arc' as const, c: S.c, R: S.R, a0: S.a0, a1: S.a0 + (S.sgn * S.len) / S.R, side: S.side, closed: S.next === S.id, marks, host: S.host, tether: S.tether, rough: S.muF > 0 || S.muB > 0 };
      // 输出本地坐标，播放器按采样中的 host 位置平移；不参与物理计算。
      const end = posOn(S, S.len), rough = S.muF > 0 || S.muB > 0;
      const belt = spec.surfaces.find((s) => s.id === S.id)?.speed === undefined ? undefined : S.belt;
      return { id: S.id, kind: 'seg' as const, rough, p0: S.p0, p1: [end[0] - o[0], end[1] - o[1]] as V2, belt, marks, host: S.host, walls: { start: S.wS, end: S.wE }, rails: spec.surfaces.find((q) => q.id === S.id)?.rails === undefined ? undefined : ev(spec.surfaces.find((q) => q.id === S.id)!.rails) };
    }),
    bodies: bodies.map((b) => ({ id: b.id, kind: b.kind, L: b.L, m: b.m, walls: { ...b.walls }, look: spec.bodies.find((s) => s.id === b.id)?.look, q: b.q })),
  };
  return { ...(failure ? { failure } : {}), events, stages, samples, start, end, geo, vars: { ...vars }, ropes: ropes.map((r) => ({ id: r.id, a: r.a.id, b: r.b.id, via: r.via })), fields: fieldList, em: emGeo };
}

export function matches(e: EventRec, s: EventSpec, vars: Record<string, number> = {}): boolean {
  // 离开某段轨道（写了 from）：滑上下一段轨道或木板也算离开
  if (s.event === 'leave' && e.type === 'enter' && s.from && e.from === s.from) return !s.body || e.a === s.body;
  if (e.type !== s.event) return false;
  if (s.name && e.a !== s.name) return false;
  if (s.event === 'time' && s.t !== undefined && Math.abs(e.t - evaluate(s.t, { vars })) > 1e-9) return false;
  if (e.type === 'same_velocity' && s.bodies) return (!s.body || s.bodies.includes(s.body)) && (!s.to || s.bodies.includes(s.to)) && ((!s.from || s.bodies.includes(s.from))) && ((e.a === s.bodies[0] && e.b === s.bodies[1]) || (e.a === s.bodies[1] && e.b === s.bodies[0]));
  if (e.type === 'same_velocity' && s.body) return (e.a === s.body || e.b === s.body) && (!(s.to || s.from) || (e.a === s.body ? e.b : e.a) === (s.to ?? s.from));
  if (s.body && e.a !== s.body) return false;
  if ((s.from ?? s.to) && e.b !== (s.from ?? s.to)) return false;
  if (s.bodies && !((e.a === s.bodies[0] && e.b === s.bodies[1]) || (e.a === s.bodies[1] && e.b === s.bodies[0]))) return false;
  return true;
}

export function findEvent(r: SimResult, s: EventSpec): EventRec | undefined {
  const e = r.events.filter((e) => matches(e, s, r.vars))[(s.n ?? 1) - 1];
  return e && s.phase ? { ...e, snap: e[s.phase] ?? e.snap } : e;
}

/** 同一个系数矩阵的多个右端项；逐项执行与 gauss 完全相同的浮点运算。 */
function gaussRhs(A: number[][]): ((rhs: number[]) => number[]) | null {
  const n = A.length, swaps: number[] = [], factors: number[][] = [];
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-14) return null;
    swaps.push(p); [A[c], A[p]] = [A[p], A[c]];
    const row = new Array<number>(n); factors.push(row);
    for (let r = 0; r < n; r++) if (r !== c) {
      const k = A[r][c] / A[c][c]; row[r] = k;
      for (let j = c; j < n; j++) A[r][j] -= k * A[c][j];
    }
  }
  const diag = A.map((row, i) => row[i]);
  return (rhs) => {
    for (let c = 0; c < n; c++) {
      const p = swaps[c]; [rhs[c], rhs[p]] = [rhs[p], rhs[c]];
      for (let r = 0; r < n; r++) if (r !== c) rhs[r] -= factors[c][r] * rhs[c];
    }
    for (let i = 0; i < n; i++) rhs[i] /= diag[i];
    return rhs;
  };
}

function gauss(A: number[][]): number[] | null {
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-14) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) {
      const k = A[r][c] / A[c][c];
      for (let j = c; j <= n; j++) A[r][j] -= k * A[c][j];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

/** 按解析式演示：物体位置由题目给的 t 的函数决定，不做动力学模拟。取值仍可读，但只算“仅代数”。 */
function simulateScript(spec: SceneSpec, vars: Record<string, number>, opt: { sample?: number; times?: number[] } = {}): SimResult {
  const sc = spec.script!, base = simulate({ ...spec, script: undefined, bodies: [], ropes: [], tMax: 0, forces: [], springs: [], collisions: [], friction: [], kicks: [], fields: [], resistance: [], until: undefined }, vars);
  const at = (x: Num | undefined, t: number, extra: Record<string, number> = {}) => (x === undefined ? 0 : evaluate(x, { vars: { ...vars, t, ...extra } }));
  const T = at(sc.duration, 0), ids = Object.entries(sc.bodies ?? {}), step = opt.sample || 1 / 60, h = 1e-3;
  const pos = (b: ScriptBody, t: number) => [at(b.x, t), at(b.y, t), at(b.z, t)];
  const frame = (t: number): Snapshot => {
    const bodies: Snapshot['bodies'] = {};
    for (const [id, b] of ids) {
      const p = pos(b, t), q = pos(b, t + h), o = pos(b, t - h);
      bodies[id] = { x: p[0], y: p[1], z: p[2], cx: p[0], vx: (q[0] - o[0]) / (2 * h), vy: (q[1] - o[1]) / (2 * h), ang: 0, on: null, a: undefined };
    }
    const end = (e: string | [Num, Num, Num?]) => typeof e === 'string' ? pos(sc.bodies![e], t) : [at(e[0], t), at(e[1], t), at(e[2], t)];
    const script: ScriptFrame = {
      links: (sc.links ?? []).map((l) => ({ a: end(l.a), b: end(l.b), kind: l.kind ?? 'rope' })),
      curves: (sc.curves ?? []).map((c) => { const n = c.n ?? 80; return { label: c.label, pts: Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return [at(c.x, t, { u }), at(c.y, t, { u }), at(c.z, t, { u })]; }) }; }),
      vectors: (sc.vectors ?? []).map((v) => ({ on: v.on, v: [at(v.v[0], t), at(v.v[1], t), at(v.v[2], t)], label: v.label, kind: v.kind ?? 'force' })),
    };
    return { t, bodies, heat: {}, path: {}, counts: {}, springs: {}, script };
  };
  const samples: Snapshot[] = []; for (let t = 0; t < T; t += step) samples.push(frame(t));
  const start = frame(0), end = frame(T);
  const events: EventRec[] = [{ type: 'start', a: '', t: 0, snap: start }, ...(sc.marks ?? []).map((m) => { const t = at(m.t, 0); return { type: 'mark', a: m.label, b: m.label, t, snap: frame(t) }; }), ...(opt.times ?? []).map((t) => ({ type: 'time', a: '', t, snap: frame(t) })), { type: 'end', a: '', t: T, snap: end }].sort((p, q) => p.t - q.t);
  const geo: Geo = { ...base.geo, bodies: ids.map(([id, b]) => ({ id, kind: b.kind ?? 'ball', L: at(b.length, 0), m: at(b.m, 0), look: b.look })) };
  return { ...base, script: true, events, stages: [{ t0: 0, t1: T, modes: [], acc: {} }], samples, start, end, geo };
}

/** 直流电路：节点电压法。理想导线、电流表用极小电阻，电压表、电容、断开的开关用极大电阻；电源用诺顿等效。表达式可含 t，用于滑动变阻器扫描和交变电源。 */
function simulateCircuit(spec: SceneSpec, vars: Record<string, number>, opt: { sample?: number; times?: number[] } = {}): SimResult {
  const c = spec.circuit!, base = simulate({ ...spec, circuit: undefined, surfaces: [], bodies: [], tMax: 0, until: undefined }, vars);
  const at = (x: Num | undefined, t: number, d = 0) => (x === undefined ? d : evaluate(x, { vars: { ...vars, t } }));
  let solving = false;
  const names = Object.keys(c.nodes), index = new Map(names.slice(1).map((n, i) => [n, i])), n = names.length - 1;
  // 小灯泡的伏安曲线：按当前电压查表得电阻，迭代到收敛
  const curves = new Map(c.elements.filter((e) => e.curve).map((e) => [e.id, e.curve!.map((p) => [at(p[0], 0), at(p[1], 0)]).sort((a, b) => a[0] - b[0])]));
  const lastU: Record<string, number> = {};
  const curveR = (e: CircuitElement) => { const pts = curves.get(e.id)!, u = Math.abs(lastU[e.id] ?? pts[Math.floor(pts.length / 2)][0]); let i = 1; while (i < pts.length - 1 && pts[i][0] < u) i++; const [u0, i0] = pts[i - 1], [u1, i1] = pts[i], cur = i0 + (i1 - i0) * (u - u0) / (u1 - u0 || 1); return Math.max(u, 1e-6) / Math.max(cur, 1e-9); };
  const nonlinear = curves.size > 0;
  // 电容瞬态：每步把电容换成电压源串小电阻（后向欧拉）
  const caps = c.elements.filter((e) => e.kind === 'capacitor'), dyn = !!c.transient && caps.length > 0;
  const resistanceOf = (e: CircuitElement, t: number) => {
    if (e.curve) return curveR(e);
    if (e.kind === 'wire' || e.kind === 'ammeter') return at(e.R, t, 1e-7);
    if (e.kind === 'voltmeter') return at(e.R, t, 1e10);
    if (e.kind === 'capacitor') return 1e12;
    if (e.kind === 'switch') return at(e.on, t, 1) >= .5 ? 1e-7 : 1e12;
    return Math.max(at(e.R, t), 1e-7);
  };
  const solve = (t: number, vc?: Record<string, number>, hstep?: number): CircuitFrame => {
    if (nonlinear && !solving) { solving = true; let f = solve(t, vc, hstep); for (let k = 0; k < 60; k++) { let moved = 0; for (const id of curves.keys()) { const u = f.U[id], old = lastU[id] ?? u; lastU[id] = old + (u - old) * .5; moved = Math.max(moved, Math.abs(u - old)); } f = solve(t, vc, hstep); if (moved < 1e-9) break; } solving = false; return f; }
    const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
    const stamp = (a: string, b: string, G: number, I: number) => {   // I：电流源从 b 流向 a
      const i = index.get(a), j = index.get(b);
      if (i !== undefined) { A[i][i] += G; A[i][n] += I; if (j !== undefined) A[i][j] -= G; }
      if (j !== undefined) { A[j][j] += G; A[j][n] -= I; if (i !== undefined) A[j][i] -= G; }
    };
    for (let i = 0; i < n; i++) A[i][i] += 1e-13;
    for (const e of c.elements) {
      if (e.kind === 'battery') { const r = Math.max(at(e.r, t), 1e-6); stamp(e.a, e.b, 1 / r, at(e.E, t) / r); }
      else if (e.kind === 'capacitor' && vc && hstep) { const Cc = at(e.C, t, 1), G = Cc / hstep; stamp(e.a, e.b, G, G * (vc[e.id] ?? 0)); }
      else stamp(e.a, e.b, 1 / resistanceOf(e, t), 0);
    }
    const x = n ? gauss(A) : [];
    if (!x) throw new Error('电路方程解不出来，请检查有没有悬空的节点');
    const V: Record<string, number> = { [names[0]]: 0 }; names.slice(1).forEach((m, i) => { V[m] = x[i]; });
    const I: Record<string, number> = {}, U: Record<string, number> = {};
    for (const e of c.elements) {
      const u = V[e.a] - V[e.b]; U[e.id] = u;
      I[e.id] = e.kind === 'battery' ? (at(e.E, t) - u) / Math.max(at(e.r, t), 1e-6) : e.kind === 'capacitor' && vc && hstep ? at(e.C, t, 1) * (u - (vc[e.id] ?? 0)) / hstep : u / resistanceOf(e, t);
    }
    const Is = Object.fromEntries(c.elements.map((e) => [e.id, e.kind === 'battery' ? -I[e.id] : I[e.id]]));   // 元件声明 a → b 为正
    return { V, I, U, Is };
  };
  const T = at(c.duration, 0, 6), step = opt.sample || 1 / 60;
  const M = 3000, hs = T / M, states: Record<string, number>[] = [];
  if (dyn) { let v = Object.fromEntries(caps.map((e) => [e.id, at(e.U0, 0, 0)])); states.push(v); for (let i = 1; i <= M; i++) { const f = solve(i * hs, v, hs); v = Object.fromEntries(caps.map((e) => [e.id, f.U[e.id]])); states.push(v); } }
  const frame = (t: number): Snapshot => {
    const i = dyn ? Math.min(M, Math.max(1, Math.ceil(t / hs))) : 0, f = dyn ? solve(t, states[i - 1], hs) : solve(t), vals: Record<string, number> = {};
    for (const e of c.elements) { vals[`U_${e.id}`] = f.U[e.id]; vals[`I_${e.id}`] = f.I[e.id]; vals[`Is_${e.id}`] = f.Is[e.id]; if (e.kind === 'capacitor') vals[`q_${e.id}`] = at(e.C, t, 0) * f.U[e.id]; if (e.curve) vals[`R_${e.id}`] = f.U[e.id] / (f.I[e.id] || 1e-30); }
    return { t, bodies: {}, heat: {}, path: {}, counts: {}, springs: {}, circuit: f, vals };
  };
  const samples: Snapshot[] = []; for (let t = 0; t < T; t += step) samples.push(frame(t));
  const start = frame(0), end = frame(T);
  const events: EventRec[] = [{ type: 'start', a: '', t: 0, snap: start }, ...(c.marks ?? []).map((m) => { const t = at(m.t, 0); return { type: 'mark', a: m.label, b: m.label, t, snap: frame(t) }; }), ...(opt.times ?? []).map((t) => ({ type: 'time', a: '', t, snap: frame(t) })), { type: 'end', a: '', t: T, snap: end }].sort((p, q) => p.t - q.t);
  return { ...base, script: true, events, stages: [{ t0: 0, t1: T, modes: [], acc: {} }], samples, start, end, circuit: { nodes: Object.fromEntries(Object.entries(c.nodes).map(([k, p]) => [k, [at(p[0], 0), at(p[1], 0)] as V2])), elements: c.elements.map((e) => ({ id: e.id, kind: e.kind, a: e.a, b: e.b })) } };
}
