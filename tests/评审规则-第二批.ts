// 第二批规则验收：不改题库、不改变计算；可在没有浏览器的环境执行。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { simulate, type SceneSpec, type Snapshot, type SimResult } from '../engine/sim.ts';
import { validate, storyHints, storyLines } from '../engine/validate.ts';
import { extractJson } from '../engine/parse.ts';
import { readLessonReply, lessonFallback } from '../player/lesson-input.ts';
import { phasesOf, motionAt, motionDuring } from '../player/view-rules.ts';
import { buildProcessMap, overviewWindow, overviewContentEnd, formatSpeed, mapLine } from '../player/lesson.ts';
import { sampleAt } from '../player/timeline.ts';
import { pieces, punctuatedHtml } from '../player/typeset.ts';
let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`通过 ${name}`); }
const file = (s: string) => JSON.parse(readFileSync(new URL(`../problems/${s}/standard.json`, import.meta.url), 'utf8')) as Problem;
const base: Problem = { spec: 'v1', scene: { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 1, on: '地', v: 2 }], tMax: 2 }, asks: [{ id: '1', text: '求速度', expr: 'v(A)', at: { event: 'time', t: 1 }, answer: 2 }] };
test('story 合法数组可校验、空数组可省略', () => {
  for (const story of [undefined, [], ['物体匀速：合力为零']]) { assert.deepEqual(storyHints({ story }), []); assert.deepEqual(validate({ ...base, story }), []); }
});
test('story 类型、空句、超长统一为一条轻提示，不成为场景/讲解错误', () => {
  for (const story of [null, '一段话', 1, [1], [''], ['字'.repeat(31)], ['有效', null]]) {
    const p = { ...base, story } as unknown as Problem;
    assert.equal(storyHints(p).length, 1); assert.deepEqual(validate(p), []); assert.deepEqual(storyLines(p), []);
    const reply = readLessonReply(JSON.stringify(p)); assert.ok(!reply.problem.unsupported); assert.equal(reply.repair, undefined);
  }
});
test('story 在缺场景、完整场景、错放 scene 或重复时均不丢失', () => {
  const story = ['物体匀速：合力为零'];
  for (const raw of [{ asks: base.asks, story }, { ...base, story }, { ...base, scene: { ...base.scene, story } }, { ...base, story, scene: { ...base.scene, story: ['采用顶层'] } }]) {
    const p = extractJson(JSON.stringify(raw)) as Problem;
    assert.deepEqual(p.story, story); assert.ok(!('story' in p.scene));
  }
});
test('story 是纯文字元数据，加入后完整求解结果逐字段不变', () => {
  assert.deepEqual(solveProblem(base, 1 / 30), solveProblem({ ...base, story: ['物体匀速：合力为零'] }, 1 / 30));
  assert.deepEqual(lessonFallback({ ...base, story: ['一段说明'] }).story, ['一段说明']);
});
const board = file('00-板块示例'), boardSolved = solveProblem(board, 1 / 30), window = overviewWindow(boardSolved), boardMap = buildProcessMap(board, boardSolved.sim!, ...window);
test('板块过程地图每行不超 30 字，无力/加速度数值和长小数', () => {
  assert.ok(boardMap.steps.length > 2);
  for (const s of boardMap.steps) { assert.ok([...s.say].length <= 30); assert.ok(!/\d\s*N\b|m\/s²|加速度约|0\.6667|3 N|0\.5 m\/s/.test(s.say), s.say); }
  assert.ok(boardMap.steps.some((s) => /2\/3 m\/s/.test(s.say)));
});
test('速度先认分数，其余最多三位有效数字，截短按 Unicode 字符', () => {
  assert.equal(formatSpeed(2 / 3), '2/3'); assert.equal(formatSpeed(1.234567), '1.23');
  assert.equal([...mapLine('字'.repeat(80))].length, 30); assert.equal([...mapLine('😀'.repeat(31))].length, 30);
});
test('相邻加速、减速、匀速、静止的状态标签各自不同', () => {
  const snap = (vx: number, x: number) => ({ bodies: { A: { vx, vy: 0, a: x, ang: 0 } } }) as unknown as Snapshot;
  assert.equal(motionAt(snap(2, 1), 'A').state, '加速'); assert.equal(motionAt(snap(2, -1), 'A').state, '减速');
  assert.equal(motionAt(snap(2, 0), 'A').state, '匀速'); assert.equal(motionAt(snap(0, 0), 'A').state, '静止');
});
test('上抛同一受力段中的减速上升和加速下降不合并', () => {
  const scene = { surfaces: [{ id: '竖轨', from: [0, -1000], to: [0, 1000] }], bodies: [{ id: '球', m: 1, on: '竖轨', at: 1000, v: 20 }], tMax: 4 } as SceneSpec;
  const sim = simulate(scene, { g: 10 }, { sample: 1 / 30, forces: true }), labels = phasesOf(sim, 0, sim.end.t).map((p) => p.label);
  assert.ok(labels.some((s) => s.includes('减速上升')), labels.join('/')); assert.ok(labels.some((s) => s.includes('加速下降')), labels.join('/'));
});
const cabin = file('真题-2026卷13-实验舱'), cabinSolved = solveProblem(cabin, 1 / 30), cabinWindow = overviewWindow(cabinSolved);
test('全过程以实际引用时间窗优先，默认 t 末尾不拖长播放', () => {
  const stop = cabinSolved.sim!.events.find((e) => e.type === 'stop')!.t;
  assert.ok(Math.abs(cabinWindow[1] - stop * 1.05) < 1e-8);
  assert.ok(cabinSolved.asks[1].t! > cabinWindow[1]);
});
test('实验舱有加速上升、减速上升，结束在最高点附近，不离塔', () => {
  const sim = cabinSolved.sim!, labels = phasesOf(sim, ...cabinWindow, { contentEnd: overviewContentEnd(cabinSolved) }).map((p) => p.label), map = buildProcessMap(cabin, sim, ...cabinWindow, false, overviewContentEnd(cabinSolved));
  assert.ok(labels.some((s) => s.includes('加速上升'))); assert.ok(labels.some((s) => s.includes('减速上升')));
  assert.ok(map.steps.every((s) => !/离开塔|在空中运动|下降/.test(s.say)));
  assert.ok(labels.every((s) => !s.includes('下降')));
  const highest = sim.events.find((e) => e.type === 'stop')!.snap.bodies['舱'].y, end = sampleAt(sim, cabinWindow[1]).bodies['舱'];
  assert.ok(Math.abs(end.y - highest) < highest * .01); assert.equal(end.on, '塔');
});
test('没有正时长引用时用全程，5% 留白不超模拟终点', () => {
  const fake = { sim: { end: { t: 10 } } } as unknown as typeof cabinSolved;
  assert.deepEqual(overviewWindow({ ...fake, asks: [{}] }), [0, 10]);
  assert.deepEqual(overviewWindow({ ...fake, asks: [{ t: 9.9 }] }), [0, 10]);
  assert.deepEqual(overviewWindow({ ...fake, asks: [{ t: 2 }, { span: [0, 4] }] }), [0, 4.2]);
  assert.deepEqual(overviewWindow({ ...fake, asks: [{ t: 0 }] }), [0, 10]);
});
test('story 条数等于阶段数则逐段替代，转折仍按时序显示', () => {
  const sim = boardSolved.sim!, phases = phasesOf(sim, ...window), story = phases.map((_, i) => `自写第${i + 1}段`);
  const map = buildProcessMap({ story }, sim, ...window);
  assert.deepEqual(map.intro, []); assert.deepEqual(map.steps.filter((s) => !s.transition).map((s) => s.say), story);
  for (let i = 1; i < map.steps.length; i++) assert.ok(map.steps[i].t >= map.steps[i - 1].t);
});
test('story 数量不符放在地图上方，非法 story 回退自动说明', () => {
  const sim = boardSolved.sim!, story = ['全程说明'];
  assert.deepEqual(buildProcessMap({ story }, sim, ...window).intro, story);
  const invalid = buildProcessMap({ story: ['字'.repeat(31)] }, sim, ...window); assert.deepEqual(invalid.intro, []);
  assert.deepEqual(invalid.steps.map((s) => s.say), boardMap.steps.map((s) => s.say));
});
test('B6 公式或文字末字与句号不分行，转换不改变输入片段', () => {
  const input = pieces('速度为 $v=2$。下一步。'), before = structuredClone(input), html = punctuatedHtml(input, (s) => `<math>${s}</math>`, (s) => s);
  assert.ok(html.includes('<span class="keep-punctuation"><math>v=2</math>。</span>'));
  assert.ok(html.includes('<span class="keep-punctuation">步。</span>')); assert.deepEqual(input, before);
  assert.equal(punctuatedHtml([{ text: '对\"。' }], (s) => s, (s) => s.replace(/\"/g, '&quot;')), '对<span class=\"keep-punctuation\">&quot;。</span>');
});
test('各份生成提示词都含同一条简短 story 说明，单份新增不超过150字', () => {
  const template = readFileSync(new URL('../prompt/模板.md', import.meta.url), 'utf8'), line = template.split('\n').find((s) => s.startsWith('可选顶层 `"story"'))!;
  assert.ok(line && line.length + 1 <= 150);
  const topics = JSON.parse(readFileSync(new URL('../prompt/提示词.json', import.meta.url), 'utf8'));
  for (const text of [readFileSync(new URL('../prompt/提示词.txt', import.meta.url), 'utf8'), ...Object.values(topics)] as string[]) assert.equal(text.split(line).length - 1, 1);
});


// 分段退步修正：用解析采样构造通用边界，既不读取题目名称也不改物理引擎。
const analytic = (times: number[], velocity: (t: number) => number[], on: string | null = '轨道'): SimResult => {
  const snap = (t: number) => { const v = velocity(t); return { t, bodies: { A: { x: t, y: 0, cx: t, vx: v[0], vy: v[1], ang: 0, on } }, springs: {}, heat: {}, path: {}, counts: {} } as Snapshot; };
  return { geo: { bodies: [{ id: 'A', m: 1 }], surfaces: [], plane: 'horizontal' }, start: snap(times[0]), end: snap(times.at(-1)!), samples: times.map(snap), stages: [{ t0: times[0], t1: times.at(-1)!, modes: [], acc: {} }], events: [], vars: {} } as unknown as SimResult;
};
const orbitPositions = (sim: SimResult) => {
  for (const snap of [sim.start, sim.end, ...sim.samples]) { snap.bodies.A.x = snap.bodies.A.cx = Math.sin(snap.t); snap.bodies.A.y = -Math.cos(snap.t); }
  return sim;
};
test('无 fs 的匀速圆周按速度差分判曲线，不随坐标方向反复分段', () => {
  const sim = orbitPositions(analytic(Array.from({ length: 161 }, (_, i) => i * Math.PI / 40), (t) => [Math.cos(t), Math.sin(t)], null));
  assert.equal(motionDuring(sim, 0, .1, 'A').state, '曲线');
  const ps = phasesOf(sim, 0, sim.end.t); assert.equal(ps.length, 1); assert.ok(ps[0].label.includes('曲线')); assert.ok(!/向左|向右|上升|下降/.test(ps[0].label));
  const map = buildProcessMap({}, sim, 0, sim.end.t); assert.ok(map.steps.every((s) => !s.say.includes('合力为零')));
});
test('同状态短接触段并入同状态邻段，相反状态短段仍保留', () => {
  const sim = analytic([0, .005, 1], () => [1, 0]); sim.start.bodies.A.on = '另一轨';
  sim.samples[0].bodies.A.on = '另一轨';
  sim.events = [{ type: 'enter', a: 'A', b: '轨道', t: .005, snap: sim.samples[1], before: { ...sim.samples[1], bodies: { A: { ...sim.samples[1].bodies.A, on: '另一轨' } } }, after: sim.samples[1] }];
  assert.equal(phasesOf(sim, 0, 1).length, 1);
  const reversal = analytic([0, .005, 1], (t) => [t <= .005 ? 1 + t : 1.005 - (t - .005), 0]);
  const ps = phasesOf(reversal, 0, 1); assert.equal(ps.length, 2); assert.ok(ps[0].label.includes('加速')); assert.ok(ps[1].label.includes('减速')); assert.ok(ps[0].t1 < .01);
});
test('无零长度或近重复切点，零时长窗口恢复完整可观看区间', () => {
  const sim = analytic([0, .4, .4 + 1e-13, 1], () => [2, 0]);
  const ps = phasesOf(sim, 0, 1); assert.equal(ps.length, 1); assert.ok(ps.every((p) => p.t1 > p.t0)); const restored = phasesOf(sim, 1, 1); assert.equal(restored.length, 1); assert.equal(restored[0].t0, 0); assert.equal(restored[0].t1, 1);
});
test('周期运动超过8段时按事件粗分，地图使用粗分描述', () => {
  const sim = analytic(Array.from({ length: 641 }, (_, i) => i * Math.PI / 40), (t) => [-Math.sin(t), 0]);
  for (let i = 1; i < 16; i++) sim.events.push({ type: 'stop', a: 'A', t: i * Math.PI, snap: sampleAt(sim, i * Math.PI) });
  const ps = phasesOf(sim, 0, sim.end.t); assert.ok(ps.length <= 8); assert.ok(ps.every((p) => p.coarse && [...p.label].length <= 16));
  const map = buildProcessMap({}, sim, 0, sim.end.t); assert.ok(map.steps.filter((p) => !p.transition).every((p) => !/第\d+段/.test(p.say)));
});
test('多物体只标最多2个相关物体，其余保留“等”，标签不超过16字', () => {
  const sim = analytic([0, 1], () => [1, 0]);
  const names = ['很长名字的甲物体', '很长名字的乙物体', '丙', '丁', '戊', '静止物体'];
  sim.geo.bodies = names.map((id) => ({ id, m: 1 })) as typeof sim.geo.bodies;
  for (const snap of [sim.start, sim.end, ...sim.samples]) snap.bodies = Object.fromEntries(names.map((id) => [id, { ...snap.bodies.A, vx: id === '静止物体' ? 0 : 1 }]));
  const ps = phasesOf(sim, 0, 1); assert.equal(ps.length, 1); assert.equal(ps[0].bodies?.length, 2); assert.ok(ps[0].label.endsWith('等')); assert.ok([...ps[0].label].length <= 16); assert.ok(!ps[0].label.includes('静止物体'));
});

test('只有稀疏转向采样、另有阶段切点时也不虚构加减速或轴向方向', () => {
  const sim = orbitPositions(analytic([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2, 2 * Math.PI], (t) => [Math.cos(t), Math.sin(t)], null));
  const cuts = [0, .1, .5, 1, 2, 3, 4, 5, 2 * Math.PI];
  sim.stages = cuts.slice(0, -1).map((t0, i) => ({ t0, t1: cuts[i + 1], modes: [], acc: {} }));
  const ps = phasesOf(sim, 0, sim.end.t); assert.equal(ps.length, 1); assert.ok(ps[0].label.includes('曲线')); assert.ok(!/加速|减速|上升|下降|向左|向右/.test(ps[0].label));
});

test('半周两端速度反向时，借助位置弦区分圆弧和直线折返', () => {
  const sim = orbitPositions(analytic([0, Math.PI, 2 * Math.PI], (t) => [Math.cos(t), Math.sin(t)], null));
  const ps = phasesOf(sim, 0, sim.end.t); assert.equal(ps.length, 1); assert.ok(ps[0].label.includes('曲线')); assert.ok(!/加速|减速|上升|下降|向左|向右/.test(ps[0].label));
});

test('实验室保留无节点时的过程描述，重复和超多节点也不产生零长或超8段', () => {
  const sim = analytic([0, 1], () => [1, 0]); sim.board = { name: '自编实验室', view: [0, 0, 1, 1] };
  assert.equal(phasesOf(sim, 0, 1)[0].label, '运动过程');
  for (let i = 0; i < 20; i++) sim.events.push({ type: 'mark', a: '很长的阶段描述'.repeat(8), t: (Math.floor(i / 2) + 1) / 12, snap: sampleAt(sim, .5) });
  const ps = phasesOf(sim, 0, 1); assert.ok(ps.length <= 8); assert.ok(ps.every((p) => p.t1 > p.t0 && [...p.label].length <= 16));
});

test('原生粗分去掉编号并合并重复标签，事件分段保留真实起点名', () => {
  const sim = analytic(Array.from({ length: 641 }, (_, i) => i * Math.PI / 40), (t) => [-Math.sin(t), 0]);
  const coarse = phasesOf(sim, 0, sim.end.t); assert.equal(coarse.length, 1); assert.equal(coarse[0].label, 'A 沿轨道运动');
  sim.board = { name: '事件实验室', view: [0, 0, 1, 1] };
  sim.events = Array.from({ length: 14 }, (_, i) => ({ type: 'mark', a: `甲进入${String.fromCharCode(65 + i)}`, t: i + 1, snap: sampleAt(sim, i + 1) }));
  const events = phasesOf(sim, 0, sim.end.t); assert.ok(events.length <= 8);
  for (const p of events) { assert.ok(!/第\d+段/.test(p.label)); if (p.t0 > 0) assert.equal(p.label, sim.events.find((e) => e.t === p.t0)!.a); }
});
test('圆锥摆的公式小问不再把全过程变为0秒、0段', () => {
  const solved = solveProblem(file('示例-圆锥摆'), 1 / 30), [w0, w1] = overviewWindow(solved);
  assert.ok(w1 > 0); assert.equal(w1, solved.sim!.end.t); const phases = phasesOf(solved.sim!, w0, w1); assert.ok(phases.length >= 1); assert.ok(phases.every((p) => p.t1 > p.t0));
});
test('5%留白只延长已有段，过程地图不描述留白里的反向状态', () => {
  const end = overviewContentEnd(cabinSolved), phases = phasesOf(cabinSolved.sim!, ...cabinWindow, { contentEnd: end });
  assert.equal(phases.length, 2); assert.equal(phases.at(-1)!.t1, cabinWindow[1]); assert.equal(phases.at(-1)!.contentEnd, end);
  const map = buildProcessMap(cabin, cabinSolved.sim!, ...cabinWindow, false, end); assert.ok(map.steps.every((p) => !p.say.includes('下降') && p.t <= end));
});
test('0.2%以下相反状态也吸收，0.2%至1%的相反状态仍保留', () => {
  const tiny = analytic([0, .001, 1], (t) => [t <= .001 ? 1 + t : 1.001 - (t - .001), 0]);
  const absorbed = phasesOf(tiny, 0, 1); assert.equal(absorbed.length, 1); assert.ok(absorbed[0].label.includes('减速'));
  const small = analytic([0, .005, 1], (t) => [t <= .005 ? 1 + t : 1.005 - (t - .005), 0]);
  const phases = phasesOf(small, 0, 1); assert.equal(phases.length, 2); assert.ok(phases.every((p) => p.t1 - p.t0 >= .002));
});
test('单帧静态模拟也有可观看的一段，不改原快照', () => {
  const sim = analytic([0], () => [0, 0]), before = structuredClone(sim), window = overviewWindow({ sim, asks: [{ span: [0, 0] }] });
  assert.deepEqual(window, [0, 1]); const phases = phasesOf(sim, ...window); assert.equal(phases.length, 1); assert.ok(phases[0].t1 > phases[0].t0); assert.deepEqual(sim, before);
});
console.log(`第二批评审规则：${passed}/${passed} 通过`);
