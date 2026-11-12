import { EVENTS } from './validate.ts';
import { evaluate } from './expr.ts';
// 宽容地从 AI 的回复里取出 JSON：代码框、中文引号、多余的逗号、注释、全角标点都尽量处理。

export function extractJson(text: string): unknown {
  let s = text;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1];
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0) throw new Error('回复里没有找到 JSON（应该以 { 开头、以 } 结尾）');
  // 回复被截断时末尾可能缺右括号：另留一份“从 { 到全文末尾”的，补括号时用
  const whole = s.slice(a).trimEnd();
  s = b > a ? s.slice(a, b + 1) : whole;
  // AI 常把 LaTeX 的反斜杠只写一个：\theta 会被当成制表符加 heta，这里先补齐
  s = s.replace(/(?<!\\)\\(?!u[0-9a-fA-F]{4})([a-zA-Z]{2,})/g, '\\\\$1').replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, '\\\\');
  const tries = [
    s,
    s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"),
  ];
  const clean = (x: string) => x
    .replace(/\/\/[^\n"]*$/gm, '')                 // 行尾注释（不在字符串里的粗略判断）
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/，(?=\s*["{[\]}])/g, ',').replace(/：(?=\s*["{[\d-])/g, ':')
    .replace(/,\s*([}\]])/g, '$1');               // 多余的逗号
  // 先在原文上补救（中文引号可能正是字符串内容，如“时间分辨-能量分析仪”），再试把中文引号当成英文引号的版本
  for (const base of [tries[0], tries[1]]) tries.push(clean(base), quoteBare(clean(base)));
  const fixBs = (x: string) => x.replace(/(?<!\\)\\(?!u[0-9a-fA-F]{4})([a-zA-Z]{2,})/g, '\\\\$1').replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, '\\\\');
  const wholeFixed = fixBs(whole);
  for (const base of [wholeFixed, wholeFixed.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"), tries[0], tries[1]]) tries.push(closeOpen(quoteBare(clean(base))));   // 最后一招：末尾少写的 } ] 补上，结构对不对交给校验器
  let last: Error | null = null;
  for (const t of tries) { try { return normalizeShape(JSON.parse(t)); } catch (e) { last = e as Error; } }
  throw new Error(`JSON 格式有误：${last?.message}`);
}

/** AI 常在值的位置直接写表达式不加引号，如 [2*h,0]、"mu":1/10、"c":sqrt(3)/2。
 *  逐字扫描（跳过字符串），值的位置如果不是合法的 JSON 值，就把到下一个同层 , ] } 为止的内容加上引号。 */
export function quoteBare(s: string): string {
  let out = '', i = 0;
  const stack: string[] = [];
  let expectValue = false;
  const NUM = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {   // 整段字符串原样复制
      let j = i + 1; while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1); i = j + 1; expectValue = false; continue;
    }
    if (c === '{' || c === '[') { stack.push(c); out += c; i++; expectValue = c === '['; continue; }
    if (c === '}' || c === ']') { stack.pop(); out += c; i++; expectValue = false; continue; }
    if (c === ':') { out += c; i++; expectValue = true; continue; }
    if (c === ',') { out += c; i++; expectValue = stack.at(-1) === '['; continue; }
    if (/\s/.test(c)) { out += c; i++; continue; }
    if (expectValue) {
      // 找到这个值的结尾：同层的 , ] }（括号内的不算）
      let j = i, depth = 0;
      while (j < s.length) { const d = s[j]; if (d === '(') depth++; else if (d === ')') depth--; else if (depth <= 0 && (d === ',' || d === ']' || d === '}' || d === '\n')) break; j++; }
      const raw = s.slice(i, j).trim();
      const m = NUM.exec(raw);
      const ok = (m && m[0] === raw) || raw === 'true' || raw === 'false' || raw === 'null';
      out += ok ? raw : JSON.stringify(raw);
      out += s.slice(i, j).slice(s.slice(i, j).trimEnd().length);   // 保留值后面的空白
      i = j; expectValue = false; continue;
    }
    out += c; i++;
  }
  return out;
}

/** 末尾少写的右括号补上（跳过字符串，按没闭合的顺序倒着补）。只在其他办法都解析失败时用。 */
export function closeOpen(s: string): string {
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { i++; while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1; continue; }
    if (c === '{') stack.push('}'); else if (c === '[') stack.push(']');
    else if ((c === '}' || c === ']') && stack.at(-1) === c) stack.pop();
  }
  return s.replace(/[\s,]*$/, '') + stack.reverse().join('');
}

/** 结构放错层时归位（AI 常见）：
 *  · 没有 scene，却在最外层写了场景或实验室字段（如 "induction":{…}）→ 这些字段收进 scene；
 *  · scene 里混进了 asks、solution、samples 这类最外层字段（多半是少写了一个右括号）→ 提到最外层。 */
const ROOT_KEYS = ['story', 'idea', 'spec', 'title', 'stem', 'view', 'model', 'unsupported', 'constants', 'params', 'samples', 'unknowns', 'conditions', 'asks', 'solution', 'abstraction'];
const HOIST = ['story', 'asks', 'solution', 'samples', 'params', 'constants', 'unknowns', 'conditions', 'model', 'idea', 'title', 'stem', 'abstraction'];
export function normalizeShape(P: unknown): unknown {
  if (!P || typeof P !== 'object' || Array.isArray(P)) return P;
  const o = P as Record<string, unknown>;
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(o.scene)) {
    const extra = Object.keys(o).filter((k) => !ROOT_KEYS.includes(k) && k !== 'scene');
    if (extra.length) { const sc: Record<string, unknown> = {}; for (const k of extra) { sc[k] = o[k]; delete o[k]; } o.scene = sc; }
  }
  if (isObj(o.scene)) {
    const sc = o.scene;
    for (const k of HOIST) if (k in sc && !(k in o)) { o[k] = sc[k]; delete sc[k]; }
    delete sc.story; // 文字说明归顶层；重复时采用顶层值，不成为场景错误
  }
  // 整题没有可模拟的场景（AI 判断引擎建不了模，只写了各问的式子）：给一个空场景，按代数解展示，标为未模拟验证
  if (!('scene' in o) && Array.isArray(o.asks)) { o.scene = { surfaces: [], bodies: [] }; if (!o.unsupported) o.unsupported = 'AI 没有给出可模拟的场景，下面是它给的解答'; }
  // 线段轨道不写 kind；AI 常写成 line、segment 等
  const SEG = ['line', 'segment', 'seg', 'straight', 'incline', 'slope', 'plane', 'track', 'linear', 'pipe', 'tube', 'rail'];
  const fixSurfaces = (sc: unknown) => { if (isObj(sc) && Array.isArray(sc.surfaces)) for (const s of sc.surfaces) if (isObj(s) && typeof s.kind === 'string' && SEG.includes(s.kind.toLowerCase())) delete s.kind; };
  fixSurfaces(o.scene);
  if (Array.isArray(o.asks)) for (const a of o.asks) if (isObj(a)) fixSurfaces(a.scene);
  // 答案全是具体数字（题目给了数值）时，samples 改了数据也没法对照答案：忽略 samples（它只用于只给字母的题）
  const letterProblem = isObj(o.params) && Object.values(o.params).some((v) => Array.isArray(v) && typeof v[2] === 'string' && v[2].includes('任取'));
  if (Array.isArray(o.samples) && Array.isArray(o.asks) && !letterProblem) {
    const ans = o.asks.filter((a) => isObj(a) && a.answer !== undefined).map((a) => (a as Record<string, unknown>).answer);
    if (ans.length && ans.every((v) => typeof v === 'number' || (typeof v === 'string' && /^\s*-?[\d.]+(e-?\d+)?\s*$/i.test(v)))) delete o.samples;
  }
  // samples 的值要求是数：AI 写成 "3/pi" 这类只含常数的式子时直接算出来
  if (Array.isArray(o.samples)) for (const g of o.samples) if (isObj(g)) for (const [k, v] of Object.entries(g)) if (typeof v === 'string') { try { const x = evaluate(v, { vars: {} }); if (Number.isFinite(x)) g[k] = x; } catch { /* 留给校验器报 */ } }
  // 事件名写成了实验室的节点名（如 "p1进入B_region"）：改成 {"event":"mark","name":…}
  const fixEvents = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(fixEvents); return; }
    if (!isObj(x)) return;
    if (typeof x.event === 'string' && !EVENTS.has(x.event) && /[\u4e00-\u9fa5]/.test(x.event) && x.name === undefined) { x.name = x.event; x.event = 'mark'; }
    for (const v of Object.values(x)) if (v && typeof v === 'object') fixEvents(v);
  };
  if (Array.isArray(o.asks)) fixEvents(o.asks);
  if (Array.isArray(o.conditions)) fixEvents(o.conditions);
  if (isObj(o.solution)) fixEvents(o.solution);
  // samples 里写了不是参数的键（如常量 g）：去掉
  if (Array.isArray(o.samples) && isObj(o.params)) for (const g of o.samples) if (isObj(g)) for (const k of Object.keys(g)) if (!(k in (o.params as object))) delete g[k];
  // expr 写成空字符串：当作没写（只给答案的小问）
  if (Array.isArray(o.asks)) for (const a of o.asks) if (isObj(a) && typeof a.expr === 'string' && !a.expr.trim()) delete a.expr;
  // 物体写了 start / startAt / delay（延时出发）：转成 release
  const fixStart = (sc: unknown) => { if (!isObj(sc) || !Array.isArray(sc.bodies)) return; for (const b of sc.bodies) if (isObj(b) && b.release === undefined) for (const k of ['start', 'startAt', 'delay', 'startTime']) if (b[k] !== undefined) { const v = b[k]; b.release = typeof v === 'number' || typeof v === 'string' ? { event: 'time', t: v } : v; delete b[k]; break; } };
  fixStart(o.scene); if (Array.isArray(o.asks)) for (const a of o.asks) if (isObj(a)) fixStart(a.scene);
  // samples 只应含第二组：AI 常把第一组（与 params 相同）也写进去，去掉与 params 完全相同的那组
  if (Array.isArray(o.samples) && o.samples.length > 1 && isObj(o.params)) {
    const pv = (k: string) => { const p = (o.params as Record<string, unknown>)[k]; return Array.isArray(p) ? p[0] : p; };
    const same = (g: unknown) => isObj(g) && Object.keys(g).length > 0 && Object.entries(g).every(([k, v]) => pv(k) === v || (typeof v === 'number' && typeof pv(k) === 'number' && Math.abs(v - (pv(k) as number)) <= 1e-12 * Math.max(1, Math.abs(v))));
    const rest = o.samples.filter((g) => !same(g));
    if (rest.length >= 1) o.samples = rest.slice(0, 1);
  }
  return o;
}
