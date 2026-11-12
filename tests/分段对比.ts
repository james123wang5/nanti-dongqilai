// 从任意目录运行：node 难题/tests/分段对比.ts [--sample 0.03333333333333333]
// 可选 --before-window /tmp/修正前lesson.ts，以及 --before /tmp/修正前.ts --out /tmp/分段对比.json，用冻结的实现生成前后报告。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { phasesOf, type Phase } from '../player/view-rules.ts';
import { phasesOf as oldPhases } from './fixtures/view-rules-old.ts';
import { buildProcessMap, overviewWindow, overviewContentEnd } from '../player/lesson.ts';
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'problems'), sample = Number(arg('--sample', '0'));
const beforeFile = arg('--before'), beforePhases = beforeFile ? (await import(pathToFileURL(resolve(beforeFile)).href)).phasesOf as typeof phasesOf : undefined;
const beforeWindowFile = arg('--before-window'), beforeWindow = beforeWindowFile ? (await import(pathToFileURL(resolve(beforeWindowFile)).href)).overviewWindow as typeof overviewWindow : undefined;
const rows: object[] = [], skips: object[] = [], errors: string[] = [];
const stats = (phases: Phase[], span: number) => ({ count: phases.length, min: phases.length ? Math.min(...phases.map((p) => (p.t1 - p.t0) / span)) : null, labels: phases.map((p) => p.label) });
const check = (ok: unknown, message: string) => { if (!ok) errors.push(message); };
for (const dir of readdirSync(root).sort()) {
  const f = join(root, dir, 'standard.json'); if (!existsSync(f)) continue;
  const p = JSON.parse(readFileSync(f, 'utf8')) as Problem;
  let solved;
  try { solved = solveProblem(p, sample); }
  catch (e) { const skip = { dir, reason: String((e as Error).message) }; skips.push(skip); console.log(`${dir}\t无法演示：${skip.reason}`); continue; }
  const sim = solved.sim;
  if (!sim) { skips.push({ dir, reason: '只有讲解，没有动画' }); console.log(`${dir}\t只有讲解，没有动画`); continue; }
  for (const [mode, bounds] of [['全过程', overviewWindow(solved)], ['完整模拟', [0, sim.end.t]]] as const) {
    const [w0, w1] = bounds, span = w1 - w0, contentEnd = mode === '全过程' ? overviewContentEnd(solved) : w1;
    const old = oldPhases(sim, w0, w1), now = phasesOf(sim, w0, w1, { contentEnd });
    const beforeBounds = mode === '全过程' && beforeWindow ? beforeWindow(solved) : bounds, before = beforePhases?.(sim, ...beforeBounds);
    const a = stats(old, span), b = stats(now, span), prev = before ? stats(before, beforeBounds[1] - beforeBounds[0]) : undefined;
    const prefix = `${dir}/${mode}`;
    console.log(`${prefix}\t旧${a.count}\t${prev ? `修正前${prev.count}\t` : ''}新${b.count}\t最短${b.min === null ? '—' : (b.min * 100 < 1e-6 ? (b.min * 100).toExponential(2) : (b.min * 100).toFixed(6)) + '%'}\t${b.labels.join(' | ')}`);
    rows.push({ dir, mode, w0, w1, contentEnd, beforeBounds, old: a, before: prev, after: b });
    check(now.length <= 8, `${prefix} 超过8段`);
    check(now.length > 0, `${prefix} 没有分段`);
    check(now.every((p) => !/第\s*[\d一二三四五六七八九十]+\s*段/.test(p.label)), `${prefix} 有编号标签`);
    check(now.every((p) => p.t1 - p.t0 >= span * .002 - span * 1e-12), `${prefix} 有短于0.2%的段`);
    check(now.every((p, i) => !i || p.label !== now[i - 1].label), `${prefix} 相邻段标签重复`);
    for (const [i, phase] of now.entries()) {
      check(phase.t1 > phase.t0, `${prefix} 第${i + 1}段长度为0`);
      check([...phase.label].length <= 16, `${prefix} 标签超过16字：${phase.label}`);
      check(phase.t0 >= w0 && phase.t1 <= w1, `${prefix} 超出窗口`);
      if (i) check(Math.abs(phase.t0 - now[i - 1].t1) <= Math.max(span * 1e-8, Number.EPSILON), `${prefix} 分段不连续`);
    }
    if (dir === '示例-卫星变轨') check(now.every((q) => !/上升|下降|向左|向右/.test(q.label)), `${prefix} 曲线运动用了轴向方向词`);
    if (dir === '真题-2026卷13-实验舱') {
      check(now.some((q) => q.label.includes('加速上升')), `${prefix} 缺少加速上升`);
      check(now.some((q) => q.label.includes('减速上升')), `${prefix} 缺少减速上升`);
      if (mode === '全过程') {
        check(now.every((q) => !q.label.includes('下降')), `${prefix} 留白中产生下降段`);
        check(buildProcessMap(p, sim, w0, w1, false, contentEnd).steps.every((q) => !q.say.includes('下降') && q.t <= contentEnd), `${prefix} 地图描述了留白下降`);
      }
    }
    if (dir === '00-板块示例') {
      const map = buildProcessMap(p, sim, w0, w1, false, contentEnd);
      check(map.steps.every((q) => [...q.say].length <= 30 && !/3 N|0\.5 m\/s²|0\.6667|\d\s*N\b|加速度约/.test(q.say)), `${prefix} 过程地图不满足M4.2`);
      check(map.steps.some((q) => q.say.includes('2/3 m/s')), `${prefix} 共速速度没有使用分数`);
    }
  }
}
if (arg('--out')) writeFileSync(resolve(arg('--out')!), JSON.stringify({ sample, rows, skips, errors }, null, 2));
assert.equal(errors.length, 0, errors.join('\n'));
console.log(`分段对比验收：${rows.length / 2}题 × 2窗口通过；${skips.length}题不能演示，已逐题说明`);
