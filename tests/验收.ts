// 顺序运行验收；三组既有未通过项按基线计数核对，完整日志保存在指定目录。
// node tests/验收.ts [日志目录] [--only=测试名] [--skip=测试名]
// 实际 base4 的 run.ts 为 125/3/35（任务说明写 122/3/35）；不改题库或计算值凑计数。
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), out = resolve(process.argv.slice(2).find(a => !a.startsWith('--')) ?? join(root, 'tests/性能结果/验收'));
mkdirSync(out, { recursive: true });
const cases: [string, RegExp, number][] = [
  ['通用规则', /通用规则测试：13\/13 通过/, 0],
  ['run', /合计：通过 125，未通过 3，未核验 35/, 1],
  ['新能力', /新能力测试：32\/32 通过/, 0],
  ['第二轮', /第二轮自编测试：25\/25 通过/, 0],
  ['第三轮', /第三轮自编测试：20\/20 通过/, 0],
  ['实验室', /运动方程后：通过 64，未通过 0/, 0],
  ['checker', /核对器自测通过/, 0],
  ['力学题型', /力学题型测试：12\/12 通过/, 0],
  ['电磁题型', /电磁题型测试：13\/13 通过/, 0],
  ['压轴', /压轴测试：通过 25，未通过 2，未核验 3/, 1],
  ['压轴2', /第二批：通过 12，未通过 0，未核验 1/, 0],
  ['截图实测', /截图实测：\d+\/\d+ 文件回归通过/, 0],
  ['可动支撑', /可动支撑测试：34\/34 通过/, 0],
  ['有符号电学', /有符号电学测试：8\/8 通过/, 0],
  ['中止前结果', /中止前结果测试：10\/10 通过/, 0],
  ['核验口径', /核验口径测试：39\/39 通过/, 0],
  ['静力平衡', /受力平衡测试：14\/14 通过/, 0],
  ['原子核', /原子核测试：7\/7 通过/, 0],
  ['双缝', /双缝测试：5\/5 通过/, 0],
];
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7), skip = process.argv.find(a => a.startsWith('--skip='))?.slice(7);
let failed = 0;
for (const [name, expected, status] of cases) {
  if (only && name !== only || name === skip) continue;
  const t = performance.now(), r = spawnSync(process.execPath, [join(root, 'tests', name + '.ts')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const log = r.stdout + r.stderr; writeFileSync(join(out, name + '.log'), log);
  const ok = r.status === status && expected.test(log); if (!ok) failed++;
  console.log(JSON.stringify({ name, ok, status: r.status, ms: performance.now() - t, summary: log.match(expected)?.[0] }));
}
if (failed) process.exitCode = 1;
