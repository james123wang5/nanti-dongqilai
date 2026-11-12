// M13：输入分流、计数、旧数据兼容、提示语和板块选择的通用规则。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLessonReply, unreadable, validateLesson } from '../player/lesson-input.ts';
import { attemptsOf, nextAttempt, adviceFor, noticeFor, topicRows, topicExamples, commonTopics, thirdAdvice, unreadableRepair, type PasteIssue } from '../player/paste-state.ts';
import { formatRepair, validate } from '../engine/validate.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`通过 ${name}`); };
const p: Problem = { spec: 'v1', title: '自编匀速题', stem: '物体沿水平面以2 m/s匀速运动。',
  scene: { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 1, on: '地', v: 2 }], tMax: 1 },
  asks: [{ id: '1', text: '求1秒时的位移', at: { event: 'time', t: 1 }, expr: 'x(A)', answer: 2 }],
  solution: { '1': [{ say: '匀速运动，位移等于速度乘时间。', tex: 'x=vt=2' }] } };
test('正常回复保持原题，没有格式问题计数', () => { assert.deepEqual(readLessonReply(JSON.stringify(p)), { problem: p }); });
test('场景错误自动交给讲解，数量和复制提示来自原校验器', () => {
  const bad = structuredClone(p); bad.scene.bodies![0].on = '不存在'; const result = readLessonReply(JSON.stringify(bad)), errors = validate(bad);
  assert.ok(result.problem.unsupported); assert.equal(result.issueCount, errors.length); assert.equal(result.repair, formatRepair(errors));
  assert.equal(solveProblem(result.problem).asks[0].steps!.length, 1);
});
test('unsupported 接受并能读讲解，不回到格式错误拦截', () => {
  const result = readLessonReply(JSON.stringify({ ...p, unsupported: '暂时不支持', scene: { surfaces: [], bodies: [] } }));
  assert.ok(result.problem.unsupported); assert.ok(validateLesson(result.problem)); assert.equal(result.repair, undefined);
});
test('只有读不出的结构、小问、题干和讲解字符串类型会拒绝', () => {
  for (const bad of ['普通文字', '{', { ...p, asks: [] }, { ...p, asks: [{ id: '1', text: '' }] }, { ...p, title: [] }, { ...p, stem: 1 }, { ...p, solution: [] }, { ...p, solution: { '1': [{ say: 1 }] } }, { ...p, solution: { '1': [{ say: '说明', tex: 3 }] } }]) {
    assert.throws(() => readLessonReply(typeof bad === 'string' ? bad : JSON.stringify(bad)), { message: unreadable });
  }
});
test('新题连续提交按1、2、3累计，第三次起才给建议', () => {
  const issue: PasteIssue = { kind: 'unreadable' }; let attempts = 0;
  for (const expected of [1, 2, 3]) { attempts = nextAttempt(undefined, attempts); assert.equal(attempts, expected); assert.equal(noticeFor(issue, attempts, true).round, `第 ${expected} 次`); assert.equal(!!adviceFor(attempts, issue), expected >= 3); }
  assert.equal(adviceFor(3, issue), thirdAdvice);
});
test('保存并重新读取后的同题替换从原次数接着计，不重置', () => {
  const saved = JSON.parse(JSON.stringify({ id: 'same', problem: p, attempts: 2 })); assert.equal(nextAttempt(saved), 3);
  saved.attempts = nextAttempt(saved); assert.equal(nextAttempt(JSON.parse(JSON.stringify(saved))), 4);
});
test('旧题缺少或损坏的计数按首份回复处理，下次替换为第2次', () => {
  for (const attempts of [undefined, 0, -1, NaN, 1.5]) { assert.equal(attemptsOf({ attempts }), 1); assert.equal(nextAttempt({ attempts }), 2); }
  assert.equal(attemptsOf(), 0);
});
test('成功回复虽累计次数，但不继续显示三次失败建议', () => { assert.equal(nextAttempt({ attempts: 2 }), 3); assert.equal(adviceFor(3, undefined), ''); assert.equal(adviceFor(9, undefined), ''); });
test('场景、运行中断、无法动画和结果问题均享有第三次建议', () => {
  for (const kind of ['scene', 'runtime', 'unsupported', 'result'] as const) assert.equal(adviceFor(3, { kind }), thirdAdvice);
});
test('主流程提示不暴露技术错误，复制成功与否如实表达', () => {
  const issue: PasteIssue = { kind: 'scene', count: 4 }, copied = noticeFor(issue, 2, true), failed = noticeFor(issue, 2, false);
  assert.ok(copied.message.includes('4')); assert.ok(copied.next.startsWith('修改提示已复制')); assert.ok(!failed.next.includes('已复制'));
  for (const kind of ['unreadable', 'scene', 'runtime', 'unsupported', 'result'] as const) assert.ok(!/JSON|单侧支撑|undefined|格式校验/.test(Object.values(noticeFor({ kind }, 3)).join('')));
  assert.ok(unreadableRepair.includes('每一小问')); assert.ok(unreadableRepair.includes('完整回复'));
});
test('板块完整分为常见6项和其他7项，每项都有举例', () => {
  const prompts = JSON.parse(readFileSync(new URL('../prompt/提示词.json', import.meta.url), 'utf8')), keys = Object.keys(prompts), rows = topicRows(keys);
  assert.deepEqual(rows[0], commonTopics); assert.equal(rows[1].length, 7); assert.equal(new Set(rows.flat()).size, keys.length); assert.equal(rows.flat().length, keys.length);
  for (const k of keys) assert.ok(topicExamples[k]?.length > 4);
  assert.equal(topicExamples.带电粒子, '粒子在电场、磁场里运动'); assert.equal(topicExamples.运动方程, '题目给了微分关系或变力，要列方程积分');
});
console.log(`第三批评审规则：${passed}/${passed} 通过`);
