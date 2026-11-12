// 从最终实现逐项撤去优化，测其独立收益；顺序运行，避免 CPU 争用。
// node tests/优化分项.ts <base4项目目录> <base4完整结果目录> [输出目录]
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), baseline = resolve(process.argv[2]), values = resolve(process.argv[3]);
const out = resolve(process.argv[4] ?? join(root, 'tests/性能结果/分项')); mkdirSync(out, { recursive: true });
const original = readFileSync(join(root, 'engine/sim.ts'), 'utf8'), base = readFileSync(join(baseline, 'engine/sim.ts'), 'utf8');
const between = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
const variants: [string, string][] = [
  ['最终实现', original],
  ['恢复残差受力清单', original.replace('!!opt.sample && opt.forces !== false', '!!opt.sample')],
  ['关闭接触解缓存', original.replace('if (!coupled) return solveLegacy(ms);', 'if (!coupled) return solveAccImpl(ms);')],
  ['恢复矩阵逐次组装与分配', original.replace('if (ropes.length) return solveAccWithRopes(ms);', 'return solveAccWithRopes(ms);')],
  ['恢复状态数组flatMap与slice', original
    .replace(between(original, '  const pack =', '  let stageAcc:'), between(base, '  const pack =', '  let stageAcc:'))
    .replace(between(original, '  const deriv =', '  // constAcc：'), between(base, '  const deriv =', '  // constAcc：'))],
];
for (const [name, sim] of variants) {
  if (name !== '最终实现' && sim === original) throw new Error('分项替换失败 ' + name);
  const copy = mkdtempSync(join(tmpdir(), 'physics-ablation-'));
  try {
    for (const dir of ['engine', 'player', 'problems']) cpSync(join(root, dir), join(copy, dir), { recursive: true });
    writeFileSync(join(copy, 'engine/sim.ts'), sim);
    for (const id of ['真题-2026卷14-小球打板', '2025-湖北-15']) {
      const r = spawnSync(process.execPath, [join(root, 'tests/耗时.ts'), copy, '--sample=' + 1/30, '--filter=' + id, '--compare=' + values], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      writeFileSync(join(out, name + '-' + id + '.jsonl'), r.stdout + r.stderr);
      if (r.status !== 0) throw new Error(r.stderr || r.stdout);
      console.log(JSON.stringify({ variant: name, ...JSON.parse(r.stdout) }));
    }
  } finally { rmSync(copy, { recursive: true, force: true }); }
}
