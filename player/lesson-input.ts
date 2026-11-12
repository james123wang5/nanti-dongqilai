import { extractJson } from '../engine/parse.ts';
import { validate, formatRepair } from '../engine/validate.ts';
import type { Problem } from '../engine/solve.ts';

export const unreadable = '这段回复里没有找到题目的小问。请确认复制的是 AI 的整段回复。';
/** 讲解独立于模型检查；模型的字段、表达式和数值错误都不能挡住文字。 */
export function validateLesson(p: unknown): p is Problem {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const x = p as Problem;
  if (!Array.isArray(x.asks) || !x.asks.length || x.asks.some((q) => !q || typeof q.text !== 'string' || !q.text.trim())) return false;
  if (x.title !== undefined && typeof x.title !== 'string' || x.stem !== undefined && typeof x.stem !== 'string') return false;
  if (x.solution !== undefined) {
    if (!x.solution || typeof x.solution !== 'object' || Array.isArray(x.solution)) return false;
    for (const steps of Object.values(x.solution)) {
      if (!Array.isArray(steps) || steps.some((s) => !s || typeof s !== 'object' || typeof s.say !== 'string' || s.tex !== undefined && typeof s.tex !== 'string')) return false;
    }
  }
  return true;
}
export function lessonFallback(p: Problem): Problem {
  // 只保留可读内容，坏的 samples、条件和场景字段不进入保底路径。
  return { title: p.title, stem: p.stem, story: p.story, idea: typeof p.idea === 'string' ? p.idea : undefined,
    scene: { surfaces: [], bodies: [] }, unsupported: '场景部分需要修改',
    asks: p.asks.map((q, i) => ({ id: typeof q.id === 'string' || typeof q.id === 'number' ? String(q.id) : String(i + 1), text: q.text,
      answer: q.answer, answerText: typeof q.answerText === 'string' ? q.answerText : undefined,
      think: Array.isArray(q.think) ? q.think.filter((s) => typeof s === 'string') : undefined,
      unit: typeof q.unit === 'string' ? q.unit : undefined,
      option: q.option && typeof q.option.text === 'string' ? { label: String(q.option.label ?? ''), text: q.option.text, correct: typeof q.option.correct === 'boolean' ? q.option.correct : undefined } : undefined })),
    solution: p.solution } as Problem;
}
export function readLessonReply(text: string): { problem: Problem; original?: Problem; repair?: string; issueCount?: number } {
  let p: unknown;
  try { p = extractJson(text); } catch { throw new Error(unreadable); }
  if (!validateLesson(p)) throw new Error(unreadable);
  let errors: string[];
  try { errors = validate(p); } catch (e) { errors = [`场景结构无法读取：${(e as Error).message}`]; }
  if (!errors.length) return { problem: p.unsupported ? { ...lessonFallback(p), unsupported: p.unsupported } : p };
  return { problem: lessonFallback(p), original: p, repair: formatRepair(errors), issueCount: errors.length };
}
