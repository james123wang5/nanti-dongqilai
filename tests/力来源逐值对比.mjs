// 不启动浏览器。先用未改动版本：
// node 难题/tests/耗时.ts --sample=0.03333333333333333 --save=/tmp/before-values
// 修改后：node 难题/tests/力来源逐值对比.mjs --before /tmp/before-values [--out /tmp/comparison.json]
// 对比所有字段，唯一允许增加的是快照 fs[] 内的只读 by 字符串；数值使用 Object.is 严格相等。
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { solveProblem } from '../engine/solve.ts';
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i+1]; };
const before = arg('--before'); if (!before) throw new Error('需要 --before 改前完整输出目录');
const root = new URL('../problems/', import.meta.url), sample = 1/30;
const encode = (_k, v) => typeof v === 'number' && !Number.isFinite(v) ? { $number: String(v) } : v === undefined ? { $undefined: true } : v;
let numbers = 0, sources = 0;
function compare(a, b, path = '$') {
  if (typeof a === 'number') numbers++;
  if (Object.is(a,b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === 'by' && /\.fs\.\d+$/.test(path) && a[key] === undefined && typeof b[key] === 'string') { sources++; continue; }
      compare(a[key],b[key],`${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path}：${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}
const rows = [];
const ids = readdirSync(root).filter((id) => existsSync(new URL(`${id}/standard.json`, root))).sort();
const baselineIds = readdirSync(before).filter((s) => s.endsWith('.json.gz')).map((s) => s.slice(0,-8)).sort();
if (JSON.stringify(ids) !== JSON.stringify(baselineIds)) throw new Error('题库文件集合与基线不同');
for (const id of ids) {
  let result, error;
  try { result = solveProblem(JSON.parse(readFileSync(new URL(`${id}/standard.json`, root),'utf8')), sample); } catch (e) { error = e.message; }
  const expected = JSON.parse(gunzipSync(readFileSync(join(before,id+'.json.gz'))).toString());
  const actual = JSON.parse(JSON.stringify({ error, result }, encode));
  try { compare(expected,actual); rows.push({ id, identical: true, error: error ?? null }); }
  catch (e) { rows.push({ id, identical: false, difference: e.message }); }
  console.log(`${rows.at(-1).identical ? '一致' : '不一致'} ${id}`);
}
const report = { sample, problems: rows.length, identical: rows.filter((r) => r.identical).length, numbers, addedSources: sources, rows };
if (arg('--out')) writeFileSync(resolve(arg('--out')), JSON.stringify(report,null,2)+'\n');
console.log(`全库逐值对比：${report.identical}/${report.problems} 一致；严格比较 ${numbers} 个数值；只新增 ${sources} 个施力方字符串。`);
if (report.identical !== report.problems) process.exitCode = 1;
