// 核对器自测：把板块示例的解题过程故意改错几步，看能否查出来、原因说得对不对。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveProblem, type Problem } from '../engine/solve.ts';

const here = dirname(fileURLToPath(import.meta.url));
const P = JSON.parse(readFileSync(join(here, '../problems/00-板块示例/standard.json'), 'utf8')) as Problem;
const S1 = P.solution!['1'], S3 = P.solution!['3'];
S1[0].check!.value = 3.92;          // 用了 g = 9.8
S1[1].check!.value = -0.5;          // 方向弄反
S3[2].check!.value = 2;             // 漏了一半
const r = solveProblem(P);
const reasons = r.asks.flatMap((a) => (a.steps ?? []).filter((s) => s.verdict === 'bad').map((s) => s.reason ?? ''));
const expect = [['g = 9.8', reasons[0]], ['正负号', reasons[1]], ['2 倍', reasons[2]]] as const;
let ok = r.label === '有问题' && reasons.length === 3;
for (const [k, got] of expect) { const hit = got?.includes(k); ok &&= !!hit; console.log(`${hit ? '✓' : '✗'} 期望原因含「${k}」：${got}`); }
console.log(`结论：${r.label}\n修复提示：\n${r.repair}`);
console.log(ok ? '\n核对器自测通过' : '\n核对器自测未通过');
process.exit(ok ? 0 : 1);
