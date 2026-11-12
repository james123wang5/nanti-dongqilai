// 单进程按目录名顺序计时，stdout 为 JSONL；序列化、比较不计入 solveProblem 耗时。
// node tests/耗时.ts [项目目录] [--sample=0.03333333333333333] [--save=/tmp/base] [--compare=/tmp/base] [--filter=题名]
// save 保存完整返回值（含第二组、事件、动画快照），compare 逐字段核对数值及错误。
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const args = process.argv.slice(2), flag = (name: string) => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
const root = resolve(args.find(a => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const sample = Number(flag('sample') ?? 0), save = flag('save'), compare = flag('compare'), filter = flag('filter') ?? '';
if (save) mkdirSync(save, { recursive: true });
const { solveProblem } = await import(pathToFileURL(join(root, 'engine/solve.ts')).href);
// JSON 本身会丢失 NaN/Infinity/undefined；显式编码，避免把不同错误结果都变成 null。
const encode = (_k: string, v: unknown) => typeof v === 'number' && !Number.isFinite(v) ? { $number: String(v) } : v === undefined ? { $undefined: true } : v;
function diff(a: any, b: any, path = '$', out: string[] = []): string[] {
  if (Object.is(a, b)) return out;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))) return out;
  } else if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) { if (out.length >= 20) break; diff(a[k], b[k], path + '.' + k, out); }
    return out;
  }
  out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`); return out;
}
let mismatches = 0;
for (const id of readdirSync(join(root, 'problems')).sort()) {
  const file = join(root, 'problems', id, 'standard.json'); if (!id.includes(filter) || !existsSync(file)) continue;
  const p = JSON.parse(readFileSync(file, 'utf8')), t = performance.now();
  let result: any, error: string | undefined;
  try { result = solveProblem(p, sample); } catch (e) { error = (e as Error).message; }
  const ms = performance.now() - t, full = JSON.stringify({ error, result }, encode);
  if (save) writeFileSync(join(save, id + '.json.gz'), gzipSync(full));
  const differences = compare ? diff(JSON.parse(gunzipSync(readFileSync(join(compare, id + '.json.gz'))).toString()), JSON.parse(full)) : undefined;
  if (differences?.length) mismatches++;
  const asks = result?.asks.map((a: any) => ({ id: a.id, ok: a.ok, error: a.error, value: a.value, source: a.source, answerMatch: a.answerMatch, verified: a.verified }));
  console.log(JSON.stringify({ id, ms, sample, error, vars: result?.vars, residual: result?.residual, asks, identical: differences ? !differences.length : undefined, differences: differences?.length ? differences : undefined }));
}
if (mismatches) process.exitCode = 1;
