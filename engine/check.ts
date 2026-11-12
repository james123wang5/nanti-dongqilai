// 核对器：逐步核对解题过程里的数，对不上时排查常见原因，并生成可以贴回给 AI 的修复提示。

import { nice, same, sameAnswer } from './num.ts';
import type { Snapshot } from './sim.ts';
import type { Source } from './source.ts';

export type Verdict = 'ok' | 'bad' | 'skip' | 'algebra' | 'custom';
export type StepResult = {
  verified?: boolean; frame?: { t: number; phase: 'before' | 'after' | 'at'; snapshot: Snapshot };
  say: string; tex?: string; verdict: Verdict; show?: { forces?: string[]; span?: string[]; gap?: [string, string]; label?: string };
  claimed?: number; engine?: number; t?: number; after?: boolean;   // after：这一步讲的是事件刚发生之后（碰后）
  reason?: string;                                // 对不上时的排查结论
  error?: string;
  source?: Source;
};

/** 对不上时，看看是不是常见的几类错误 */
export function diagnose(claimed: number, engine: number): string {
  if (!Number.isFinite(engine)) return '引擎在这个时刻算不出这个量，可能是事件写错了，或者这一步指的时刻不对';
  const r = claimed / engine;
  const near = (x: number, y: number, tol = 2e-3) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));
  if (near(r, -1)) return '正负号相反：检查规定的正方向';
  for (const [k, why] of [[9.8 / 10, '这一步像是用了 g = 9.8，题目要求取 10'], [10 / 9.8, '这一步像是用了 g = 10，题目要求取 9.8'],
    [Math.sqrt(9.8 / 10), '这一步像是用了 g = 9.8（结果里 g 开了根号），题目要求取 10'], [Math.sqrt(10 / 9.8), '这一步像是用了 g = 10（结果里 g 开了根号），题目要求取 9.8']] as const) {
    if (near(Math.abs(r), k)) return why;
  }
  for (const [k, why] of [[0.75, 'sin37° 和 cos37°（0.6 和 0.8）可能弄反了'], [4 / 3, 'sin37° 和 cos37°（0.6 和 0.8）可能弄反了']] as const) {
    if (near(Math.abs(r), k)) return why;
  }
  for (const p of [10, 100, 1000]) if (near(Math.abs(r), p) || near(Math.abs(r), 1 / p)) return `差了 ${p} 倍：检查单位换算（cm 与 m、g 与 kg、ms 与 s）`;
  if (near(Math.abs(r), 2) || near(Math.abs(r), 0.5)) return '差了 2 倍：检查是不是漏了 ½（如 ½mv²、½at²），或者把两个物体当成一个';
  if (Math.abs(r - 1) < 0.03) return '只差一点：可能是中间步骤提前四舍五入了，或者用了题目没给的近似值';
  return '';
}

/** 学生写的数按原样显示（3.92 不要变成 98/25） */
const asWritten = (x: number) => (Math.abs(x * 1e4 - Math.round(x * 1e4)) < 1e-6 ? String(Number(x.toFixed(4))) : nice(x));

/** 生成可以贴回给学生 AI 的修复提示 */
export function repairPrompt(items: { askId: string; askText: string; index: number; step: StepResult }[]): string {
  if (!items.length) return '';
  const lines = items.map(({ askId, index, step }) =>
    `- 第 (${askId}) 问第 ${index + 1} 步「${step.say}」：你写的是 ${asWritten(step.claimed!)}，按题目条件算出来应该是 ${nice(step.engine!)}。${step.reason ? `可能原因：${step.reason}。` : ''}`);
  return [
    '你给的解题过程里有几步和题目条件对不上，请逐条检查并改正，然后按原来的格式重新输出完整的 JSON：',
    ...lines,
    '注意：如果是题目条件抄错了（数值、方向、哪段光滑哪段粗糙），请同时改正场景部分。',
  ].join('\n');
}

export const verdictOf = (claimed: number, engine: number): Verdict => (Number.isFinite(engine) && sameAnswer(claimed, engine) ? 'ok' : 'bad');
