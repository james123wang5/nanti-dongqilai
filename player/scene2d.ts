// 二维舞台：画成试卷插图的样子，只是它会动。只消费几何、采样和事件。
import type { SimResult, Snapshot, GeoSurface, V2, BodySnap } from '../engine/sim.ts';
import type { Prim } from '../engine/labs/common.ts';
import { arrowScale, flatIconRadius, forceGlyphs, forceMax, readableFont, groupDenseForces, mergeEqualResultant, layoutForceLines, MEANING, type ForceGlyph } from './visual-rules.ts';
import { placeLabel, placeStableLabel, overlaps } from './label-layout.ts';
import { sampleAt } from './timeline.ts';
import { COLORS, fitFrame, bodyPose, hostBox, offsetOf, springEnds, supportPlan, surfacePoints, type Frame, type Supports } from './geometry.ts';

const PAPER_HALO = '#fffaf0e0';
const INK = '#1a262a', SOFT = '#7c8680', PAPER = '#f6f2e8', DOT = '#e0d9c8', BASE = '#e7e0cf', WOOD = '#e4cfa4', VEL = '#1c5fc4', FORCE = '#c9711a';
const MATH = '"Times New Roman", "Songti SC", serif', CJK = '"PingFang SC", "Microsoft YaHei", sans-serif';
type Flag = 'velocity' | 'force' | 'trail' | 'inset';

export class Scene2D {
  readonly canvas = document.createElement('canvas');
  private g = this.canvas.getContext('2d')!;
  private sim?: SimResult; private f!: Frame; private snap?: Snapshot;
  private flags: Record<Flag, boolean> = { velocity: true, force: false, trail: true, inset: false };
  private w = 0; private h = 0; private k = 1; private ky = 1; private ox = 0; private oy = 0; private w0 = 0; private w1 = 1;
  private vmax = 1; private focusId: string | null = null; private f0!: Frame; private lastK = 0; private over: { forces: string[]; spans: string[]; gap?: [string, string]; label?: string; from: number } = { forces: [], spans: [], from: 0 }; private fmax = 1; private snaps: Snapshot[] = []; private pointNames = new Set<string>(); private supports: Supports | null = null; symbolsOnly = false; private ghosts: { t: number; c: V2; size: number; color: string; ball: boolean }[] = []; private paths: { color: string; pts: number[][] }[] = [];

  /** 跟随镜头：小容器（带两端挡板、里面有物体的木板）相对整段运动很小时，镜头推近跟着它走，碰撞前后推近、长途飞行时拉远 */
  private follow: { id: string; riders: Set<string>; ev: number[]; hold: number; tau: number; along: number; kF: number; box: { x0: number; x1: number; y0: number; y1: number } | null } | null = null; private kG = 1;
  /** 学生自己缩放、拖动后的镜头；null 表示用自动取景。overview：不跟随，看这一问的全景 */
  private manual: { k: number; ox: number; oy: number } | null = null; private overview = false; private followPlan: Scene2D['follow'] = null;
  constructor(private element: HTMLElement) {
    this.canvas.className = 'scene2d'; element.prepend(this.canvas);
    this.qaOn = typeof location !== 'undefined' && /[?&]qa\b/.test(location.search); this.hookText();
  }
  /** 质检记录（只在网址带 ?qa 时打开）：每帧记下画了哪些字、物体、箭头，交给 tests/质检 的脚本判断有没有重叠、出画面等 */
  qa: QaFrame | null = null; private qaOn = false; private qaInset = false; private qaAnchor: [number, number] = [0, 0];
  private hookText() {
    const g = this.g, raw = g.fillText.bind(g);
    g.fillText = (text: string, x: number, y: number, mw?: number) => {
      g.save(); g.font = readableFont(g.font);
      if (this.sim?.board || /^#(?:fff|ffffff)$/i.test(String(g.fillStyle))) g.fillStyle = INK;
      g.lineJoin = 'round'; g.lineWidth = 2; g.strokeStyle = PAPER; g.strokeText(text, x, y);
      const f = this.qa; if (this.qaOn && f && text.trim()) {
        const m = g.getTransform(), d = Math.min(devicePixelRatio || 1, 2), w = g.measureText(text).width, size = +(/(\d+(?:\.\d+)?)px/.exec(g.font)?.[1] ?? 13);
        const al = g.textAlign, x0 = al === 'center' ? x - w / 2 : al === 'right' || al === 'end' ? x - w : x;
        const X = (m.a * x0 + m.c * y + m.e) / d, Y = (m.b * x0 + m.d * y + m.f) / d, rot = Math.abs(m.b) > 1e-6;
        f.texts.push({ s: text, x: X, y: Y - size * .8, w: w * m.a / d, h: size, color: String(g.fillStyle), inset: this.qaInset, rot, outline: PAPER, outlineWidth: 2, font: g.font });
      }
      mw === undefined ? raw(text, x, y) : raw(text, x, y, mw); g.restore();
    };
  }
  /** 以屏幕上 (x, y) 为中心缩放 */
  zoomBy(f: number, x = this.w / 2, y = this.h / 2) {
    if (!this.sim || this.sim.board?.flat) return;
    const m = this.manual ?? { k: this.k, ox: this.ox, oy: this.oy }, k = Math.min(Math.max(m.k * f, this.autoK * .2), this.autoK * 40), r = k / m.k;
    this.manual = { k, ox: x - (x - m.ox) * r, oy: y - (y - m.oy) * r }; this.resize(k);
  }
  panBy(dx: number, dy: number) { if (!this.sim || this.sim.board?.flat) return; const m = this.manual ?? { k: this.k, ox: this.ox, oy: this.oy }; this.manual = { ...m, ox: m.ox + dx, oy: m.oy + dy }; }
  /** 回到自动取景（有跟随就跟随） */
  resetView() { this.manual = null; this.lastK = 0; if (this.overview) this.setOverview(false); }
  /** 全景：不推近跟随，整段运动一起看 */
  setOverview(on: boolean) { this.overview = on; this.manual = null; this.lastK = 0; this.follow = on ? null : this.followPlan; this.f = this.follow ? this.followF! : this.f0; this.bcache = null; this.makeGhosts(); }
  get camState() { return { manual: !!this.manual, canFollow: !!this.followPlan, overview: this.overview }; }
  private autoK = 1; private followF: Frame | null = null; private gapMin = Infinity;
  /** 图标半径上限（像素）：保证相邻质点之间留出间隙 */
  private capPx(k: number) { return Math.max(5, this.gapMin * k * .36); }
  /** 画出来的物体大小：真实尺寸放大到至少看得清，太大的按真实尺寸 */
  private resize(k: number) { if (this.follow) return; const r = this.iconRadius(k); this.f = { ...this.f0, body: r * 2 / k, thick: Math.min(this.f0.thick, 12 / k) }; this.makeGhosts(); }
  prepare(sim: SimResult, w0: number, w1: number) {
    this.manual = null; this.overview = false; this.followPlan = null; this.followF = null;
    this.sim = sim; this.w0 = w0; this.w1 = w1; this.f = this.f0 = fitFrame(sim, w0, w1); this.lastK = 0; this.bcache = null; this.riddenCache.clear(); this.lastSpot.clear(); this.lineOrder.clear();
    const snaps = sim.samples.filter((s) => s.t >= w0 && s.t <= w1);
    this.vmax = Math.max(1e-6, ...snaps.flatMap((s) => Object.values(s.bodies).map((b) => Math.hypot(b.vx, b.vy))));
    this.fmax = forceMax(sim, w0, w1, (id) => this.isAnchor(id)); this.fmaxKey = '';
    // 频闪残影的位置只算一次，播放时按时间取用
    this.snaps = snaps;
    // 同一支撑面上相邻质点的最小间距：画大的图标不能把间隙盖住（间距、先后、是否相碰常是考点）
    // 有真实长度的物块也算：画大的示意图标同样不能盖住它们之间的间隙；图标不小于真实大小，所以真实大小本身不会互相压住
    this.gapMin = Infinity; const s0 = snaps[0] ?? sim.start, pts = sim.geo.bodies.filter((q) => q.kind !== 'board' && s0.bodies[q.id]?.on);
    // 取整段里的最近距离（弹簧压缩、追近时间隙会变小）；会碰上、贴在一起的一对仍按开始时的距离，免得图标被压到看不见
    const st = Math.max(1, Math.floor(snaps.length / 200));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const A = pts[i], B = pts[j], a = s0.bodies[A.id], b = s0.bodies[B.id]; if (a.on !== b.on) continue;
      const d0 = Math.hypot(a.x - b.x, a.y - b.y); let dm = d0;
      for (let k = 0; k < snaps.length; k += st) { const p = snaps[k].bodies[A.id], q = snaps[k].bodies[B.id]; if (p && q && p.on === q.on) dm = Math.min(dm, Math.hypot(p.x - q.x, p.y - q.y)); }
      const d = dm - ((A.L || 0) + (B.L || 0)) / 2 > 1e-6 * Math.max(1, d0) ? dm : d0; if (d > 1e-9) this.gapMin = Math.min(this.gapMin, d);
    }
    this.makeGhosts();
    const ground = sim.geo.surfaces.find((q) => q.kind === 'ground');
    this.supports = ground ? supportPlan(sim, { ...this.f, thick: 0 }, ground.y!) : null;
    this.follow = null; this.snap = undefined;
    for (let i = 0; i < 4; i++) { const k = this.k; this.fit(); if (Math.abs(this.k - k) < this.k * .01) break; }
    this.setupFollow();
  }
  /** 本问的几何外框，不依赖画布高度或像素比例。 */
  get contentRatio() { const c = this.f0?.content; return c ? (c.x1 - c.x0) / Math.max(c.y1 - c.y0, 1e-30) : 1; }
  private iconRadius(k: number) { const flat=this.contentRatio>3.2; return Math.min(Math.max(this.f0.body*k/2,flat?flatIconRadius(this.h):12),flat?28:19,this.capPx(k)); }
  private isContainer(id: string | null | undefined) { const q = id ? this.sim!.geo.bodies.find((b) => b.id === id) : undefined; return !!q && q.kind === 'board' && q.walls?.left !== undefined && q.walls?.right !== undefined; }
  /**
   * 跟随镜头（通用规则）：带着别的物体走的木板、可动轨道、容器，在整段运动的取景里画得太小（看不清上面发生什么）时，
   * 镜头推近跟着它走：离和它有关的事件近时推近，长途运动时拉远。取最大的那个。
   */
  private setupFollow() {
    const sim = this.sim!; if (sim.board || sim.circuit || sim.script || !this.w) return;
    const hostOf = (on: string | null | undefined) => on ? sim.geo.surfaces.find((s) => s.id === on)?.host ?? on : null;
    let best: { q: SimResult['geo']['bodies'][number]; riders: Set<string>; ext: number; box: ReturnType<typeof hostBox>; avail: number } | null = null;
    for (const q of sim.geo.bodies) {
      if (q.kind !== 'board' || q.look) continue;
      const riders = new Set(sim.geo.bodies.filter((r) => r.id !== q.id && this.snaps.some((p) => hostOf(p.bodies[r.id]?.on) === q.id)).map((r) => r.id)); if (!riders.size) continue;
      const box = hostBox(sim, q.id, this.f0.size), ext = box ? Math.max(box.x1 - box.x0, box.y1 - box.y0) : q.L; if (!(ext > 0)) continue;
      const b0 = sim.start.bodies[q.id], steep = !box && Math.abs(Math.sin(b0?.ang ?? 0)) > .7, avail = steep ? this.h - 74 : Math.min(this.w - 92, box ? this.h - 74 : Infinity);
      if (ext * this.k > Math.min(120, avail * .2)) continue;   // 本来就看得清
      if (!best || ext > best.ext) best = { q, riders, ext, box, avail };
    }
    if (!best) return;
    const { q, riders, ext, box, avail } = best, who = new Set([q.id, ...riders]), span = this.w1 - this.w0;
    const ev = sim.events.filter((e) => (who.has(e.a) || (e.b !== undefined && who.has(e.b))) && !['start', 'end', 'time', 'mark'].includes(e.type)).map((e) => e.t);
    this.kG = this.k;
    const kF = Math.max(this.k, avail * (box ? .45 : .3) / ext);
    this.follow = this.followPlan = { id: q.id, riders, ev, hold: span * .05, tau: span * .14, along: box ? 0 : q.L, kF, box };
    const r = Math.min(Math.max(this.f0.body * kF / 2, 12), 19, this.capPx(kF));
    this.f = this.followF = { ...this.f0, body: r * 2 / kF, thick: Math.min(this.f0.thick, 10 / kF) };
    this.makeGhosts();
  }
  /** 推近程度 0–1：离跟这个容器有关的事件越近越推近 */
  private zoomAt(t: number) {
    const F = this.follow!; if (!F.ev.length) return 1;
    let d = Infinity; for (const te of F.ev) d = Math.min(d, Math.abs(t - te));
    if (d <= F.hold) return 1; const u = Math.max(0, 1 - (d - F.hold) / F.tau); return u * u * (3 - 2 * u);
  }
  private followView(b: { x0: number; x1: number; y0: number; y1: number }, mx: number, top: number, bottom: number) {
    const F = this.follow!, s = this.snap && this.snap.bodies[F.id] ? this.snap : this.sim!.start, h = s.bodies[F.id], z = this.zoomAt(s.t);
    this.kG = Math.min((this.w - mx * 2) / Math.max(b.x1 - b.x0, 1e-30), (this.h - top - bottom) / Math.max(b.y1 - b.y0, 1e-30));
    let k = this.kG * Math.pow(Math.max(F.kF, this.kG) / this.kG, z); this.k = this.ky = k;
    const up = (this.f.thick + this.cavity(F.id, s)) / 2, ca = Math.cos(h.ang), sa = Math.sin(h.ang);
    let cx = F.box ? h.x + (F.box.x0 + F.box.x1) / 2 : h.x + ca * F.along / 2 - sa * up, cy = F.box ? h.y + (F.box.y0 + F.box.y1) / 2 : h.y + sa * F.along / 2 + ca * up;
    // 推近时，还在动、又不在被跟随物体上的物体（还没滑上木板、已经飞离的）也要在画面里：放不下就连续地拉远，最远拉到全景
    const sim = this.sim!, hostOf = (on: string | null | undefined) => on ? sim.geo.surfaces.find((q) => q.id === on)?.host ?? on : null;
    let kFit = Infinity; const W2 = (this.w - mx * 2) / 2 - 24, H2 = (this.h - top - bottom) / 2 - 24;
    for (const q of sim.geo.bodies) { const p = s.bodies[q.id]; if (q.id === F.id || q.kind === 'board' || !p || hostOf(p.on) === F.id || Math.hypot(p.vx, p.vy) < 1e-9) continue; const dx = Math.abs(p.x - cx), dy = Math.abs(p.y - cy); if (dx > 0) kFit = Math.min(kFit, W2 / dx); if (dy > 0) kFit = Math.min(kFit, H2 / dy); }
    if (kFit < k) { k = Math.max(this.kG, kFit); this.k = this.ky = k; }
    const hw = (this.w - mx * 2) / 2 / k, hh = (this.h - top - bottom) / 2 / k;
    cx = b.x1 - b.x0 > 2 * hw ? Math.min(b.x1 - hw, Math.max(b.x0 + hw, cx)) : (b.x0 + b.x1) / 2;
    cy = b.y1 - b.y0 > 2 * hh ? Math.min(b.y1 - hh, Math.max(b.y0 + hh, cy)) : (b.y0 + b.y1) / 2;
    this.ox = this.w / 2 - cx * k; this.oy = top + (this.h - top - bottom) / 2 + cy * k;
  }
  /** 容器内腔的宽度（世界单位）：装得下里面最大的物体 */
  private cavity(id: string, s: Snapshot) {
    let m = 0; for (const q of this.sim!.geo.bodies) if (q.id !== id && (s.bodies[q.id]?.on === id || this.follow?.riders.has(q.id))) m = Math.max(m, q.L || this.f.body);
    return m * 1.3;
  }
  /** 实验室画面的取景：按实际画出来的东西（图元和轨迹）定，声明的视野太空就收紧，轨迹跑出视野就放宽 */
  private boardBounds() {
    const bd = this.sim!.board!, v = bd.view, out = { x0: v[0], y0: v[1], x1: v[2], y1: v[3] };
    if (bd.flat) return out;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, wide = false;
    // 图元只在声明的视野里算（有的区域画到很远）；轨迹可以把视野往外撑，最多撑出四成
    const vw = v[2] - v[0], vh = v[3] - v[1], lim = (x: number, y: number, k: number): [number, number] => [Math.min(v[2] + vw * k, Math.max(v[0] - vw * k, x)), Math.min(v[3] + vh * k, Math.max(v[1] - vh * k, y))];
    const put = (x: number, y: number, k: number) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; [x, y] = lim(x, y, k); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    const add = (x: number, y: number) => put(x, y, 0);
    const prim = (q: Prim) => {
      if (q.k === 'line') for (const p of q.p) add(p[0], p[1]);
      else if (q.k === 'circle') { const r = q.r ?? 0; add(q.at[0] - r, q.at[1] - r); add(q.at[0] + r, q.at[1] + r); }
      else if (q.k === 'rect') { add(q.x0, q.y0); add(q.x1, q.y1); }
      else if (q.k === 'text') add(q.at[0], q.at[1]);
      else if ('x0' in q) { const r = q as unknown as { x0: number; y0: number; x1: number; y1: number }; if (r.x1 - r.x0 >= (v[2] - v[0]) * .98 && r.y1 - r.y0 >= (v[3] - v[1]) * .98) wide = true; else { add(r.x0, r.y0); add(r.x1, r.y1); } }
      else if ('at' in q) { const a = (q as unknown as { at: number[] }).at; add(a[0], a[1]); }
    };
    for (const q of bd.stat ?? []) prim(q);
    const ss = this.sim!.samples, st = Math.max(1, Math.floor(ss.length / 40));
    for (let i = 0; i < ss.length; i += st) for (const q of ss[i].draw ?? []) prim(q);
    for (const q of this.sim!.end.draw ?? []) prim(q);
    for (const p of bd.paths ?? []) for (const pt of p.pts) put(pt[0], pt[1], .4);
    if (!(x1 > x0) && !(y1 > y0)) return out;
    if (wide) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[2]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[3]); }
    const w = Math.max(x1 - x0, (y1 - y0) * .3, 1e-30), h = Math.max(y1 - y0, (x1 - x0) * .3, 1e-30), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const c = { x0: cx - w * .58, x1: cx + w * .58, y0: cy - h * .6, y1: cy + h * .62 };
    const inside = c.x0 >= v[0] && c.x1 <= v[2] && c.y0 >= v[1] && c.y1 <= v[3];
    if (inside) return (c.x1 - c.x0) * (c.y1 - c.y0) < .55 * (v[2] - v[0]) * (v[3] - v[1]) ? c : out;
    return { x0: Math.min(v[0], c.x0), y0: Math.min(v[1], c.y0), x1: Math.max(v[2], c.x1), y1: Math.max(v[3], c.y1) };
  }
  private makeGhosts() {
    this.paths = []; const stride = Math.max(1, Math.floor(this.snaps.length / 500));
    this.sim!.geo.bodies.forEach((q, i) => { if (q.kind === 'board') return; const pts = this.snaps.filter((p, k) => k % stride === 0 && !p.bodies[q.id]?.on && p.bodies[q.id]).map((p) => [p.bodies[q.id].x, p.bodies[q.id].y, p.t]); if (pts.length > 1) this.paths.push({ color: COLORS[i % COLORS.length], pts }); });
    const sim = this.sim!, every = Math.max(.001, (this.w1 - this.w0) / 14); this.ghosts = [];
    sim.geo.bodies.forEach((q, i) => { if (q.kind === 'board' || this.follow?.riders.has(q.id)) return; let next = this.w0; for (const p of this.snaps) if (p.t >= next && p.bodies[q.id]) { next = p.t + every; const b = bodyPose(sim, this.f, q.id, p); this.ghosts.push({ t: p.t, c: b.c, size: q.look ? 0 : b.size, color: COLORS[i % COLORS.length], ball: q.kind === 'ball' || !!q.look }); } });
  }
  private bcache: { x0: number; x1: number; y0: number; y1: number } | null = null;
  private bounds() { return this.bcache ??= this.computeBounds(); }
  private computeBounds() {
    if (this.sim!.board) return this.boardBounds();
    const c = this.f.content; let [x0, x1, y0, y1] = [c.x0, c.x1, c.y0, c.y1];
    for (const s of [this.sim!.start, this.sim!.end]) if (s.script) {
      for (const l of s.script.links) for (const p of [l.a, l.b]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      for (const q of s.script.curves) for (const p of q.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    }
    if (this.sim!.circuit) { const ps = Object.values(this.sim!.circuit.nodes); return { x0: Math.min(...ps.map((p) => p[0])), x1: Math.max(...ps.map((p) => p[0])), y0: Math.min(...ps.map((p) => p[1])), y1: Math.max(...ps.map((p) => p[1])) }; }
    for (const f of this.sim!.em ?? []) { const q = f.rect ?? (f.circle ? [f.circle[0] - f.circle[2], f.circle[1] - f.circle[2], f.circle[0] + f.circle[2], f.circle[1] + f.circle[2]] : f.at ? [f.at[0], f.at[1], f.at[0], f.at[1]] : null); if (q && q[2] - q[0] < 1e4 * (x1 - x0 || 1)) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[2]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[3]); } }
    for (const r of this.sim!.ropes ?? []) for (const p of r.via) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    // 只看运动发生的地方：很长的轨道不把动作压得很小；带着轨道走的方框要完整
    // 被跟随的容器、木板和里面的物体不画残影，但它们走过的地方同样要算进取景
    const extra: V2[] = [];
    if (!this.sim!.script && !this.sim!.em?.length) for (let i = 0; i < this.snaps.length; i += Math.max(1, Math.floor(this.snaps.length / 60))) for (const q of this.sim!.geo.bodies) {
      const p = this.snaps[i].bodies[q.id]; if (!p || (q.kind !== 'board' && !this.follow?.riders.has(q.id))) continue;
      if (q.kind === 'board') { const L = Math.min(q.L, this.f.span * 1.6); extra.push([p.x, p.y], [p.x + L * Math.cos(p.ang), p.y + L * Math.sin(p.ang)]); } else extra.push([p.x, p.y]);
    }
    if ((this.ghosts.length || extra.length) && !this.sim!.script && !this.sim!.em?.length) {
      const xs = [...this.ghosts.map((g) => g.c[0]), ...extra.map((p) => p[0])], ys = [...this.ghosts.map((g) => g.c[1]), ...extra.map((p) => p[1])];
      for (const q of this.sim!.geo.bodies) if (q.kind === 'board') { const box = hostBox(this.sim!, q.id, this.f.size); if (box) for (const p of this.snaps.filter((_, i) => i % 10 === 0)) { const b = p.bodies[q.id]; xs.push(b.x + box.x0, b.x + box.x1); ys.push(b.y + box.y0, b.y + box.y1); } }
      const a = Math.min(...xs), b = Math.max(...xs), c = Math.min(...ys), d = Math.max(...ys), pad = Math.max(Math.max(b - a, d - c) * .35, this.f.body * 3);
      const ground = this.sim!.geo.surfaces.find((q) => q.kind === 'ground');
      // 贴着地面时地下只留一点（约两个物体大小）
      const out = { x0: Math.max(x0, a - pad), x1: Math.min(x1, b + pad), y0: ground && c - ground.y! < Math.max(d - c, b - a, this.f.body * 8) * 1.2 ? Math.max(y0, Math.min(c - pad, ground.y!), ground.y! - Math.max(this.f.body * 2, (d - c) * .08)) : Math.max(y0, c - pad), y1: Math.min(y1, d + pad) };
      // 速度箭头的尖（连同名字）也要在画面里：按当前比例把箭头长度换成世界长度，取景时算进去
      if (this.flags.velocity && this.k > 0 && Number.isFinite(this.k)) {
        const st = Math.max(1, Math.floor(this.snaps.length / 120));
        for (let i = 0; i < this.snaps.length; i += st) for (const q of this.sim!.geo.bodies) {
          const p = this.snaps[i].bodies[q.id]; if (q.kind === 'board' || !p || this.follow?.riders.has(q.id)) continue;
          const v = Math.hypot(p.vx, p.vy); if (v <= this.vmax * .01) continue;
          const L = ((24 + v / this.vmax * 74) * this.arrowK + 30) / this.k, tx = p.x + p.vx / v * L, ty = Math.max(p.y + p.vy / v * L, ground ? ground.y! - 12 / this.k : -Infinity);   // 指向地下的箭头不把取景往地下撑
          out.x0 = Math.min(out.x0, tx); out.x1 = Math.max(out.x1, tx); out.y0 = Math.min(out.y0, ty); out.y1 = Math.max(out.y1, ty);
        }
      }
      return out;
    }
    return { x0, x1, y0, y1 };
  }
  private fit() {
    const r = this.element.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    if (this.canvas.width !== Math.round(r.width * d) || this.canvas.height !== Math.round(r.height * d)) { this.canvas.width = Math.round(r.width * d); this.canvas.height = Math.round(r.height * d); }
    this.g.setTransform(d, 0, 0, d, 0, 0);
    if (!this.sim) return;
    // 底部留出浮在画面上的控件（镜头按钮栏）的高度，物体不跑到按钮底下
    const under = this.reserved.filter((r) => r.y + r.h > this.h - 24 && r.y > this.h * .6).reduce((m, r) => Math.max(m, this.h - r.y), 0);
    const b = this.bounds(), bw = Math.max(b.x1 - b.x0, 1e-30), bh = Math.max(b.y1 - b.y0, 1e-30), mx = this.sim.circuit ? 90 : 46, top = this.sim.circuit ? 56 : 40, bottom = Math.max(this.sim.circuit ? 44 : 34, under + 6);
    const right = 0;
    const rightB = 0;
    this.k = Math.min((this.w - mx * 2 - right - rightB) / bw, (this.h - top - bottom) / bh); this.ky = this.k;
    if (this.sim.board?.flat) { this.k = (this.w - mx * 2) / bw; this.ky = (this.h - top - bottom) / bh; this.ox = mx - b.x0 * this.k; this.oy = top + b.y1 * this.ky; return; }
    if (this.follow) { this.followView(b, mx, top, bottom); this.autoK = this.k; this.applyManual(); return; }
    this.ox = mx + ((this.w - mx * 2 - right - rightB) - bw * this.k) / 2 - b.x0 * this.k;
    // 内容垂直居中；扁场景的可读图标在接触面上方，按显示后的图标高度居中。
    this.oy = top + ((this.h - top - bottom) - bh * this.k) * .5 + b.y1 * this.k;
    if (this.contentRatio > 3.2 && !this.sim.board && !this.sim.circuit && !this.sim.script) this.oy += this.iconRadius(this.k) * .65;
    if (!this.manual && Math.abs(this.k - this.lastK) > this.k * .01) {
      this.lastK = this.k;
      const r = this.iconRadius(this.k);
      this.f = { ...this.f0, body: r * 2 / this.k, thick: Math.min(this.f0.thick, 12 / this.k) };
      this.makeGhosts(); this.bcache = null;
    }
    this.autoK = this.k; this.applyManual();
  }
  private applyManual() { const m = this.manual; if (m) { this.k = this.ky = m.k; this.ox = m.ox; this.oy = m.oy; } }
  /** 箭头长度随画面大小缩放：手机上的小画面箭头短一些，不把画面撑得太空 */
  private fmaxKey = '';
  /** 同向箭头上一帧的先后（见 layoutForceLines） */
  private lineOrder = new Map<string, number>();
  private get arrowK() { return arrowScale(this.w); }
  private px = (x: number) => this.ox + x * this.k;
  private py = (y: number) => this.oy - y * this.ky;
  update(s: Snapshot) { this.snap = s; }
  predictionOrigin: string | null = null;
  setFocus(id: string | null) { this.focusId = id; }
  /** 每个物体的质量记号（题目写的是字母时用它，重力标成 Mg、m_A g） */
  private massSym: Record<string, string> = {};
  setMasses(m: Record<string, string>) { this.massSym = m; }
  /** 物体在画面上的中心：竖着的容器取管子的中心 */
  private centerOf(id: string, s: Snapshot): V2 | null {
    const c = this.screenOf(id); if (!c || !this.isContainer(id) || !s.bodies[id]) return c;
    const pose = bodyPose(this.sim!, this.f, id, s); if (Math.abs(Math.sin(pose.ang)) <= .7) return c;
    const r0 = Math.max(9, pose.size * this.k) / 2 + Math.max(this.cavity(id, s) * this.k, 10) / 2; return [c[0] - Math.sin(pose.ang) * r0, c[1] - Math.cos(pose.ang) * r0];
  }
  /** 这一步要在画面上标什么：谁的受力、谁的位移、两物体的间距 */
  setOverlay(o: { forces: string[]; spans: string[]; gap?: [string, string]; label?: string; from: number }) { const changed=!!this.over.forces.length!==!!o.forces.length;this.over=o;if(changed&&this.sim){this.resize(this.k);this.bcache=null;} }
  /** 这一问的考点（AI 标的角度、长度、间距）：画准，并标出真实数值 */
  private keep: { angle?: string; length?: string; gap?: [string, string] }[] = [];
  setKeep(k: Scene2D['keep'] | undefined) { this.keep = k ?? []; }
  toggle(flag: Flag, on: boolean) { this.flags[flag] = on; this.bcache = null; if(this.sim&&flag==='force')this.resize(this.k); }
  setView() { /* 二维只有一个视角 */ }
  screenOf(id: string): V2 | null {
    if (!this.snap?.bodies[id] || !this.sim) return null;
    const c = bodyPose(this.sim, this.f, id, this.snap).c; return [this.px(c[0]), this.py(c[1])];
  }
  render(now: number) {
    if (!this.sim || !this.snap) return;
    this.fit();
    if (this.qaOn) this.qa = { t: this.snap.t, w: this.w, h: this.h, k: this.k, ky: this.ky, ox: this.ox, oy: this.oy, bounds: this.bcache, mode: this.sim.board ? 'lab' : this.sim.circuit ? 'circuit' : this.sim.script ? 'script' : 'bodies', follow: !!this.follow, focus: this.focusId, texts: [], bodies: [], arrows: [], forceArrows: [], nameDots: [], obstacles: [], labels: [], forced: 0, dropped: 0, keep: [], inset: null };
    const g = this.g, s = this.snap; g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = PAPER; g.fillRect(0, 0, this.w, this.h); this.taken = [...this.reserved]; this.labels = [];
    this.dots();
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (this.sim.board) {
      const bd = this.sim.board; this.prims(bd.stat ?? []); this.notesArt();
      for (const p of bd.paths ?? []) { let n = 0; while (n < p.pts.length && p.pts[n][2] <= s.t) n++; if (n > 1) { g.strokeStyle = p.c; g.lineWidth = p.w ?? 2; g.setLineDash(p.dash ?? []); g.beginPath(); for (let i = 0; i < n; i++) { const x = this.px(p.pts[i][0]), y = this.py(p.pts[i][1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); g.setLineDash([]); } }
      this.prims(s.draw ?? []); this.flushLabels(); return;
    }
    this.fieldsArt();
    if (this.sim.circuit) { this.circuit(s, now); this.flushLabels(); return; }
    for (const q of this.sim.geo.bodies) if (q.kind !== 'board') { const c = this.screenOf(q.id), r = s.bodies[q.id] ? this.radiusOf(q.id, s) : 0; if (c) this.taken.push({ x: c[0] - r - 2, y: c[1] - r - 2, w: 2 * r + 4, h: 2 * r + 4 }); }
    this.bases(); this.pointNames.clear(); this.notesArt();
    for (const q of this.sim.geo.surfaces) this.surface(q, s);
    if (this.flags.trail) this.trails(s);
    for (const c of this.sim.fields ?? []) { const x = this.px(c.x), y = this.py(c.y), R = 26, gr = this.g.createRadialGradient(x - 8, y - 8, 3, x, y, R); gr.addColorStop(0, '#9fc6ee'); gr.addColorStop(1, '#2d5f93'); this.g.fillStyle = gr; this.g.beginPath(); this.g.arc(x, y, R, 0, 7); this.g.fill(); this.g.strokeStyle = INK; this.g.lineWidth = 1.5; this.g.stroke(); }
    this.script(s);
    this.ropes(s);
    this.springs(s);
    this.sim.geo.bodies.forEach((q, i) => this.body(q.id, i, s));
    for (const q of this.sim.geo.bodies) this.vectors(q.id, s);
    this.overlayArt(s); this.drawForces(s);
    this.keepArt(s);
    this.originArt();
    this.scaleBar();
    const ins = this.flags.inset ? this.planInset(s) : null; if (ins) this.taken.push({ x: ins.R.x - 6, y: ins.R.y - 6, w: ins.R.w + 12, h: ins.R.h + 12 });
    this.flushLabels();
    if (ins) this.drawInset(s, ins);
  }
  /** 用世界坐标记住起点，缩放和平移时仍固定在地面上。 */
  private originArt() {
    const id = this.predictionOrigin, sim = this.sim!;
    if (!id || !sim.start.bodies[id]) return;
    const b = sim.start.bodies[id], x = this.px(b.x), y = this.py(b.y), g = this.g;
    g.strokeStyle = SOFT; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x, y + 20); g.stroke();
    const text = '起点', w = 30;
    this.labels.push({ x: x - w / 2, y: y + 23, w, h: 18, pri: 0, near: true, key: 'prediction-origin', optional: false, draw: (a, b) => this.text(text, a + w / 2, b + 14, `13px ${CJK}`, SOFT) });
  }
  /** 网页浮在画面上的控件（镜头按钮等）占的位置：文字不放在那里 */
  private reserved: { x: number; y: number; w: number; h: number }[] = [];
  setReserved(r: { x: number; y: number; w: number; h: number }[]) { this.reserved = r; }
  /** 画面上离 (x, y) 最近、放得下 w×h 又不压住物体和文字的位置（给“所求”框这类网页浮层用）；找不到返回 null */
  freeSpot(x: number, y: number, w: number, h: number): [number, number] | null {
    const hit = (a: number, b: number) => this.taken.some((r) => a < r.x + r.w && a + w > r.x && b < r.y + r.h && b + h > r.y);
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -240; dy <= 240; dy += 12) for (let dx = -320; dx <= 320; dx += 12) {
      const a = x + dx, b = y + dy; if (a < 6 || b < 6 || a + w > this.w - 6 || b + h > this.h - 6) continue;
      const d = Math.hypot(dx, dy * 1.2); if (d < bd && !hit(a, b)) { bd = d; best = [a, b]; }
    }
    return best;
  }
  /** 考点标注：倾角画角弧写度数，长度画尺寸线写真实长度，间距画随时间变化的尺寸线 */
  private keepArt(s: Snapshot) {
    const g = this.g, sim = this.sim!, C = '#a3329a';
    for (const k of this.keep) {
      if (k.angle) {
        const q = sim.geo.surfaces.find((x) => x.id === k.angle); if (!q || q.kind !== 'seg') continue;
        const o = offsetOf(q, s), a: V2 = [q.p0![0] + o[0], q.p0![1] + o[1]], b: V2 = [q.p1![0] + o[0], q.p1![1] + o[1]], low = a[1] <= b[1] ? a : b, high = low === a ? b : a;
        const th = Math.atan2(Math.abs(high[1] - low[1]), Math.abs(high[0] - low[0])), dir = high[0] >= low[0] ? 1 : -1, x = this.px(low[0]), y = this.py(low[1]), r = 34;
        this.qa?.keep.push({ kind: 'angle', id: k.angle, real: th * 180 / Math.PI, screen: Math.atan2(Math.abs(this.py(high[1]) - y), Math.abs(this.px(high[0]) - x)) * 180 / Math.PI, x, y });
        g.strokeStyle = C; g.lineWidth = 1.6; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, y); g.lineTo(x + dir * (r + 22), y); g.stroke(); g.setLineDash([]);
        g.beginPath(); if (dir > 0) g.arc(x, y, r, -th, 0); else g.arc(x, y, r, Math.PI, Math.PI + th); g.stroke();
        const m = th / 2; this.block(x, y, x + dir * (r + 22), y); this.quantity(`θ = ${+(th * 180 / Math.PI).toFixed(1)}°`, x + dir * Math.cos(m) * (r + 8) + (dir < 0 ? -70 : 0), y - Math.sin(m) * (r + 8) + 4, C, 'left', true, false, undefined, 0);
      }
      if (k.length) {
        const q = sim.geo.surfaces.find((x) => x.id === k.length), bd = sim.geo.bodies.find((x) => x.id === k.length);
        let a: V2 | null = null, b: V2 | null = null, L = 0;
        if (q?.kind === 'seg') { const o = offsetOf(q, s); a = [q.p0![0] + o[0], q.p0![1] + o[1]]; b = [q.p1![0] + o[0], q.p1![1] + o[1]]; L = Math.hypot(b[0] - a[0], b[1] - a[1]); }
        else if (bd && s.bodies[bd.id]) { const p = s.bodies[bd.id]; L = bd.L; a = [p.x, p.y]; b = [p.x + L * Math.cos(p.ang), p.y + L * Math.sin(p.ang)]; }
        if (a && b && this.qa) this.qa.keep.push({ kind: 'length', id: k.length, real: L, screen: Math.hypot(this.px(b[0]) - this.px(a[0]), this.py(b[1]) - this.py(a[1])) / this.k, x: this.px((a[0] + b[0]) / 2), y: this.py((a[1] + b[1]) / 2) });
        if (a && b) this.dimension(a, b, `${/^[A-Za-z]/.test(k.length) ? `L_${k.length}` : 'L'} = ${fmtLen(L)}`, C, 30);
      }
      if (k.gap) {
        const [ia, ib] = k.gap, A = s.bodies[ia], B = s.bodies[ib]; if (!A || !B) continue;
        const pa = bodyPose(sim, this.f, ia, s).c, pb = bodyPose(sim, this.f, ib, s).c;
        this.dimension(pa, pb, `d = ${fmtLen(Math.hypot(A.x - B.x, A.y - B.y))}`, C, this.radiusOf(ia, s) + 30);
      }
    }
  }
  /**
   * 放大镜小窗（通用规则）：所求物体附近有画得太小的结构——短轨道、小圆弧、小木板，或贴得很近的另一个物体——
   * 在角上按比例放大那一块，标出倍数；主画面上框出放大的位置。学生自己放大到看得清时就不再出现。
   */
  private planInset(s: Snapshot) {
    const id = this.focusId, sim = this.sim!; if (!id || !s.bodies[id] || sim.board || sim.circuit || sim.script || this.w < 420) return null;
    // 只放大小物体：木板、轨道这类大东西本身就看得清，放大它只会框出一块空地方
    if (sim.geo.bodies.find((q) => q.id === id)?.kind === 'board' || this.isAnchor(id)) return null;
    const c = bodyPose(sim, this.f, id, s).c, near = 60 / this.k;
    let feat = Infinity;
    const segDist = (p: V2, a: V2, b: V2) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-30, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    for (const q of sim.geo.surfaces) {
      if (q.kind === 'ground' || q.tether || q.rails !== undefined) continue;
      const o = offsetOf(q, s);
      if (q.kind === 'seg') { const a: V2 = [q.p0![0] + o[0], q.p0![1] + o[1]], b: V2 = [q.p1![0] + o[0], q.p1![1] + o[1]]; if (segDist(c, a, b) < near) feat = Math.min(feat, Math.hypot(b[0] - a[0], b[1] - a[1])); }
      else if (q.R) { const d = Math.abs(Math.hypot(c[0] - q.c![0] - o[0], c[1] - q.c![1] - o[1]) - q.R); if (d < near) feat = Math.min(feat, q.R * 2); }
    }
    const rr = this.radiusOf(id, s) / this.k;
    for (const q of sim.geo.bodies) {
      if (q.id === id || !s.bodies[q.id]) continue;
      if (q.kind === 'board') { const box = hostBox(sim, q.id, this.f.size), ext = box ? Math.max(box.x1 - box.x0, box.y1 - box.y0) : q.L, p = s.bodies[q.id]; if (Math.hypot(p.x - c[0], p.y - c[1]) < ext + near) feat = Math.min(feat, ext); continue; }
      const d = Math.hypot(s.bodies[q.id].x - s.bodies[id].x, s.bodies[q.id].y - s.bodies[id].y); if (d > 1e-9 && d < rr * 3) feat = Math.min(feat, d);
    }
    if (!(feat * this.k < 28) || !(feat > 0)) return null;
    const z = Math.min(Math.max(90 / (feat * this.k), 2.5), 12), W = Math.min(220, this.w * .32), H = W * .75, fc = this.screenOf(id)!;
    // 四个角里挑盖住东西最少的（物体、已经放好的文字、所求物体本身），同样少时先右上
    const cover = (R: { x: number; y: number; w: number; h: number }) => { let n = 0; for (const r of this.taken) { const ow = Math.min(R.x + R.w, r.x + r.w) - Math.max(R.x, r.x), oh = Math.min(R.y + R.h, r.y + r.h) - Math.max(R.y, r.y); if (ow > 0 && oh > 0) n += ow * oh; } if (fc[0] > R.x - 30 && fc[0] < R.x + R.w + 30 && fc[1] > R.y - 30 && fc[1] < R.y + R.h + 30) n += 1e6; return n; };
    const corners = [{ x: this.w - W - 12, y: 12 }, { x: 12, y: 12 }, { x: this.w - W - 12, y: this.h - H - 50 }, { x: 12, y: this.h - H - 40 }].map((p) => ({ ...p, w: W, h: H }));
    const R = corners.reduce((a, b) => cover(b) < cover(a) ? b : a);
    return { R, z, c, fc };
  }
  /** 放大镜小窗（通用规则）：所求物体附近有画得太小的结构——短轨道、小圆弧、小木板，或贴得很近的另一个物体——
   * 在角上按比例放大那一块，标出倍数；主画面上框出放大的位置。学生自己放大到看得清时就不再出现。 */
  private drawInset(s: Snapshot, P: { R: { x: number; y: number; w: number; h: number }; z: number; c: V2; fc: V2 }) {
    const sim = this.sim!, { R, z, c, fc } = P, W = R.w, H = R.h;
    const save = { k: this.k, ky: this.ky, ox: this.ox, oy: this.oy, f: this.f, taken: this.taken, labels: this.labels, names: new Set(this.pointNames), lastSpot: this.lastSpot };
    const g = this.g, k2 = this.k * z;
    // 主画面上框出放大的那一块
    const hw = W / 2 / z, hh = H / 2 / z; g.strokeStyle = '#a3329a'; g.lineWidth = 1.2; g.setLineDash([3, 3]); g.strokeRect(fc[0] - hw, fc[1] - hh, hw * 2, hh * 2); g.setLineDash([]);
    this.k = this.ky = k2; this.ox = R.x + R.w / 2 - c[0] * k2; this.oy = R.y + R.h / 2 + c[1] * k2;
    const r = Math.min(Math.max(this.f0.body * k2 / 2, 8), 16, this.capPx(k2)); this.f = { ...this.f, body: r * 2 / k2, thick: Math.min(this.f0.thick, 10 / k2) }; this.labels = []; this.taken = [{ x:R.x, y:R.y+R.h-28, w:R.w, h:28 }]; this.lastSpot = new Map();
    g.save(); g.beginPath(); g.roundRect(R.x, R.y, R.w, R.h, 10); g.fillStyle = PAPER; g.fill(); g.clip();
    if (this.qa) this.qa.inset = { ...R, z }; this.qaInset = true;
    try { for (const q of sim.geo.surfaces) this.surface(q, s); if (this.flags.trail) this.trails(s); this.ropes(s); this.springs(s); sim.geo.bodies.forEach((q, i) => this.body(q.id, i, s)); this.flushLabels(); } finally { this.qaInset = false; g.restore(); Object.assign(this, { k: save.k, ky: save.ky, ox: save.ox, oy: save.oy, f: save.f, taken: save.taken, labels: save.labels, pointNames: save.names, lastSpot: save.lastSpot }); }
    g.strokeStyle = '#a3329a'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(R.x, R.y, R.w, R.h, 10); g.stroke();
    const txt = `放大 ${z >= 10 ? Math.round(z) : +z.toFixed(1)} 倍`; g.font = `600 13px ${CJK}`; const tw = g.measureText(txt).width; g.fillStyle = '#a3329a'; g.beginPath(); g.roundRect(R.x + 8, R.y + R.h - 24, tw + 12, 18, 9); g.fill(); g.fillStyle = INK; g.textAlign = 'left'; this.qaInset = true; try { g.fillText(txt, R.x + 14, R.y + R.h - 11); } finally { this.qaInset = false; }
  }
  /** 线段在画面里的那一段（参数 0–1）；完全在外面返回 null */
  private clipT(x0: number, y0: number, x1: number, y1: number, m = 10): [number, number] | null {
    let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
    for (const [p, q] of [[-dx, x0 - m], [dx, this.w - m - x0], [-dy, y0 - m], [dy, this.h - m - y0]] as const) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
      const r = q / p; if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    }
    return t0 < t1 ? [t0, t1] : null;
  }
  /** 尺寸线：两端短线、双箭头、真实数值；超出画面的一端画断开符号 */
  private dimension(a: V2, b: V2, label: string, color: string, lift: number) {
    const g = this.g, X0 = this.px(a[0]), Y0 = this.py(a[1]), X1 = this.px(b[0]), Y1 = this.py(b[1]), L = Math.hypot(X1 - X0, Y1 - Y0); if (L < 4) return;
    const nx = (Y1 - Y0) / L, ny = -(X1 - X0) / L, sg = ny < 0 ? 1 : -1, ox = nx * lift * sg, oy = ny * lift * sg;
    const c = this.clipT(X0 + ox, Y0 + oy, X1 + ox, Y1 + oy); if (!c) return;
    const at = (t: number) => [X0 + (X1 - X0) * t, Y0 + (Y1 - Y0) * t], [x0, y0] = at(c[0]), [x1, y1] = at(c[1]), cut0 = c[0] > 1e-6, cut1 = c[1] < 1 - 1e-6;
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1.3; g.setLineDash([3, 3]); g.beginPath();
    if (!cut0) { g.moveTo(x0, y0); g.lineTo(x0 + ox * 1.15, y0 + oy * 1.15); } if (!cut1) { g.moveTo(x1, y1); g.lineTo(x1 + ox * 1.15, y1 + oy * 1.15); } g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(x0 + ox, y0 + oy); g.lineTo(x1 + ox, y1 + oy); g.stroke(); this.block(x0 + ox, y0 + oy, x1 + ox, y1 + oy);
    const head = (x: number, y: number, dx: number, dy: number) => { const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l; g.beginPath(); g.moveTo(x, y); g.lineTo(x - ux * 8 - uy * 3.5, y - uy * 8 + ux * 3.5); g.lineTo(x - ux * 8 + uy * 3.5, y - uy * 8 - ux * 3.5); g.closePath(); g.fill(); };
    if (cut1) this.zigzag(x1 + ox, y1 + oy, color); else head(x1 + ox, y1 + oy, X1 - X0, Y1 - Y0);
    if (cut0) this.zigzag(x0 + ox, y0 + oy, color); else head(x0 + ox, y0 + oy, X0 - X1, Y0 - Y1);
    this.quantity(label + (cut0 || cut1 ? '（未画全）' : ''), (x0 + x1) / 2 + ox - 30, (y0 + y1) / 2 + oy - 5, color, 'left', true, false, undefined, 0);
  }
  /** 长木板画不全（超出画面或按示意截短）时：在截断处画断开符号，旁边写真实长度 */
  private boardBreak(id: string, pose: { length: number; size: number; ang: number }, x: number, y: number) {
    const q = this.sim!.geo.bodies.find((b) => b.id === id)!, Lp = pose.length * this.k, ca = Math.cos(pose.ang), sa = Math.sin(pose.ang), H = Math.max(9, pose.size * this.k);
    const x0 = x - ca * Lp / 2, y0 = y + sa * Lp / 2, x1 = x + ca * Lp / 2, y1 = y - sa * Lp / 2, c = this.clipT(x0, y0, x1, y1, 4); if (!c) return;
    const short = pose.length < q.L * (1 - 1e-6), cuts: [number, number][] = [];
    if (c[0] > 1e-6) cuts.push([x0 + (x1 - x0) * c[0], y0 + (y1 - y0) * c[0]]);
    if (c[1] < 1 - 1e-6) cuts.push([x0 + (x1 - x0) * c[1], y0 + (y1 - y0) * c[1]]);
    if (short && !cuts.length) cuts.push([x1, y1]);
    if (!cuts.length) return;
    const g = this.g;
    for (const [cx, cy] of cuts) {
      const ix = cx + (x - cx) / (Math.hypot(x - cx, y - cy) || 1) * 14, iy = cy + (y - cy) / (Math.hypot(x - cx, y - cy) || 1) * 14;
      g.save(); g.translate(ix, iy); g.rotate(-pose.ang); g.fillStyle = PAPER; g.fillRect(-3, -H / 2 - 2, 6, H + 4);
      g.strokeStyle = INK; g.lineWidth = 1.3; for (const d of [-3, 3]) { g.beginPath(); g.moveTo(d - 2, -H / 2 - 4); g.lineTo(d + 2, -H / 6); g.lineTo(d - 2, H / 6); g.lineTo(d + 2, H / 2 + 4); g.stroke(); } g.restore();
    }
    if (!this.keep.some((k) => k.length === id)) {   // 字母题的长度是任取的，只写“未画全”
      const [cx, cy] = cuts[0], txt = this.compact ? '未画全' : `全长 ${fmtLen(q.L)}，未画全`; g.font = `500 13px ${CJK}`; const w = g.measureText(txt).width + 8;
      this.labels.push({ x: Math.min(Math.max(cx - w / 2, 8), this.w - w - 8), y: cy + H / 2 + 8, w, h: 17, pri: 2, near: true, key: 'break' + id, optional: false, draw: (a, b) => { g.font = `500 13px ${CJK}`; g.fillStyle = PAPER + 'e6'; g.fillRect(a, b, w, 17); g.fillStyle = SOFT; g.textAlign = 'left'; g.fillText(txt, a + 4, b + 13); } });
    }
  }
  /** 断开符号：长度没有画完 */
  private zigzag(x: number, y: number, color: string) { const g = this.g; g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 5, y + 8); g.lineTo(x + 2, y + 3); g.lineTo(x - 2, y - 3); g.lineTo(x + 5, y - 8); g.stroke(); }
  /** 左下角的比例尺：画面怎么缩放，都能读出真实长度 */
  private scaleBar() {
    if (this.symbolsOnly || this.sim!.script || !Number.isFinite(this.k) || this.k <= 0) return;
    const g = this.g, raw = 90 / this.k, e = Math.pow(10, Math.floor(Math.log10(raw))), len = [1, 2, 5, 10].map((m) => m * e).filter((v) => v <= raw).at(-1) ?? e, L = len * this.k;
    const x = 16, y = this.h - 14, txt = len >= 1000 ? `${+(len / 1000).toPrecision(3)} km` : len >= 1 ? `${+len.toPrecision(3)} m` : len >= .01 ? `${+(len * 100).toPrecision(3)} cm` : len >= 1e-3 ? `${+(len * 1000).toPrecision(3)} mm` : `${len.toExponential(0)} m`;
    g.strokeStyle = SOFT; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + L, y); g.lineTo(x + L, y - 5); g.stroke();
    g.font = `500 13px ${MATH}`; g.fillStyle = SOFT; g.textAlign = 'left'; g.fillText(txt, x + L + 6, y + 1);
    this.taken.push({ x: x - 2, y: y - 14, w: L + 8 + g.measureText(txt).width, h: 18 });
  }
  /** 坐标纸的点钉在世界坐标上：镜头跟随或拖动时，背景跟着动，看得出物体相对地面在走 */
  private dots() {
    const g = this.g, raw = 24 / this.k, e = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map((m) => m * e).find((v) => v >= raw * .8) ?? 10 * e;
    const sx = step * this.k, sy = step * this.ky; if (!(sx > 6 && sy > 6) || !Number.isFinite(sx)) return;
    const x0 = this.ox % sx, y0 = this.oy % sy; g.fillStyle = DOT;
    for (let x = (x0 + sx) % sx; x < this.w; x += sx) for (let y = (y0 + sy) % sy; y < this.h; y += sy) g.fillRect(x - .7, y - .7, 1.4, 1.4);
  }
  /** 讲解标注：受力箭头、位移尺寸线 */
  private overlayArt(s: Snapshot) {
    const o = this.over, g = this.g, sim = this.sim!;
    // 位移：从这一问开始的位置到现在
    o.spans.forEach((id, i) => {
      const a = sampleAt(sim, o.from).bodies[id], b = s.bodies[id]; if (!a || !b) return;
      const isBoard = sim.geo.bodies.find((q) => q.id === id)?.kind === 'board', p0 = isBoard ? [a.x, a.y] as V2 : bodyPose(sim, this.f, id, sampleAt(sim, o.from)).c, p1 = isBoard ? [b.x, b.y] as V2 : bodyPose(sim, this.f, id, s).c, x0 = this.px(p0[0]), y0 = this.py(p0[1]), x1 = this.px(p1[0]), y1 = this.py(p1[1]), d = Math.hypot(b.x - a.x, b.y - a.y), r = this.radiusOf(id, s), lift = r + 26 + i * 26;
      if (Math.hypot(x1 - x0, y1 - y0) < 6) return;
      const L = Math.hypot(x1 - x0, y1 - y0), nx = (y1 - y0) / L, ny = -(x1 - x0) / L, sgn = ny < 0 ? 1 : -1, ox = nx * lift * sgn, oy = ny * lift * sgn;
      g.strokeStyle = '#5a4bb0'; g.fillStyle = '#5a4bb0'; g.lineWidth = 1.4; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + ox, y0 + oy); g.moveTo(x1, y1); g.lineTo(x1 + ox, y1 + oy); g.stroke(); g.setLineDash([]);
      this.arrow(x0 + ox, y0 + oy, x1 - x0, y1 - y0, '#5a4bb0'); this.arrow(x1 + ox, y1 + oy, x0 - x1, y0 - y1, '#5a4bb0');
      this.quantity(`${o.label ?? (/^[A-Za-z]\d?$/.test(id) ? `x_${id}` : 'x')} = ${d.toFixed(2)} m`, (x0 + x1) / 2 + ox - 20, (y0 + y1) / 2 + oy - 6, '#5a4bb0', 'left', true, false, undefined, .5);
    });
    if (o.gap) {
      const [ia, ib] = o.gap, A = this.screenOf(ia), B = this.screenOf(ib);
      if (A && B) { const a = s.bodies[ia], b = s.bodies[ib], y = Math.min(A[1], B[1]) - 46, d = Math.hypot(a.x - b.x, a.y - b.y); g.strokeStyle = '#5a4bb0'; g.lineWidth = 1.4; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(A[0], y); g.moveTo(B[0], B[1]); g.lineTo(B[0], y); g.stroke(); g.setLineDash([]); this.arrow(A[0], y, B[0] - A[0], 0, '#5a4bb0'); this.arrow(B[0], y, A[0] - B[0], 0, '#5a4bb0'); this.quantity(`${o.label ?? 'Δx'} = ${d.toFixed(2)} m`, (A[0] + B[0]) / 2 - 24, y - 6, '#5a4bb0', 'left', true, false, undefined, .5); }
    }
  }
  /** 开关和讲解选中的物体共用同一组分力、合力和本问线性比例。 */
  /** 质量比别的物体大十万倍以上：题目里“固定”的东西用大质量代替，它的受力没有物理意义，不画 */
  private isAnchor(id: string) {
    const bs = this.sim!.geo.bodies, me = bs.find((q) => q.id === id); if (!me) return false;
    const others = bs.filter((q) => q.id !== id && q.m > 0).map((q) => q.m); return others.length > 0 && me.m > 1e5 * Math.min(...others);
  }
  /** 打开“受力”时默认画谁：所求物体；没有就取第一个会动的小物体。其他物体等学生点它再画。 */
  private forceFocus(s: Snapshot) {
    const ok = (id: string | null | undefined) => !!id && !!s.bodies[id]?.fs && !this.isAnchor(id);
    if (ok(this.focusId)) return this.focusId!;
    const bs = this.sim!.geo.bodies; return (bs.find((q) => q.kind !== 'board' && ok(q.id)) ?? bs.find((q) => ok(q.id)))?.id ?? null;
  }
  /**
   * 受力图（通用规则）：箭头一律从受力物体的质心出发（同受力分析图），长度按同一比例，不为了让标签好放而把箭头挪走；挤的时候只挪文字。
   * 同一方向的几个力并排错开几个像素，免得完全重合。
   */
  private drawForces(s: Snapshot) {
    const ids = new Set(this.over.forces); if (this.flags.force) { const f = this.forceFocus(s); if (f) ids.add(f); }
    // 比例只按这次画出受力的物体（整段时间里）的最大力定：只画所求物体时，别的物体的大力不会把它的箭头压短
    const key = [...ids].sort().join('|'); if (this.fmaxKey !== key) { this.fmaxKey = key; this.fmax = forceMax(this.sim!, this.w0, this.w1, (id) => this.isAnchor(id) || !ids.has(id)); }
    for (const id of ids) {
      const b = s.bodies[id], point = this.centerOf(id, s); if (!point || !b?.fs || this.isAnchor(id)) continue;
      const radius = this.radiusOf(id, s), board = this.sim!.geo.bodies.find((q) => q.id === id)?.kind === 'board';
      const glyphs = forceGlyphs(b.fs.length + 1 >= 8 ? groupDenseForces(b.fs) : b.fs, this.fmax, this.arrowK, this.symbolsOnly, this.massSym[id]);
      mergeEqualResultant(glyphs);
      for (const glyph of glyphs.filter((a) => !a.magnitude)) { this.quantity(glyph.label, point[0] + radius + 10, point[1] + radius + 14, glyph.color, 'left', true, false, undefined, 1, true, `force:${id}:sum`); this.qa?.forceArrows.push({ ...glyph, body: id, x0: point[0], y0: point[1], x1: point[0], y1: point[1] }); }
      // 和学生画受力分析一样从质心出发；同向的力共用一条线，太短的拉长到刚露出物体（规则见 layoutForceLines）
      for (const { glyph, ux, uy, len, label, bumped } of layoutForceLines(glyphs, (g) => [g.x / g.magnitude, -g.y / g.magnitude], board ? 40 : radius + 12, this.lineOrder, id)) {
          const [x, y] = point;
          this.arrow(x, y, ux * len, uy * len, PAPER_HALO, undefined, 1, true, glyph.width + 3);
          this.arrow(x, y, ux * len, uy * len, glyph.color, label, 1, false, glyph.width, `force:${id}:${glyph.resultant ? 'sum' : glyph.by ?? 'external'}`);
          this.qa?.forceArrows.push({ ...glyph, label, length: len, schematic: glyph.schematic || bumped, body: id, x0: x, y0: y, x1: x + ux * len, y1: y + uy * len });
      }
    }
  }
  /** 题图上的字母和参考线 */
  private notesArt() {
    const g = this.g;
    for (const n of this.sim!.notes ?? []) {
      if (n.line) { this.line(n.line, '#6f7a78', 1.3, n.dash === false ? [] : [6, 5]); if (n.text) this.letter(n.text, this.px(n.line[1][0]) + 6, this.py(n.line[1][1]) - 20); }
      else if (n.at) { const x = this.px(n.at[0]), y = this.py(n.at[1]); g.fillStyle = INK; g.beginPath(); g.arc(x, y, 2.8, 0, 7); g.fill(); this.taken.push({ x: x - 3, y: y - 3, w: 6, h: 6 }); if (n.text) this.letter(n.text, x + 6, y - 21); }
    }
  }
  /** 高处的轨道画成落到地面的台体，和试卷上的平台一样 */
  private bases() {
    if (!this.supports) return; const g = this.g;
    g.fillStyle = BASE; g.strokeStyle = '#b9b09a'; g.lineWidth = 1;
    for (const f of this.supports.fills) { g.beginPath(); f.forEach((p, i) => { const x = this.px(p[0]), y = this.py(p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.fill(); g.stroke(); }
  }
  /** 实验室交来的图元：这里只管画 */
  private prims(list: Prim[]) {
    const g = this.g;
    for (const original of list) {
      const p = original.k === 'text' && this.symbolsOnly ? { ...original, s: symbolicReading(original.s) } : original;
      g.setLineDash([]);
      if (p.k === 'line') {
        if (p.p.length < 2) continue;
        g.beginPath(); p.p.forEach((q, i) => { const x = this.px(q[0]), y = this.py(q[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); if (p.close) g.closePath();
        if (p.fill) { g.fillStyle = p.fill; g.fill(); }
        if (p.c) { g.strokeStyle = p.c; g.lineWidth = p.w ?? 2; g.setLineDash(p.dash ?? []); g.stroke(); g.setLineDash([]); if (this.sim?.board && !p.dash?.length) for (let i=1; i<p.p.length; i++) this.block(this.px(p.p[i-1][0]), this.py(p.p[i-1][1]), this.px(p.p[i][0]), this.py(p.p[i][1])); }
        if (p.arrow) { const a = p.p.at(-2)!, b = p.p.at(-1)!, x0 = this.px(a[0]), y0 = this.py(a[1]), x1 = this.px(b[0]), y1 = this.py(b[1]), L = Math.hypot(x1 - x0, y1 - y0); if (L > 2) { const ux = (x1 - x0) / L, uy = (y1 - y0) / L, hd = 10; g.fillStyle = p.c ?? INK; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - ux * hd - uy * hd * .45, y1 - uy * hd + ux * hd * .45); g.lineTo(x1 - ux * hd + uy * hd * .45, y1 - uy * hd - ux * hd * .45); g.closePath(); g.fill(); } }
      } else if (p.k === 'circle') {
        const r = p.rp ?? (p.r ?? 0) * this.k; g.beginPath(); g.arc(this.px(p.at[0]), this.py(p.at[1]), Math.max(r, .5), 0, 7);
        if (p.fill) { g.fillStyle = p.fill; g.fill(); } if (p.c) { g.strokeStyle = p.c; g.lineWidth = p.w ?? 1.2; g.setLineDash(p.dash ?? []); g.stroke(); g.setLineDash([]); }
      } else if (p.k === 'rect') {
        const x = this.px(p.x0), y = this.py(p.y1), w = (p.x1 - p.x0) * this.k, h = (p.y1 - p.y0) * this.ky;
        if (p.fill) { g.fillStyle = p.fill; g.fillRect(x, y, w, h); } if (p.c) { g.strokeStyle = p.c; g.lineWidth = p.w ?? 1.2; g.setLineDash(p.dash ?? []); g.strokeRect(x, y, w, h); g.setLineDash([]); if (this.sim?.board) { this.block(x, y, x+w, y); this.block(x+w, y, x+w, y+h); this.block(x+w, y+h, x, y+h); this.block(x, y+h, x, y); } }
      } else if (p.k === 'text') {
        const size = Math.max(13, p.size ?? 13), x = this.px(p.at[0]) + (p.dx ?? 0), y = this.py(p.at[1]) + (p.dy ?? 0);
        const font = `${p.bold ? 600 : 500} ${size}px ${MATH.replace('"Songti SC"', '"PingFang SC"')}`; g.font = font; const w = g.measureText(p.s).width + 4, al = p.align ?? 'center', left = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x;
        this.labels.push({ x: left, y: y - size * .85, w, h: size * 1.15, pri: 1, near: true, key: 'p' + p.s, optional: false, draw: (a, b) => { g.font = font; g.textAlign = 'left'; g.fillStyle = p.c ?? INK; g.fillText(p.s, a + 2, b + size * .85); } });
      } else if (p.k === 'angle') {
        const x = this.px(p.at[0]), y = this.py(p.at[1]), r = p.rp ?? 26; let a0 = -p.a0, a1 = -p.a1; let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        g.strokeStyle = p.c ?? FORCE; g.lineWidth = 1.4; g.beginPath(); g.arc(x, y, r, a0, a0 + d, d < 0); g.stroke();
        if (p.s) { const m = a0 + d / 2, s2 = p.s, c2 = p.c ?? FORCE; g.font = `500 13px ${MATH}`; const w = g.measureText(s2).width + 4, cx = x + Math.cos(m) * (r + 17), cy = y + Math.sin(m) * (r + 17); this.labels.push({ x: cx - w / 2, y: cy - 8, w, h: 16, pri: 1, near: true, key: 'a' + s2, optional: false, draw: (a, b) => { g.font = `500 13px ${MATH}`; g.textAlign = 'left'; g.fillStyle = c2; g.fillText(s2, a + 2, b + 12); } }); }
      } else if (p.k === 'field' || p.k === 'efield') {
        const x0 = Math.max(this.px(p.x0), 0), x1 = Math.min(this.px(p.x1), this.w), y0 = Math.max(this.py(p.y1), 0), y1 = Math.min(this.py(p.y0), this.h);
        if (x1 <= x0 || y1 <= y0 || (p.k === 'field' && Math.abs(p.B) < 1e-30)) continue;
        g.save(); g.beginPath();
        if (p.circle) g.arc(this.px(p.circle[0]), this.py(p.circle[1]), p.circle[2] * this.k, 0, 7);
        else if (p.poly) p.poly.forEach((q, i) => { const x = this.px(q[0]), y = this.py(q[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        else g.rect(x0, y0, x1 - x0, y1 - y0);
        g.closePath(); const isB = p.k === 'field' || !!p.magnetic; g.fillStyle = isB ? '#687b7d0e' : '#8a795d10'; g.fill(); g.strokeStyle = isB ? '#687b7d88' : '#8a795d88'; g.lineWidth = 1.3; g.setLineDash([6, 5]); if (p.poly || p.circle) g.stroke(); g.setLineDash([]); g.clip();
        if (p.k === 'field') { const up = p.B >= 0; g.strokeStyle = g.fillStyle = '#687b7d77'; g.lineWidth = 1.4; for (let x = x0 + 22; x < x1; x += 44) for (let y = y0 + 22; y < y1; y += 44) { if (up) { g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); } else { g.beginPath(); g.moveTo(x - 4.5, y - 4.5); g.lineTo(x + 4.5, y + 4.5); g.moveTo(x + 4.5, y - 4.5); g.lineTo(x - 4.5, y + 4.5); g.stroke(); } } }
        else { const m = Math.hypot(p.E[0], p.E[1]) || 1, ux = p.E[0] / m, uy = -p.E[1] / m; for (let x = x0 + 30; x < x1; x += 60) for (let y = y0 + 30; y < y1; y += 60) this.arrow(x - ux * 13, y - uy * 13, ux * 26, uy * 26, p.magnetic ? '#687b7d77' : '#8a795d77', undefined, 1, true); }
        g.restore();
      }
    }
  }
  private line(pts: V2[], color = INK, width = 2, dash: number[] = []) {
    const g = this.g; g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash); g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(this.px(p[0]), this.py(p[1])) : g.moveTo(this.px(p[0]), this.py(p[1])))); g.stroke(); g.setLineDash([]);
    if (this.sim?.board) for (let i = 1; i < pts.length; i++) this.block(this.px(pts[i-1][0]), this.py(pts[i-1][1]), this.px(pts[i][0]), this.py(pts[i][1]));
  }
  /** 试卷上表示固定面的斜线：沿 p→q 在 side 一侧画短线 */
  private hatch(p: V2, q: V2, side: number) {
    const g = this.g, a = [this.px(p[0]), this.py(p[1])], b = [this.px(q[0]), this.py(q[1])], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 4) return;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy * side, ny = ux * side;
    g.strokeStyle = INK; g.lineWidth = 1;
    for (let d = 6; d < L; d += 11) { const x = a[0] + ux * d, y = a[1] + uy * d; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (nx - ux) * 8, y + (ny - uy) * 8); g.stroke(); }
  }
  private riddenCache = new Map<string, boolean>();
  /** 竖直、光滑、有物体沿着走的直线：竖直上抛、自由落体借它表示一维运动 */
  private guide(q: GeoSurface) {
    if (q.kind !== 'seg' || q.host || q.rough || q.belt !== undefined || q.rails !== undefined) return false;
    const L = Math.hypot(q.p1![0] - q.p0![0], q.p1![1] - q.p0![1]); if (Math.abs(q.p1![0] - q.p0![0]) > L * 1e-6) return false;
    let r = this.riddenCache.get(q.id); if (r === undefined) { r = this.sim!.samples.some((p) => Object.values(p.bodies).some((b) => b.on === q.id)); this.riddenCache.set(q.id, r); }
    return r;
  }
  /** 跟随镜头时沿参考线画刻度，镜头动的时候看得出物体在走 */
  private ruler(a: V2, b: V2, gap: number) {
    const g = this.g, L = Math.hypot(b[0] - a[0], b[1] - a[1]), raw = 34 / this.k, e = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 5, 10].map((m) => m * e).find((v) => v >= raw)!;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], dig = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    g.strokeStyle = '#a99f88'; g.lineWidth = 1; g.font = `13px ${MATH}`; g.fillStyle = SOFT; g.textAlign = 'left';
    for (let i = 0; i * step <= L + 1e-9; i++) {
      const d = i * step, x = this.px(a[0] + u[0] * d), y = this.py(a[1] + u[1] * d); if (y < -10 || y > this.h + 10 || x < -10 || x > this.w + 10) continue;
      const big = Math.abs(d / (step * 5) - Math.round(d / (step * 5))) < 1e-6; g.beginPath(); g.moveTo(x - (big ? 7 : 4), y); g.lineTo(x + (big ? 7 : 4), y); g.stroke();
      if ((big || step * this.k > 60) && (!this.symbolsOnly || i === 0)) { const t = this.symbolsOnly ? '0' : `${d.toFixed(dig)} m`, w = g.measureText(t).width, bx = x - gap - w, by = y - 8; if (this.reserved.some((r) => bx < r.x + r.w && bx + w > r.x && by < r.y + r.h && by + 14 > r.y)) continue; this.labels.push({x:bx,y:by,w,h:18,pri:2,near:true,key:`ruler:${a.join(',')}:${b.join(',')}:${d}`,optional:false,draw:(left,top)=>{g.font=`13px ${MATH}`;g.fillStyle=SOFT;g.textAlign='left';g.fillText(t,left,top+12);}}); }   // 被网页按钮盖住的刻度不写数
    }
  }
  private surface(q: GeoSurface, s: Snapshot) {
    const o = offsetOf(q, s), sh = (p: V2): V2 => [p[0] + o[0], p[1] + o[1]], g = this.g;
    if (q.kind === 'ground') {
      const y = q.y!, x0 = (0 - this.ox) / this.k, x1 = (this.w - this.ox) / this.k;
      const Y = this.py(y), gr = g.createLinearGradient(0, Y, 0, Math.min(this.h, Y + 90)); gr.addColorStop(0, '#e6dfcf'); gr.addColorStop(1, '#e6dfcf00'); g.fillStyle = gr; g.fillRect(0, Y, this.w, 90);
      this.line([[x0, y], [x1, y]], INK, 2); this.hatch([x0, y], [x1, y], 1);
    } else if (q.kind === 'seg') {
      const a = sh(q.p0!), b = sh(q.p1!);
      if (q.belt !== undefined) this.belt(a, b, q.belt, s.t);
      else if (q.rails !== undefined) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * q.rails / 2, ny = (b[0] - a[0]) / L * q.rails / 2; for (const d of [1, -1]) this.line([[a[0] + nx * d, a[1] + ny * d], [b[0] + nx * d, b[1] + ny * d]], INK, 2.6); }
      else if (this.guide(q)) {   // 竖直方向的一维运动借用的直线：只是一条参考线，不是墙；上面走的是竖管时，线穿过管子中心
        const tube = this.sim!.geo.bodies.find((o) => s.bodies[o.id]?.on === q.id && this.isContainer(o.id) && Math.abs(Math.sin(s.bodies[o.id].ang)) > .7), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        let sh: V2 = [0, 0];
        if (tube) { const c = this.centerOf(tube.id, s)!, w: V2 = [(c[0] - this.ox) / this.k, (this.oy - c[1]) / this.ky], n: V2 = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], d = (w[0] - a[0]) * n[0] + (w[1] - a[1]) * n[1]; sh = [n[0] * d, n[1] * d]; }
        const a2: V2 = [a[0] + sh[0], a[1] + sh[1]], b2: V2 = [b[0] + sh[0], b[1] + sh[1]];
        this.line([a2, b2], '#b9b09a', 1.2, [5, 6]);
        if (this.follow && s.bodies[this.follow.id]?.on === q.id) this.ruler(a2, b2, tube ? Math.max(this.cavity(tube.id, s) * this.k, 10) / 2 + 8 : 10);
      } else {
        this.line([a, b], INK, 2.2); if (!q.host) this.hatch(a, b, b[0] >= a[0] ? 1 : -1);
        // 同一道题里有光滑段也有粗糙段时，粗糙段加粗，一眼分开
        if (q.rough && this.sim!.geo.surfaces.some((o) => o.kind === 'seg' && !o.rough && o.belt === undefined)) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * 3 / this.k, ny = (b[0] - a[0]) / L * 3 / this.k; this.line([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny]], '#7a6a4f', 6); }
      }
      const u = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2, wl = 22 / this.k;
      if (this.guide(q)) {   // 两端的挡板就是地面和天花板：画宽，斜线画在外侧
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, d: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], hw = Math.max(44, ...[...this.sim!.geo.bodies].filter((o) => this.isContainer(o.id)).map((o) => (this.cavity(o.id, s) + this.f.thick) * this.k * 1.6)) / this.k;
        for (const [e, p, out] of [[q.walls?.start, a, -1], [q.walls?.end, b, 1]] as const) if (e !== undefined) { const p1: V2 = [p[0] + d[1] * hw, p[1] - d[0] * hw], p2: V2 = [p[0] - d[1] * hw, p[1] + d[0] * hw]; this.line([p1, p2], INK, 2.2); const sx = this.px(p2[0]) - this.px(p1[0]), sy = this.py(p2[1]) - this.py(p1[1]), side = (-sy * (d[0] * out) + sx * (-d[1] * out)) > 0 ? 1 : -1; this.hatch(p1, p2, side); }
      } else for (const [e, p] of [[q.walls?.start, a], [q.walls?.end, b]] as const) if (e !== undefined) this.line([p, [p[0] + Math.cos(u) * wl, p[1] + Math.sin(u) * wl]], INK, 4);
    } else {
      const pts = surfacePoints(q).map(sh);
      if (q.tether) {   // 绳或杆的约束：只画悬点和当前的绳，走过的圆弧用虚线
        const c = sh(q.c!), x = this.px(c[0]), y = this.py(c[1]);
        this.line(pts, '#b9b09a', 1.2, [4, 5]);
        for (const b of this.sim!.geo.bodies) if (s.bodies[b.id]?.on === q.id) { const p = this.screenOf(b.id); if (p) { g.strokeStyle = q.tether === 'rod' ? '#8a5a24' : INK; g.lineWidth = q.tether === 'rod' ? 4 : 1.6; g.beginPath(); g.moveTo(x, y); g.lineTo(p[0], p[1]); g.stroke(); } }
        g.fillStyle = INK; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.lineWidth = 1; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(x + i * 6 - 3, y - 6); g.lineTo(x + i * 6 + 3, y - 12); g.stroke(); } g.lineWidth = 2; g.beginPath(); g.moveTo(x - 16, y - 6); g.lineTo(x + 16, y - 6); g.stroke();
      } else if (q.side === 'tube') {
        const n = this.bodyRadius() * 1.5 / this.k, c = sh(q.c!);
        for (const r of [q.R! - n, q.R! + n]) this.line(pts.map((p) => { const d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1; return [c[0] + (p[0] - c[0]) / d * r, c[1] + (p[1] - c[1]) / d * r] as V2; }), INK, 1.6);
      } else {
        this.line(pts, INK, 2.2);
        if (!q.host) {   // 斜线画在轨道背后：物体在里侧时向外，在外侧时向里
          const c = sh(q.c!), out = q.side === 'outside' ? -1 : 1, n = Math.max(8, Math.round(q.R! * Math.abs(q.a1! - q.a0!) * this.k / 11)); g.strokeStyle = INK; g.lineWidth = 1;
          for (let i = 0; i <= n; i++) { const a = q.a0! + (q.a1! - q.a0!) * i / n, x = this.px(c[0] + q.R! * Math.cos(a)), y = this.py(c[1] + q.R! * Math.sin(a)), d = out * 7, e = 5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * d - Math.sin(a) * e, y - Math.sin(a) * d - Math.cos(a) * e); g.stroke(); }
        }
      }
    }
    // 轨道名是 AB、BCD 这样的字母时，把字母标到端点上，和题图对应
    const names = /^[A-Z]{2,4}$/.test(q.id) && q.kind !== 'ground' ? q.id.split('') : null;
    if (names) {
      const pts = q.kind === 'seg' ? [sh(q.p0!), sh(q.p1!)] : surfacePoints(q).map(sh), own = Object.keys(q.marks ?? {});
      names.forEach((n, i) => { if (own.includes(n)) return; const p = pts[Math.round(i / (names.length - 1) * (pts.length - 1))], x = this.px(p[0]), y = this.py(p[1]); if (this.pointNames.has(n) || !this.onScreen(x, y)) return; this.pointNames.add(n); g.fillStyle = INK; g.beginPath(); g.arc(x, y, 2.8, 0, 7); g.fill(); this.taken.push({ x: x - 3, y: y - 3, w: 6, h: 6 }); this.letter(n, x + 6, y + 3); });
    }
    for (const [name, p] of Object.entries(q.marks ?? {})) {
      const m = sh(p as V2); if (!this.onScreen(this.px(m[0]), this.py(m[1]))) continue; g.fillStyle = INK; g.beginPath(); g.arc(this.px(m[0]), this.py(m[1]), 3.2, 0, 7); g.fill();
      this.pointNames.add(name); this.taken.push({ x: this.px(m[0]) - 3, y: this.py(m[1]) - 3, w: 6, h: 6 }); this.letter(name, this.px(m[0]) + 6, this.py(m[1]) + 3);
    }
  }
  /** 点在画面里（画面外的点不写字母，免得字母被挤到边上、对不上位置） */
  private onScreen(x: number, y: number) { return x >= 2 && x <= this.w - 2 && y >= 2 && y <= this.h - 2; }
  private belt(a: V2, b: V2, speed: number, t: number) {
    const g = this.g, A = [this.px(a[0]), this.py(a[1])], B = [this.px(b[0]), this.py(b[1])], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L, R = 11, nx = -uy, ny = ux;
    g.strokeStyle = INK; g.lineWidth = 2; const dn = (ux >= 0 ? 1 : -1);
    for (const off of [0, 2 * R]) { g.beginPath(); g.moveTo(A[0] + nx * dn * off, A[1] + ny * dn * off); g.lineTo(B[0] + nx * dn * off, B[1] + ny * dn * off); g.stroke(); }
    for (const p of [A, B]) { const cx = p[0] + nx * dn * R, cy = p[1] + ny * dn * R; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke(); const ang = t * speed * this.k / R; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); g.stroke(); }
    const step = 26, ph = ((t * speed * this.k) % step + step) % step; g.fillStyle = SOFT;
    for (let d = ph; d < L; d += step) g.fillRect(A[0] + ux * d - 1, A[1] + uy * d - 1, 3, 3);
  }
  private railWidth(on: string | null) { return this.sim!.geo.surfaces.find((q) => q.id === on)?.rails ?? 1; }
  /** 场区：叉和点表示磁场方向，箭头表示电场方向 */
  private fieldsArt() {
    const g = this.g;
    for (const f of this.sim!.em ?? []) {
      if (f.kind === 'Q') { const x = this.px(f.at![0]), y = this.py(f.at![1]), pos = (f.Q ?? 0) >= 0, c = pos ? '#c8322b' : '#1668d6';
        g.strokeStyle = c + '55'; g.lineWidth = 1.2; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20); g.lineTo(x + Math.cos(a) * 120, y + Math.sin(a) * 120); g.stroke(); }
        g.fillStyle = c; g.beginPath(); g.arc(x, y, 15, 0, 7); g.fill(); this.text(pos ? '+' : '−', x, y + 7, '700 20px "Times New Roman", serif', '#fff'); continue; }
      const q = f.rect, cc = f.circle; let [x0, y0, x1, y1] = [0, 0, this.w, this.h];
      g.save();
      if (q) { x0 = this.px(q[0]); x1 = this.px(q[2]); y0 = this.py(q[3]); y1 = this.py(q[1]); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip(); }
      if (cc) { const r = cc[2] * this.k, x = this.px(cc[0]), y = this.py(cc[1]); x0 = x - r; x1 = x + r; y0 = y - r; y1 = y + r; g.beginPath(); g.arc(x, y, r, 0, 7); g.clip(); }
      const isB = f.kind === 'B'; g.fillStyle = isB ? '#1668d60f' : '#d9730d10'; if (q || cc) g.fillRect(x0, y0, x1 - x0, y1 - y0);
      const whole = !q && !cc, many = (this.sim!.em ?? []).filter((x) => !x.rect && !x.circle && x.kind !== 'Q').length > 1;
      const step = (isB ? 46 : 58) * (whole ? (many ? 2 : 1.4) : 1), up = (f.B ?? 0) >= 0, E = f.E ?? [0, 0], m = Math.hypot(E[0], E[1]) || 1;
      for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
        if (isB) { g.strokeStyle = g.fillStyle = whole ? '#1668d644' : '#1668d666'; g.lineWidth = 1.6; if (up) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); } else { g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke(); } }
        else this.arrow(x - E[0] / m * 14, y + E[1] / m * 14, E[0] / m * 28, -E[1] / m * 28, whole ? '#8a795d55' : '#8a795d77', undefined, 1, true);
      }
      g.restore();
      if (q || cc) { g.strokeStyle = isB ? '#1668d6aa' : '#d9730daa'; g.lineWidth = 1.5; g.setLineDash([6, 5]); g.beginPath(); if (q) g.rect(x0, y0, x1 - x0, y1 - y0); else g.arc((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, 0, 7); g.stroke(); g.setLineDash([]); }
      { const lx = q || cc ? x0 + 6 : 18, ly = q || cc ? y0 + 6 : this.h - 74, col = isB ? '#1668d6' : '#d9730d', sym = isB ? 'B' : 'E';   // 场的符号也参与避让，不压住物体名
        this.labels.push({ x: lx, y: ly, w: 18, h: 22, pri: 1.5, near: true, key: 'field' + sym, optional: false, draw: (a, b) => this.text(sym, a + 9, b + 17, 'italic 600 19px "Times New Roman", serif', col) }); }
    }
  }
  private flow: Record<string, number> = {}; private lastNow = 0;
  /** 电路图：每个元件画在两节点之间，电流用沿导线移动的小点表示，速度和电流成正比 */
  private circuit(s: Snapshot, now: number) {
    const c = this.sim!.circuit!, f = s.circuit!, g = this.g, dt = Math.min(.05, (now - this.lastNow) / 1000) || 0; this.lastNow = now;
    const imax = Math.max(1e-9, ...this.snaps.flatMap((p) => Object.values(p.circuit?.I ?? {}).map(Math.abs)));
    for (const e of c.elements) {
      const A = c.nodes[e.a], B = c.nodes[e.b], a = [this.px(A[0]), this.py(A[1])], b = [this.px(B[0]), this.py(B[1])], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, gap = e.kind === 'wire' ? 0 : Math.min(30, L * .28);
      const I = f.I[e.id] ?? 0, U = f.U[e.id] ?? 0, glow = Math.abs(I) / imax;
      g.strokeStyle = INK; g.lineWidth = 2.2; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(mx - ux * gap, my - uy * gap); g.moveTo(mx + ux * gap, my + uy * gap); g.lineTo(b[0], b[1]); g.stroke();
      this.flow[e.id] = (this.flow[e.id] ?? 0) + (e.kind === 'battery' ? -I : I) / imax * 70 * dt;
      if (Math.abs(I) > imax * 1e-4 && e.kind !== 'voltmeter') { g.fillStyle = '#d8332a'; const ph = ((this.flow[e.id] % 24) + 24) % 24; for (let d = ph; d < L; d += 24) { if (Math.abs(d - L / 2) < gap) continue; g.beginPath(); g.arc(a[0] + ux * d, a[1] + uy * d, 2.8, 0, 7); g.fill(); } }
      g.save(); g.translate(mx, my); g.rotate(Math.atan2(uy, ux)); g.strokeStyle = INK; g.fillStyle = PAPER; g.lineWidth = 2;
      if (e.kind === 'R' || e.kind === 'rheostat') { g.beginPath(); g.rect(-gap, -9, 2 * gap, 18); g.fill(); g.stroke(); if (e.kind === 'rheostat') { g.beginPath(); g.moveTo(-gap * .8, 15); g.lineTo(gap * .8, -15); g.stroke(); } }
      else if (e.kind === 'lamp') { g.fillStyle = `rgba(255,196,60,${.15 + .8 * glow})`; g.beginPath(); g.arc(0, 0, 15, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-10, -10); g.lineTo(10, 10); g.moveTo(10, -10); g.lineTo(-10, 10); g.stroke(); }
      else if (e.kind === 'ammeter' || e.kind === 'voltmeter') { g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fill(); g.stroke(); g.rotate(-Math.atan2(uy, ux)); this.text(e.kind === 'ammeter' ? 'A' : 'V', 0, 7, `600 19px ${MATH}`, INK); }
      else if (e.kind === 'battery') { g.beginPath(); g.moveTo(-5, -18); g.lineTo(-5, 18); g.stroke(); g.lineWidth = 4; g.beginPath(); g.moveTo(5, -9); g.lineTo(5, 9); g.stroke(); }
      else if (e.kind === 'capacitor') { g.beginPath(); g.moveTo(-5, -15); g.lineTo(-5, 15); g.moveTo(5, -15); g.lineTo(5, 15); g.stroke(); }
      else if (e.kind === 'switch') { const on = Math.abs(U) < 1e-3 && true; g.beginPath(); g.arc(-gap, 0, 3, 0, 7); g.arc(gap, 0, 3, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-gap, 0); g.lineTo(gap, on ? 0 : -gap * .8); g.stroke(); }
      g.restore();
      if (e.kind !== 'wire') { const vertical = Math.abs(uy) > Math.abs(ux), lx = mx + (vertical ? 26 : 0), ly = my + (vertical ? 0 : -24), al: CanvasTextAlign = vertical ? 'left' : 'center';
        this.name(e.id, lx, ly - (vertical ? 9 : 16), INK, 15, al);
        const read = e.kind === 'voltmeter' ? `${Math.abs(U).toFixed(2)} V` : e.kind === 'ammeter' ? `${Math.abs(I).toFixed(2)} A` : e.kind === 'switch' ? '' : `${Math.abs(U).toFixed(2)} V  ${Math.abs(I).toFixed(2)} A`;
        this.text(this.symbolsOnly ? symbolicReading(read) : read, lx, ly + (vertical ? 9 : 2), '500 13px "Times New Roman", serif', '#c8322b', al); }
    }
    g.fillStyle = INK; for (const p of Object.values(c.nodes)) { g.beginPath(); g.arc(this.px(p[0]), this.py(p[1]), 3, 0, 7); g.fill(); }
  }
  private bodyRadius() { return Math.max(Math.min(11, this.capPx(this.k)), Math.min(26, this.f.body * this.k / 2)); }
  /** 只画离开轨道后的路径；在轨道上的物体，轨道本身就是路径 */
  private trails(s: Snapshot) {
    for (const p of this.paths) { const done = p.pts.filter((q) => q[2] <= s.t + 1e-12); if (done.length > 1) this.line(done.map((q) => [q[0], q[1]] as V2), p.color, 1.7, [5, 5]); }
  }
  private radiusOf(id: string, s: Snapshot) {
    const p = bodyPose(this.sim!, this.f, id, s), host = s.bodies[id]?.on, L = host && this.isContainer(host) ? this.sim!.geo.bodies.find((b) => b.id === host)!.L : 0;
    const own = this.sim!.geo.bodies.find((q)=>q.id===id)!;
    let radius = Math.max(p.size * this.k / 2, Math.min(L ? Math.min(9, L * this.k * .3) : 9, this.capPx(this.k)));
    if (!own.L) for (const other of this.sim!.geo.bodies) {
      const a=s.bodies[id], b=s.bodies[other.id]; if(other.id===id || other.kind==='board' || !a || !b)continue;
      const real=Math.hypot(a.x-b.x,a.y-b.y), contact=((own.L||0)+(other.L||0))/2;
      if(real<=contact*1.05+1e-9)continue;
      const q=bodyPose(this.sim!,this.f,other.id,s), d=Math.hypot(p.c[0]-q.c[0],p.c[1]-q.c[1])*this.k;
      if(d>1e-9) radius=Math.min(radius,Math.max(other.L ? (d-other.L*this.k/2)*.9 : d*.45,0));
    }
    return radius;
  }
  private body(id: string, i: number, s: Snapshot) {
    const q = this.sim!.geo.bodies.find((b) => b.id === id)!, b = s.bodies[id]; if (!b) return;
    const g = this.g, pose = bodyPose(this.sim!, this.f, id, s), color = COLORS[i % COLORS.length], x = this.px(pose.c[0]), y = this.py(pose.c[1]), box0 = q.kind === 'board' ? hostBox(this.sim!, id, this.f.size) : null,
      // 管道画成两道壁（中心线两侧各 tw），方框的左右和顶也要包住管壁；底边不动（贴着下面的支撑）
      tw = this.sim!.geo.surfaces.some((g) => g.host === id && g.side === 'tube') ? this.bodyRadius() * 1.5 / this.k : 0,
      more = Math.max(0, tw - this.f.size * 0.8), box = box0 && more ? { ...box0, x0: box0.x0 - more, x1: box0.x1 + more, y1: box0.y1 + more } : box0;
    if (this.qa) { const Lp = pose.length * this.k, H = Math.max(9, pose.size * this.k), ca = Math.cos(pose.ang), sa = Math.sin(pose.ang); this.qa.bodies.push({ id, kind: q.kind, x, y, r: q.kind === 'board' ? 0 : this.radiusOf(id, s), hw: q.kind === 'board' ? Math.abs(ca) * Lp / 2 + Math.abs(sa) * H / 2 : 0, hh: q.kind === 'board' ? Math.abs(sa) * Lp / 2 + Math.abs(ca) * H / 2 : 0, wx: b.x, wy: b.y, size: q.L || 0, on: b.on ?? null, inset: this.qaInset }); }
    if (!box && q.kind !== 'board' && (x < -40 || x > this.w + 40 || y < -40 || y > this.h + 40)) return;   // 在画面外：不画，名字也不挤到边上
    if (box) { const a = this.px(b.x + box.x0), c = this.py(b.y + box.y1); g.strokeStyle = INK; g.lineWidth = 2; g.fillStyle = '#f0e4c8aa'; g.fillRect(a, c, (box.x1 - box.x0) * this.k, (box.y1 - box.y0) * this.k); g.strokeRect(a, c, (box.x1 - box.x0) * this.k, (box.y1 - box.y0) * this.k); this.tag(id, a + 16, c + 16); return; }
    if (q.look === 'rod') { const W = this.railWidth(b.on) * this.k, c = [this.px(b.x), this.py(b.y)]; g.strokeStyle = color; g.lineWidth = 6; g.beginPath(); g.moveTo(c[0], c[1] - W / 2 - 5); g.lineTo(c[0], c[1] + W / 2 + 5); g.stroke(); this.tag(id, c[0], c[1] - W / 2 - 22); return; }
    if (b.on && q.kind !== 'board') { const r0 = this.radiusOf(id, s); g.save(); g.translate(x, y); g.rotate(-pose.ang); g.fillStyle = 'rgba(40,30,10,.13)'; g.beginPath(); g.ellipse(0, r0 + 1, r0 * 1.15, 3.2, 0, 0, 7); g.fill(); g.restore(); }
    g.save(); g.translate(x, y); g.rotate(-pose.ang);
    const cav = q.kind === 'board' && this.isContainer(id) ? Math.max(this.cavity(id, s) * this.k, 10) : 0, closed = cav > 0 && Math.abs(Math.sin(pose.ang)) > .7;
    if (closed) {   // 竖着的容器（管、壳）：画成一段封闭的管子，里面的东西看得见
      const L = pose.length * this.k, H = Math.max(9, pose.size * this.k), y0 = -H / 2 - cav;
      g.fillStyle = '#fbf7ee'; g.fillRect(-L / 2, y0, L, cav); g.strokeStyle = INK; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-L / 2, y0); g.lineTo(L / 2, y0); g.moveTo(-L / 2, -H / 2); g.lineTo(L / 2, -H / 2); g.stroke();
      g.lineWidth = 3.4; g.beginPath(); g.moveTo(-L / 2, y0 - 1); g.lineTo(-L / 2, -H / 2 + 1); g.moveTo(L / 2, y0 - 1); g.lineTo(L / 2, -H / 2 + 1); g.stroke();
    } else if (q.kind === 'board') {
      const L = pose.length * this.k, H = Math.max(9, pose.size * this.k);
      g.fillStyle = WOOD; g.strokeStyle = INK; g.lineWidth = 1.5; g.fillRect(-L / 2, -H / 2, L, H); g.fillStyle = '#ffffff40'; g.fillRect(-L / 2, -H / 2, L, Math.max(1.5, H * .22)); g.strokeRect(-L / 2, -H / 2, L, H);
      const wh = cav ? H / 2 + cav : H * 2.2; g.lineWidth = 3.5; for (const [e, xx] of [[q.walls?.left, -L / 2], [q.walls?.right, L / 2]] as const) if (e !== undefined) { g.beginPath(); g.moveTo(xx, H / 2); g.lineTo(xx, -wh); g.stroke(); }
    } else if (q.kind === 'ball') {
      const r = this.radiusOf(id, s), roll = -(b.s ?? b.x) / Math.max(r / this.k, 1e-6);
      const gr = g.createRadialGradient(-r * .38, -r * .42, r * .08, 0, 0, r * 1.05); gr.addColorStop(0, tint(color)); gr.addColorStop(.45, color); gr.addColorStop(1, shade(color));
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 1.4; g.stroke();
      if (q.q) { g.restore(); this.tag(id, x, y-r-12, q.q>0?' (+)':' (−)'); return; }
      g.rotate(-roll); g.fillStyle = '#ffffffb0'; g.beginPath(); g.arc(r * .58, 0, Math.max(1.6, r * .13), 0, 7); g.fill();   // 表面一个小记号，看得出在转
    } else {
      const r = this.radiusOf(id, s), rr = Math.min(4, r * .2);
      const gb = g.createLinearGradient(0, -r, 0, r); gb.addColorStop(0, tint(color)); gb.addColorStop(.25, color); gb.addColorStop(1, shade(color));
      g.fillStyle = gb; g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.roundRect(-r, -r, 2 * r, 2 * r, rr); g.fill(); g.stroke();
    }
    g.restore();
    if (q.kind === 'board' && !closed) this.boardBreak(id, pose, x, y);
    // 所求物体的虚线圈：只在画面上有好几个小物体、不圈出来分不清问的是谁时才画；木板不圈
    if (id === this.focusId && q.kind !== 'board' && this.sim!.geo.bodies.filter((o) => o.kind !== 'board').length >= 2) {
      g.strokeStyle = '#d8332a99'; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath();
      if (q.kind === 'board') { const L = pose.length * this.k, H = Math.max(9, pose.size * this.k), e = 7; g.save(); g.translate(x, y); g.rotate(-pose.ang); g.roundRect(-L / 2 - e, -H / 2 - cav - e, L + 2 * e, H + cav + 2 * e, 8); g.restore(); }
      else g.arc(x, y, this.radiusOf(id, s) * 1.75, 0, 7);
      g.stroke(); g.setLineDash([]);
    }
    if (closed) { const H = Math.max(9, pose.size * this.k), L = pose.length * this.k, ca = Math.cos(pose.ang), sa = Math.sin(pose.ang), n = [-sa, -ca], r0 = H / 2 + cav / 2, cxp = x + n[0] * r0, cyp = y + n[1] * r0, hw = Math.abs(ca) * L / 2 + Math.abs(sa) * cav / 2, hh = Math.abs(sa) * L / 2 + Math.abs(ca) * cav / 2;
      const e = Math.max(0, L / 2 - 12); this.tag(id, cxp + n[0] * (cav / 2 + 18) + ca * e, cyp + n[1] * (cav / 2 + 18) - sa * e); }
    else if (q.kind === 'board') {   // 木板的名字写在左端外侧，不和上面物体的名字挤在一起
      const H = Math.max(9, pose.size * this.k), L = pose.length * this.k, ca = Math.cos(pose.ang), sa = Math.sin(pose.ang); g.font = `600 14px ${CJK}`; const w = g.measureText(id).width;
      const ex = x - ca * L / 2, ey = y + sa * L / 2, tx = ex - ca * (w / 2 + 10), ty = ey + sa * (w / 2 + 10) + 2;
      if (!this.clipT(ex, ey, x + ca * L / 2, y - sa * L / 2, 0)) { /* 整块板都在画面外，不写名字 */ }
      else if (tx > w / 2 + 6 && tx < this.w - w / 2 - 6) this.tag(id, tx, ty); else this.tag(id, Math.max(x - L / 2 + 16, Math.min(x + L / 2 - 16, this.w - 40)), y - H / 2 - 13);
    }
    else {
      const r = this.radiusOf(id, s), host = b.on && this.isContainer(b.on) ? b.on : null, hp = host ? s.bodies[host] : null;
      if (hp && Math.abs(Math.sin(hp.ang)) > .7) { const n = [-Math.sin(hp.ang), -Math.cos(hp.ang)], d = Math.max(this.cavity(host!, s) * this.k, 10) - pose.size * this.k / 2 + 18; this.tag(id, x + n[0] * d, y + n[1] * d); }   // 管子里的物体：名字写在管外
      else this.tag(id, x, y - r - 13);
    }
  }
  /** 物体名：登记到最后统一放，贴着物体找空位 */
  private tag(s: string, x: number, y: number, suffix = '') {
    const g = this.g, index = this.sim!.geo.bodies.findIndex((b) => b.id === s), color = index >= 0 ? COLORS[index % COLORS.length] : undefined;
    g.font = `600 14px ${CJK}`; const w = g.measureText(s+suffix).width + (color ? 18 : 4);
    this.labels.push({ x: x - w / 2, y: y - 9, w, h: 20, pri: 1, near: true, key: 'tag' + s + (this.qaInset ? 'i' : ''), optional: false, draw: (a, b) => {
      if (color) { g.fillStyle = color; g.beginPath(); g.arc(a + 5, b + 10, 3.5, 0, 7); g.fill(); this.qa?.nameDots.push({ id: s, color, x: a + 5, y: b + 10, inset: this.qaInset }); }
      this.name(s+suffix, a + (color ? 14 : 2), b + 15, INK, 14, 'left');
    } });
  }
  /** 点的字母（题图上的 A、B、C）：贴着点放 */
  private letter(s: string, x: number, y: number) { const g = this.g; g.font = `italic 600 15px ${MATH}`; const w = Math.max(14, g.measureText(s).width + 4); this.labels.push({ x, y, w, h: 18, pri: .8, near: true, key: 'pt' + s, optional: false, draw: (a, b) => this.name(s, a + w / 2, b + 14, INK, 15) }); }
  /** 物体名：字母斜体、下标小一号，中文正体 */
  private name(s: string, x: number, y: number, color: string, size: number, align: CanvasTextAlign = 'center') {
    const g = this.g, m = /^([A-Za-z])[_]?(\d{1,2}|[a-z])$/.exec(s);
    g.textBaseline = 'alphabetic'; g.fillStyle = color;
    if (m) {
      g.font = `italic 600 ${size}px ${MATH}`; const w = g.measureText(m[1]).width; const f2 = `500 ${Math.max(13, size * .68)}px ${MATH}`; const save = g.font; g.font = f2; const w2 = g.measureText(m[2]).width; g.font = save;
      const left = align === 'center' ? x - (w + w2) / 2 : align === 'left' ? x : x - w - w2;
      g.textAlign = 'left'; g.fillText(m[1], left, y); g.font = f2; g.fillText(m[2], left + w + .5, y + size * .22); return;
    }
    g.font = /^[A-Za-z]+$/.test(s) ? `italic 600 ${size}px ${MATH}` : `600 ${Math.max(13, size)}px ${CJK}`; g.textAlign = align; g.fillText(s, x, y);
  }
  private text(s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'center') { const g = this.g; g.font = font; g.textAlign = align; g.fillStyle = color; g.fillText(s, x, y); }
  private arrow(x: number, y: number, dx: number, dy: number, color: string, label?: string, pri = 1, pattern = false, width = 2.6, stableKey?: string) {
    const g = this.g, L = Math.hypot(dx, dy); if (L < 5) return; const ux = dx / L, uy = dy / L, head = Math.min(11, L * .45);
    g.strokeStyle = g.fillStyle = color; g.lineWidth = width; g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx - ux * head, y + dy - uy * head); g.stroke();
    g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx - ux * head - uy * head * .5, y + dy - uy * head + ux * head * .5); g.lineTo(x + dx - ux * head + uy * head * .5, y + dy - uy * head - ux * head * .5); g.closePath(); g.fill();
    if (pattern) return;   // 场区里铺的方向箭头只是底纹，文字可以盖在上面
    this.block(x, y, x + dx, y + dy); this.qa?.arrows.push({ x0: x, y0: y, x1: x + dx, y1: y + dy, inset: this.qaInset });
    if (label) this.quantity(label, x + dx + ((color === FORCE || color === MEANING.resultant) && dx < -1 ? -8 : 8), y + dy - 5, color, (color === FORCE || color === MEANING.resultant) && dx < -1 ? 'right' : 'left', true, pri > 1, [x + dx, y + dy], pri, color === FORCE || color === MEANING.resultant, stableKey);
  }
  /** 所有文字标签（物体名、点的字母、箭头的名字、考点读数、实验室文字）先登记，等物体、箭头、尺寸线都画完再统一放：
   * 先放要紧的（考点、讲解量、点的字母），再放其余的；次要标签找不到空位就不画，不压在别的字上 */
  private labels: { x: number; y: number; w: number; h: number; pri: number; near: boolean; key: string; optional: boolean; tip?: [number, number]; draw: (left: number, top: number, key: string) => void }[] = [];
  /** 每个标签上一帧放在哪（相对箭头尖的偏移）：位置不变就不挪，免得播放时标签来回跳 */
  private lastSpot = new Map<string, [number, number]>();
  private block(x0: number, y0: number, x1: number, y1: number) { if (this.sim?.board) this.qa?.obstacles.push({ x0, y0, x1, y1 }); const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 7)); for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; this.taken.push({ x: x - 4, y: y - 4, w: 8, h: 8 }); } }
  /** 先放要紧的（这一步讲的量、所求物体的量），再放其余的；次要标签找不到空位就不画，不压在别的字上 */
  private flushLabels() {
    const seen = new Map<string, number>();
    // 同名标签（两个摩擦力 f）各自记住自己上一帧的位置，不共用；同一优先级里，上一帧已经有位置的先放回去，新出现的标签不抢老标签的位置
    const list = this.labels.map((l) => { const n = seen.get(l.key) ?? 0; seen.set(l.key, n + 1); return { ...l, key: `${l.key}#${n}` }; })
      .sort((a, b) => a.pri - b.pri || Number(!this.lastSpot.has(a.key)) - Number(!this.lastSpot.has(b.key)));
    this.labels = [];
    for (const l of list) {
      const key = l.key;
      const at = l.near ? this.spotNear(l.x, l.y, l.w, l.h, key, l.optional, l.tip) : this.spot(l.x, l.y, l.w, l.h) as [number, number];
      if (!at) continue;
      const [left, top] = at;
      // 不再画虚线引线：同向的力共用一条线后标签少了，引线反而让画面乱
      this.qaAnchor = [l.x, l.y]; l.draw(left, top, key);
    }
  }
  /** 箭头名字：在箭头尖附近找最近的空位，离得越近越好，免得看成别的箭头的名字 */
  private spotNear(x: number, y: number, w: number, h: number, key = '', optional = false, tip?: [number,number]): [number, number] | null {
    const prior=this.lastSpot.get(key), preferred={x:x+w/2,y:y+h/2,w,h};
    const previous=prior?{...preferred,x:preferred.x+prior[0],y:preferred.y+prior[1]}:undefined;
    const obstacles=this.taken.map((r)=>({...r,x:r.x+r.w/2,y:r.y+r.h/2}));
    const velocity=key.includes(VEL), ground=velocity?this.sim?.geo.surfaces.find((s)=>s.kind==='ground'&&!s.host):undefined, floor=ground?this.py(ground.y!):this.h;
    if(velocity&&tip&&tip[1]<=floor&&floor<this.h)obstacles.push({x:this.w/2,y:(floor+this.h)/2,w:this.w,h:this.h-floor});
    const priorDistance=tip&&previous?Math.hypot(Math.max(previous.x-w/2-tip[0],0,tip[0]-previous.x-w/2),Math.max(previous.y-h/2-tip[1],0,tip[1]-previous.y-h/2)):0;
    const previousFree=previous&&(!tip||priorDistance<=42)&&previous.x-w/2>=4&&previous.x+w/2<=this.w-4&&previous.y-h/2>=4&&previous.y+h/2<=this.h-4&&!obstacles.some((o)=>overlaps(previous,o,1));
    const at=previousFree?previous:placeStableLabel(preferred,obstacles,this.w,this.h,previous,tip)??placeLabel(tip?preferred:previous??preferred,obstacles,this.w,this.h,tip);
    if(at){const left=at.x-w/2,top=at.y-h/2;this.taken.push({x:left,y:top,w,h});if(key)this.lastSpot.set(key,[left-x,top-y]);return [left,top];}
    if(optional){if(this.qa)this.qa.dropped++;return null;}
    const fallback=this.spot(x,y,w,h) as [number,number];if(key)this.lastSpot.set(key,[fallback[0]-x,fallback[1]-y]);return fallback;
  }

  /** 窄屏上箭头只写符号，数值看图像和读数 */
  private get compact() { return this.symbolsOnly || this.w < 560; }
  /** 找一个不和别的文字、物体重叠的位置：先试原位，再上下左右挪 */
  private taken: { x: number; y: number; w: number; h: number }[] = [];
  private spot(x: number, y: number, w: number, h: number) {
    const hit = (a: number, b: number) => this.taken.some((r) => a < r.x + r.w && a + w > r.x && b < r.y + r.h && b + h > r.y);
    for (const [dx, dy] of [[0, 0], [0, -h - 3], [0, h + 3], [w * .6, 0], [-w * .6, 0], [0, -2 * h - 6], [0, 2 * h + 6], [w + 6, -h], [-w - 6, -h], [w + 6, h], [-w - 6, h]]) {
      const a = Math.min(Math.max(x + dx, 4), this.w - w - 4), b = Math.min(Math.max(y + dy, 4), this.h - h - 4);
      if (!hit(a, b)) { this.taken.push({ x: a, y: b, w, h }); return [a, b]; }
    }
    const a = Math.min(Math.max(x, 4), this.w - w - 4), b = Math.min(Math.max(y, 4), this.h - h - 4); this.taken.push({ x: a, y: b, w, h }); if (this.qa) this.qa.forced++; return [a, b];
  }
  /** v = 2.40 m/s：物理量斜体，数值和单位正体；字母题数值是任取的，只写符号 */
  private quantity(s: string, x: number, y: number, color: string, align: CanvasTextAlign, near = false, optional = false, tip?: [number, number], pri = 1, keepValues = false, stableKey?: string) {
    const text=s.replace(/（长度为示意）$/, ''), note='';
    const g=this.g,i=text.indexOf(' '),raw=i<0?text:text.slice(0,i),rest=i<0||!keepValues&&(this.compact||color===VEL&&this.sim!.geo.bodies.length>1&&(!this.focusId||raw!==this.vName(this.focusId)))?'':text.slice(i),[sym,sub='']=raw.split('_');
    g.font=`italic 600 14px ${MATH}`;const a0=g.measureText(sym).width;g.font=`500 13px ${MATH}`;const a1=sub?g.measureText(sub).width+1:0,a=a0+a1,b=g.measureText(rest).width;
    const W=Math.max(a+b,note?g.measureText(note).width:0)+6,H=note?40:22,x0=align==='right'?x-W+6:x,inset=this.qaInset;
    this.labels.push({x:x0-3,y:y-14,w:W,h:H,pri,near,key:raw+color+(stableKey?`@${stableKey}`:''),optional,tip,draw:(left,top,key)=>{
      this.qa?.labels.push({s:key,x:left,y:top,w:W,h:H,tip:tip??null,inset,ax:this.qaAnchor[0],ay:this.qaAnchor[1]});
      const base=top+14;g.fillStyle=PAPER+'e6';g.beginPath();g.roundRect(left,top,W,H,3);g.fill();g.textAlign='left';g.font=`italic 600 14px ${MATH}`;g.fillStyle=color;g.fillText(sym,left+3,base);
      if(sub){g.font=`500 13px ${MATH}`;g.fillText(sub,left+3+a0+.5,base+3.5);}
      if(rest){g.font=`500 13px ${MATH}`;g.fillText(rest,left+3+a,base);}
      if(note){g.font=`500 13px ${MATH}`;g.fillText(note,left+3,top+33);}
    }});
  }
  /** 不止一个物体在动时，速度带下标 */
  private vName(id: string) { return this.sim!.geo.bodies.length > 1 && id.length <= 2 ? `v_${id}` : 'v'; }
  /** 水平速度箭头走邻近物体上方的空带，避免箭头尖落在下一物体内部。 */
  private velocityY(id: string, x: number, y: number, dx: number, s: Snapshot) {
    if(this.sim!.geo.bodies.length<2)return y;
    let top=y;
    const lo=Math.min(x,x+dx)-20,hi=Math.max(x,x+dx)+100;
    for(const q of this.sim!.geo.bodies){const b=s.bodies[q.id];if(!b)continue;const p=bodyPose(this.sim!,this.f,q.id,s),cx=this.px(p.c[0]),cy=this.py(p.c[1]),r=this.radiusOf(q.id,s);if(cx+r>=lo&&cx-r<=hi&&Math.abs(cy-y)<=r+60)top=Math.min(top,cy-r-18);}
    const lane=Math.max(0,this.sim!.geo.bodies.findIndex((q)=>q.id===id));
    return Math.max(28,top-lane*26);
  }
  private vectors(id: string, s: Snapshot) {
    const q = this.sim!.geo.bodies.find((b) => b.id === id)!, b = s.bodies[id]; if (!b) return;
    if (this.over.forces.includes(id)) return;   // 这一步在讲它的受力：速度箭头先不画，免得和力的箭头挤在一起
    const v = Math.hypot(b.vx, b.vy), pri = !this.focusId || id === this.focusId ? 1 : 2;   // 所求物体的读数一定显示，其余的放不下就省掉
    if (q.kind === 'board') {   // 木板、容器：速度箭头从前进方向的那一端画出去，不压住上面的物体
      if (!this.flags.velocity || v <= this.vmax * .01 || q.look) return;
      const c = this.centerOf(id, s)!, pose = bodyPose(this.sim!, this.f, id, s), L = (24 + v / this.vmax * 74) * this.arrowK, lab = `${this.vName(id)} = ${v.toFixed(2)} m/s`;
      if (this.isContainer(id) && Math.abs(Math.sin(pose.ang)) > .7) {   // 竖着的管子：箭头画在管子外侧，和里面物体的箭头分开
        const side = Math.max(this.cavity(id, s) * this.k, 10) / 2 + 12, nx = Math.sin(pose.ang), ny = Math.cos(pose.ang);
        this.arrow(c[0] + nx * side - b.vx / v * L / 2, c[1] + ny * side + b.vy / v * L / 2, b.vx / v * L, -b.vy / v * L, VEL, lab, pri); return;
      }
      const ex = Math.abs(b.vx / v * Math.cos(pose.ang) + b.vy / v * Math.sin(pose.ang)) * pose.length * this.k / 2;
      let sx = c[0] + b.vx / v * (ex + 4), sy = c[1] - b.vy / v * (ex + 4);
      if (sx < 20 || sx > this.w - 20 - Math.max(0, b.vx / v * L) - 60) { sx = Math.min(Math.max(c[0], 150), this.w - 190); sy = c[1]; }   // 长木板的端点在画面外：箭头画在看得见的那段板上
      if(Math.abs(b.vy)<Math.abs(b.vx)*.05)sy=this.velocityY(id,sx,sy,b.vx/v*L,s);
      this.arrow(sx, sy, b.vx / v * L, -b.vy / v * L, VEL, lab, pri); return;
    }
    const p = this.screenOf(id)!, r = this.radiusOf(id, s);
    if (this.flags.velocity && v > this.vmax * .01) { const L = (24 + v / this.vmax * 74) * this.arrowK,x=p[0]+b.vx/v*r,y=p[1]-b.vy/v*r,sy=Math.abs(b.vy)<Math.abs(b.vx)*.05?this.velocityY(id,x,y,b.vx/v*L,s):y; this.arrow(x, sy, b.vx / v * L, -b.vy / v * L, VEL, `${this.vName(id)} = ${v.toFixed(2)} m/s`, pri); }
  }
  private springs(s: Snapshot) {
    for (const sp of Object.values(s.springs ?? {})) {
      const e = springEnds(this.sim!, this.f, s, sp); let { p, q } = e; const { ia, ib } = e;
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, gap = sp.contact && sp.x >= 0 ? Math.min(L, sp.L0 ?? L) : L;
      if (!ia) { const n = 14 / this.k; this.line([[p[0] - uy * n, p[1] + ux * n], [p[0] + uy * n, p[1] - ux * n]], INK, 3.5); }
      p = [p[0] + ux * ia, p[1] + uy * ia]; const len = Math.max(gap - ia - ib, .05 * L); q = [p[0] + ux * len, p[1] + uy * len];
      this.coil([this.px(p[0]), this.py(p[1])], [this.px(q[0]), this.py(q[1])]);
    }
  }
  private coil(a: number[], b: number[]) {
    const g = this.g, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, n = 12, amp = 8;
    g.strokeStyle = INK; g.lineWidth = 1.6; g.beginPath(); g.moveTo(a[0], a[1]);
    for (let i = 1; i < n * 2; i++) { const d = L * (.08 + .84 * i / (n * 2)), o = i % 2 ? amp : -amp; g.lineTo(a[0] + ux * d - uy * o, a[1] + uy * d + ux * o); }
    g.lineTo(b[0], b[1]); g.stroke();
  }
  private ropes(s: Snapshot) {
    for (const r of this.sim!.ropes ?? []) {
      const A = s.bodies[r.a], B = s.bodies[r.b]; if (!A || !B || !A.on || !B.on) continue;
      this.line([bodyPose(this.sim!, this.f, r.a, s).c, ...r.via, bodyPose(this.sim!, this.f, r.b, s).c], INK, 1.6);
      for (const p of r.via) { const g = this.g, x = this.px(p[0]), y = this.py(p[1]), R = 9; g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 1.8; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); g.stroke(); const a = s.t * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); g.stroke(); g.fillStyle = INK; g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); }
    }
  }
  private script(s: Snapshot) {
    const f = s.script; if (!f) return;
    for (const q of f.curves) { this.line(q.pts.map((p) => [p[0], p[1]] as V2), SOFT, 1.8); if (q.label) { const p = q.pts.at(-1)!; this.text(q.label, this.px(p[0]) + 8, this.py(p[1]), '500 13px "Songti SC", serif', SOFT, 'left'); } }
    for (const l of f.links) { const a = [this.px(l.a[0]), this.py(l.a[1])], b = [this.px(l.b[0]), this.py(l.b[1])]; if (l.kind === 'spring') this.coil(a, b); else this.line([[l.a[0], l.a[1]], [l.b[0], l.b[1]]], INK, l.kind === 'rod' ? 3.5 : 1.6); }
    for (const v of f.vectors) {
      const b = s.bodies[v.on]; if (!b) continue;
      const m = Math.hypot(v.v[0], v.v[1]); if (m < 1e-9) continue;
      const p = this.screenOf(v.on)!, scale = Math.min(90, 34 + m * 3), resultant=/F合|ΣF/.test(v.label??''), color=v.kind==='velocity'?VEL:resultant?MEANING.resultant:FORCE, width=resultant?3:2;
      const dx=v.v[0]/m*scale,dy=-v.v[1]/m*scale;
      this.arrow(p[0],p[1],dx,dy,color,v.label,1,false,width);
      if(v.kind!=='velocity')this.qa?.forceArrows.push({x:v.v[0],y:v.v[1],magnitude:Math.hypot(...v.v),length:scale,schematic:false,label:v.label??'',color,width,resultant,body:v.on,x0:p[0],y0:p[1],x1:p[0]+dx,y1:p[1]+dy});
    }
  }
  dispose() { this.canvas.remove(); }
}

type Box = { x: number; y: number; w: number; h: number };
export type QaFrame = {
  t: number; w: number; h: number; k: number; ky: number; ox: number; oy: number; bounds: unknown; mode: string; follow: boolean; focus: string | null;
  texts: (Box & { s: string; color: string; inset: boolean; rot: boolean; outline: string; outlineWidth: number; font: string })[];
  bodies: { id: string; kind: string; x: number; y: number; r: number; hw: number; hh: number; wx: number; wy: number; size: number; on: string | null; inset: boolean }[];
  obstacles: { x0: number; y0: number; x1: number; y1: number }[];
  nameDots: { id: string; color: string; x: number; y: number; inset: boolean }[];
  forceArrows: (ForceGlyph & { body: string; x0: number; y0: number; x1: number; y1: number })[];
  arrows: { x0: number; y0: number; x1: number; y1: number; inset: boolean }[];
  labels: (Box & { s: string; tip: [number, number] | null; inset: boolean; ax: number; ay: number })[];
  forced: number; dropped: number;
  keep: { kind: string; id: string; real: number; screen: number; x: number; y: number }[];
  inset: (Box & { z: number }) | null;
};
/** 长度读数：按大小选单位 */
const fmtLen = (L: number) => { const a = Math.abs(L); return a >= 1000 ? `${+(L / 1000).toPrecision(3)} km` : a >= 1 ? `${+L.toPrecision(3)} m` : a >= .01 ? `${+(L * 100).toPrecision(3)} cm` : a >= 1e-3 ? `${+(L * 1000).toPrecision(3)} mm` : `${L.toExponential(2)} m`; };
const tint = (hex: string) => { const n = parseInt(hex.slice(1), 16), f = (x: number) => Math.round(x + (255 - x) * .42); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
const shade = (hex: string) => { const n = parseInt(hex.slice(1), 16), f = (x: number) => Math.round(x * .55); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
/** 合加速度方向：直线段用引擎值，其余用相邻采样估计 */
export function force(sim: SimResult, id: string, b: BodySnap, s: Snapshot): V2 | null {
  if (b.a !== undefined && Number.isFinite(b.a)) return [b.a * Math.cos(b.ang), b.a * Math.sin(b.ang)];
  const i = sim.samples.findIndex((p) => p.t >= s.t), p = sim.samples[Math.max(0, i - 1)], q = sim.samples[Math.min(sim.samples.length - 1, i + 1)];
  if (!p || !q || q.t <= p.t || !p.bodies[id] || !q.bodies[id]) return null;
  return [(q.bodies[id].vx - p.bodies[id].vx) / (q.t - p.t), (q.bodies[id].vy - p.bodies[id].vy) / (q.t - p.t)];
}

/** 字母题实验读数仅保留量名；无法可靠拆开的数值明确标作示例。 */
function symbolicReading(s: string) {
  const symbols = s.replace(/\s*=\s*[-+]?\d+(?:\.\d+)?(?:e[+-]?\d+)?(?:\s*(?:m\/s²|m\/s|m³|m²|kg|Pa|Hz|Ω|N|J|W|A|V|K|s|m|°))?/gi, '');
  return /\d/.test(symbols) && !symbols.includes('示例') ? `${symbols}（示例）` : symbols;
}
