// 核验来源：内置物理、用户自定义方程、代数、AI 声明分别计数，不能互相冒充。
import { dependencies, parseExpression, SNAP_ARITY } from './expr.ts';
import type { Problem } from './solve.ts';
import type { EventSpec } from './sim.ts';
export type Source = 'engine' | 'custom' | 'ai' | 'algebra' | 'unavailable' | 'unsupported';
export const SOURCE_TEXT: Record<Source, string> = { engine: '引擎内置物理算出', custom: '按 AI 方程/自定义量算出，未核验物理', ai: 'AI 给出，未核验', algebra: '仅代数，未模拟验证', unavailable: '算不出', unsupported: '本题超出引擎能力，未经验证' };
export const SNAP_FUNCTIONS = new Set(Object.keys(SNAP_ARITY));
export const physicalEvent = (at?: EventSpec) => !!at && !['start', 'end', 'time'].includes(at.event);
const merge = (a: Source, b: Source): Source => a === 'custom' || b === 'custom' ? 'custom' : a === 'engine' || b === 'engine' ? 'engine' : 'algebra';
export function expressionSource(P: Problem, expr: string, at?: EventSpec,
  times?: Record<string, EventSpec>, vals?: Record<string, { at: EventSpec; expr: string }>, determined?: Set<string>, customDetermined = new Set<string>()): Source {
  const customScene = !!(P.scene?.script || P.scene?.ode), customInputs = determined !== undefined && Object.keys(P.unknowns ?? {}).some((k) => !determined.has(k));
  const observation: Source = customScene || customInputs ? 'custom' : 'engine';
  const active = new Set<string>();
  // when 也可能只是 t-2 这样的代数计时，不能仅因它叫“事件”就授予物理核验。
  const eventSource = (event?: EventSpec): Source => event?.event === 'when' ? visit(event.expr ?? '0') : physicalEvent(event) ? observation : 'algebra';
  const visit = (text: string, event?: EventSpec): Source => {
    const d = dependencies(text); let out: Source = 'algebra';
    if ([...d.calls].some((f) => SNAP_FUNCTIONS.has(f))) out = observation;
    for (const name of d.names) {
      if (name === 't') { out = merge(out, eventSource(event)); continue; }
      if (times?.[name]) { out = merge(out, eventSource(times[name])); continue; }
      if (active.has(name)) continue;
      active.add(name);
      if (vals?.[name]) {
        const v = vals[name], source = visit(v.expr, v.at), ast = parseExpression(v.expr);
        // 原始读数的别名保留来源；另写公式命名的派生量只证明代入正确。
        out = merge(out, source === 'engine' && !(ast.kind === 'call' && SNAP_FUNCTIONS.has(ast.name)) ? 'custom' : source);
      } else if (name in (P.unknowns ?? {})) {
        if (customDetermined.has(name)) out = merge(out, 'custom');
        else if (determined?.has(name)) out = merge(out, customInputs ? 'custom' : 'engine');
      } else {
        const param = P.params?.[name], value = param === undefined ? P.constants?.[name] : Array.isArray(param) ? param[0] : param;
        if (typeof value === 'string') { const source = visit(value, event), ast = parseExpression(value); out = merge(out, source === 'engine' && ast.kind !== 'name' ? 'custom' : source); }
      }
      active.delete(name);
    }
    return out;
  };
  return visit(expr, at);
}
type Item = { source?: Source; ok?: boolean | null; error?: string; verified?: boolean; verdict?: string };
const categories = () => ({ engine: 0, custom: 0, ai: 0, algebra: 0, uncompared: 0, mismatch: 0, unavailable: 0, unsupported: 0 });
function category(a: Item, step = false): keyof ReturnType<typeof categories> {
  if (a.error || a.source === 'unavailable') return 'unavailable';
  if (a.ok === false || a.verdict === 'bad') return 'mismatch';
  if (a.source === 'unsupported') return 'unsupported';
  if (a.source === 'engine' && (a.verified ?? (step ? a.verdict === 'ok' : a.ok === true))) return 'engine';
  if (step && a.verdict === 'skip') return 'ai';
  if (a.source === 'custom' || a.source === 'ai' || a.source === 'algebra') return a.source;
  return 'uncompared';
}
export function verificationCounts(asks: (Item & { steps?: Item[] })[]) {
  const out = categories(), steps = categories();
  for (const a of asks) { out[category(a)]++; for (const s of a.steps ?? []) steps[category(s, true)]++; }
  return { ...out, steps };
}
