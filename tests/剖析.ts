// 在临时副本插桩，生产热路径不承担计数开销。输出 CPU profile 和每次模拟的独立计数。
// node tests/剖析.ts <项目目录> <输出目录> [题名]
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(process.argv[2] ?? '.'), out = resolve(process.argv[3] ?? 'tests/性能结果/剖析');
mkdirSync(out, { recursive: true });
const copy = mkdtempSync(join(tmpdir(), 'physics-profile-'));
for (const dir of ['engine', 'player', 'problems']) cpSync(join(root, dir), join(copy, dir), { recursive: true });
const prefix = `const perf = globalThis.__physicsPerf;\n`;
const edit = (file: string, changes: [string, string][]) => {
  let s = readFileSync(join(copy, file), 'utf8');
  for (let [from, to] of changes) {
    if (from === 'function solveAccImpl(ms: Mode[]) {' && !s.includes(from)) { from = 'function solveAccImpl(ms: Mode[]): AccResult | null {'; to = from + ' perf.row.acc++;'; }
    if (!s.includes(from)) throw new Error(`插桩位置缺失 ${file}: ${from}`); s = s.replace(from, to);
  }
  if (file === 'engine/sim.ts' && s.includes('function makeLegacyLayout(ms: Mode[]) {')) s = s.replace('function makeLegacyLayout(ms: Mode[]) {', 'function makeLegacyLayout(ms: Mode[]) { perf.row.plans++;');
  writeFileSync(join(copy, file), prefix + s);
};
edit('engine/solve.ts', [
  ['function solveUnknowns(P: Problem)', 'function solveUnknowns(P: Problem)'],
  ['const happens = (x: number) => { try {', 'const happens = (x: number) => { perf.trials++; try {'],
  ['function residuals(P: Problem, u: Record<string, number>): number[] {', 'function residuals(P: Problem, u: Record<string, number>): number[] { perf.trials++;'],
  ['for (let it = 0; it < iterations && norm(r) > 1e-11; it++) {', 'for (let it = 0; it < iterations && norm(r) > 1e-11; it++) { perf.lmIterations++;'],
  ['for (let c = 0; c < G ** names.length; c++) {', 'for (let c = 0; c < G ** names.length; c++) { perf.gridIterations++;'],
  ['const raw = (x: number[]) => { const key = JSON.stringify(x);', 'const raw = (x: number[]) => { perf.residualRequests++; const key = JSON.stringify(x); if (residualCache.has(key)) perf.cacheHits++;'],
  ['for (let it = 0; it < 45; it++) { const mid = (lo + hi) / 2; if (happens(mid)', 'for (let it = 0; it < 45; it++) { perf.justIterations++; const mid = (lo + hi) / 2; if (happens(mid)'],
  ['for (let it = 0; it < 60; it++) {\n      const value = F([other])[0];', 'for (let it = 0; it < 60; it++) { perf.tangentIterations++;\n      const value = F([other])[0];'],
  ['for (let it = 0; it < 45; it++) {\n      const mid = (lo + hi) / 2, value = F([mid])[0];', 'for (let it = 0; it < 45; it++) { perf.bracketIterations++;\n      const mid = (lo + hi) / 2, value = F([mid])[0];'],
  ['const value = (t: number) => { try {', 'const value = (t: number) => { perf.crossingValues++; try {'],
]);
edit('engine/sim.ts', [
  ['const r = simulateCore(spec, vars, opt);', `const row = { steps: 0, events: 0, rk4: 0, acc: 0, snaps: 0, forces: 0, plans: 0, eliminations: 0 }; perf.runs.push(row); perf.row = row; const r = simulateCore(spec, vars, opt); row.end = r.end.t; row.samples = r.samples.length; row.vars = vars;`],
  ['function gauss(A: number[][]): number[] | null {', 'function gauss(A: number[][]): number[] | null { perf.row.eliminations++;'],
  ['const snap = (): Snapshot => {', 'const snap = (): Snapshot => { perf.row.snaps++;'],
  ['function forceList(b: Body): ForceVec[] {', 'function forceList(b: Body): ForceVec[] { perf.row.forces++;'],
  ['function solveAccImpl(ms: Mode[]) {', 'function solveAccImpl(ms: Mode[]) { perf.row.acc++;'],
  ['const rk4 = (st: St, h: number): St => {', 'const rk4 = (st: St, h: number): St => { perf.row.rk4++;'],
  ['try { while (t < tMax && guard++ < 2e6) {', 'try { while (t < tMax && guard++ < 2e6) { perf.row.steps++;'],
  ['const fns = eventFns();', 'const fns = eventFns().map(e => { const f = e.f; return { ...e, f: () => { perf.row.events++; return f(); } }; });'],
]);
writeFileSync(join(copy, 'profile.ts'), `
import { readFileSync } from 'node:fs';
globalThis.__physicsPerf = { trials: 0, lmIterations: 0, crossingValues: 0, gridIterations: 0, justIterations: 0, tangentIterations: 0, bracketIterations: 0, residualRequests: 0, cacheHits: 0, runs: [] };
const { solveProblem } = await import('./engine/solve.ts');
const p = JSON.parse(readFileSync(new URL('./problems/' + process.argv[2] + '/standard.json', import.meta.url), 'utf8'));
const t = performance.now(); const r = solveProblem(p, 1/30);
console.log(JSON.stringify({ id: process.argv[2], ms: performance.now()-t, asks: r.asks.map(a=>({id:a.id,value:a.value,error:a.error})), ...globalThis.__physicsPerf, row: undefined }));
`);
try { for (const id of process.argv[4] ? [process.argv[4]] : ['真题-2026卷14-小球打板', '2025-湖北-15']) {
  const r = spawnSync(process.execPath, ['--cpu-prof', '--cpu-prof-dir=' + out, '--cpu-prof-name=' + id + '.cpuprofile', join(copy, 'profile.ts'), id], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  writeFileSync(join(out, id + '.json'), r.stdout);
  const data = JSON.parse(r.stdout), sums = Object.fromEntries(['steps','events','rk4','acc','snaps','forces','plans','eliminations'].map(k=>[k,data.runs.reduce((s,r)=>s+r[k],0)]));
  console.log(JSON.stringify({id,ms:data.ms,trials:data.trials,lmIterations:data.lmIterations,crossingValues:data.crossingValues,gridIterations:data.gridIterations,justIterations:data.justIterations,tangentIterations:data.tangentIterations,bracketIterations:data.bracketIterations,residualRequests:data.residualRequests,cacheHits:data.cacheHits,runs:data.runs.length,...sums}));
}
} finally { rmSync(copy, { recursive: true, force: true }); }
