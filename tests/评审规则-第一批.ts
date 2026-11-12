// 本批的通用边界：文字与模型分开校验，未核验不能冒充核验。
import assert from 'node:assert/strict';
import { readLessonReply, unreadable, lessonFallback } from '../player/lesson-input.ts';
import { verifyState } from '../player/verification.ts';
import { buildLesson } from '../player/lesson.ts';
import { validate, formatRepair } from '../engine/validate.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`通过 ${name}`); }
const base: Problem = {
  title: '自编匀速题', stem: '物体以 2 m/s 匀速运动，求 1 s 时的位置。', params: { v0: 2 },
  scene: { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 1, on: '地', v: 'v0' }], tMax: 1 },
  asks: [{ id: '1', text: '求位置', expr: 'x(A)', at: { event: 'time', t: 1 }, answer: 2 }],
  solution: { '1': [{ say: '先看运动状态', tex: 'v=2' }, { say: '位移等于速度乘时间', tex: 'x=vt' }, { say: '代入题中数据', tex: 'x=2' }] },
} as Problem;
test('正常回复保持动画场景', () => { assert.deepEqual(validate(base), []); assert.deepEqual(readLessonReply(JSON.stringify(base)), { problem: base }); });
test('坏轨道仍保留逐问逐步讲解，修改提示与原校验一致', () => {
  const p = structuredClone(base); p.scene.bodies![0].on = '不存在';
  const out = readLessonReply(JSON.stringify(p));
  assert.ok(out.problem.unsupported); assert.deepEqual(out.original, p);
  assert.equal(out.repair, formatRepair(validate(p)));
  const a = solveProblem(out.problem).asks[0];
  const steps = buildLesson({ P: out.problem, a, q: out.problem.asks[0], w0: 0, w1: 1, keyT: null, letters: false });
  assert.equal(steps.length, 4); assert.deepEqual(steps.slice(0, 3).map((s) => s.say), base.solution!['1'].map((s) => s.say));
  assert.equal(steps[3].final, true); assert.equal(verifyState(a), 'ai');
});
test('坏场景结构、samples 和取值表达式不挡住讲解', () => {
  for (const extra of [{ scene: { bodies: '错误' } }, { samples: '错误' }, { asks: [{ ...base.asks[0], expr: 42 }] }]) {
    const out = readLessonReply(JSON.stringify({ ...base, ...extra })); assert.ok(out.problem.unsupported, JSON.stringify(extra)); assert.ok(out.repair); assert.equal(solveProblem(out.problem).asks.length, 1);
  }
});
test('没有小问、没有文字、读不出结构与坏讲解仍拒绝', () => {
  for (const x of ['没有完整回复', JSON.stringify({ asks: [] }), JSON.stringify({ ...base, asks: [{ id: '1' }] }), JSON.stringify({ ...base, solution: { '1': [{ say: 42 }] } })]) assert.throws(() => readLessonReply(x), { message: unreadable });
});
test('unsupported 与运行期失败都能保留答案和讲解', () => {
  const p = { ...base, scene: { surfaces: [], bodies: [] }, unsupported: '当前不支持' };
  const out = readLessonReply(JSON.stringify(p)); assert.equal(out.problem.unsupported, '当前不支持');
  const fallback = solveProblem(lessonFallback(base)); assert.equal(fallback.asks[0].steps!.length, 3); assert.equal(verifyState(fallback.asks[0]), 'ai');
});
test('四态优先级与 algebra/custom 留空不授予代数核对', () => {
  assert.equal(verifyState({ ok: true, verified: true, source: 'engine' }), 'engine');
  for (const source of ['algebra', 'custom'] as const) {
    assert.equal(verifyState({ source, ok: null }), 'ai'); assert.equal(verifyState({ source, ok: true }), 'algebra'); assert.equal(verifyState({ source, ok: false }), 'mismatch');
  }
  assert.equal(verifyState({ source: 'engine', ok: false, verified: true }), 'mismatch');
  assert.equal(verifyState({ source: 'engine', ok: null }), 'ai');
});
test('实际代数一致时 answerMatch=true 但 ok=null，界面仍未核验', () => {
  const p = structuredClone(base); p.asks[0].expr = 'v0*1';
  const a = solveProblem(p).asks[0]; assert.equal(a.answerMatch, true); assert.equal(a.ok, null); assert.equal(a.source, 'algebra'); assert.equal(verifyState(a), 'ai');
});
console.log(`第一批评审规则：${passed}/${passed} 通过`);
