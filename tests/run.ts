// 标准集回归测试：跑 problems/*/standard.json，逐问和参考答案比对。
// 用法：node 难题/tests/run.ts [题目文件夹名关键字]

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { nice } from '../engine/num.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'problems');
const filter = process.argv[2] ?? '';
let pass = 0, fail = 0, unverified = 0, stepsVerified = 0, stepsUnverified = 0; const sources: Record<string, number> = {};
for (const dir of readdirSync(root).sort()) {
  const f = join(root, dir, 'standard.json');
  if (!dir.includes(filter) || !existsSync(f)) continue;
  const P = JSON.parse(readFileSync(f, 'utf8')) as Problem;
  const t0 = performance.now();
  try {
    const S = solveProblem(P);
    const ms = (performance.now() - t0).toFixed(0);
    console.log(`\n■ ${dir}  ${P.title ?? ''}（${ms} ms）`);
    const un = Object.keys(P.unknowns ?? {});
    if (un.length) console.log(`  反解：${un.map((k) => `${k} = ${nice(S.vars[k])}`).join('，')}（条件残差 ${S.residual.toExponential(1)}）`);
    for (const a of S.asks) {
      const mark = a.ok === null ? '○' : a.ok ? '✓' : '✗';
      if (a.ok === false) fail++; else if (a.ok === true) pass++; else unverified++;
      sources[a.source ?? 'unknown'] = (sources[a.source ?? 'unknown'] ?? 0) + 1;
      console.log(`  ${mark} (${a.id}) ${a.text} = ${a.shown}${a.answer !== undefined ? `　答案 ${nice(a.answer)}` : ''}${a.error ? `　${a.error}` : ''}`);
      for (const [i, st] of (a.steps ?? []).entries()) {
        const m = st.verdict === 'ok' ? '✓' : st.verdict === 'bad' ? '✗' : '○';
        if (st.verdict === 'bad') fail++; else if (st.verdict === 'ok' && st.source === 'engine') stepsVerified++; else stepsUnverified++;
        console.log(`      ${m} 第 ${i + 1} 步 ${st.say}${st.claimed !== undefined ? `（写 ${nice(st.claimed)}，引擎 ${nice(st.engine!)}）` : ''}${st.reason ? `　${st.reason}` : ''}`);
      }
    }
    console.log(`  结论：${S.label}`);
    if (S.repair) console.log('  修复提示：\n' + S.repair.split('\n').map((l) => '    ' + l).join('\n'));
    console.log(`  阶段：${S.sim.stages.map((s) => `[${nice(s.t0)}→${nice(s.t1)} s ${s.modes.map((m) => `${m.upper}/${m.lower}:${m.mode}`).join(' ')}]`).join(' ')}`);
    console.log(`  事件：${S.sim.events.map((e) => `${e.type}(${[e.a, e.b].filter(Boolean).join(',')})@${nice(e.t)}`).join(' ')}`);
  } catch (e) {
    fail++;
    console.log(`\n■ ${dir}  出错：${(e as Error).message}`);
  }
}
console.log(`\n合计：通过 ${pass}，未通过 ${fail}，未核验 ${unverified}`);
console.log(`来源：${JSON.stringify(sources)}；步骤：已核验 ${stepsVerified}，未核验 ${stepsUnverified}`);
process.exit(fail ? 1 : 0);
