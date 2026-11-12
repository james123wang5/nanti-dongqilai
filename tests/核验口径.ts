// 核验的是内置物理计算与命题/答案的一致性；方程积分、AI 声明和讲解文字单独计数。
import assert from 'node:assert/strict';
import { solveProblem, plotPoints, type Problem } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
import { evaluateBoolean } from '../engine/expr.ts';
import { verificationCounts } from '../engine/source.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).stack}`); } }
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const P = (): Problem => ({ spec: 'v1', constants: { g: 10 }, params: { u: 2, M: 1 }, scene: { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 'M', on: '地', x: 0, v: 'u' }], tMax: 1 }, asks: [{ id: '1', text: '速度', expr: 'v(A)', answer: 2 }] });
const choice = (claim?: string, correct?: boolean): Problem => { const p = P(); p.asks = [{ id: '1', text: '选项', option: { label: 'A', text: '速度向右', ...(claim === undefined ? {} : { claim }), ...(correct === undefined ? {} : { correct }) } }]; return p; };
test('旧选项仅有 correct：AI 来源，数值附问匹配也不能替命题核验', () => {
  const p = choice(undefined, true); p.asks[0].expr = 'v(A)'; p.asks[0].answer = 2; const r = solveProblem(p), a = r.asks[0]; assert.equal(a.source, 'ai'); assert.equal(a.answerMatch, true); assert.equal(a.ok, null); assert.equal(a.verified, false); assert.equal(r.counts!.ai, 1); assert.equal(r.counts!.engine, 0);
});
test('真命题及假命题都能独立核验，真假与是否核验是两个字段', () => {
  for (const [claim, expected] of [['vx(A)>0', true], ['v(A)<0', false]] as const) { const a = solveProblem(choice(claim, expected)).asks[0]; assert.equal(a.claimValue, expected); assert.equal(a.claimOk, true); assert.equal(a.source, 'engine'); assert.equal(a.verified, true); assert.equal(a.ok, true); }
});
test('AI 写错 correct：返回引擎结论和修复提示', () => { const r = solveProblem(choice('vx(A)>0', false)); assert.equal(r.asks[0].claimValue, true); assert.equal(r.asks[0].claimOk, false); assert.equal(r.asks[0].ok, false); assert.equal(r.counts!.mismatch, 1); assert.match(r.repair, /得出 真/); });
test('命题匹配不能遮盖附带数值答案的不一致', () => { const p = choice('vx(A)>0', true); p.asks[0].expr = 'v(A)'; p.asks[0].answer = 7; const a = solveProblem(p).asks[0]; assert.equal(a.claimOk, true); assert.equal(a.answerMatch, false); assert.equal(a.ok, false); assert.equal(a.verified, false); });
test('布尔逻辑短路、相对容差和极小量不会把任意非零数当真', () => {
  assert.equal(evaluateBoolean('1<2 && !(3<=2) || false', { vars: {} }), true);
  assert.equal(evaluateBoolean('false && (1/0>0)', { vars: {} }), false);
  assert.equal(evaluateBoolean('approx(1e-19,0,1e-3,0)', { vars: {} }), false);
  assert.equal(evaluateBoolean('approx(1e-19,1.0001e-19,1e-3,0)', { vars: {} }), true);
  assert.throws(() => evaluateBoolean('1/0<0', { vars: {} }), /非有限/);
});
test('没有独立物理依赖的判断式、恒真式和乘零不能得到已核验', () => {
  for (const claim of ['true', 'u>0', 'v(A)==v(A)', 'approx(v(A),v(A))', 'vx(A)>0 || true', '0*v(A)<1', 'vx(A)>0 || !(vx(A)>0)', 'vx(A)>=0 || vx(A)<0']) { const a = solveProblem(choice(claim, true)).asks[0]; assert.equal(a.source, 'algebra', claim); assert.equal(a.ok, null, claim); assert.equal(a.verified, false, claim); }
});
test('纯计时 when 的事件名不能把代数时刻升级为物理证据', () => {
  for (const expr of ['t', 'alias']) { const p = P(); p.asks[0] = { id: '1', text: '计时', at: { event: 'when', expr: 't-.5' }, times: { alias: { event: 'when', expr: 't-.5' } }, expr, answer: .5 }; const a = solveProblem(p).asks[0]; assert.equal(a.answerMatch, true); assert.equal(a.source, 'algebra'); assert.equal(a.verified, false); }
  const p = P(); p.asks[0] = { id: '1', text: '到达', at: { event: 'when', expr: 'x(A)-1' }, expr: 't', answer: .5 }; assert.equal(solveProblem(p).asks[0].verified, true);
});
test('碰撞耗能的通用命名可用于命题，校验与求值规则一致', () => { const a = solveProblem(choice('Q(碰撞)>=0', true)).asks[0]; assert.equal(a.claimValue, true); assert.equal(a.source, 'engine'); assert.equal(a.verified, true); });
test('判断式里的非有限数报错，不能核验为假命题', () => { const a = solveProblem(choice('sqrt(-1)<v(A)', false)).asks[0]; assert.equal(a.source, 'unavailable'); assert.equal(a.verified, false); assert.match(a.error!, /非有限/); });
test('判断式共享 at、times、vals；数值 expr 同样支持事件别名参数', () => {
  const p = choice('approx(x(A,t1),x1,1e-7,1e-9) && v(A,t1)>0', true); p.asks[0].at = { event: 'time', t: .8 }; p.asks[0].times = { t1: { event: 'time', t: .2 } }; p.asks[0].vals = { x1: { at: { event: 'time', t: .2 }, expr: 'x(A)' } }; p.asks[0].expr = 'x(A,t1)'; p.asks[0].answer = .4;
  assert.deepEqual(validate(p), []); const a = solveProblem(p).asks[0]; near(a.value, .4); assert.equal(a.claimValue, true); assert.equal(a.verified, true);
});
test('引用未知对象、未声明时刻、非法判断式和未知事件均在校验器报出', () => {
  for (const claim of ['v(不存在)>0', 'v(A,t1)>0', 'v(A,.2)>0', 'v(A) >>> 0', 'v(A)+1', 'hack(A)>0', 'sin(1,2)>0', 'approx(v(A))']) assert.ok(validate(choice(claim, true)).length, claim);
  const p = choice('v(A,t1)>0', true); p.asks[0].times = { t1: { event: 'pass', body: 'A', to: '不存在的点' } }; assert.ok(validate(p).some((s) => /不存在的点/.test(s)));
});
test('累计量不能因为对象名不存在而默默返回零并取得核验', () => {
  for (const expr of ['Q(不存在)', 'path(A,不存在)', 'count(不存在)']) { const p = P(); p.asks[0].expr = expr; p.asks[0].answer = 0; const a = solveProblem(p).asks[0]; assert.equal(a.verified, false); assert.equal(a.source, 'unavailable'); assert.match(a.error!, /不存在/); }
});
test('畸形 option 和伪造的引擎核验字段给出可操作的格式错误', () => {
  const p = choice('vx(A)>0', true); p.asks[0].option = null as never; assert.ok(validate(p).some((s) => /option 必须是对象/.test(s)));
  const q = choice('vx(A)>0', true); (q.asks[0] as unknown as Record<string, unknown>).verified = true; assert.ok(validate(q).some((s) => /由引擎生成/.test(s)));
});
test('有符号感应电流可直接判断方向，来自内置电磁规律', () => {
  const p = choice('val(Is)<0', true); p.scene = { surfaces: [], bodies: [], induction: { kind: 'coil', B: 't', N: 2, S: 1, R: 1, duration: 1 } }; const a = solveProblem(p).asks[0]; assert.equal(a.claimValue, true); assert.equal(a.source, 'engine'); assert.equal(a.verified, true);
});
test('改参数并清空参考答案后重算命题，不沿用旧 correct', () => {
  const p = choice('vx(A)>0', true); assert.equal(solveProblem(p).asks[0].claimValue, true); p.params!.u = -2; delete p.asks[0].option!.correct; const a = solveProblem(p).asks[0]; assert.equal(a.claimValue, false); assert.equal(a.claimOk, null); assert.equal(a.source, 'engine'); assert.equal(a.ok, null); assert.equal(a.verified, false);
});
test('只改条件仍保留旧 correct 时，实际结论照常重算并报告不一致', () => { const p = choice('vx(A)>0', true); p.params!.u = -2; const a = solveProblem(p).asks[0]; assert.equal(a.claimValue, false); assert.equal(a.claimOk, false); });
test('逐问 with 参与命题计算，主场景参数不能污染该问', () => { const p = choice('vx(A)>0', false); p.asks[0].with = { u: -3 }; const a = solveProblem(p).asks[0]; assert.equal(a.claimValue, false); assert.equal(a.verified, true); });
test('逐问 with 新增的比较参数有独立变量作用域', () => { const p = choice('vx(A)>limit', true); p.asks[0].with = { limit: 1 }; assert.deepEqual(validate(p), []); assert.equal(solveProblem(p).asks[0].verified, true); });
test('没有 expr/claim 的讲解 when 事件也使用该问的参数上下文', () => {
  solveProblem(P()); const p = choice(undefined, true); p.asks[0].with = { u: 3 }; p.solution = { '1': [{ say: '到达', at: { event: 'when', expr: 't-1/u' } }] }; const a = solveProblem(p).asks[0]; near(a.steps![0].frame!.t, 1 / 3); assert.equal(a.verified, false);
});
test('两组样例任一命题不一致，最终结果清除第一组 verified', () => { const p = choice('vx(A)>0', true); p.samples = [{ u: -3 }]; const r = solveProblem(p); assert.equal(r.samples![0].asks[0].claimValue, true); assert.equal(r.samples![1].asks[0].claimValue, false); assert.equal(r.asks[0].claimOk, false); assert.equal(r.asks[0].verified, false); assert.equal(r.counts!.engine, 0); });
const odeP = (): Problem => ({ spec: 'v1', scene: { surfaces: [], bodies: [], ode: { state: { x: 0 }, rates: { x: 2 }, vals: { energy: '123+x' }, events: [{ name: 'P', when: 'x-1', once: true }], duration: 1, steps: 2000, draw: [], view: [0, 0, 2, 2] } }, asks: [{ id: '1', text: 'x', expr: 'val(x)', answer: 2 }] });
test('ODE 结果只证明积分正确，数值一致不授予物理核验', () => { const r = solveProblem(odeP()), a = r.asks[0]; assert.equal(a.answerMatch, true); assert.equal(a.source, 'custom'); assert.equal(a.ok, null); assert.equal(a.verified, false); assert.equal(r.counts!.custom, 1); assert.notEqual(r.label, '已核验'); });
test('ODE 派生量、命题和自定义事件时刻都不能洗成 engine', () => {
  const p = odeP(); p.asks = [{ id: '1', text: '派生', expr: 'val(energy)', answer: 125 }, { id: '2', text: '命题', option: { label: 'A', text: '正', correct: true, claim: 'val(x)>0' } }, { id: '3', text: '事件', at: { event: 'mark', name: 'P' }, expr: 't', answer: .5 }]; const r = solveProblem(p); for (const a of r.asks) { assert.equal(a.source, 'custom'); assert.equal(a.verified, false); assert.equal(a.ok, null); } assert.equal(r.asks[1].claimOk, true);
});
test('能静态确定的自定义事件名拼错时在校验阶段报出', () => { const p = odeP(); p.asks[0].times = { t1: { event: 'mark', name: '不存在' } }; p.asks[0].option = { label: 'A', text: '正', correct: true, claim: 'val(x,t1)>0' }; assert.ok(validate(p).some((s) => /命名事件 不存在 不存在/.test(s))); });
test('script 轨迹属于自定义计算，不是独立物理', () => { const p = P(); p.scene = { surfaces: [], bodies: [], script: { duration: 1, bodies: { A: { x: '123*t', y: 0 } } } }; p.asks[0].expr = 'x(A)'; p.asks[0].answer = 123; const a = solveProblem(p).asks[0]; assert.equal(a.source, 'custom'); assert.equal(a.answerMatch, true); assert.equal(a.ok, null); });
test('用户派生公式单独分级，原始观测值的别名保留 engine', () => {
  const p = P(); p.asks = [{ id: '1', text: '派生', expr: 'E', answer: 6, vals: { E: { at: { event: 'end' }, expr: '3*KE(A)' } } }, { id: '2', text: '原始', expr: 'E', answer: 2, vals: { E: { at: { event: 'end' }, expr: 'KE(A)' } } }]; const r = solveProblem(p); assert.equal(r.asks[0].source, 'custom'); assert.equal(r.asks[0].ok, null); assert.equal(r.asks[1].source, 'engine'); assert.equal(r.asks[1].verified, true);
});
test('跨时刻派生别名组合能计算，但保留 custom 来源并拒绝循环', () => {
  const p = P(); p.asks[0].vals = { raw: { at: { event: 'time', t: .2 }, expr: 'KE(A)' }, derived: { at: { event: 'end' }, expr: '3*raw' } }; p.asks[0].expr = 'derived'; p.asks[0].answer = 6; const a = solveProblem(p).asks[0]; near(a.value, 6); assert.equal(a.source, 'custom'); assert.equal(a.verified, false);
  p.asks[0].vals.raw.expr = 'derived'; assert.ok(validate(p).some((s) => /循环引用/.test(s)));
});
test('ODE 条件反解未知数仍是 custom，不因为调用了求根就变成 engine', () => {
  const p = odeP(); p.scene.ode!.rates.x = 'u'; p.unknowns = { u: { range: [1, 3] } }; p.conditions = [{ at: { event: 'time', t: .5 }, eq: 'val(x)-1' }]; p.asks[0].expr = 'u'; const a = solveProblem(p).asks[0]; assert.equal(a.source, 'custom'); assert.equal(a.ok, null); near(a.value, 2);
});
test('纯代数约束确定的未知初速度不能借轨迹读数洗成内置物理证明', () => { const p = P(); delete p.params!.u; p.unknowns = { u: { range: [1, 3] } }; p.conditions = [{ eq: 'u-2' }]; const a = solveProblem(p).asks[0]; assert.equal(a.source, 'custom'); assert.equal(a.ok, null); });
test('参数里命名的派生公式也不能把物理反解的量洗成新的物理证明', () => {
  const p = P(); delete p.params!.u; p.params!.derived = '3*u'; p.unknowns = { u: { range: [1, 3] } }; p.conditions = [{ at: { event: 'time', t: .5 }, eq: 'x(A)-1' }]; p.asks = [{ id: '1', text: '原始反解', expr: 'u', answer: 2 }, { id: '2', text: '另定义的量', expr: 'derived', answer: 6 }]; const r = solveProblem(p); assert.equal(r.asks[0].verified, true); assert.equal(r.asks[1].source, 'custom'); assert.equal(r.asks[1].verified, false); assert.equal(r.asks[1].answerMatch, true);
});
test('未写 check 的步骤明确未核验，不计入已核验步骤数', () => {
  const p = P(); p.solution = { '1': [{ say: '一句没有核对项的讲解' }, { say: '实际核对', check: { expr: 'v(A)', value: 2 } }] }; const r = solveProblem(p); assert.equal(r.asks[0].verified, true); assert.equal(r.asks[0].steps![0].verified, false); assert.equal(r.counts!.steps.ai, 1); assert.equal(r.counts!.steps.engine, 1); assert.equal(r.label, '部分核验');
});
test('自定义方程的步骤即使数值匹配也不返回 verdict:ok', () => { const p = odeP(); p.solution = { '1': [{ say: '积分核对', check: { expr: 'val(x)', value: 2 } }] }; const s = solveProblem(p).asks[0].steps![0]; assert.equal(s.verdict, 'custom'); assert.equal(s.verified, false); });
test('逐问 plot 使用该问的质量、g、times/vals 和时间窗', () => {
  const p = P(); p.scene.surfaces[0].y = 5; p.asks[0] = { id: '1', text: '图', expr: 'KE(A)', answer: 6, at: { event: 'time', t: .5 }, with: { M: 3, u: 2, g: 20 }, times: { t1: { event: 'time', t: .25 } }, vals: { E: { at: { event: 'time', t: .1 }, expr: 'KE(A)' } }, plot: { x: 't', y: 'E+PE(A)+v(A,t1)' } };
  const r = solveProblem(p), a = r.asks[0]; assert.equal(a.ok, true); assert.equal(a.plotContext!.vars.g, 20); assert.equal(a.plotContext!.vars.M, 3); assert.ok(a.plotData!.length > 1); for (const q of a.plotData!) { near(q[1], 308); assert.ok(q[2] >= a.span![0] - 1e-9 && q[2] <= a.span![1] + 1e-9); }
  const rebuilt = plotPoints(p, r.vars, a.sim!, p.asks[0].plot!, ...a.span!, a.plotContext); assert.deepEqual(rebuilt, a.plotData);
});
test('关系图表达式错误单独报告，不抹掉独立算出的有效答案', () => {
  const p = P(); p.asks[0].plot = { x: 't', y: 'v(不存在)' }; const a = solveProblem(p).asks[0]; assert.equal(a.ok, true); assert.equal(a.verified, true); assert.equal(a.error, undefined); assert.equal(a.plotSource, 'unavailable'); assert.match(a.plotError!, /没有物体/);
});
test('碰前/碰后步骤返回同一事件时刻的精确快照，微秒尺度也不偏移', () => {
  const p = P(); p.params = {}; p.scene = { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 1, on: '地', x: 0, v: 1 }, { id: 'B', m: 1, on: '地', x: 1e-6 }], collisions: [{ bodies: ['A', 'B'], e: 1 }], tMax: 3e-6 }; p.asks[0] = { id: '1', text: '碰后', at: { event: 'collided', bodies: ['A', 'B'] }, expr: 'vx(A)', answer: 0 }; p.solution = { '1': [{ say: '碰前', at: { event: 'collide', bodies: ['A', 'B'] } }, { say: '碰后', at: { event: 'collided', bodies: ['A', 'B'] } }] };
  p.asks[0].times = { pre: { event: 'collide', bodies: ['A', 'B'], phase: 'before' }, post: { event: 'collide', bodies: ['A', 'B'], phase: 'after' } }; p.asks[0].option = { label: 'A', text: '碰后 A 的速度变小', correct: true, claim: 'vx(A,pre)>vx(A,post)' };
  const r = solveProblem(p), steps = r.asks[0].steps!; assert.equal(r.asks[0].claimValue, true); assert.equal(r.asks[0].verified, true); assert.ok(steps[0].frame && steps[1].frame); assert.equal(steps[0].frame!.t, steps[1].frame!.t); assert.equal(steps[0].frame!.phase, 'before'); assert.equal(steps[1].frame!.phase, 'after'); near(steps[0].frame!.snapshot.bodies.A.vx, 1); near(steps[1].frame!.snapshot.bodies.A.vx, 0);
});
const roots = (equations: string[]): Problem => ({ spec: 'v1', scene: { surfaces: [], bodies: [], script: { duration: .01, bodies: { A: { x: 0, y: 0 } } } }, unknowns: { a: { range: [-2, 2] }, b: { range: [-2, 2] } }, conditions: equations.map((eq) => ({ eq })), asks: [{ id: '1', text: '根', expr: 'a' }] });
test('二元多起点找到第二个孤立根，报告多解及候选值', () => { assert.throws(() => solveProblem(roots(['a^2-1', 'b-a'])), /多解.*多个根/); });
test('二元切触根也能从不同残差盆地找到，不依赖过零检测', () => { assert.throws(() => solveProblem(roots(['(a^2-1)^2', 'b-a'])), /多解.*多个根/); });
test('唯一二元根去重，条件缩放不产生假多解', () => {
  for (const c of ['1', '1e-8', '1e8']) { const r = solveProblem(roots([`${c}*(a+b-1)`, `${c}*(a-b)`])); near(r.vars.a, .5); near(r.vars.b, .5); }
});
test('范围边界上的两根也拒绝，三元唯一线性根可去重且更高维明确拒绝', () => {
  assert.throws(() => solveProblem(roots(['a^2-4', 'b-a'])), /多解.*多个根/);
  const p = roots(['a-.5', 'b-1', 'c+1']); p.unknowns!.c = { range: [-2, 2] }; const r = solveProblem(p); near(r.vars.a, .5); near(r.vars.b, 1); near(r.vars.c, -1);
  p.unknowns!.d = { range: [-2, 2] }; assert.throws(() => solveProblem(p), /最多同时反解 3/);
});
test('verificationCounts 不把 ok:null、custom、AI 或未检查步骤计为 engine', () => {
  const c = verificationCounts([{ source: 'engine', ok: true, verified: true, steps: [{ source: 'ai', verdict: 'skip', verified: false }] }, { source: 'engine', ok: null }, { source: 'custom', ok: null }, { source: 'ai', ok: null }, { source: 'algebra', ok: null }]); assert.equal(c.engine, 1); assert.equal(c.uncompared, 1); assert.equal(c.custom, 1); assert.equal(c.ai, 1); assert.equal(c.algebra, 1); assert.equal(c.steps.engine, 0); assert.equal(c.steps.ai, 1);
});
console.log(`\n核验口径测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
