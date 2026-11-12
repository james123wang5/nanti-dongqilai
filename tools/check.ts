// 给 AI 编程智能体（Claude Code、Codex、Trae、Cursor 等）用的检查命令：
//   npm run check -- problems/某题/standard.json      （也可以给题目文件夹，或一段含 ```json 代码块的 AI 回复）
// 做的事和网页一样：读 JSON → 格式校验 → 引擎独立模拟 → 核对每一问的答案和每一步的 check → 给出修改提示。
// 退出码 0 = 通过（可以打开播放器看）；1 = 还要改（照着“修改提示”改 JSON 再跑）。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractJson } from '../engine/parse.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
import { nice } from '../engine/num.ts';
import { SOURCE_TEXT, verificationCounts } from '../engine/source.ts';
import { resultRepair, KEEP_SIM } from '../engine/repair.ts';
import { validate, formatRepair } from '../engine/validate.ts';

const arg = process.argv[2];
if (!arg) { console.log('用法：npm run check -- problems/某题/standard.json'); process.exit(2); }
const file = existsSync(arg) && statSync(arg).isDirectory() ? join(arg, 'standard.json') : arg;
if (!existsSync(file)) { console.log(`✗ 找不到文件：${file}`); process.exit(2); }

const fail = (title: string, fix: string): never => {
  console.log(`\n✗ 未通过：${title}\n\n修改提示（照着改 JSON，再运行一次本命令）：\n${fix}`);
  process.exit(1);
};

let P: Problem;
try { P = extractJson(readFileSync(file, 'utf8')) as Problem; }
catch (e) { fail('读不出 JSON', `${(e as Error).message}\n文件内容必须是合法 JSON（表达式写成带引号的字符串）。`); }
const errs = validate(P!);
if (errs.length) fail('格式有问题', formatRepair(errs));

let S: ReturnType<typeof solveProblem>;
const t0 = performance.now();
try { S = solveProblem(P!); }
catch (e) { fail('引擎运行出错', `${(e as Error).message}\n${KEEP_SIM}`); }

console.log(`${P!.title ?? file}\n结论：${S!.label}（用时 ${Math.round(performance.now() - t0)} ms）`);
for (const [group, result] of (S!.samples ?? [S!]).entries()) {
  if (S!.samples) console.log(`\n第 ${group + 1} 组数值：${result.label}；参数 ${JSON.stringify(result.vars)}`);
  for (const a of result.asks) {
    const mark = a.ok === null ? '○' : a.ok ? '✓' : '✗';
    console.log(`${mark} (${a.id}) ${a.text} [${a.source ? SOURCE_TEXT[a.source] : '来源不明'}] = ${a.shown}${a.answer !== undefined ? `　答案 ${nice(a.answer)}` : ''}${a.error ? `　${a.error}` : ''}`);
    for (const [i, st] of (a.steps ?? []).entries()) {
      if (st.verdict !== 'bad') continue;
      console.log(`    ✗ 第 ${i + 1} 步 ${st.say.slice(0, 40)}（写 ${st.claimed === undefined ? '—' : nice(st.claimed)}，引擎 ${st.engine === undefined ? '—' : nice(st.engine)}）${st.reason ?? ''}${st.error ?? ''}`);
    }
  }
  const c = verificationCounts(result.asks);
  console.log(`统计：引擎核验 ${c.engine}，代数核对 ${c.algebra}，AI 给出未核验 ${c.ai}，不一致 ${c.mismatch}，算不出 ${c.unavailable}`);
}
const fix = resultRepair(S!);
if (S!.label === '有问题' || fix) fail('有小问对不上或算不出', fix || '见上面标 ✗ 的小问和步骤。');
const weak = verificationCounts(S!.asks); 
console.log(`\n✓ 通过。${weak.ai + weak.algebra ? `（有 ${weak.ai + weak.algebra} 问是“仅代数”或“AI 给出”，能模拟的尽量改成读模拟量，见 prompt/提示词.txt 第 7 条）` : ''}\n运行 npm run dev，在网页“题库”里打开这道题看动画。`);
