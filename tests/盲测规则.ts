// 豆包盲测后补的通用规则：JSON 容错、结构归位、希腊字母名字、val(参数)、release 延时出发、木板长条接触、机械波 crest、leave 认换轨
import assert from 'node:assert/strict';
import { extractJson } from '../engine/parse.ts';
import { evaluate } from '../engine/expr.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}\n   ${(e as Error).message}`); } }
const ok = (P: Problem) => { assert.deepEqual(validate(P), []); const S = solveProblem(P); for (const a of S.asks) assert.equal(a.ok, true, `${a.id}: ${a.error ?? a.shown}`); return S; };

test('裸表达式加引号、缺右括号补上、中文引号是内容', () => {
  const P = extractJson('{"scene":{},"stem":"“时间分辨”仪","a":[2*h,0],"mu":1/10,"c":sqrt(3)/2,"d":-3.5,"e":true') as Record<string, unknown>;
  assert.deepEqual(P.a, ['2*h', 0]); assert.equal(P.mu, '1/10'); assert.equal(P.c, 'sqrt(3)/2'); assert.equal(P.d, -3.5); assert.equal(P.stem, '“时间分辨”仪');
});
test('结构归位：实验室写在最外层收进 scene；scene 里混进的 asks 提到外层；线段 kind:line 去掉', () => {
  const P = extractJson('{"spec":"v1","induction":{"kind":"rails"},"asks":[]}') as Record<string, any>;
  assert.ok(P.scene.induction); assert.equal(P.induction, undefined);
  const Q = extractJson('{"spec":"v1","scene":{"surfaces":[{"id":"s","kind":"line","from":[0,0],"to":[1,0]}],"bodies":[],"asks":[{"id":"1"}]}}') as Record<string, any>;
  assert.equal(Q.asks.length, 1); assert.equal(Q.scene.surfaces[0].kind, undefined);
});
test('samples：去掉与 params 相同的第一组；常数式算成数；数值题答案全是数时忽略', () => {
  const P = extractJson('{"params":{"R":[2,"m","数值任取"]},"samples":[{"R":2},{"R":"3/pi"}],"asks":[{"id":"1","answer":"R"}],"scene":{}}') as Record<string, any>;
  assert.equal(P.samples.length, 1); assert.ok(Math.abs(P.samples[0].R - 3 / Math.PI) < 1e-12);
  const Q = extractJson('{"params":{"m":[4,"kg","质量"]},"samples":[{"m":5}],"asks":[{"id":"1","answer":2.5}],"scene":{}}') as Record<string, any>;
  assert.equal(Q.samples, undefined);
});
test('节点名写成事件名改成 mark', () => {
  const P = extractJson('{"asks":[{"id":"1","at":{"event":"p1进入B区"}}],"scene":{}}') as Record<string, any>;
  assert.deepEqual(P.asks[0].at, { event: 'mark', name: 'p1进入B区' });
});
test('名字可用希腊字母；没有快照时 val(L) 是参数 L', () => {
  assert.equal(evaluate('2*sinθ+μ1', { vars: { 'sinθ': 0.5, μ1: 0.2 } }), 1.2);
  assert.equal(evaluate('val(L)*2', { vars: { L: 3 } }), 6);
  assert.throws(() => evaluate('val(B)', { vars: {} }), /B 没有定义/);
});
test('release：甲到 B 时乙才以 5 m/s 从 A 出发，乙到 B 时两者相距 40 m', () => {
  ok({ spec: 'v1', constants: { g: 10 }, scene: { surfaces: [{ id: 'AB', from: [0, 12], to: ['sqrt(36^2-12^2)', 0], mu: 'sqrt(2)/10', next: 'BC' }, { id: 'BC', kind: 'ground', y: 0, mu: 0.1 }],
    bodies: [{ id: '甲', kind: 'block', m: 60, on: 'AB', at: 0, v: 0 }, { id: '乙', kind: 'block', m: 60, on: 'AB', at: 0, v: 5, release: { event: 'enter', body: '甲', to: 'BC' } }] },
    asks: [{ id: '1', text: '甲到 B', at: { event: 'enter', body: '甲', to: 'BC' }, expr: 't', answer: 6 }, { id: '2', text: '距离', at: { event: 'enter', body: '乙', to: 'BC' }, expr: 'x(甲)-x(乙)', answer: 40 }] } as never);
});
test('leave from 认滑上下一段轨道', () => {
  ok({ spec: 'v1', constants: { g: 10 }, scene: { surfaces: [{ id: 'AB', from: [0, 5], to: [5, 0], next: 'BC' }, { id: 'BC', kind: 'ground', y: 0 }], bodies: [{ id: 'A', kind: 'block', m: 1, on: 'AB', at: 0, v: 0 }] },
    asks: [{ id: '1', text: '到底端速度', at: { event: 'leave', body: 'A', from: 'AB' }, expr: 'v(A)', answer: 10 }] } as never);
});
test('摆球摆到最低点撞木板右端（木板按有厚度长条算接触）', () => {
  const S = ok({ spec: 'v1', constants: { g: 10 }, scene: { surfaces: [{ id: '地面', kind: 'ground', y: 0 }, { id: '摆', kind: 'arc', center: [0, 0.9], radius: 0.9, start: ['sin(pi/3)', '-cos(pi/3)'], end: ['-sin(pi/3)', '-cos(pi/3)'], turn: 'cw', side: 'inside', tether: 'rope' }],
    bodies: [{ id: 'A', kind: 'board', m: 0.4, length: 2, on: '地面', x: -2, v: 0 }, { id: 'C', kind: 'ball', m: 0.1, on: '摆', at: 0, v: 0 }], collisions: [{ bodies: ['C', 'A'], e: 1 }] },
    asks: [{ id: '1', text: '碰后木板速度', at: { event: 'collided', bodies: ['C', 'A'] }, expr: 'abs(v(A))', answer: 1.2 }] } as never);
  assert.ok(S.sim!.events.some((e) => e.type === 'collided'));
});
test('机械波 crest：t=0 时 x=2 m 处为波峰、沿 −x 传播，x=3 m 的 P 第 2 次到平衡位置用时 4 s', () => {
  ok({ spec: 'v1', scene: { surfaces: [], bodies: [], wave: { range: [0, 12], duration: 8, steady: true, sources: [{ id: 'S', crest: 2, A: 0.01, T: 6, v: 2, dir: -1 }], points: [{ id: 'P', x: 3 }] } },
    asks: [{ id: '1', text: 'P 第二次到平衡位置', at: { event: 'when', expr: 'val(y_P)', n: 2 }, expr: 't', answer: 4 }] } as never);
});
console.log(`\n盲测规则测试：${passed}/${passed + failed} 通过`); if (failed) process.exit(1);
