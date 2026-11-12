// 数值、依赖分析和公式排版共用同一棵语法树，不执行输入代码。
export type Env = { vars: Record<string, number>; fns?: Record<string, (...args: (number | string)[]) => number> };
// 取量函数的完整命名参数个数；末尾可再写一个 asks.times 的事件别名。
export const SNAP_ARITY: Record<string, number> = Object.fromEntries([
  ...'x y cx vx vy v a dx dy rel angle KE PE N Ep Fs polar z T I Is U P Vn val'.split(' ').map((k) => [k, 1]), ...'Q path count'.split(' ').map((k) => [k, 2]),
]);
const finite = (x: number) => { if (!Number.isFinite(x)) throw new Error('判断式使用了非有限数值，请检查除零、根号及取量时刻'); return x; };
const MATH: Record<string, (...a: number[]) => number> = {
  approx: (a, b, rtol = 1e-6, atol = 0) => { [a, b, rtol, atol].forEach(finite); if (rtol < 0 || atol < 0) throw new Error('approx 的相对/绝对容差必须非负'); return +(Math.abs(a - b) <= atol + rtol * Math.max(Math.abs(a), Math.abs(b))); },
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  min: Math.min, max: Math.max, exp: Math.exp, ln: Math.log, log: Math.log, mod: (a, b) => a - Math.floor(a / b) * b, floor: Math.floor, ceil: Math.ceil, sign: Math.sign, deg: (r) => r * 180 / Math.PI, rad: (d) => d * Math.PI / 180,
};
export type Expr = { kind: 'number'; value: number } | { kind: 'name'; name: string } |
  { kind: 'unary'; op: string; arg: Expr } | { kind: 'binary'; op: string; left: Expr; right: Expr } |
  { kind: 'call'; name: string; args: Expr[] };
type Tok = { kind: string; value: string };
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < src.length;) {
    const c = src[i]; if (/\s/.test(c)) { i++; continue; }
    const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (number) { out.push({ kind: 'number', value: number[0] }); i += number[0].length; continue; }
    // 名字可以含希腊字母（θ、μ、ω₀ 写成 ω0 等，AI 常这样起参数名）；单独的 π 仍是圆周率
    const name = c === 'π' ? null : /^[A-Za-z_Α-Ωα-ορ-ω一-龥][\wΑ-Ωα-ορ-ω一-龥.]*/.exec(src.slice(i));
    if (name) { const js = /^Math\.(\w+)$/.exec(name[0]); out.push({ kind: 'name', value: js ? (js[1] === 'PI' ? 'pi' : js[1].toLowerCase()) : name[0] }); i += name[0].length; continue; }   // JS 写法 Math.PI、Math.sqrt
    const quoted = /^["'“‘]([^"'”’]+)["'”’]/.exec(src.slice(i));
    if (quoted) { out.push({ kind: 'name', value: quoted[1] }); i += quoted[0].length; continue; }
    if (['&&', '||', '==', '!='].includes(src.slice(i, i + 2))) { out.push({ kind: 'op', value: src.slice(i, i + 2) }); i += 2; continue; }
    if ((c === '<' || c === '>') && src[i + 1] === '=') { out.push({ kind: 'op', value: c + '=' }); i += 2; continue; }
    if ('+-*/^(),<>!'.includes(c)) { out.push({ kind: 'op', value: c }); i++; continue; }
    if ('·×'.includes(c)) { out.push({ kind: 'op', value: '*' }); i++; continue; }
    if (c === 'π') { out.push({ kind: 'name', value: 'pi' }); i++; continue; }
    throw new Error(`表达式里有不认识的字符 "${c}"：${src}`);
  }
  return out;
}
const parsed = new Map<string, Expr>();
export function parseExpression(src: string | number): Expr {
  if (typeof src === 'number') return { kind: 'number', value: src };
  const cached = parsed.get(src); if (cached) return cached;
  const ts = lex(src); let p = 0;
  const peek = () => ts[p]?.value;
  const eat = (expected?: string) => { const t = ts[p++]; if (!t || (expected && t.value !== expected)) throw new Error(`表达式格式不对（期望 ${expected ?? '更多内容'}）：${src}`); return t; };
  const binary = (op: string, left: Expr, right: Expr): Expr => ({ kind: 'binary', op, left, right });
  const or = (): Expr => { let a = and(); while (peek() === '||') a = binary(eat().value, a, and()); return a; };
  const and = (): Expr => { let a = cmp(); while (peek() === '&&') a = binary(eat().value, a, cmp()); return a; };
  const cmp = (): Expr => { const a = sum(); const o = peek(); return o === '<' || o === '>' || o === '<=' || o === '>=' || o === '==' || o === '!=' ? binary(eat().value, a, sum()) : a; };
  const sum = (): Expr => { let a = prod(); while (peek() === '+' || peek() === '-') a = binary(eat().value, a, prod()); return a; };
  const prod = (): Expr => { let a = unary(); while (peek() === '*' || peek() === '/') a = binary(eat().value, a, unary()); return a; };
  const unary = (): Expr => peek() === '-' || peek() === '+' || peek() === '!' ? { kind: 'unary', op: eat().value, arg: unary() } : power();
  const power = (): Expr => { const a = atom(); return peek() === '^' ? (eat(), binary('^', a, unary())) : a; };
  const atom = (): Expr => {
    const t = eat();
    if (t.kind === 'number') return { kind: 'number', value: Number(t.value) };
    if (t.value === '(') { const a = or(); eat(')'); return a; }
    if (t.kind === 'name') {
      if (peek() !== '(') return { kind: 'name', name: t.value };
      eat('('); const args: Expr[] = [];
      if (peek() !== ')') { args.push(or()); while (peek() === ',') { eat(','); args.push(or()); } }
      eat(')'); return { kind: 'call', name: t.value, args };
    }
    throw new Error(`表达式格式不对：${src}`);
  };
  const ast = or(); if (p !== ts.length) throw new Error(`表达式末尾多了内容：${src}`);
  if (parsed.size > 4096) parsed.clear(); parsed.set(src, ast); return ast;
}
export function evaluate(src: string | number, env: Env): number {
  const run = (e: Expr): number => {
    switch (e.kind) {
      case 'number': return e.value;
      case 'name': if (e.name === 'true' || e.name === 'false') return +(e.name === 'true'); if (e.name in env.vars) return env.vars[e.name]; if (e.name === 'pi') return Math.PI; throw new Error(`表达式里的 ${e.name} 没有定义`);
      case 'unary': return e.op === '-' ? -run(e.arg) : e.op === '!' ? +!finite(run(e.arg)) : run(e.arg);
      case 'binary': {
        const a = run(e.left);
        // 积分的热路径仍直接做算术，不为每个 +/* 分配比较符数组。
        switch (e.op) {
          case '+': return a + run(e.right); case '-': return a - run(e.right);
          case '*': return a * run(e.right); case '/': return a / run(e.right); case '^': return a ** run(e.right);
          case '&&': return finite(a) ? +!!finite(run(e.right)) : 0;
          case '||': return finite(a) ? 1 : +!!finite(run(e.right));
        }
        const b = run(e.right); finite(a); finite(b);
        return +(e.op === '<' ? a < b : e.op === '>' ? a > b : e.op === '<=' ? a <= b : e.op === '>=' ? a >= b : e.op === '==' ? a === b : a !== b);
      }
      case 'call': {
        // 没有快照可取时（实验室参数、params 等处），val(L) 就是参数 L 本身（AI 常这样引用参数）
        if (e.name === 'val' && !env.fns?.val && e.args.length === 1 && e.args[0].kind === 'name') { if (e.args[0].name in env.vars) return env.vars[e.args[0].name]; throw new Error(`表达式里的 ${e.args[0].name} 没有定义（要求的未知量写进 unknowns，用条件求出）`); }
        const f = env.fns?.[e.name] ?? MATH[e.name]; if (!f) throw new Error(`不认识的函数 ${e.name}()`);
        const args = e.args.map((a) => a.kind === 'name' && (Object.hasOwn(SNAP_ARITY, e.name) || (!(a.name in env.vars) && a.name !== 'pi' && a.name !== 'true' && a.name !== 'false')) ? a.name : run(a));   // val() 的参数总是量的名字
        return (f as (...a: (number | string)[]) => number)(...args);
      }
    }
  };
  return run(parseExpression(src));
}
export const MATH_FUNCTIONS = new Set(Object.keys(MATH));
export function isBooleanExpression(e: Expr): boolean {
  return e.kind === 'binary' ? ['<', '>', '<=', '>=', '==', '!='].includes(e.op) || ['&&', '||'].includes(e.op) && isBooleanExpression(e.left) && isBooleanExpression(e.right) : e.kind === 'unary' ? e.op === '!' && isBooleanExpression(e.arg) : e.kind === 'call' ? e.name === 'approx' : e.kind === 'name' && ['true', 'false'].includes(e.name);
}
export function evaluateBoolean(src: string, env: Env): boolean {
  if (!isBooleanExpression(parseExpression(src))) throw new Error('claim 必须是布尔判断式，如 v(A)>0 或 approx(v(A),v0,1e-6,0)');
  const value = evaluate(src, env); finite(value); return !!value;
}
/** 去除明确不影响结果的依赖。未使用的 times/vals 由调用方按名字追踪。 */
function dependencyTree(e: Expr): Expr {
  if (e.kind === 'unary') return { ...e, arg: dependencyTree(e.arg) };
  if (e.kind === 'call') { if (e.name === 'approx' && JSON.stringify(e.args[0]) === JSON.stringify(e.args[1])) return { kind: 'number', value: 1 }; return { ...e, args: e.args.map(dependencyTree) }; }
  if (e.kind !== 'binary') return e;
  const left = dependencyTree(e.left), right = dependencyTree(e.right);
  const equal = (a: Expr, b: Expr) => JSON.stringify(a) === JSON.stringify(b);
  const complement = (a: Expr, b: Expr) => a.kind === 'unary' && a.op === '!' && equal(a.arg, b) || b.kind === 'unary' && b.op === '!' && equal(b.arg, a) || a.kind === 'binary' && b.kind === 'binary' && ({ '<': '>=', '>': '<=', '<=': '>', '>=': '<', '==': '!=', '!=': '==' } as Record<string, string>)[a.op] === b.op && equal(a.left, b.left) && equal(a.right, b.right);
  if (['&&', '||'].includes(e.op) && complement(left, right)) return { kind: 'number', value: +(e.op === '||') };

  const is = (e: Expr, n: number) => e.kind === 'number' && e.value === n || e.kind === 'name' && e.name === (n ? 'true' : 'false');
  if (e.op === '||' && (is(left, 1) || is(right, 1))) return { kind: 'number', value: 1 };
  if (e.op === '&&' && (is(left, 0) || is(right, 0))) return { kind: 'number', value: 0 };
  if (['==', '!=', '<', '>', '<=', '>='].includes(e.op) && JSON.stringify(left) === JSON.stringify(right)) return { kind: 'number', value: +['==', '<=', '>='].includes(e.op) };
  if ((e.op === '*' && (is(left, 0) || is(right, 0))) || (e.op === '-' && JSON.stringify(left) === JSON.stringify(right))) return { kind: 'number', value: 0 };
  if (e.op === '^' && is(right, 0)) return { kind: 'number', value: 1 };
  if ((e.op === '+' || e.op === '-') && is(right, 0)) return left;
  if ((e.op === '+' && is(left, 0)) || (e.op === '*' && is(left, 1))) return right;
  if ((e.op === '*' || e.op === '/') && is(right, 1)) return left;
  return { ...e, left, right };
}
export function dependencies(src: string | number): { names: Set<string>; calls: Set<string> } {
  const names = new Set<string>(), calls = new Set<string>();
  const walk = (e: Expr) => {
    if (e.kind === 'name') names.add(e.name);
    else if (e.kind === 'unary') walk(e.arg);
    else if (e.kind === 'binary') { walk(e.left); walk(e.right); }
    else if (e.kind === 'call') { calls.add(e.name); e.args.forEach((a, i) => { if (!(Object.hasOwn(SNAP_ARITY, e.name) && i < SNAP_ARITY[e.name] && a.kind === 'name')) walk(a); }); }
  };
  walk(dependencyTree(parseExpression(src))); return { names, calls };
}
const greek = ['alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'rho', 'tau', 'phi', 'omega', 'pi'];
const texEscape = (s: string) => s.replace(/[\\{}#$%&_^~]/g, (c) => `\\${c}`);
function texName(name: string): string {
  const trig = /^(sin|cos|tan|cot)(\d+)$/.exec(name);
  if (trig) return `\\${trig[1]} ${trig[2]}^\\circ`;
  const base = (s: string) => greek.includes(s) ? `\\${s}` : s.length === 1 && /[a-zA-Z]/.test(s) ? s : `\\mathrm{${texEscape(s)}}`;
  const explicit = /^([^_]+)_(.+)$/.exec(name);
  if (explicit) return `${base(explicit[1])}_{${base(explicit[2])}}`;
  const prefix = greek.find((g) => name.startsWith(g));
  if (prefix && name.length > prefix.length) return `\\${prefix}_{${base(name.slice(prefix.length))}}`;
  const indexed = /^([A-Za-z])([A-Z]+|\d+)$/.exec(name);
  return indexed ? `${indexed[1]}_{${indexed[2]}}` : base(name);
}
export function expressionToTex(src: string | number): string {
  const render = (e: Expr): string => {
    if (e.kind === 'number') return String(e.value).replace(/e([+-]?\d+)$/i, '\\times 10^{$1}');
    if (e.kind === 'name') return texName(e.name);
    if (e.kind === 'unary') return `${e.op}${e.arg.kind === 'binary' ? `\\left(${render(e.arg)}\\right)` : render(e.arg)}`;
    if (e.kind === 'call') {
      const a = e.args.map(render);
      if (e.name === 'sqrt') return `\\sqrt{${a[0]}}`;
      if (e.name === 'abs') return `\\left|${a[0]}\\right|`;
      const named: Record<string, string> = { sin: '\\sin', cos: '\\cos', tan: '\\tan', atan: '\\arctan', asin: '\\arcsin', acos: '\\arccos', ln: '\\ln', log: '\\ln', exp: '\\exp', max: '\\max', min: '\\min' };
      if (named[e.name]) return e.args.length === 1 && e.args[0].kind === 'name' ? `${named[e.name]} ${a[0]}` : `${named[e.name]}\\left(${a.join(',')}\\right)`;
      return `\\operatorname{${texEscape(e.name)}}\\left(${a.join(',')}\\right)`;
    }
    const a = render(e.left), b = render(e.right), bracket = (x: Expr, text: string) => x.kind === 'binary' && ['+', '-'].includes(x.op) ? `\\left(${text}\\right)` : text;
    if (e.op === '/') return `\\frac{${a}}{${b}}`;
    if (e.op === '^') return `{${e.left.kind === 'binary' || e.left.kind === 'unary' ? `\\left(${a}\\right)` : a}}^{${b}}`;
    if (e.op === '*') return e.right.kind === 'number' ? `${bracket(e.left, a)}\\times ${b}` : `${bracket(e.left, a)} ${bracket(e.right, b)}`;
    return `${a}${e.op}${e.op === '-' ? bracket(e.right, b) : b}`;
  };
  return render(parseExpression(src));
}
