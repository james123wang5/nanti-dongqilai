// 把 AI 写的普通文字排成试卷的样子：物理量斜体、单位正体、下标和希腊字母用公式排，中文不动。
// 只负责切分和转换，真正渲染由调用方交给 KaTeX。

const GREEK: Record<string, string> = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'varepsilon', ζ: 'zeta', η: 'eta', θ: 'theta', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'varphi', ϕ: 'varphi', χ: 'chi', ψ: 'psi', ω: 'omega', Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega' };
const SUB: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't' };
const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', 'ⁿ': 'n' };
const FUNCS = ['arcsin', 'arccos', 'arctan', 'sin', 'cos', 'tan', 'cot', 'ln', 'lg', 'log', 'exp'];
// 紧跟在数字后面才算单位，避免把物理量 m、s 排成正体
const UNIT = /^(?:k?m\/s[²2]?|m\/s[²2]|cm\/s|km\/h|rad\/s|kg·m\/s|N·s|N\/m|N\/C|V\/m|J\/kg|W\/m|Ω·m|kg|g|mg|t|km|cm|mm|nm|μm|m[²³23]?|L|mL|s|ms|μs|ns|min|h|N|kN|J|kJ|eV|MeV|keV|W|kW|MW|Pa|kPa|atm|K|℃|°C|V|kV|mV|A|mA|μA|Ω|kΩ|MΩ|F|μF|pF|nF|C|μC|nC|T|mT|Wb|H|mH|Hz|kHz|MHz|mol|rad|u)$/;
const LATEX_ESC = /[#%&]/g;

// 一段公式可以用的字符。中文、顿号、逗号、句号天然把它们隔开。
const RUN = /[A-Za-z0-9α-ωΑ-Ωϕ₀-₉ₐₑₒₓₕₖₗₘₙₚₛₜ⁰¹²³⁴-⁹⁺⁻ⁿ√∞°′″℃=≈≠≤≥<>+\-−–×÷·\/^_().%:｜| ]+/g;
const CN_SUB = '上下左右前后甲乙丙丁合总外内入出初末安电磁洛';

const isMathy = (s: string) => {
  const t = s.trim();
  if (!t) return false;
  if (!/[A-Za-zα-ωΑ-Ωϕ√]/.test(t)) return false;          // 纯数字、年份不动
  const words = t.match(/[A-Za-z]{2,}/g) ?? [];
  for (const w of words) {
    if (FUNCS.includes(w) || UNIT.test(w) || /^[A-Z]{2,5}$/.test(w)) continue;
    if (w.length <= 4) continue;                            // mgh、qvB、xOy
    return false;                                           // 英文单词
  }
  return true;
};

function atoms(s: string): string {
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (SUB[c]) { let v = ''; while (SUB[s[i]]) v += SUB[s[i++]]; out += `_{${v}}`; continue; }
    if (SUP[c]) { let v = ''; while (SUP[s[i]]) v += SUP[s[i++]]; out += `^{${v}}`; continue; }
    if (c === '_' ) { const m = /^_\{?([A-Za-z0-9]{1,4})\}?/.exec(s.slice(i)); if (m) { out += `_{${m[1]}}`; i += m[0].length; continue; } }
    const fn = FUNCS.find((f) => s.startsWith(f, i) && !/[A-Za-z]/.test(s[i + f.length] ?? '') && !/[A-Za-z]/.test(s[i - 1] ?? ''));
    if (fn) { out += `\\${['arcsin', 'arccos', 'arctan'].includes(fn) ? `operatorname{${fn}}` : fn} `; i += fn.length; continue; }
    if (GREEK[c]) { out += `\\${GREEK[c]} `; i++; continue; }
    if (c === '√') { const m = /^√\s*(\([^()]*\)|[0-9A-Za-z.]+)/.exec(s.slice(i)); if (m) { out += `\\sqrt{${atoms(m[1].replace(/^\(|\)$/g, ''))}}`; i += m[0].length; continue; } out += '\\surd '; i++; continue; }
    if (c === '×') { out += '\\times '; i++; continue; }
    if (c === '÷') { out += '\\div '; i++; continue; }
    if (c === '·') { out += '\\cdot '; i++; continue; }
    if (c === '≈') { out += '\\approx '; i++; continue; }
    if (c === '≠') { out += '\\ne '; i++; continue; }
    if (c === '≤') { out += '\\le '; i++; continue; }
    if (c === '≥') { out += '\\ge '; i++; continue; }
    if (c === '°') { out += '^\\circ '; i++; continue; }
    if (c === '′') { out += "'"; i++; continue; }
    if (c === '−') { out += '-'; i++; continue; }
    if (c === '–' || (c === '-' && /[A-Za-z]/.test(s[i - 1] ?? '') && /[A-Za-z]/.test(s[i + 1] ?? ''))) { out += '\\text{-}'; i++; continue; }
    if (c === '｜' || c === '|') { out += '|'; i++; continue; }
    if (c === '℃') { out += '\\,^\\circ\\mathrm{C}'; i++; continue; }
    out += c.replace(LATEX_ESC, '\\$&'); i++;
  }
  return out;
}

/** 数字后面的单位排正体，其余按公式排 */
export function plainToTex(run: string): string {
  const parts: string[] = [];
  // 单位可能是 m/s²、kg·m/s，贪婪取到空白或运算符为止
  const re = /(\d[\d.]*(?:\s*[×]\s*10[⁰¹²³⁴-⁹⁻]+)?)(\s*)([A-Za-zμΩ℃°][A-Za-zμΩ·\/²³⁻¹0-9]*)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(run))) {
    const unit = m[3];
    if (!UNIT.test(unit.replace(/⁻¹/g, ''))) continue;
    if (!m[2] && /^[a-zA-Z]$/.test(unit) && !/^[NJWVAKTCFH]$/.test(unit) ) continue;   // 2m、3t 贴着写是系数乘字母
    if (!m[2] && /^(?:[A-Z])$/.test(unit) && /[a-zα-ω]/.test(run.slice(m.index + m[0].length, m.index + m[0].length + 1))) continue;
    parts.push(atoms(run.slice(last, m.index)), atoms(m[1]), `\\,\\mathrm{${atoms(unit).replace(/\\mu /g, '\\mu ').replace(/\\Omega /g, '\\Omega ')}}`);
    last = m.index + m[0].length;
  }
  parts.push(atoms(run.slice(last)));
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export type Piece = { text: string } | { tex: string };

/** 普通文字切成文字段和公式段；$…$ 里的原样当公式 */
export function pieces(s: string): Piece[] {
  const out: Piece[] = [];
  const push = (x: Piece) => { const last = out.at(-1); if ('text' in x && last && 'text' in last) last.text += x.text; else out.push(x); };
  for (const part of String(s ?? '').split(/(\$[^$\n]+\$)/)) {
    if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) { out.push({ tex: part.slice(1, -1) }); continue; }
    let last = 0;
    // t上、F合 这类中文下标先换成占位，排进公式
    const src = part.replace(new RegExp(`\\b([tvaFEQWPfTNIRUrxs])([${CN_SUB}])(?![\\u4e00-\\u9fa5])`, 'g'), '$1\u0001$2\u0002');
    const re = new RegExp(RUN.source.replace('[A-Za-z0-9', '[\\u0001\\u0002' + CN_SUB + 'A-Za-z0-9'), 'g');
    for (const m of src.matchAll(re)) {
      // 占位之外的中文不能算进公式
      for (const seg of splitCn(m[0], m.index!)) {
        const lead = /^[\s(.:%]*/.exec(seg.s)![0].length, tail = /[\s(:=+\-−–×÷·/<>.]*$/.exec(seg.s)![0].length;
        const core = seg.s.slice(lead, seg.s.length - tail);
        if (!core || !isMathy(core.replace(/\u0001.\u0002/g, ''))) continue;
        const a = seg.i + lead;
        if (a > last) push({ text: unmark(src.slice(last, a)) });
        push({ tex: texWithCn(core) });
        last = a + core.length;
      }
    }
    if (last < src.length) push({ text: unmark(src.slice(last)) });
  }
  return out;
}
const unmark = (s: string) => s.replace(/[\u0001\u0002]/g, '');
const cnClass = new RegExp(`[${CN_SUB}]`);
function splitCn(s: string, base: number) {
  const out: { s: string; i: number }[] = []; let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\u0001') { i += 2; continue; }
    if (cnClass.test(s[i])) { if (i > start) out.push({ s: s.slice(start, i), i: base + start }); start = i + 1; }
  }
  if (start < s.length) out.push({ s: s.slice(start), i: base + start });
  return out;
}
const texWithCn = (s: string) => s.split(/(\u0001.\u0002)/).map((p) => p.startsWith('\u0001') ? `_{\\text{${p[1]}}}` : plainToTex(p)).join('');

/** 小问编号：1a→(1)，1①→(1)①，2(i)a→(2)(i)。拆出来的 a、b 只是内部编号，不给学生看 */
export function qLabel(id: string): string {
  const m = /^(\d+)\s*\(?([ivx]+)?\)?\s*([①-⑩])?\s*([a-z])?$/.exec(String(id));
  return m ? `(${m[1]})${m[2] ? `(${m[2]})` : ''}${m[3] ?? ''}` : `(${id})`;
}

/** 中文和中文之间不留空格（自动生成的句子用空格隔开物体名，中文名字时去掉） */
const CJK = '\u3000-\u303f\u4e00-\u9fff\uff00-\uffef';
const CJK_GAP = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g');
export const tidyCJK = (s: string) => s.replace(CJK_GAP, '$1');
/** 小问标签：(2a)(2b) 都写成 (2) 会分不清，同一题号有几问时加 ①② */
export function askLabels(ids: string[]): string[] {
  const base = ids.map(qLabel), seen = new Map<string, number>();
  return base.map((b) => { const n = base.filter((x) => x === b).length; if (n < 2 || /[①-⑩]/.test(b)) return b; const k = (seen.get(b) ?? 0) + 1; seen.set(b, k); return b + '①②③④⑤⑥⑦⑧⑨⑩'[k - 1]; });
}

/** 公式或最后一个字和紧随的中文标点绑在一起，避免句号单独换行。 */
export function punctuatedHtml(input: Piece[], math: (s: string) => string, text: (s: string) => string): string {
  const list = input.map((p) => ({ ...p }));
  return list.map((p, i) => {
    if ('tex' in p) {
      const next = list[i + 1], mark = next && 'text' in next ? /^\s*[，。；：！？、）]+/.exec(next.text)?.[0] ?? '' : '';
      if (mark && next && 'text' in next) next.text = next.text.slice(mark.length);
      return mark ? `<span class="keep-punctuation">${math(p.tex)}${text(mark.trim())}</span>` : math(p.tex);
    }
    return p.text.split(/([^\s][，。；：！？、）]+)/g).map((part, i) => i % 2 ? `<span class="keep-punctuation">${text(part)}</span>` : text(part)).join('');
  }).join('');
}
