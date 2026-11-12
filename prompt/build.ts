// 用模板、一题标准例和一题自编字母例生成提示词。示例与测试共用文件。
// 用法：node 难题/prompt/build.ts   → 生成 难题/prompt/提示词.txt

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const examples = [
  { dir: '00-板块示例', limit: 3, text: '质量 M = 2 kg 的木板放在水平地面上，木板与地面间动摩擦因数 μ₂ = 0.1；质量 m = 1 kg 的滑块以 v₀ = 6 m/s 滑上木板左端，滑块与木板间 μ₁ = 0.4，木板足够长，g 取 10 m/s²。求 (1) 共速所用时间；(2) 共速时速度；(3) 滑块相对木板滑动的距离。' },
  { file: '../tests/cases/字母自由落体.json', text: '质量为 m 的质点从离地 H 处静止释放，不计阻力，g=10 m/s²。求落地前速率。题目只给字母；两组示例均由你按题意选择。' },
];
let out = readFileSync(join(here, '模板.md'), 'utf8');
examples.forEach((e, i) => {
  const file = 'file' in e ? join(here, e.file!) : join(here, '..', 'problems', e.dir!, 'standard.json');
  const P = JSON.parse(readFileSync(file, 'utf8'));
  delete P.title;
  if ('limit' in e) {
    P.asks = P.asks.slice(0, e.limit);
    P.solution = Object.fromEntries(Object.entries(P.solution ?? {}).filter(([id]) => P.asks.some((a: { id: string }) => a.id === id)));
  }
  out = out.replace(`{{题${i + 1}}}`, e.text).replace(`{{例${i + 1}}}`, JSON.stringify(P));
});
writeFileSync(join(here, '提示词.txt'), out);
// 按板块拆：力学用完整模板，其他板块只给通用规则和本板块说明，免费 AI 才读得完
const sec = (name: string) => out.split(/^## /m).find((p) => p.startsWith(name)) ?? '';
const labs = Object.fromEntries(readFileSync(join(here, '板块.md'), 'utf8').split(/^# /m).filter(Boolean).map((p) => { const i = p.indexOf('\n'); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
const head = out.split(/^## /m)[0], common = labs['共用'], tail = '\n\n下面是要你建模的题目：\n';
const general = ['输出要求', '情景题', '问题 asks', '解题过程 solution'].map((n) => `## ${sec(n).trim()}`).join('\n\n');
const topics: Record<string, string> = { '力学': out.replace(/## 电学和磁学[\s\S]*?(?=## 情景题)/, '') };
for (const [k, v] of Object.entries(labs)) if (k !== '共用') topics[k] = `${head}${general}\n\n## 这一板块的写法\n${common}\n\n${v}${tail}`;
writeFileSync(join(here, '提示词.json'), JSON.stringify(topics));
console.log(`提示词.txt：${out.length} 字；`, Object.entries(topics).map(([k, v]) => `${k} ${v.length}`).join('，'));
