// 可动支撑的解析对照；只构造通用模型，不依赖题库。
import assert from 'node:assert/strict';
import { simulate, type SceneSpec, type Snapshot } from '../engine/sim.ts';
import { validate } from '../engine/validate.ts';
import { type Problem } from '../engine/solve.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const near = (a: number, b: number, tol = 2e-7) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const P = (scene: SceneSpec): Problem => ({ spec: 'v1', constants: { g: 10 }, scene, asks: [{ id: '1', text: '速度', expr: 'vx(楔)' }] });
const wedge = (M = 1, m = 1, th = Math.PI / 6, mu = 0, groundMu = 0): SceneSpec => ({
  surfaces: [{ id: '地', kind: 'ground', y: 0, mu: groundMu }, { id: '斜', on: '楔', from: [0, 20], dir: [Math.cos(th), -Math.sin(th)], length: 30, mu }],
  bodies: [{ id: '楔', kind: 'board', m: M, length: 30, on: '地', x: 0 }, { id: '块', m, on: '斜', at: 1 }], tMax: .3,
});
const energy = (s: Snapshot, M: number, m: number) => { const a = s.bodies.楔, b = s.bodies.块; return .5 * M * (a.vx ** 2 + a.vy ** 2) + .5 * m * (b.vx ** 2 + b.vy ** 2) + 10 * (M * a.y + m * b.y); };
for (const [M, m, th] of [[1, 1, Math.PI / 6], [3, .7, 37 * Math.PI / 180], [.4, 2, Math.PI / 3]]) test(`光滑楔块：M=${M} m=${m} θ=${th * 180 / Math.PI}°，加速度/动量/能量`, () => {
  const sc = wedge(M, m, th); assert.deepEqual(validate(P(sc)), []);
  const r = simulate(sc, { g: 10 }, { sample: .02 }), sn = Math.sin(th), c = Math.cos(th), A = -m * 10 * sn * c / (M + m * sn * sn), ar = (M + m) * 10 * sn / (M + m * sn * sn);
  near(r.stages[0].acc.楔, A); near(r.stages[0].acc.块, ar);
  for (const s of [...r.samples, r.end]) { near(s.bodies.楔.vx, A * s.t); near(s.bodies.块.s!, 1 + .5 * ar * s.t ** 2); near(M * s.bodies.楔.vx + m * s.bodies.块.vx, 0); near(energy(s, M, m), energy(r.start, M, m)); }
  // 用引擎返回的力图也能复核楔块合力（含物块对斜面的反作用）。
  const fs = r.samples.at(-1)!.bodies.楔.fs!; near(fs.reduce((a, f) => a + f.x, 0), M * A); near(fs.reduce((a, f) => a + f.y, 0), 0);
});
test('四分之一圆弧：最低点速度、质心位移、全程水平动量和机械能', () => {
  const M = 2, m = .8, R = 1.7;
  const sc: SceneSpec = { surfaces: [{ id: '地', kind: 'ground', y: 0 }, { id: '弧', kind: 'arc', on: '楔', center: [R, R], radius: R, start: 180, end: 270, side: 'inside', marks: { 底: 270 } }], bodies: [{ id: '楔', kind: 'board', m: M, length: 4, on: '地', x: 0 }, { id: '块', kind: 'ball', m, on: '弧', at: 0 }], until: { event: 'pass', body: '块', to: '底' }, tMax: 3 };
  assert.deepEqual(validate(P(sc)), []); const r = simulate(sc, { g: 10 }, { sample: .01 }), e = r.events.find((e) => e.type === 'pass' && e.b === '底'); assert.ok(e, '应到达最低点');
  const s = e!.snap, vr = Math.sqrt(20 * R * (M + m) / M); near(s.bodies.楔.vx, -m * vr / (M + m)); near(s.bodies.块.vx, M * vr / (M + m)); near(s.bodies.块.vy, 0);
  near(s.bodies.楔.x - r.start.bodies.楔.x, -m * R / (M + m));
  for (const q of [...r.samples, s]) { near(M * q.bodies.楔.vx + m * q.bodies.块.vx, 0); near(energy(q, M, m), energy(r.start, M, m)); near(M * (q.bodies.楔.x - r.start.bodies.楔.x) + m * (q.bodies.块.x - r.start.bodies.块.x), 0); }
});
for (const mu of [.1, .35]) test(`粗糙斜面/光滑地面 μ=${mu}，反作用与热量`, () => {
  // T=(c,-s)，n=(s,c)，下滑时 f=-μN；块：N=m(gc+A s)，ar=g s-A c-μN/m。
  // 楔：M A=-N(s-μc)，所以 A=-mgc(s-μc)/(M+m s(s-μc))。
  const M = 2, m = 1.3, th = Math.PI / 6, sn = Math.sin(th), c = Math.cos(th), d = sn - mu * c;
  const A = -m * 10 * c * d / (M + m * sn * d), N = m * (10 * c + A * sn), ar = 10 * sn - A * c - mu * N / m;
  const sc = wedge(M, m, th, mu); assert.deepEqual(validate(P(sc)), []); const r = simulate(sc, { g: 10 }, { sample: .03 });
  near(r.stages[0].acc.楔, A); near(r.stages[0].acc.块, ar); near(r.stages[0].modes.find((m) => m.upper === '块')!.N, N);
  for (const q of [...r.samples, r.end]) { near(M * q.bodies.楔.vx + m * q.bodies.块.vx, 0); near(energy(q, M, m) + Object.values(q.heat).reduce((a, b) => a + b, 0), energy(r.start, M, m)); }
});
for (const mu of [Math.tan(Math.PI / 6), .8]) test(`斜面静摩擦临界 μ=${mu}，两体保持静止`, () => {
  const r = simulate(wedge(1, 1, Math.PI / 6, mu), { g: 10 }); near(r.stages[0].acc.楔, 0); near(r.stages[0].acc.块, 0); near(r.end.bodies.楔.vx, 0); near(r.end.bodies.块.vx, 0);
});
for (const ug of [.4, .03]) test(`楔块/地面摩擦 μg=${ug}，静止或滑动由联立受力决定`, () => {
  // 楔底 Rg=Mg+N(c+μs)，静止需 f地=N(s-μc)≤μg Rg。
  // 向左滑动时 MA=-N(s-μc)+μg[Mg+N(c+μs)]，与 N=m(gc+A s) 联立。
  const M = 2, m = 1, th = Math.PI / 6, mu = .1, sn = Math.sin(th), c = Math.cos(th), d = sn - mu * c, e = c + mu * sn;
  const fixed = m * 10 * c * d <= ug * (M * 10 + m * 10 * c * e);
  const A = fixed ? 0 : (ug * M * 10 + m * 10 * c * (ug * e - d)) / (M - m * sn * (ug * e - d)), N = m * (10 * c + A * sn), ar = 10 * sn - A * c - mu * N / m;
  const sc = wedge(M, m, th, mu, ug); assert.deepEqual(validate(P(sc)), []); const r = simulate(sc, { g: 10 }, { sample: .02 });
  near(r.stages[0].acc.楔, A); near(r.stages[0].acc.块, ar); near(r.end.bodies.楔.vx, A * r.end.t);
  near(r.stages[0].modes.find((m) => m.upper === '楔')!.N, M * 10 + N * e);
  near(energy(r.end, M, m) + Object.values(r.end.heat).reduce((a, b) => a + b, 0), energy(r.start, M, m));
});
test('宿主叠在光滑底板上：底板不受水平力，承受正确的竖直载荷', () => {
  const sc = wedge(); sc.bodies.unshift({ id: '底板', kind: 'board', m: 3, length: 100, on: '地', x: -10 }); sc.bodies[1].on = '底板'; sc.bodies[1].at = 10; delete sc.bodies[1].x;
  const r = simulate(sc, { g: 10 }); near(r.stages[0].acc.底板, 0); near(r.stages[0].acc.楔, -Math.sqrt(12)); near(r.stages[0].modes.find((m) => m.upper === '底板')!.N, 46);
});
test('宿主与底板静摩擦粘住：两层质量一起参与，地面载荷随块运动变化', () => {
  const sc = wedge(); sc.bodies.unshift({ id: '底板', kind: 'board', m: 3, length: 100, on: '地', x: -10 }); sc.bodies[1].on = '底板'; sc.bodies[1].at = 10; delete sc.bodies[1].x; sc.friction = [{ between: ['楔', '底板'], mu: 1 }];
  const r = simulate(sc, { g: 10 }), A = -10 * .5 * Math.sqrt(.75) / 4.25; near(r.stages[0].acc.底板, A); near(r.stages[0].acc.楔, A); near(r.stages[0].acc.块, 50 * .5 / 4.25);
});
test('圆弧载荷变化使地面静摩擦失效：记录 slip 后重新联立', () => {
  const sc: SceneSpec = { surfaces: [{ id: '地', kind: 'ground', y: 0, mu: .08 }, { id: '弧', kind: 'arc', on: '楔', center: [1, 1], radius: 1, start: 180, end: 270, side: 'inside' }], bodies: [{ id: '楔', kind: 'board', m: 1, length: 3, on: '地', x: 0 }, { id: '块', m: 1, on: '弧', at: 0 }], tMax: .5 };
  const r = simulate(sc, { g: 10 }, { sample: .01 }); assert.ok(r.events.some((e) => e.type === 'slip' && e.a === '楔')); assert.ok(r.end.bodies.楔.vx < 0);
});
test('粗糙可动圆弧：摩擦反作用守恒水平动量，机械能损失等于热量', () => {
  const sc: SceneSpec = { surfaces: [{ id: '地', kind: 'ground', y: 0 }, { id: '弧', kind: 'arc', on: '楔', center: [1, 1], radius: 1, start: 180, end: 270, side: 'inside', mu: .15, marks: { 底: 270 } }], bodies: [{ id: '楔', kind: 'board', m: 2, length: 3, on: '地', x: 0 }, { id: '块', m: 1, on: '弧', at: 0 }], until: { event: 'pass', body: '块', to: '底' }, tMax: 3 };
  assert.deepEqual(validate(P(sc)), []); const r = simulate(sc, { g: 10 }, { sample: .02 }); assert.ok(r.events.some((e) => e.type === 'pass' && e.b === '底'));
  for (const q of [...r.samples, r.end]) { near(2 * q.bodies.楔.vx + q.bodies.块.vx, 0); near(energy(q, 2, 1) + Object.values(q.heat).reduce((a, b) => a + b, 0), energy(r.start, 2, 1)); }
});
test('木板 next 进圆弧、折返再回木板：速度换参考系正确且无位置跳变', () => {
  const sc: SceneSpec = { surfaces: [{ id: '地', kind: 'ground', y: 0 }, { id: '弧', kind: 'arc', on: '楔', center: [5, 2], radius: 2, start: -90, end: 0, side: 'inside' }], bodies: [{ id: '楔', kind: 'board', m: 2, length: 5, on: '地', x: 0, next: '弧' }, { id: '块', m: 1, on: '楔', at: 4.9, v: 2 }], tMax: 2 };
  assert.deepEqual(validate(P(sc)), []); const r = simulate(sc, { g: 10 }, { sample: .01 }); assert.ok(r.events.some((e) => e.type === 'enter' && e.b === '弧')); assert.ok(r.events.some((e) => e.type === 'enter' && e.b === '楔'));
  near(r.end.bodies.楔.vx, 4 / 3); near(r.end.bodies.块.vx, -2 / 3);
  for (const q of [...r.samples, r.end]) { near(2 * q.bodies.楔.vx + q.bodies.块.vx, 2); near(energy(q, 2, 1), energy(r.start, 2, 1)); near(2 * (q.bodies.楔.x - r.start.bodies.楔.x) + q.bodies.块.x - r.start.bodies.块.x, 2 * q.t); }
});
test('水平俯视的可动直线：摩擦法向用纸面外总重量，不能用面内导向力', () => {
  const sc: SceneSpec = { plane: 'horizontal', surfaces: [{ id: '地', kind: 'ground', y: 0, mu: .02 }, { id: '槽', on: '楔', from: [0, 0], to: [10, 0], mu: .1 }], bodies: [{ id: '楔', kind: 'board', m: 2, length: 10, on: '地', x: 0 }, { id: '块', m: 1, on: '槽', at: 1, v: 3 }], tMax: .3 };
  assert.deepEqual(validate(P(sc)), []); const r = simulate(sc, { g: 10 }); near(r.stages[0].acc.楔, .2); near(r.stages[0].acc.块, -1.2); near(r.stages[0].modes.find((m) => m.upper === '楔')!.N, 30);
  near(energy(r.end, 2, 1) + Object.values(r.end.heat).reduce((a, b) => a + b, 0), energy(r.start, 2, 1));
});
test('水平粗糙圆弧：摩擦生热也用重量，不能误用向心力', () => {
  const sc: SceneSpec = { plane: 'horizontal', surfaces: [{ id: '弧', kind: 'arc', center: [0, 0], radius: 2, start: 0, end: 180, mu: .1 }], bodies: [{ id: '块', m: 1, on: '弧', at: 0, v: 10 }], tMax: .1 };
  const r = simulate(sc, { g: 10 }), b = r.end.bodies.块, Q = Object.values(r.end.heat).reduce((a, b) => a + b, 0); near(Math.hypot(b.vx, b.vy), 9.9); near(Q, .995); near(.5 * (b.vx ** 2 + b.vy ** 2) + Q, 50);
});
test('同一宿主承载多个物块：反作用相加后一起联立，不逐个覆盖', () => {
  const sc = wedge(2, 1); sc.surfaces.push({ id: '斜乙', on: '楔', from: [2, 20], dir: [.8, -.6], length: 30 }); sc.bodies.push({ id: '乙', m: 3, on: '斜乙', at: 1 });
  assert.deepEqual(validate(P(sc)), []); const r = simulate(sc, { g: 10 }), A = -10 * (.5 * Math.sqrt(.75) + 3 * .6 * .8) / (2 + .25 + 3 * .36);
  near(r.stages[0].acc.楔, A); near(r.stages[0].acc.块, 5 - A * Math.sqrt(.75)); near(r.stages[0].acc.乙, 6 - A * .8); near(2 * r.end.bodies.楔.vx + r.end.bodies.块.vx + 3 * r.end.bodies.乙.vx, 0);
});
test('撤力时刻使缓存失效：同一瞬时状态重新联立反作用和摩擦', () => {
  const sc = wedge(2, 1, Math.asin(.6), .1); sc.forces = [{ on: '楔', F: [2, 0], until: { event: 'time', t: .1 } }]; sc.tMax = .2;
  const r = simulate(sc, { g: 10 }, { sample: .01 }), before = (2 - 10 * .8 * (.6 - .1 * .8)) / (2 + .6 * (.6 - .1 * .8)), after = -10 * .8 * (.6 - .1 * .8) / (2 + .6 * (.6 - .1 * .8));
  near(r.stages[0].acc.楔, before); near(r.stages[1].acc.楔, after); near(r.end.bodies.楔.vx, .1 * (before + after)); near(2 * r.end.bodies.楔.vx + r.end.bodies.块.vx, .2);
});
const reject = (sc: SceneSpec, pattern: RegExp) => { const es = validate(P(sc)); assert.ok(es.some((e) => pattern.test(e)), es.join('\n')); assert.ok(es.some((e) => /ode|script/.test(e)), '需给出建模替代路径'); };
test('拒绝：可动轨道同轨碰撞及粘连', () => { for (const e of [0, 1]) { const sc = wedge(); sc.bodies.push({ id: '乙', m: 1, on: '斜', at: 2 }); sc.collisions = [{ bodies: ['块', '乙'], e }]; reject(sc, /冲量\/粘连/); } });
test('拒绝：宿主木板碰撞和可动轨道挡板', () => { const sc = wedge(); sc.collisions = [{ bodies: ['楔', '块'], e: 1 }]; reject(sc, /冲量/); delete sc.collisions; sc.surfaces[1].walls = { end: 1 }; reject(sc, /挡板冲量/); });
test('拒绝：板上物块挂绳、可动轨道挂绳、宿主挂绳', () => { for (const id of ['块', '楔', '板上']) { const sc = wedge(); sc.bodies.push({ id: '板上', m: 1, on: '楔', at: 2 }); sc.ropes = [{ between: [id, '板上'] }]; reject(sc, /绳端/); } });
test('拒绝：空中弹簧、非共线或错开的直线弹簧', () => {
  for (const kind of ['空中', '非共线', '错开']) { const sc: SceneSpec = { surfaces: [{ id: '甲轨', from: [0, 0], to: [10, 0] }, { id: '乙轨', from: [0, 1], to: kind === '非共线' ? [10, 2] : [10, 1] }], bodies: [{ id: '楔', m: 1, on: '甲轨', at: 1 }, kind === '空中' ? { id: '乙', m: 1, pos: [1, 1] } : { id: '乙', m: 1, on: '乙轨', at: 1 }], springs: [{ id: '簧', between: ['楔', '乙'], k: 1 }] }; reject(sc, /弹簧/); }
});
test('拒绝：自由宿主、嵌套可动轨道、跨参考系 next', () => {
  const free = wedge(); delete free.bodies[0].on; delete free.bodies[0].x; free.bodies[0].pos = [0, 0]; reject(free, /宿主/);
  const nested = wedge(); nested.bodies[0].on = '斜'; reject(nested, /宿主/);
  const join = wedge(); join.surfaces[1].next = '地'; reject(join, /跨参考系/);
});
test('拒绝：轨道上的电磁力/中心引力不再被忽略', () => { const sc = wedge(); sc.bodies[1].q = 1; sc.em = [{ kind: 'E', E: [1, 0] }]; reject(sc, /电磁力/); });
test('拒绝：外力使初始支撑失效，以及宿主运动中离开直线约束', () => {
  const lifted = wedge(); lifted.forces = [{ on: '楔', F: [0, 30] }]; reject(lifted, /初态约束/);
  const end = wedge(); end.bodies[0].length = .01; end.surfaces[0] = { id: '地', from: [0, 0], to: [1, 0] }; assert.throws(() => simulate(end, { g: 10 }), /宿主已脱离/);
});
test('拒绝：空中带电粘连后逐粒子施加场力会拆开组合体', () => {
  const sc: SceneSpec = { surfaces: [], bodies: [{ id: '楔', m: 1, q: 1, pos: [0, 0], vel: [1, 0] }, { id: '乙', m: 2, q: 0, pos: [1, 0] }], em: [{ kind: 'E', E: [0, 1] }], collisions: [{ bodies: ['楔', '乙'], e: 0 }] }; reject(sc, /整体约束/);
});
test('拒绝：可动轨道接续折角、负摩擦、粗糙双侧管道', () => {
  const sc = wedge(); sc.surfaces.push({ id: '折', on: '楔', from: [30 * Math.sqrt(.75), 5], dir: [1, 0], length: 20 }); sc.surfaces[1].next = '折'; reject(sc, /正向切线/);
  const rough = wedge(); rough.surfaces.push({ id: '管', kind: 'arc', on: '楔', center: [0, 2], radius: 2, start: 180, end: 270, side: 'tube', mu: .1 }); reject(rough, /双侧接触/);
  const negative = wedge(); negative.surfaces[1].mu = -.1; assert.ok(validate(P(negative)).some((e) => /mu 必须非负/.test(e)));
});
test('可动轨道出轨后碰撞仍合法：限制按碰撞实际时刻检查', () => {
  const sc = wedge(); sc.bodies.push({ id: '乙', m: 1, on: '地', at: 100 }); sc.collisions = [{ bodies: ['块', '乙'], e: 0 }]; assert.deepEqual(validate(P(sc)), []);
});
test('有弹簧时静摩擦到阈值才开始滑：保留原有直线规则', () => {
  const sc: SceneSpec = { surfaces: [{ id: '地', kind: 'ground', y: 0, mu: .2 }], bodies: [{ id: '楔', m: 1, on: '地', x: 0 }, { id: '拉端', m: 1, on: '地', x: 2, v: 2 }], springs: [{ id: '簧', between: ['楔', '拉端'], k: 10, L0: 2 }], tMax: .5 };
  const r = simulate(sc, { g: 10 }), e = r.events.find((e) => e.type === 'slip' && e.a === '楔'); assert.ok(e); near(e!.snap.springs.簧.F, 2, 2e-6);
});
test('拒绝：绳的初始速度不相容、初态需负拉力、动态松弛后强行再绷紧', () => {
  const rope = (): SceneSpec => ({ surfaces: [{ id: '线', from: [-20, 0], to: [20, 0] }], bodies: [{ id: '楔', m: 1, on: '线', at: 19 }, { id: '乙', m: 1, on: '线', at: 21 }], ropes: [{ between: ['楔', '乙'] }], tMax: 1 });
  const badV = rope(); badV.bodies[1].v = 1; reject(badV, /初速度/);
  const slack = rope(); slack.forces = [{ on: '楔', F: [1, 0] }]; reject(slack, /初态约束/);
  const dynamic = rope(); dynamic.forces = [{ on: '楔', F: ['2*t-1', 0] }]; assert.deepEqual(validate(P(dynamic)), []); assert.throws(() => simulate(dynamic, { g: 10 }), /松绳|松弛/);
});
test('拒绝：绳端冲量不能只改一个端点的速度', () => {
  for (const k of ['挡板', '损失', '碰撞', '变速']) {
    const sc: SceneSpec = { surfaces: [{ id: '线', from: [-20, 0], to: [20, 0] }], bodies: [{ id: '楔', m: 1, on: '线', at: 19 }, { id: '乙', m: 1, on: '线', at: 21 }], ropes: [{ between: ['楔', '乙'] }] };
    if (k === '挡板') sc.surfaces[0].walls = { end: 1 }; if (k === '损失') sc.surfaces[0].losses = [{ at: 22, fraction: .1 }]; if (k === '碰撞') sc.collisions = [{ bodies: ['楔', '乙'], e: 1 }]; if (k === '变速') sc.kicks = [{ on: '楔', when: { event: 'time', t: 1 }, dv: 1 }]; reject(sc, /绳的冲量/);
  }
});
test('运行期拒绝：粘连后只对其中一体瞬时变速会破坏整体约束', () => {
  const sc: SceneSpec = { plane: 'horizontal', surfaces: [], bodies: [{ id: '楔', m: 1, pos: [0, 0], vel: [1, 0] }, { id: '乙', m: 1, pos: [2, 0], vel: [-1, 0] }], collisions: [{ bodies: ['楔', '乙'], e: 0 }], kicks: [{ on: '楔', when: { event: 'time', t: 1.5 }, vel: [1, 0] }], tMax: 2 };
  assert.throws(() => simulate(sc, { g: 10 }), /粘连组.*瞬时变速/);
});
test('拒绝：实验室与原生力学或另一个实验室拼接，不会自动耦合', () => {
  const sc = wedge(); sc.induction = { kind: 'coil', B: 't', S: 1, R: 1 }; reject(sc, /不会.*耦合/);
  const two: SceneSpec = { surfaces: [], bodies: [], induction: { kind: 'coil', B: 't', S: 1, R: 1 }, circuit: { nodes: { a: [0, 0], b: [1, 0] }, elements: [{ id: 'R', kind: 'R', a: 'a', b: 'b', R: 1 }] } }; reject(two, /只会执行一个/);
});
console.log(`\n可动支撑测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
