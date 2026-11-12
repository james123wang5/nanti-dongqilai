// 实测用：把 AI 的整段回复存成文件，提取 JSON → 运行 → 核对，打印结果。
// 用法：node 难题/tests/try.ts 回复文件.txt [修改提示输出文件]   第二个参数给了，就把学生在网页上会拿到的修改提示写进去（没问题就写空）
import { readFileSync } from 'node:fs';
import { extractJson } from '../engine/parse.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { nice } from '../engine/num.ts';
import { SOURCE_TEXT, verificationCounts } from '../engine/source.ts';
import { writeFileSync } from 'node:fs';
import { resultRepair, KEEP_SIM } from '../engine/repair.ts';
const fixOut = process.argv[3];
const saveFix = (t: string) => { if (fixOut) writeFileSync(fixOut, t); };

const text = readFileSync(process.argv[2], 'utf8');
let P: Problem;
try { P = extractJson(text) as Problem; } catch (e) { console.log(`✗ 提取失败：${(e as Error).message}`); saveFix(`没读懂这段回复：${(e as Error).message}\n请只输出一个 \`\`\`json 代码块，内容是合法 JSON（表达式写成带引号的字符串），重新输出完整 JSON。`); process.exit(1); }
import { validate, formatRepair } from '../engine/validate.ts';
const errs = validate(P!);
if (errs.length) { console.log(`✗ 格式有问题：\n${formatRepair(errs)}`); saveFix(formatRepair(errs)); process.exit(1); }
try {
  const S = solveProblem(P);
  console.log(`结论：${S.label}`);
  for (const [group, result] of (S.samples ?? [S]).entries()) {
  if (S.samples) console.log(`\n第 ${group + 1} 组：${result.label}；参数 ${JSON.stringify(result.vars)}`);
  for (const a of result.asks) {
    const mark = a.ok === null ? '○' : a.ok ? '✓' : '✗';
    console.log(`${mark} (${a.id}) ${a.text} [${a.source ? SOURCE_TEXT[a.source] : '来源不明'}] = ${a.shown}${a.answer !== undefined ? `　AI 给的答案 ${nice(a.answer)}` : ''}${a.error ? `　${a.error}` : ''}`);
    for (const [i, st] of (a.steps ?? []).entries()) {
      const m = st.verdict === 'ok' ? '✓' : st.verdict === 'bad' ? '✗' : '○';
      console.log(`    ${m} ${i + 1}. ${st.say.slice(0, 40)}${st.source && st.source !== 'engine' ? ` [${SOURCE_TEXT[st.source]}]` : ''}${st.verdict === 'bad' ? `（写 ${st.claimed === undefined ? '—' : nice(st.claimed)}，引擎 ${st.engine === undefined ? '—' : nice(st.engine)}）${st.reason ?? ''}${st.error ?? ''}` : ''}`);
    }
  }
  const counts = verificationCounts(result.asks);
  console.log(`统计：已核验 ${counts.engine} / 按 AI 方程或自定义量 ${counts.custom} / AI 未核验 ${counts.ai} / 仅代数 ${counts.algebra} / 无参考 ${counts.uncompared} / 不一致 ${counts.mismatch} / 算不出 ${counts.unavailable} / 超出能力 ${counts.unsupported}；步骤 ${JSON.stringify(counts.steps)}`);
  }
  const fix = resultRepair(S); saveFix(fix); if (fix) console.log(`\n修改提示：\n${fix}`);
  if (S.label === '有问题') process.exitCode = 1;
} catch (e) { console.log(`✗ 运行出错：${(e as Error).message}`); saveFix(`网页引擎运行这段 JSON 时出错：\n${(e as Error).message}\n请按报错修改，重新输出完整 JSON。${KEEP_SIM}`); process.exitCode = 1; }
