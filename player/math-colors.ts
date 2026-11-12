import { MEANING } from './visual-rules.ts';
export type MathVisibility = { velocity: boolean; force: boolean; displacement: boolean };
/** 只替换独立物理符号。命令名、正文、单位、已有配色及下标内容原样保留。 */
export function colorMath(source: string, visible: MathVisibility): string {
  const groupEnd = (start: number) => {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      if (source[i] === '\\') { i++; continue; }
      if (source[i] === '{') depth++;
      if (source[i] === '}' && --depth === 0) return i + 1;
    }
    return source.length;
  };
  let out = '', i = 0;
  while (i < source.length) {
    const start = i;
    if (source[i] === '_' || source[i] === '^') {
      i++;
      if (source[i] === '{') i = groupEnd(i);
      else if (source[i] === '\\') i += (/^\\[A-Za-z]+|^\\./.exec(source.slice(i))?.[0].length ?? 1);
      else if (i < source.length) i++;
      out += source.slice(start, i); continue;
    }
    if (source[i] === '\\') {
      const cmd = /^\\[A-Za-z]+|^\\./.exec(source.slice(i))?.[0] ?? '\\';
      if (cmd === '\\Delta' && /^\\Delta\s*x(?![A-Za-z])/.test(source.slice(i))) {
        i += /^\\Delta\s*x/.exec(source.slice(i))![0].length;
      } else {
        i += cmd.length;
        const groups = /^(\\textcolor|\\colorbox)$/.test(cmd) ? 2 : /^(\\text|\\textrm|\\textsf|\\mathrm|\\operatorname|\\color)$/.test(cmd) ? 1 : 0;
        for (let k = 0; k < groups; k++) { while (/\s/.test(source[i] ?? '') && i < source.length) i++; if (source[i] === '{') i = groupEnd(i); }
        out += source.slice(start, i); continue;
      }
    } else {
      const match = /^(?:Δ\s*x|mg|[vFfNTxsLh])/.exec(source.slice(i));
      if (!match || /[A-Za-z\\]/.test(source[i - 1] ?? '') || /[A-Za-z]/.test(source[i + match[0].length] ?? '')) { out += source[i++]; continue; }
      i += match[0].length;
    }
    const symbol = source.slice(start, i);
    if (source[i] === '_') {
      const at = i + 1;
      if (source[at] === '{') i = groupEnd(at);
      else if (source[at] === '\\') i = at + (/^\\[A-Za-z]+|^\\./.exec(source.slice(at))?.[0].length ?? 1);
      else if (at < source.length) i = at + 1;
    }
    const color = symbol === 'v' ? visible.velocity && MEANING.velocity : /^(mg|[FfNT])$/.test(symbol) ? visible.force && MEANING.force : visible.displacement && MEANING.displacement;
    const token = source.slice(start, i);
    out += color ? `{\\textcolor{${color}}{${token}}}` : token;
  }
  return out;
}
