// 第三轮自编解析题。不读取盲测题和回复，不以题名分支。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { simulate, findEvent, type SceneSpec } from '../engine/sim.ts';
import { solveProblem, solveProgressively, type Problem } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
import { verificationCounts } from '../engine/source.ts';
import { overlaps, placeLabel, type Rect } from '../player/label-layout.ts';
let passed = 0;
const near = (a: number, b: number, tol = 1e-7) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
const flat = (): SceneSpec => ({ surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: '车', m: 2, on: '地', x: 0, v: 3 }], tMax: 1 });
const problem = (scene = flat()): Problem => ({ spec: 'v1', constants: { g: 10 }, scene, asks: [{ id: '1', text: '末速', expr: 'v(车)', answer: 3 }] });
function test(name: string, fn: () => void) { fn(); passed++; console.log(`✓ ${name}`); }

test('1 只有 answer 的公式、数值和不等式均允许，只计仅代数', () => {
  for (const answer of ['sqrt(13)', 7, 'u>0']) {
    const p = problem(); p.asks = [{ id: '1', text: '保留推导', answer }];
    assert.deepEqual(validate(p), []); const s = solveProblem(p);
    assert.equal(s.asks[0].shown, String(answer)); assert.equal(s.asks[0].ok, null); assert.equal(s.asks[0].source, 'algebra');
    assert.equal(s.label, '仅代数，未模拟验证'); assert.deepEqual(verificationCounts(s.asks), { ...verificationCounts([]), algebra: 1 });
  }
});
test('1 两组混合问题与步骤如实分开统计；未写 expr 不会自动复制 answer', () => {
  const p = problem(); p.params = { u: [3, 'm/s', '数值任取'] }; p.samples = [{ u: 5 }]; p.scene.bodies[0].v = 'u'; p.asks[0].answer = 'u';
  p.asks.push({ id: '2', text: '代数结论', answer: 'u^2/2' });
  p.solution = { '2': [{ say: '推导保留', tex: 'E=u^2/2' }, { say: '另核对初速', check: { at: { event: 'start' }, expr: 'v(车)', value: 'u' } }] };
  const s = solveProblem(p); assert.equal(s.label, '部分核验');
  for (const r of s.samples!) { assert.equal(verificationCounts(r.asks).engine, 1); assert.equal(verificationCounts(r.asks).algebra, 1); assert.equal(r.asks[1].steps![1].verdict, 'ok'); }
  p.asks[1].expr = ''; assert.ok(validate(p).some((x) => x.includes('省略 expr')));
  delete p.asks[1].expr; delete p.asks[1].answer; assert.ok(validate(p).some((x) => x.includes('保留 answer')));
});
test('1 步骤继承本问 times/vals，显式同名别名可以覆盖', () => {
  const p = problem(); p.asks[0].vals = { x0: { at: { event: 'start' }, expr: 'x(车)' } }; p.asks[0].times = { t0: { event: 'start' } };
  p.solution = { '1': [{ say: '继承', check: { expr: 'x(车)-x0-t0', value: 3 } }, { say: '覆盖', check: { vals: { x0: { at: { event: 'end' }, expr: 'x(车)' } }, expr: 'x0', value: 3 } }] };
  assert.deepEqual(solveProblem(p).asks[0].steps!.map((s) => s.verdict), ['ok', 'ok']);
});

test('2 板与板上物块由弹簧连接：解析简谐解、反作用力与动量能量', () => {
  for (const rightAnchor of [false, true]) {
    const sc: SceneSpec = { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: '板', kind: 'board', m: 6, length: 10, on: '地', x: 0 }, { id: '块', m: 2, on: '板', at: 4, v: 3 }], springs: [{ id: '簧', between: ['板', '块'], k: 12, anchors: rightAnchor ? [10, 0] : undefined }], tMax: 0.4 };
    const r = simulate(sc, { g: 10 }), b = r.end.bodies, w = Math.sqrt(8), delta = 3 / w * Math.sin(w * 0.4), relativeV = 3 * Math.cos(w * 0.4);
    near(b.板.vx, 0.75 - relativeV / 4); near(b.块.vx, 0.75 + relativeV * 3 / 4);
    near(b.块.rel!, 4 + delta); near(6 * b.板.vx + 2 * b.块.vx, 6);
    near(3 * b.板.vx ** 2 + b.块.vx ** 2 + r.end.springs.簧.Ep, 9);
    near(r.end.springs.簧.endpoints![0][0], b.板.x + (rightAnchor ? 10 : 0));
    assert.deepEqual(validate({ ...problem(sc), asks: [{ id: '1', text: '能量', expr: 'KE(板)+KE(块)+Ep(簧)', answer: 9 }] }), []);
  }
});
test('2 不同起点及反向共线轨道上的弹簧，世界反作用力等大反向', () => {
  const sc: SceneSpec = { surfaces: [{ id: '正', from: [-5, 0], to: [15, 0] }, { id: '反', from: [15, 0], to: [-5, 0] }], bodies: [{ id: '甲', m: 2, on: '正', at: 5 }, { id: '乙', m: 2, on: '反', at: 11 }], springs: [{ id: '簧', between: ['甲', '乙'], k: 3, L0: 2 }], tMax: 0.2 };
  const r = simulate(sc, { g: 10 }), w = Math.sqrt(3); near(r.end.bodies.甲.x, 1 - Math.cos(w * 0.2)); near(r.end.bodies.乙.x, 3 + Math.cos(w * 0.2)); near(r.end.bodies.甲.vx + r.end.bodies.乙.vx, 0);
  sc.surfaces[1] = { id: '反', from: [0, 1], to: [15, 1] }; assert.throws(() => simulate(sc, { g: 10 }), /共线/);
});

test('3 斜面接无限地面保持世界接续位置，返程能回斜面', () => {
  const sc: SceneSpec = { surfaces: [{ id: '坡', from: [-3, 2], to: [1, 0], next: '地' }, { id: '地', kind: 'ground', y: 0 }], bodies: [{ id: '甲', m: 2, on: '坡', at: 0 }, { id: '乙', m: 6, on: '地', x: 2 }], collisions: [{ bodies: ['甲', '乙'], e: 1 }], until: { event: 'stop', body: '甲' }, tMax: 4 };
  const r = simulate(sc, { g: 10 }), enter = findEvent(r, { event: 'enter', body: '甲', to: '地' })!;
  near(enter.snap.bodies.甲.x, 1); near(enter.snap.bodies.甲.y, 0); near(enter.snap.bodies.甲.vx, Math.sqrt(40));
  assert.ok(findEvent(r, { event: 'enter', body: '甲', to: '坡' })); near(findEvent(r, { event: 'stop', body: '甲' })!.snap.bodies.甲.y, 0.5);
});
test('3 标量未知初速由末端速率反解，俯视 μmg 不因平面内重力为零而消失', () => {
  const p = problem({ plane: 'horizontal', surfaces: [{ id: '路', from: [0, 0], to: [7, 0], mu: 0.2 }], bodies: [{ id: '车', m: 3, on: '路', at: 0, v: 'u' }], until: { event: 'leave', body: '车' }, tMax: 8 });
  p.unknowns = { u: { range: [5, 8] } }; p.conditions = [{ at: { event: 'leave', body: '车' }, eq: 'v(车)^2-9' }]; p.asks = [{ id: '1', text: '初速', at: { event: 'start' }, expr: 'v(车)', answer: 'sqrt(37)' }];
  const r = solveProblem(p); near(r.vars.u, Math.sqrt(37)); assert.equal(r.asks[0].ok, true);
});
test('3 临界反解保留发生侧，可以读临界事件；不吞掉试算异常', () => {
  const p = problem({ surfaces: [{ id: '路', from: [0, 0], to: [4, 0], mu: 'mu' }], bodies: [{ id: '车', m: 2, on: '路', at: 0, v: 4 }], tMax: 8 });
  p.unknowns = { mu: { range: [0.1, 0.4] } }; p.conditions = [{ just: { event: 'leave', body: '车' } }];
  p.asks = [{ id: '1', text: '临界路程', at: { event: 'leave', body: '车' }, expr: 'path(车,路)', answer: 4 }];
  const r = solveProblem(p); near(r.vars.mu, 0.2, 1e-8); assert.equal(r.asks[0].ok, true);
  p.scene.surfaces[0].losses = [{ at: 1, energy: 200 }]; assert.throws(() => solveProblem(p), /临界试算.*失败.*不等于事件未发生/);
});
test('3 反解失败给出条件、残差或事件及改法，不返回伪解', () => {
  const p = problem(); p.unknowns = { u: { range: [2, 4] } }; p.scene.bodies[0].v = 'u';
  p.conditions = [{ at: { event: 'pass', body: '车', to: 'P' }, eq: 'v(车)-5' }]; p.scene.surfaces[0].marks = { P: 30 };
  assert.throws(() => solveProblem(p), /条件1.*所用事件未发生.*tMax/);
  p.conditions = [{ at: { event: 'end' }, eq: 'v(车)-8' }]; assert.throws(() => solveProblem(p), /残差.*range 要覆盖真实解/);
});

test('4 第 n 次挡板事件后才结束，竖直长板最高点是速度过零', () => {
  const sc: SceneSpec = { surfaces: [{ id: '竖', from: [0, 0], to: [0, 20], walls: { start: 1 } }], bodies: [{ id: '板', kind: 'board', length: 2, m: 3, on: '竖', at: 0, v: 7 }], until: { event: 'hit', body: '板', n: 2 }, tMax: 4 };
  const r = simulate(sc, { g: 10 }); near(findEvent(r, { event: 'stop', body: '板' })!.t, 0.7); near(findEvent(r, { event: 'stop', body: '板' })!.snap.bodies.板.y, 2.45); near(r.end.t, 2.8);
  assert.equal(r.events.filter((e) => e.type === 'hit').length, 2);
});
test('4 板与板上物体先共速后一起上升，到顶仍记录板 stop', () => {
  const sc: SceneSpec = { surfaces: [{ id: '竖', from: [0, 0], to: [0, 20] }], bodies: [{ id: '板', kind: 'board', length: 4, m: 6, on: '竖', at: 0, v: 6 }, { id: '珠', m: 2, on: '板', at: 2, v: 2 }], resistance: [{ on: '珠', relativeTo: '板', magnitude: 20 }], tMax: 1 };
  const r = simulate(sc, { g: 10 }); near(findEvent(r, { event: 'same_velocity', bodies: ['珠', '板'] })!.t, 0.3);
  const e = findEvent(r, { event: 'stop', body: '板' })!; near(e.t, 0.5); near(e.snap.bodies.板.y, 1.4);
});

test('5 压缩时 Fs 为负，压缩量用 -Fs/k；近似答案仍会被严格抓出', () => {
  const p = problem({ surfaces: [{ id: '路', kind: 'ground', y: 0 }], bodies: [{ id: '甲', m: 3, on: '路', x: 0, v: 2 }, { id: '乙', m: 6, on: '路', x: 2 }], springs: [{ id: '簧', between: ['甲', '乙'], k: 8, L0: 2, mode: 'contact' }], until: { event: 'extreme', body: '簧' }, tMax: 2 });
  p.asks = [{ id: '1', text: '压缩量', at: { event: 'extreme', body: '簧' }, expr: '-Fs(簧)/8', answer: 1 }]; assert.equal(solveProblem(p).asks[0].ok, true);
  p.asks[0].expr = 'Fs(簧)/8'; assert.equal(solveProblem(p).asks[0].ok, false);
  p.asks[0].expr = '-Fs(簧)/8'; p.asks[0].answer = 1.01; assert.equal(solveProblem(p).asks[0].ok, false);
});

test('补充 同刻碰撞先于离轨，离轨速度取碰后值', () => {
  const r = simulate({ surfaces: [{ id: '台', from: [-2, 3], to: [0, 3] }, { id: '地', kind: 'ground', y: 0 }], bodies: [{ id: '甲', m: 2, on: '台', at: 0, v: 4 }, { id: '乙', m: 2, on: '台', at: 2 }], collisions: [{ bodies: ['甲', '乙'], e: 1 }], tMax: 2 }, { g: 10 });
  const impact = findEvent(r, { event: 'collided' })!, leave = findEvent(r, { event: 'leave', body: '乙' })!; near(impact.snap.bodies.甲.vx, 0); near(leave.t, impact.t); near(leave.snap.bodies.乙.vx, 4);
  near(findEvent(r, { event: 'land', body: '乙' })!.snap.bodies.乙.x, 4 * Math.sqrt(0.6));
});
test('补充 光滑接续点同时相碰时，先转入新段再碰撞', () => {
  const r = simulate({ surfaces: [{ id: '坡', from: [-4, 3], to: [0, 0], next: '地' }, { id: '地', kind: 'ground', y: 0 }], bodies: [{ id: '甲', m: 2, on: '坡', at: 0 }, { id: '乙', m: 6, on: '地', x: 0 }], collisions: [{ bodies: ['甲', '乙'], e: 1 }], until: { event: 'collided' }, tMax: 3 }, { g: 10 });
  const e = findEvent(r, { event: 'collided' })!; near(e.snap.bodies.甲.vx, -Math.sqrt(60) / 2); near(e.snap.bodies.乙.vx, Math.sqrt(60) / 2); near(e.snap.bodies.甲.vy, 0);
});
test('补充 同轨木板按两端碰锁定挡板，反弹不改变挡板速度', () => {
  for (const length of [3, 9]) {
    const r = simulate({ surfaces: [{ id: '地', kind: 'ground', y: 0, mu: 0.1 }], bodies: [{ id: '板', kind: 'board', m: 2, length, on: '地', x: 0, v: 4 }, { id: '挡', kind: 'board', m: 5, length: 0.2, on: '地', x: length + 3, locked: true }], collisions: [{ bodies: ['板', '挡'], e: 1 }], until: { event: 'collided' }, tMax: 2 }, { g: 10 });
    const e = findEvent(r, { event: 'collided' })!; near(e.snap.bodies.板.x, 3); near(e.snap.bodies.板.vx, -Math.sqrt(10)); near(e.snap.bodies.挡.vx, 0);
  }
});

test('6 第一组单独发布，第二组不采样且可以推翻最终标签', () => {
  const p = problem(); p.params = { u: [3, 'm/s', '数值任取'] }; p.samples = [{ u: 6 }]; p.scene.bodies[0].v = 'u'; p.asks[0].answer = 'u/2+1.5';
  const it = solveProgressively(p, 0.1), first = it.next().value!, second = it.next().value!;
  assert.equal(first.pending, true); assert.equal(first.label, '部分核验'); assert.equal(first.asks[0].ok, null); assert.equal(first.asks[0].verified, false); assert.ok(first.sim!.samples.length > 0);
  assert.equal(second.pending, undefined); assert.equal(second.label, '有问题'); assert.equal(second.asks[0].ok, false); assert.equal(second.sim, first.sim);
  assert.equal(second.samples![1].sim!.samples.length, 0); assert.equal(it.next().done, true);
});
test('7 物体名避开物体投影及已有标签，窄屏和顶边仍在可用范围', () => {
  const obstacles: Rect[] = [{ x: 145, y: 170, w: 210, h: 35 }, { x: 145, y: 137, w: 45, h: 35 }];
  for (const width of [280, 375, 720]) {
    const name = placeLabel({ x: 145, y: 145, w: 32, h: 24 }, obstacles, width, 420)!;
    assert.ok(name); assert.ok(obstacles.every((r) => !overlaps(r, name))); assert.ok(name.x >= 24 && name.x <= width - 24); assert.ok(name.y >= 56);
    const second = placeLabel({ x: 145, y: 145, w: 32, h: 24 }, [...obstacles, name], width, 420)!; assert.ok(second); assert.ok(!overlaps(name, second));
  }
  assert.equal(placeLabel({ x: 40, y: 40, w: 32, h: 24 }, [{ x: 50, y: 50, w: 200, h: 200 }], 100, 180), undefined);
});
test('7 场景标签、说明及参数名保持一行，完整说明有悬浮提示', () => {
  const css = readFileSync(new URL('../player/style.css', import.meta.url), 'utf8'), main = readFileSync(new URL('../player/main.ts', import.meta.url), 'utf8');
  assert.match(css, /\.track button\s*\{[^}]*text-overflow:\s*ellipsis/); assert.match(main, /nameTex/);
});

// 实际运行播放器 worker；收到首组消息时即可使用动画，第二组独立核对。
const p = problem(); p.params = { u: [3, 'm/s', '数值任取'] }; p.samples = [{ u: 6 }]; p.scene.bodies[0].v = 'u'; p.asks[0].answer = 'u';
await new Promise<void>((resolve, reject) => {
  const worker = new Worker(new URL('./worker-adapter.ts', import.meta.url)), messages: any[] = [];
  const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('worker 超时')); }, 15000);
  worker.on('error', reject); worker.on('message', (m) => {
    try {
      assert.equal(m.ok, true); messages.push(m);
      if (messages.length === 1) { assert.equal(m.solved.pending, true); assert.ok(m.solved.sim.samples.length); }
      if (messages.length === 2) { assert.equal(m.solved.pending, undefined); assert.equal(m.solved.label, '已核验'); assert.ok(m.ms >= messages[0].ms); clearTimeout(timeout); void worker.terminate(); resolve(); }
    } catch (e) { clearTimeout(timeout); void worker.terminate(); reject(e); }
  });
  worker.postMessage({ id: 3, problem: p });
});
passed++; console.log('✓ 6 实际播放器 worker 按首组、最终两次发回结果');
test('损失点正好在轨道末端或撞挡板的端点时也结算一次', () => {
  const run = (surfaces: any[]) => simulate({ surfaces, bodies: [{ id: 'A', m: 1, on: 'L', at: 0, v: 4 }], tMax: 1.5 } as SceneSpec, {}, 1 / 60);
  const next = run([{ id: 'L', from: [0, 0], to: [2, 0], next: 'R', losses: [{ at: 2, energy: 3 }] }, { id: 'R', from: [2, 0], to: [50, 0] }]);
  assert.equal(next.events.filter((e) => e.type === 'energy_loss').length, 1);
  assert.ok(Math.abs(next.end.bodies.A.vx - Math.sqrt(10)) < 1e-7);
  const wall = run([{ id: 'L', from: [0, 0], to: [2, 0], walls: { end: 1 }, losses: [{ at: 2, energy: 3 }] }]);
  assert.equal(wall.events.filter((e) => e.type === 'energy_loss').length, 1);
  assert.ok(Math.abs(wall.end.bodies.A.vx + Math.sqrt(10)) < 1e-7);
});
console.log(`\n第三轮自编测试：${passed}/${passed} 通过`);
