import type { AskResult } from '../engine/solve.ts';

export type VerifyState = 'engine' | 'algebra' | 'ai' | 'mismatch';
/** 比对失败优先；代入一致但 ok 留空的结论仍不授予核验标记。 */
export function verifyState(a: Pick<AskResult, 'ok' | 'verified' | 'source'>): VerifyState {
  if (a.ok === false) return 'mismatch';
  if (a.verified) return 'engine';
  if ((a.source === 'algebra' || a.source === 'custom') && a.ok === true) return 'algebra';
  return 'ai';
}
export const verification = {
  engine: { icon: '✓', label: '引擎核验', explanation: '按题目条件独立算出，并且与所给答案一致。' },
  algebra: { icon: '=', label: '代数核对（没有经过模拟）', explanation: '代入数值与答案一致，但公式本身来自 AI。' },
  ai: { icon: '', label: 'AI 给出，未核验', explanation: '可以看解题思路，答案还需要自己核对。' },
  mismatch: { icon: '!', label: '引擎算出的和答案不一样', explanation: '这一问先别直接信，需要核对题目条件和解答。' },
} as const;
