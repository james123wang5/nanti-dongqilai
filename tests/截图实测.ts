// 真题截图写出的回复都要能校验、能算完，且没有和答案对不上的小问。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extractJson } from '../engine/parse.ts';
import { validate } from '../engine/validate.ts';
import { solveProblem, type Problem } from '../engine/solve.ts';
const dir = new URL('../实测/截图实测/', import.meta.url); let n = 0, verified = 0, unverified = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
  const P = extractJson(readFileSync(new URL(f, dir), 'utf8')) as Problem;
  assert.deepEqual(validate(P), [], f);
  const s = solveProblem(P, 1 / 60);
  for (const a of s.asks) { assert.ok(!a.error, `${f} ${a.id} ${a.error}`); assert.notEqual(a.ok, false, `${f} ${a.id}`); if (a.ok === true) verified++; else unverified++; }
  n++;
}
console.log(`截图实测：${n}/${n} 文件回归通过；小问已核验 ${verified}，未核验 ${unverified}`);
