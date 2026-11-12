// 播放器：左边一张考卷，右边实验台。算过的题直接取结果；每一问只演它对应的那一段。

import { plotPoints, solveProgressively, type Problem, type Solved, type AskResult } from '../engine/solve.ts';
import type { SimResult, Snapshot, Stage, EventRec } from '../engine/sim.ts';
import { nice } from '../engine/num.ts';
import katex from 'katex';
import { readLessonReply, lessonFallback, unreadable, validateLesson } from './lesson-input.ts';
import { verifyState, verification, type VerifyState } from './verification.ts';
import { imageStage } from './题图.ts';
import { attemptsOf, nextAttempt, noticeFor, adviceFor, unreadableRepair, topicRows, topicExamples, type PasteIssue } from './paste-state.ts';
import prompts from '../prompt/提示词.json';
import 'katex/dist/katex.min.css';
import { Scene2D, force } from './scene2d.ts';
import type { Scene3D } from './scene3d.ts';
import type { Bench3D } from './bench3d.ts';
import { drawChart, drawPlot, hasChart } from './charts.ts';
import { chartHeight, toolbarCaption } from './visual-rules.ts';
import { sampleAt } from './timeline.ts';
import { chooseDim, phasesOf, stageLines, topicOf, type Phase } from './view-rules.ts';
import { pieces, punctuatedHtml, plainToTex, qLabel, askLabels } from './typeset.ts';
import { colorMath, type MathVisibility } from './math-colors.ts';
import { fitFormulas } from './formula-fit.ts';
import { storyHints } from '../engine/validate.ts';
import { buildLesson, buildProcessMap, overviewWindow, overviewContentEnd, type LessonStep } from './lesson.ts';
import { expressionToTex, evaluate } from '../engine/expr.ts';
import { resultRepair, KEEP_SIM } from '../engine/repair.ts';
import { cached, remember, keyOf, allMine, saveMine, deleteMine, catalogState, type CatalogState, type Mine } from './cache.ts';

const files = import.meta.glob('../problems/*/standard.json', { eager: true, import: 'default' }) as Record<string, Problem>;
const library = Object.entries(files).map(([p, P]) => ({ key: p.split('/').at(-2)!, P })).sort((a, b) => Number(a.key.startsWith('示例')) - Number(b.key.startsWith('示例')) || a.key.localeCompare(b.key));
type Ask = Problem['asks'][number];

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const h = (x: unknown) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const tex = (s: string, display = false) => { try { return katex.renderToString(s, { throwOnError: false, displayMode: display }); } catch { return h(s); } };
/** AI 写的文字：物理量和单位按试卷排，其余原样 */
const memo = new Map<string, string>();
const rich = (x: unknown) => { const key = String(x ?? ''); let v = memo.get(key); if (v === undefined) { v = punctuatedHtml(pieces(key), tex, h); if (memo.size > 3000) memo.clear(); memo.set(key, v); } return v; };
const exprTex = (x: string | number) => { try { return tex(expressionToTex(x)); } catch { return h(x); } };
const nameTex = (k: string) => exprTex(k);
/** 单位用正体 */
const unitHtml = (u: string) => { const t = plainToTex(`1 ${u}`); return t.startsWith('1\\,') ? tex(`\\,${t.slice(3)}`) : ` ${h(u)}`; };
/** 引擎认出的 20/3、5√2/3、2π 这类结果排成公式 */
const niceTex = (s: string) => { const e = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s); if (e) return tex(`${e[1]}\\times 10^{${+e[2]}}`); try { return exprTex(s.replace(/(\d)√/g, '$1*√').replace(/√(\d+)/g, 'sqrt($1)').replace(/(\d)π/g, '$1*pi').replace(/π/g, 'pi')); } catch { return h(s); } };

// ---------- 状态 ----------
let P: Problem, S: Solved, baseP: Problem | null = null, baseName = '', baseImage: string | undefined;
let view = -2, sim: SimResult | undefined, w0 = 0, w1 = 1, t = 0, playing = false;
let keyT: number | null = null, lesson: LessonStep[] = [], stepIdx = -1, glide: { from: number; to: number; start: number; dur: number } | null = null, dirty = true;
let dim: '2d' | '3d' = '2d', baseRate = 1, speed = 1, phases: Phase[] = [], selected: string | null = null, plotData: [number, number, number][] | null = null;
let lastSnap: Snapshot | undefined, busy = false, keepView: number | null = null, loadTimer = 0;
const MIN_WINDOW = 1.5;
/** 每一问学生选的预测（选项序号，从 1 开始） */
let picked: Record<number, number> = {}, revealed: Record<number, boolean> = {};
let seen = new Set<number>(), baseS: Solved | undefined;
let changedConditions = false, activeRepair = '', replacingId: string | undefined;
const picture = imageStage($('lessonImage'), (src) => {
  baseImage = src; const m = mine.find((m) => `m:${m.id}` === current);
  if (m) { m.image = src; void saveMine(m); }
});

function pauseForDialog() { playing = false; glide = null; if (P) renderCaption(); if (sim) draw(); }

// ---------- 解题：先取记住的结果 ----------
const newWorker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let worker = newWorker(), reqId = 0;
type RunOpts = { restored?: boolean; tried?: boolean; image?: string; repair?: string; modelFailure?: boolean };
let modelFailure = false, storyIntro: string[] = [];

async function run(problem: Problem, name: string, opts: RunOpts = {}) {
  const id = ++reqId; document.body.dataset.state = 'busy';
  qaFail = ''; changedConditions = !!opts.tried; modelFailure = !!opts.modelFailure; activeRepair = opts.repair ?? (problem.unsupported ? `这道题的场景还不能演示：${problem.unsupported}。请对照原题补全可以演示的场景，保留题干、小问和分步解答，重新输出完整 JSON。${KEEP_SIM}` : '');
  $('forceScaleNote').hidden = true; document.body.classList.remove('nosim'); $('lessonImage').hidden = true; $('repairGuide').hidden = true; $('noAnimation').hidden = true;
  clearTimeout(tryTimer); tryTimer = 0; tryQueued = false;
  if (!opts.tried) { ++tryGeneration; tryRunning = false; baseS = undefined; if (!opts.restored) { seen = new Set(); revealed = {}; picked = {}; } $('tryCard').hidden = true; $('tryBtn').setAttribute('aria-pressed', 'false'); baseP = problem; baseName = name; baseImage = opts.image; keepView = null; $('tryReset').hidden = true; $('tryMsg').textContent = ''; }
  P = problem; sim = undefined; playing = false; t = 0; glide = null; selected = null; $('readout').hidden = true; $('callout').hidden = true; keyT = null;
  showPaper(name);
  const key = keyOf(problem), hit = await cached(key);
  if (id !== reqId) return;
  if (hit) { arrive(hit, opts); return; }
  clearTimeout(loadTimer);
  loadTimer = window.setTimeout(() => { if (id === reqId) { $('sceneLoading').hidden = false; $('sceneLoading').classList.remove('failed', 'static'); $('sceneLoading').querySelector('strong')!.textContent = '正在计算这道题'; $('sceneLoading').querySelector('span:last-child')!.textContent = '只有第一次需要等，算完会记住'; } }, 180);
  if (busy) { worker.terminate(); worker = newWorker(); }
  busy = true; let shown = false;
  worker.onmessage = (e) => {
    if (e.data.id !== id) return;
    if (!e.data.ok) { busy = false; failed(e.data.error, opts); return; }
    const s = e.data.solved as Solved;
    if (!s.pending) { busy = false; remember(key, s); }
    if (shown) {
      S = s; if (!opts.tried) catalog.set(keyOf(baseP ?? P), catalogState(P, s));
      if (!opts.tried) {
        baseS = s; document.querySelectorAll<HTMLInputElement>('#tryPanel input').forEach((input) => input.disabled = !!s.pending);
        if (!s.pending && !$('tryCard').hidden) void measureTry(P);
      }
      showVerdict(); renderQuestions(); return;
    }
    shown = true; arrive(s, opts);
  };
  worker.onerror = (e) => { if (reqId === id) { busy = false; failed(e.message || '后台计算中断', opts); } };
  worker.postMessage({ id, problem });
}
let qaFail = '';
function failed(message: string, opts: RunOpts) {
  clearTimeout(loadTimer); qaFail = message;
  if (opts.tried && baseP) { const v = keepView; void run(baseP, baseName, { image: baseImage }).then(() => { keepView = v; }); buildTry(); $('tryMsg').textContent = `这组条件算不出来，已恢复原题。`; return; }
  // 引擎没算完：照样展示题目、各问和 AI 给的解答（标明未经验证），一句话说原因；完整报错做成修改提示，复制给 AI 改 JSON
  try {
    const fb = [...solveProgressively(lessonFallback(P), 1 / 30)].at(-1);
    if (fb) {
      modelFailure = true; catalog.set(keyOf(baseP ?? P), 'none');
      activeRepair = `网页引擎运行这段 JSON 时出错：\n${message}\n请按报错修改，重新输出完整 JSON。${KEEP_SIM}`;
      const m = mine.find((m) => `m:${m.id}` === current);
      if (m) { m.original ??= baseP ?? P; m.repair = activeRepair; m.lastPasteIssue ??= { kind: 'runtime' }; void saveMine(m); autoRepair(`m:${m.id}`, attemptsOf(m), activeRepair); }
      P = lessonFallback(P); void arrive(fb, opts); return;
    }
  } catch { /* 连解答也展示不了时，退回只显示报错 */ }
  const box = $('sceneLoading'); box.hidden = false; box.classList.add('failed'); box.classList.remove('static');
  box.querySelector('strong')!.textContent = '这段回复暂时读不出来'; box.querySelector('span:last-child')!.textContent = unreadable; document.body.dataset.state = 'ready';
}
async function arrive(s: Solved, opts: RunOpts) {
  clearTimeout(loadTimer); S = s; if (!opts.tried) catalog.set(keyOf(baseP ?? P), catalogState(P, s)); if (!opts.tried) baseS = s; renderOptions();
  if (!opts.tried) buildTry();
  showVerdict();
  const scene = $('scene');
  scene.classList.toggle('nosim', !!P.unsupported); document.body.classList.toggle('nosim', !!P.unsupported);
  $('noAnimation').hidden = !P.unsupported;
  renderRepairGuide();
  if (P.unsupported) {
    $('sceneLoading').hidden = true;
    $('noAnimationReason').textContent = modelFailure ? 'AI 建的模型有问题，暂时动不起来' : '这类题目前画不出来';
    ($('noAnimation') as HTMLDetailsElement).open = false;
    $('lessonImage').hidden = false; picture.show(baseImage);
    select(keepView ?? -2); document.body.dataset.state = 'ready'; return;
  }
  stage2d.symbolsOnly = !!S.samples;
  for (const id of ['scene', 'chart']) $(id).toggleAttribute('data-letters', !!S.samples);
  $('lettersNote').hidden = !S.samples; ($('lettersNote') as HTMLDetailsElement).open = false;
  const isCircuit = !!S.sim!.circuit;
  $('altSeg').hidden = !(isCircuit && canUse3d); if (isCircuit && canUse3d) await needBench();
  sim = S.sim; await setDim(canUse3d && !isCircuit ? chooseDim(S.sim!) : '2d', false);
  $('sceneLoading').hidden = true;
  select(keepView ?? -2);
}

// ---------- 考卷 ----------
function showPaper(name: string) {
  const title = P.title ?? name;
  document.title = `${title} · 难题动起来`;
  $('source').textContent = title;
  const stem = (P.stem ?? '').trim().replace(P.asks.some((q) => q.option) ? /下列说法正确的是[：:]?/g : /$^/, '请判断下列说法：');   // 小问单独列在下面
  $('stem').innerHTML = stem ? stem.split(/\n+/).map((p) => `<p>${rich(p)}</p>`).join('') : '<p class="muted">这份回复没有写题目原文，下面是 AI 提取的条件。</p>';
  renderOptions();
  $('figure').hidden = !baseImage; $('figure').innerHTML = baseImage ? `<img src="${baseImage}" alt="题目截图" />` : '';
  const model = Array.isArray(P.model) ? P.model.filter((m) => m && typeof m === 'object') : [];
  $('model').hidden = !model.length;
  $('model').innerHTML = model.map((m) => `<span>${rich(m.from)} → <b>${rich(m.to)}</b></span>`).join('');
  $('idea').hidden = !P.idea; $('idea').innerHTML = P.idea ? `<b>这题的关键：</b>${rich(P.idea)}` : '';
  const rows = Object.entries(P.params ?? {}).map(([k, v]) => { const [val, unit, src] = Array.isArray(v) ? v : [v, '', '']; return `<tr><td>${nameTex(k)}</td><td>${h(val)} ${h(unit)}</td><td class="muted">${rich(src)}</td></tr>`; }).join('');
  $('known').innerHTML = rows; $('knownBox').hidden = !rows; ($('knownBox') as HTMLDetailsElement).open = true;
  { const ls = askLabels(P.asks.map((q) => q.id)); $('qs').innerHTML = P.asks.map((q, i) => `<button class="qbtn">${q.option ? h(q.option.label) : h(ls[i])}</button>`).join(''); } $('lesson').innerHTML = ''; $('caption').innerHTML = '';
  $('libName').textContent = title;
  $('stemPreview').innerHTML = rich(stem.split(/\n/)[0] || '查看题目和已知条件');
  $('verdict').textContent = '';
}
/** 选项原文始终在题目中；只给看过结论的选项亮标签。 */
function renderOptions() {
  const options = P.asks.map((q, i) => q.option ? { q, i } : null).filter((x) => x !== null);
  $('options').innerHTML = options.map(({ q, i }) => `<button class="paper-option" data-option="${i}"><b>${h(q.option!.label)}</b><span>${rich(q.option!.text)}</span>${!changedConditions && seen.has(i) ? `<small>${(S?.asks[i]?.claimValue ?? q.option!.correct) === undefined ? '未给出结论' : (S?.asks[i]?.claimValue ?? q.option!.correct) ? '对' : '错'}</small>` : ''}</button>`).join('') + (!changedConditions && options.length && options.every(({ i }) => seen.has(i)) ? `<p class="option-answer">正确选项：${options.filter(({ q, i }) => S.asks[i]?.claimValue ?? q.option!.correct).map(({ q }) => h(q.option!.label)).join('、') || '无'}</p>` : '');
  $('options').querySelectorAll<HTMLElement>('[data-option]').forEach((el) => el.onclick = () => select(+el.dataset.option!));
}
const stateIcon = (state: VerifyState) => `<span class="st verify-${state}" aria-hidden="true">${verification[state].icon}</span>`;
function showVerdict() {
  const counts: Record<VerifyState, number> = { engine: 0, algebra: 0, ai: 0, mismatch: 0 };
  S.asks.forEach((a) => counts[verifyState(a)]++);
  const short = { engine: '引擎核验', algebra: '代数核对', ai: 'AI 给出', mismatch: '对不上' };
  $('verdict').innerHTML = `<details><summary>${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${stateIcon(k as VerifyState)}<span>${n} ${short[k as VerifyState]}</span>`).join('')}</summary><p>${P.unsupported ? '这道题没有动画。' : ''}${Object.entries(counts).filter(([, n]) => n).map(([k]) => verification[k as VerifyState].explanation).join(' ')}${changedConditions ? ' 你改了条件，这是新结果。' : ''}</p></details>`;
  if (current.startsWith('m:') && !S.pending) {
    const fix = activeRepair || resultRepair(S);
    if (fix) {
      activeRepair = fix; $('repairGuide').hidden = false;
      const m = mine.find((m) => `m:${m.id}` === current);
      if (!changedConditions && m) {
        const changed = m.repair !== fix || !m.lastPasteIssue;
        m.repair = fix; m.lastPasteIssue ??= { kind: P.unsupported ? 'unsupported' : 'result' };
        if (changed) void saveMine(m); autoRepair(`m:${m.id}`, attemptsOf(m), fix);
      }
    }
  }
  renderRepairGuide();
}
/** 单位：AI 写了就用；否则从表达式或问法认，认不准就不写 */
const unitOf = (q: Ask) => {
  if (q.unit !== undefined) return q.unit;
  const e = (q.expr ?? '').trim();
  const one = (names: string) => new RegExp(`^(abs\\()?(${names})\\([^()]*\\)\\)?$`).test(e);
  if (one('v|vx|vy')) return 'm/s'; if (one('a')) return 'm/s²'; if (one('x|y|cx|dx|dy|rel|path')) return 'm'; if (one('Q|KE|PE|Ep')) return 'J'; if (one('T|N|Fs')) return 'N'; if (one('I')) return 'A'; if (one('U|Vn')) return 'V'; if (one('P')) return 'W';
  if (/^(t\d?|t\d? *- *t\d?)$/.test(e)) return 's';
  const w = q.text ?? '';
  if (/比|倍|因数|系数|正切|正弦|余弦|次数|几次|条件|范围|角/.test(w)) return '';
  if (/加速度/.test(w)) return 'm/s²'; if (/速度|速率/.test(w)) return 'm/s'; if (/时间|周期/.test(w)) return 's'; if (/高度|距离|长度|路程|位移|半径|直径|厚度|宽度|间距|板长|边长|至少多长|多长|多高|多远/.test(w)) return 'm';
  if (/电流|示数/.test(w) && !/电压/.test(w)) return /电压/.test(w) ? 'V' : 'A'; if (/电压|电动势|电势差/.test(w)) return 'V'; if (/功率/.test(w)) return 'W'; if (/生热|热量|能|功/.test(w)) return 'J'; if (/质量/.test(w)) return 'kg'; if (/力/.test(w)) return 'N';
  return '';
};
const answerHtml = (a: AskResult, q: Ask) => {
  const u = unitOf(q), unit = u ? unitHtml(u) : '';

  if (q.answerText && !changedConditions) return rich(q.answerText);
  if (typeof q.answer === 'string' && !changedConditions) { const letters = /[A-Za-z]/.test(q.answer.replace(/sqrt|pi|sin|cos|tan/g, '')); if (letters && !S.samples) { let v: unknown = typeof a.answer === 'number' ? a.answer : undefined; if (typeof v !== 'number' || !Number.isFinite(v)) { try { v = evaluate(q.answer, { vars: S.vars }); } catch { /* 算不出就显示原式 */ } } return (typeof v === 'number' && Number.isFinite(v) ? niceTex(nice(v)) : exprTex(q.answer)) + unit; } return exprTex(q.answer) + (letters ? '' : unit); }   // 字母题的结果本身带量纲；有数值的题显示数值
  if (typeof q.answer === 'number' && !changedConditions) return niceTex(nice(q.answer)) + unit;
  return q.expr ? niceTex(a.shown) + unit : '<span class="muted">这份回复没有给出结果</span>';
};
const thinkOf = (a: AskResult, q: Ask) => q.think?.length ? q.think : (a.steps ?? []).slice(0, 3).map((s) => s.say);
/** 圆点只表示核验状态，选项对错在最后一步用文字揭晓。 */
const statusOf = (a: AskResult, _q: Ask) => { const state = verifyState(a); return `<span class="st verify-${state}" role="img" aria-label="${verification[state].label}" title="${verification[state].label}">${verification[state].icon}</span>`; };
const claimHtml = (a: AskResult | undefined, o: NonNullable<Ask['option']>) => {
  const value = a?.claimValue ?? o.correct;
  return value === undefined ? '<span>没有给出结论</span>' : `<span>这个说法${value ? '正确' : '错误'}</span>`;
};
/** 圆圈数字用宋体单独放大，系统黑体里的 ① 太小 */
const subMark = (s: string) => h(s).replace(/([①-⑩])/g, '<span class="sub">$1</span>');
const ICON_PREV = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/** 一步：走过的、现在的、还没到的；最后一步是结果 */
function stepCard(st: LessonStep, i: number) {
  const q = view >= 0 ? P.asks[view] : undefined, state = i === stepIdx ? ' on' : i < stepIdx ? ' past' : ' later';
  if (st.final && q) {
    const a = S.asks[view], v = verifyState(a), reached = i <= stepIdx;
    let body = '<span class="muted">讲到这一步再揭晓</span>';
    if (reached) {
      if (q.option && !seen.has(view)) { seen.add(view); renderOptions(); }
      const claimed = q.option ? `这个说法${q.option.correct === undefined ? '未给出结论' : q.option.correct ? '正确' : '错误'}` : answerHtml(a, q);
      const calculated = q.option && a.claimValue !== undefined ? claimHtml(a, q.option) : `${niceTex(a.shown)}${unitOf(q) ? unitHtml(unitOf(q)) : ''}`;
      body = v === 'mismatch' ? `<div>答案给的：${claimed}</div><div>引擎算出：${calculated}</div><p>这一问先别直接信</p>${current.startsWith('m:') ? '<button class="fix result-repair">复制修改提示</button>' : ''}` : `<span class="ans">${q.option ? claimHtml(a, q.option) : answerHtml(a, q)}</span>`;
    }
    return `<li class="stepc final final-${v}${state}" data-i="${i}"><span class="no">${stateIcon(v)}</span><div class="result"><b>结果</b><div class="result-body">${body}</div></div></li>`;
  }
  const visible = mathVisibility(st), formula = (s: string, display = false) => tex(colorMath(s, visible), display);
  return `<li class="stepc${state}${st.bad ? ' wrong' : ''}" data-i="${i}"><span class="no">${i + 1}</span><div>${punctuatedHtml(pieces(st.say), formula, h)}${st.tex ? formula(st.tex, true) : ''}${st.bad ? `<div class="bad">${h(st.bad)}</div>` : ''}</div></li>`;
}
function mathVisibility(st: LessonStep): MathVisibility {
  return { velocity: !!sim && flag('velocity'), force: !!sim && (flag('force') || !!st.show.forces?.length), displacement: !!sim && (!!st.show.span?.length || !!st.show.gap) };
}
function refreshMath() {
  document.querySelectorAll<HTMLElement>('.stepc[data-i]:not(.final)').forEach((el) => {
    const i = +el.dataset.i!; if (!lesson[i]) return;
    el.outerHTML = stepCard(lesson[i], i);
  });
  document.querySelectorAll<HTMLElement>('.stepc[data-i]').forEach((el) => el.onclick = () => goStep(+el.dataset.i!));
  scheduleFormulaFit();
}
/** 左栏：小问标签 + 这一问的讲解 */
function renderQuestions() {
  const list = $('qs'); list.innerHTML = '';
  $('paperBtn').classList.toggle('on', view === -2); $('paperBtn').setAttribute('aria-selected', String(view === -2));
  $('allBtn').classList.toggle('on', view === -1); $('allBtn').setAttribute('aria-selected', String(view === -1)); $('allBtn').hidden = !!P.unsupported;
  const labels = askLabels(S.asks.map((a) => a.id));
  S.asks.forEach((a, i) => {
    const q = P.asks[i], b = document.createElement('button'); b.className = `qbtn${i === view ? ' on' : ''}`; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(i === view));
    b.innerHTML = `${q.option ? h(q.option.label) : subMark(labels[i])}${statusOf(a, q)}`; b.title = q.option ? q.option.text : a.text;
    b.onclick = () => select(i);
    list.append(b);
  });
  const box = $('lesson');
  if (changedConditions) { box.innerHTML = comparisonHtml(); }
  else if (view === -2) { box.innerHTML = ''; }
  else if (view === -1) {
    box.innerHTML = `<div class="lesson-head"><span class="lab">全过程</span><div class="qt">过程地图</div></div>${storyHints(P).map((line) => `<p class="story-hint">${h(line)}</p>`).join('')}${storyIntro.length ? `<ul class="story-intro">${storyIntro.map((line) => `<li>${rich(line)}</li>`).join('')}</ul>` : ''}${lesson.length ? `<ol class="stepsl process-map">${lesson.map(stepCard).join('')}</ol>` : '<p class="hint-all">看画面中的整个过程，再逐问讲解。</p>'}`;
  } else {
    const a = S.asks[view], q = P.asks[view], note = noteOf(), cls = `verify-${verifyState(a)}`;
    const head = `<div class="lesson-head"><span class="lab">${q.option ? h(q.option.label) : subMark(askLabels(S.asks.map((x) => x.id))[view])}</span><div class="qt">${q.option ? rich(q.option.text) : rich(a.text)}</div></div>${note ? `<p class="lesson-note ${cls}">${stateIcon(verifyState(a))}${h(note)}</p>` : ''}`;
    if (waiting() || watching()) box.innerHTML = `${head}${predictHtml()}`;
    else box.innerHTML = `${head}${predictHtml()}<div class="progress" aria-hidden="true">${lesson.map(() => '<i></i>').join('')}</div><ol class="stepsl">${lesson.map(stepCard).join('')}</ol>`;
  }
  box.querySelectorAll<HTMLButtonElement>('.result-repair').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); copy(activeRepair || resultRepair(S)); }; });
  box.querySelectorAll<HTMLButtonElement>('.predict .opt').forEach((b) => { b.onclick = () => { picked[view] = +b.dataset.k!; revealed[view] = false; t = w0; stepIdx = -1; glide = null; holdUntil = 0; playing = true; applyStep(); renderQuestions(); renderCaption(); draw(); }; });
  box.querySelector<HTMLButtonElement>('.reveal-prediction')?.addEventListener('click', revealPrediction);
  box.querySelectorAll<HTMLElement>('.stepc[data-i]').forEach((d) => { d.onclick = () => goStep(+d.dataset.i!); });
  scheduleFormulaFit();
  const on = document.querySelector<HTMLElement>('.qbtn.on'), nav = document.querySelector<HTMLElement>('.qnav')!; if (on) { const l = on.offsetLeft - nav.offsetLeft; if (l < nav.scrollLeft + 60 || l + on.offsetWidth > nav.scrollLeft + nav.clientWidth - 20) nav.scrollTo({ left: l - 80, behavior: 'smooth' }); }
}
/** 让现在这一步留在看得见的地方：桌面在左栏里滚，手机在整页里滚（上面有题图，下面有翻页按钮） */
function keepVisible(el: HTMLElement) {
  const box = $('sheetScroll'), r = el.getBoundingClientRect();
  if (box.scrollHeight > box.clientHeight + 2 && getComputedStyle(box).overflowY !== 'visible') {
    const b = box.getBoundingClientRect(), top = b.top + 60;
    if (r.top < top || r.bottom > b.bottom - 8) box.scrollTo({ top: box.scrollTop + r.top - top - 8, behavior: 'smooth' });
    return;
  }
  const stage = document.querySelector('.stage')!.getBoundingClientRect(), nav = $('caption').getBoundingClientRect(), top = Math.max(stage.bottom, 56) + 56, bottom = nav.top > 0 ? nav.top : innerHeight;
  if (r.top < top || r.bottom > bottom - 8) scrollBy({ top: r.top - top - 6, behavior: 'smooth' });
}
/** 底部翻页：上一步、第几步、下一步；同时更新步骤的状态 */
function renderCaption() {
  const c = $('caption'), n = lesson.length;
  if (view === -2) {
    c.innerHTML = `<span class="count">先读题目，再看过程</span><button id="nextStep" class="nav next">${P.unsupported ? '看第 (1) 问' : '看整个过程'}</button>`;
    $('nextStep').onclick = () => { select(P.unsupported ? 0 : -1); if (sim) { playing = true; renderCaption(); draw(); } }; return;
  }
  if (view === -1) {
    document.querySelectorAll<HTMLElement>('.stepc[data-i]').forEach((e) => { const i = +e.dataset.i!; e.classList.toggle('on', i === stepIdx); e.classList.toggle('past', i < stepIdx); e.classList.toggle('later', i > stepIdx); });
    const done = t >= w1 - 1e-9;
    c.innerHTML = `<span class="count">${done ? '整个过程看完了' : playing ? '正在看整个过程' : '先看整个过程，再逐问讲解'}</span><button id="nextStep" class="nav next">${done ? '看第 (1) 问' : playing ? '暂停观看' : '看整个过程'}</button>`;
    $('nextStep').onclick = () => { if (done) select(0); else { playing = !playing; renderCaption(); draw(); } }; return;
  }
  scheduleFormulaFit();
  const final = document.querySelector<HTMLElement>('.stepc.final');
  if (final) { const idx = +final.dataset.i!; final.outerHTML = stepCard(lesson[idx], idx); const fresh = document.querySelector<HTMLElement>('.stepc.final')!; fresh.onclick = () => goStep(idx); fresh.querySelector<HTMLButtonElement>('.result-repair')?.addEventListener('click', (e) => { e.stopPropagation(); copy(activeRepair || resultRepair(S)); }); }
  document.querySelectorAll<HTMLElement>('.stepc[data-i]').forEach((e) => { const i = +e.dataset.i!; e.classList.toggle('on', i === stepIdx); e.classList.toggle('past', i < stepIdx); e.classList.toggle('later', i > stepIdx); });
  document.querySelectorAll<HTMLElement>('.progress i').forEach((e, i) => { e.className = i === stepIdx ? 'now' : i < stepIdx ? 'done' : ''; });
  const card = document.querySelector<HTMLElement>(`.stepc[data-i="${stepIdx}"]`); if (card && stepIdx > 0) keepVisible(card); else if (stepIdx === 0 && view >= 0) keepVisible($('lesson'));   // 第一步时让这一问的题目也露出来
  if (!n) { c.innerHTML = ''; return; }
  if (watching()) { c.innerHTML = '<span class="count">先看一遍，带着预测观察</span>'; return; }
  if (changedConditions) { c.innerHTML = '<span class="count">对照图像，看看条件改变了什么</span>'; return; }
  if (waiting()) { c.innerHTML = '<span class="count">先选一个预测，再看动画</span>'; return; }
  const more = view < S.asks.length - 1, done = stepIdx >= n - 1;
  const label = stepIdx < 0 ? (view < 0 ? '开始讲解' : '开始讲解') : done && more ? (view < 0 ? '看第 (1) 问' : '下一问') : '下一步';
  const count = stepIdx < 0 ? `共 ${n} 步` : lesson[stepIdx]?.final ? '这一问的结果' : `第 ${stepIdx + 1} / ${n - (view >= 0 ? 1 : 0)} 步`;
  c.innerHTML = `<button id="prevStep" class="nav" aria-label="上一步"${stepIdx <= 0 ? ' disabled' : ''}>${ICON_PREV}</button><span class="count" title="键盘：← → 翻步，空格播放">${count}</span><button id="nextStep" class="nav next"${done && !more ? ' disabled' : ''}>${label}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  wireNav();
}
function noteOf() { return verification[verifyState(S.asks[view])].label; }
function wireNav() { const p = document.getElementById('prevStep'), n = document.getElementById('nextStep'); if (p) p.onclick = () => goStep(stepIdx - 1); if (n) n.onclick = () => { if (stepIdx >= lesson.length - 1 && view < S.asks.length - 1) select(view + 1); else goStep(stepIdx + 1); }; }
$('allBtn').onclick = () => select(-1);
$('paperBtn').onclick = () => select(-2);
/** 走到第 n 步：画面平滑走到那一刻停下，标注换成这一步的 */
function goStep(n: number) {
  if (!lesson.length || waiting() || watching() || changedConditions) return;
  stepIdx = Math.max(0, Math.min(n, lesson.length - 1)); playing = false;
  if (!sim) { renderCaption(); return; }
  const to = Math.min(Math.max(lesson[stepIdx].t, w0), w1), dur = Math.min(3.2, Math.max(.45, Math.abs(to - t) / baseRate * .5));
  glide = { from: t, to, start: performance.now(), dur: dur * 1000 / speed };
  applyStep(); renderCaption();
}
function applyStep() { updateToolbar(); const st = lesson[stepIdx], sh = st?.show ?? {}, forces = selected ? [...new Set([...(sh.forces ?? []), selected])] : sh.forces ?? []; (active() as Scene2D).setOverlay?.({ forces, spans: sh.span ?? [], gap: sh.gap, label: sh.label, from: w0 }); dirty = true; }

// ---------- 选一问 ----------
function select(i: number) {
  view = i; playing = false; stemOpen = false; updatePaper(); $('sheetScroll').scrollTop = 0;
  { const has = i >= 0 && !!P.asks[i]?.predict && !P.unsupported, chip = $('predictChip'); chip.classList.toggle('off', !has); ($('predictToggle') as HTMLInputElement).disabled = !has;
    chip.title = has ? '先选一个预测，再看动画' : '这一问没有预测题'; }
  if (P.unsupported) {
    keepView = i; sim = undefined; playing = false; glide = null; t = 0;
    lesson = i >= 0 ? buildLesson({ P, a: S.asks[i], q: P.asks[i], w0: 0, w1: 1, keyT: null, letters: false }) : [];
    stepIdx = i >= 0 ? 0 : -1; renderQuestions(); renderCaption(); return;
  }
  view = i; keepView = i; selected = null; $('readout').hidden = true;
  evtUntil = 0; eventMessage = ''; updateToolbar();   // 上一问的事件提示不带到这一问
  const a = i >= 0 ? S.asks[i] : undefined, q = i >= 0 ? P.asks[i] : undefined;
  sim = a?.sim ?? S.sim!;
  [w0, w1] = a ? windowFor(a) : overviewWindow(S);
  const at = a ? a.t ?? a.span?.[1] : undefined;
  keyT = at !== undefined && at >= w0 - 1e-9 && at <= w1 + 1e-9 ? at : null;
  $('keyHint').hidden = true;
  t = w0; glide = null; baseRate = speedFor(w1 - w0);
  phases = phasesOf(sim, w0, w1, { contentEnd: i < 0 ? overviewContentEnd(S) : undefined }); buildTimeline();
  // 关系图按这一问自己的场景、参数和时刻算（引擎已算好就直接用）
  try { plotData = q?.plot ? a?.plotData ?? (a?.plotContext ? plotPoints(P, a.plotContext.vars, sim, q.plot, w0, w1, a.plotContext) : plotPoints(P, S.vars, sim, q.plot, w0, w1)) : sim.board?.plot?.pts ?? null; } catch { plotData = null; }
  applyTools(q);
  $('callout').dataset.k = '';
  storyIntro = [];
  if (i === -2) lesson = [];
  else if (i === -1) { const map = buildProcessMap(P, sim, w0, w1, !!S.samples, overviewContentEnd(S)); lesson = map.steps; storyIntro = map.intro; }
  else lesson = buildLesson({ P, a, q, sim, w0, w1, keyT, letters: !!S.samples });
  stepIdx = -1; buildKeyEvents();
  if (dim === '3d' && !can3d(sim)) { dim = '2d'; showMode(); document.querySelector<HTMLElement>('.view-controls')!.hidden = true; }
  if (dim === '2d' && only3d(sim)) void setDim('3d');
  syncDimToggle();
  showMode(); stage2d.prepare(sim, w0, w1); if (active() !== stage2d) active().prepare(sim, w0, w1); sizeChart(); syncCam();
  // 质量写成单个字母时，重力标成 Mg、mg
  syncNotation();
  stage2d.setKeep(q?.keep);
  const prediction = !changedConditions && predictOn ? q?.predict?.q ?? '' : '';
  stage2d.predictionOrigin = prediction && /动|运动/.test(prediction) ? askBody(q!) ?? sim.geo.bodies.find((b) => prediction.includes(b.id) || b.kind === 'board' && /木板|长板/.test(prediction))?.id ?? null : null;
  applyStep();
  renderQuestions(); renderCaption(); draw(); document.body.dataset.state = 'ready';
  if (i >= 0) { playing = false; if (waiting()) { stepIdx = -1; renderCaption(); draw(); } else goStep(0); } else playing = false;
}
// ---------- 先预测再播放 ----------
/** 这一问有预测题、学生还没选：动画停在开头，答案和讲解先不给 */
/** 学生自己的偏好，记在本机浏览器里（读不到就用默认值） */
const pref = (k: string, d: boolean) => { try { const v = localStorage.getItem(`nanti-${k}`); return v === null ? d : v === '1'; } catch { return d; } };
const savePref = (k: string, on: boolean) => { try { localStorage.setItem(`nanti-${k}`, on ? '1' : '0'); } catch { /* 记不住也不影响使用 */ } };
/** “先预测再看”默认关：学生打开后，带预测题的小问才先让他选 */
let predictOn = pref('predict', false);
function watching() { return predictOn && !P.unsupported && !changedConditions && view >= 0 && !!P.asks[view]?.predict && picked[view] !== undefined && !revealed[view]; }
function revealPrediction() {
  if (!watching()) return;
  revealed[view] = true; playing = false; glide = null; stepIdx = -1; evtUntil = 0; eventMessage = '';
  applyStep(); renderQuestions(); renderCaption(); draw();
}
function waiting() { return predictOn && !P.unsupported && view >= 0 && !!P.asks[view]?.predict && picked[view] === undefined && !changedConditions; }
function predictHtml(): string {
  const pr = view >= 0 ? P.asks[view].predict : undefined; if (!pr || !predictOn || changedConditions || P.unsupported) return '';
  const k = picked[view], L = (i: number) => String.fromCharCode(64 + i);
  if (k === undefined) return `<div class="predict"><div class="sec">先预测，再看动画</div><p>${rich(pr.q)}</p>${pr.options.map((o, i) => `<button class="opt" data-k="${i + 1}">${L(i + 1)}. ${rich(o)}</button>`).join('')}</div>`;
  if (watching()) return `<div class="predict watching"><div class="sec">你选了 ${L(k)}。看动画，验证一下。</div><p>${rich(pr.q)}</p><button class="link reveal-prediction">直接看结论</button></div>`;
  const ok = k === pr.answer;
  return `<div class="predict done"><div class="sec">你的预测</div><p>${rich(pr.q)}</p><div class="pick">${L(k)}. ${rich(pr.options[k - 1])}　${ok ? '<span class="ok">✓ 预测对了</span>' : `<span class="bad">✗ 正确的是 ${L(pr.answer)}. ${rich(pr.options[pr.answer - 1])}</span>`}</div><div class="muted">${ok ? '看动画，找出它为什么会这样。' : '看动画，找出和你想的不一样的地方。'}</div></div>`;
}
let stemOpen = false;
let formulaFrame = 0;
function scheduleFormulaFit() { cancelAnimationFrame(formulaFrame); formulaFrame = requestAnimationFrame(() => fitFormulas($('sheetScroll'))); }
function updatePaper() {
  const paper = view === -2;
  document.body.dataset.view = paper ? 'paper' : view === -1 ? 'overview' : 'ask';
  document.querySelector('.sheet')!.classList.toggle('paper-view', paper);
  $('paperToggle').hidden = paper; $('paper').hidden = !(paper || stemOpen);
  $('paperToggle').setAttribute('aria-expanded', String(stemOpen)); $('paperAction').textContent = stemOpen ? '收起' : '展开';
  $('idea').hidden = !P.idea || view >= 0;
  const sheet = document.querySelector<HTMLElement>('.sheet')!; sheet.style.setProperty('--paper-max', `${sheet.clientHeight * .45}px`);
  scheduleFormulaFit();
}
$('paperToggle').onclick = () => { stemOpen = !stemOpen; updatePaper(); };
function windowFor(a: AskResult): [number, number] {
  const end = (a.sim ?? S.sim!).end.t, [a0, a1] = a.span ?? [0, end];
  return a1 - a0 < MIN_WINDOW ? [a0, Math.max(a1, Math.min(a0 + MIN_WINDOW, end))] : [a0, a1];
}
/** 不管物理上多长，这一段都用约 12 秒看完 */
const speedFor = (dur: number) => dur / 12;
/** 时间读数：微观题的时间很短，用科学计数法 */
const fmtT = (x: number) => w1 - w0 < .05 ? x.toExponential(2) : x.toFixed(2);
function buildTimeline() {
  const track = $('track'), span = w1 - w0 || 1; track.innerHTML = ''; track.parentElement!.classList.toggle('single', !phases.length || phases.length > 6);
  phases.forEach((p) => { const b = document.createElement('button'); b.textContent = p.label; b.title = p.label; b.style.flexGrow = String(Math.max(p.t1 - p.t0, span * .1)); b.onclick = () => { t = Math.max(p.t0, w0); glide = null; playing = false; syncStep(); draw(); }; track.append(b); });
  $('ticks').innerHTML = (sim!.events).filter((e) => !['start', 'end', 'time', 'collided'].includes(e.type) && e.t > w0 && e.t < w1).slice(0, 300).map((e) => `<i style="left:${(e.t - w0) / span * 100}%"></i>`).join('');
}

// ---------- 转折点：播放到这里停一下，可以前后跳 ----------
const KEY_TYPES = new Set(['collide', 'hit', 'land', 'same_velocity', 'leave', 'enter', 'stop', 'force_off', 'force_on', 'apsis', 'unlock', 'separate', 'slip', 'kick', 'out', 'extreme', 'split']);
let keyEvents: EventRec[] = [], holdAt: EventRec[] = [], holdUntil = 0, evtUntil = 0;
const nameOf = (id?: string) => id ?? '';
function eventText(e: EventRec) {
  const a = nameOf(e.a), b = nameOf(e.b);
  switch (e.type) {
    case 'collide': return b ? `${a} 与 ${b} 相碰` : `${a} 相碰`;
    case 'hit': return b ? `${a} 撞到 ${b}` : `${a} 撞到挡板`;
    case 'land': return b ? `${a} 落到 ${b} 上` : `${a} 落地`;
    case 'same_velocity': return b ? `${a} 与 ${b} 共速` : `${a} 共速`;
    case 'leave': return b ? `${a} 离开 ${b}` : `${a} 离开`;
    case 'enter': return b ? `${a} 进入 ${b}` : `${a} 进入`;
    case 'stop': return `${a} 速度减为零`;
    case 'force_off': return '撤去外力'; case 'force_on': return '开始施力';
    case 'apsis': return `${a} 到达近地点或远地点`;
    case 'unlock': return `${a} 解除锁定`; case 'separate': return b ? `${a} 与 ${b} 分离` : `${a} 分离`;
    case 'slip': return b ? `${a} 与 ${b} 开始相对滑动` : `${a} 开始滑动`;
    case 'kick': return `${a} 速度突变`; case 'split': return `${a} 分裂`; case 'out': return `${a} 离开场区`; case 'extreme': return `${a} 到达最高或最低点`;
  }
  return '';
}
/** 这一问时段里的转折点。同一时刻的合成一个；太多（多次碰撞）时只在讲解步骤和所求时刻停 */
function buildKeyEvents() {
  if (!sim || sim.circuit || sim.script) { keyEvents = holdAt = []; return; }
  const span = w1 - w0, list: EventRec[] = [];
  for (const e of sim.events) if (KEY_TYPES.has(e.type) && e.t > w0 + span * 1e-4 && e.t <= w1 + span * 1e-6 && eventText(e)) { if (!list.length || e.t - list[list.length - 1].t > span * 5e-3) list.push(e); }
  keyEvents = list;
  const near = (x: number) => Math.abs(x) < span * 5e-3;
  holdAt = list.length <= 8 ? list : list.filter((e) => (keyT !== null && near(e.t - keyT)) || lesson.some((st) => near(st.t - e.t)));
}
let eventMessage = '';
function updateToolbar() {
  const note = toolbarCaption(waiting() || watching() ? undefined : lesson[stepIdx], stepIdx, phases.find((p) => t >= p.t0 - 1e-9 && t < p.t1 - 1e-9)?.label ?? phases.at(-1)?.label ?? '', eventMessage, evtUntil, performance.now());
  const key = `${note.kind}|${note.badge}|${note.text}`; if ($('nowText').dataset.caption === key) return; $('nowText').dataset.caption = key;
  $('nowText').dataset.kind = note.kind; $('nowStep').hidden = !note.badge; $('nowStep').textContent = note.badge; $('nowMessage').innerHTML = rich(note.text); $('nowText').title = `${note.badge} ${note.text}`.trim();
}
function showEvent(e: EventRec) { eventMessage = eventText(e); evtUntil = performance.now() + 1600; updateToolbar(); }
function jumpEvent(dir: 1 | -1) {
  if (!sim || waiting() || watching()) return;
  const e = dir > 0 ? keyEvents.find((x) => x.t > t + 1e-9) : [...keyEvents].reverse().find((x) => x.t < t - 1e-9); if (!e) return;
  playing = false; holdUntil = 0; glide = { from: t, to: e.t, start: performance.now(), dur: 450 / speed }; showEvent(e);
  setTimeout(() => { syncStep(); draw(); }, 470);
}
$('evPrev').onclick = () => jumpEvent(-1); $('evNext').onclick = () => jumpEvent(1);
/** 画面时间和真实时间的比：动画放慢或加快了多少倍 */
function rateText() {
  const f = baseRate * speed; if (!(f > 0)) return '';
  const fmt = (x: number) => x >= 1e4 ? x.toExponential(1).replace(/e\+?(-?\d+)/, '×10^$1').replace(/\^(-?\d+)/, (_, d) => d.split('').map((c: string) => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(c)] ?? '⁻').join('')) : x >= 10 ? String(Math.round(x)) : String(+x.toFixed(1));
  if (f < .9) return `<span class="rate">放慢 ${fmt(1 / f)} 倍</span>`; if (f > 1.1) return `<span class="rate">加快 ${fmt(f)} 倍</span>`; return '<span class="rate">真实速度</span>';
}

// ---------- 舞台 ----------
const stage2d = new Scene2D($('scene'));
let stage3d: Scene3D | undefined, loading3d: Promise<void> | undefined;
const canUse3d = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
const need3d = () => loading3d ??= import('./scene3d.ts').then((m) => { stage3d = new m.Scene3D($('scene')); stage3d.toggle('velocity', flag('velocity')); stage3d.toggle('force', flag('force')); stage3d.toggle('trail', flag('trail')); });
const flag = (k: string) => ($(`${k}Toggle`) as HTMLInputElement).checked;
let bench: Bench3D | undefined, loadingBench: Promise<void> | undefined, real = true;
const needBench = () => loadingBench ??= import('./bench3d.ts').then((m) => { bench = new m.Bench3D($('scene')); });
const usesBench = () => !!sim?.circuit && real && canUse3d && !!bench;
const active = (): Scene2D | Scene3D | Bench3D => usesBench() ? bench! : dim === '3d' && stage3d ? stage3d : stage2d;
const showMode = () => { $('scene').dataset.mode = usesBench() ? 'bench' : dim === '3d' ? 'd3' : 'd2'; };
/** 懒加载立体或切问后，两个画法使用同一套质量字母和数值显示口径。 */
function syncNotation() {
  const masses=Object.fromEntries(((P.scene as {bodies?:{id:string;m?:unknown}[]}|undefined)?.bodies??[]).filter((b)=>typeof b.m==='string'&&/^[A-Za-z]$/.test(b.m)).map((b)=>[b.id,b.m as string]));
  stage2d.setMasses(masses);stage2d.symbolsOnly=!!S.samples;
  if(stage3d){stage3d.setMasses(masses);stage3d.symbolsOnly=!!S.samples;}
}
async function setDim(next: '2d' | '3d', redraw = true) {
  if (next === '3d') await need3d();
  dim = next;
  syncNotation(); showMode();
  document.querySelector<HTMLElement>('.view-controls')!.hidden = dim === '2d' || !!S?.sim?.circuit;
  syncDimToggle();
  if (redraw && sim) { active().prepare(sim, w0, w1); applyStep(); draw(); }
  syncCam();
}
/** 三维舞台画得出来的题（力学场景、解析演示）才给“立体”：场区、实验室、电路另有画法 */
const can3d = (s?: SimResult) => canUse3d && !!s && !s.board && !s.circuit && !s.em?.length && s.geo.bodies.every((b) => s.start.bodies[b.id] && s.end.bodies[b.id]);   // 中途分裂出现/消失的物体只在平面里画
/** 运动本身有纵深（如圆锥摆）的题只用立体画，不给平面 */
const only3d = (s?: SimResult) => can3d(s) && (chooseDim(s!) === '3d' || P.asks[view]?.view === '3d');
/** “立体”开关：平面题默认关、可以打开；真正的三维题固定打开、不能关 */
function syncDimToggle() {
  const b = $('dimToggle') as HTMLButtonElement, fixed = only3d(sim);
  b.hidden = !can3d(sim); b.disabled = fixed; b.setAttribute('aria-pressed', String(dim === '3d'));
  b.title = fixed ? '这道题的运动是立体的，只用立体画面' : dim === '3d' ? '回到平面图，和题图一样' : '切到立体画面，可以拖动旋转';
}
$('dimToggle').onclick = () => { if (!only3d(sim)) void setDim(dim === '3d' ? '2d' : '3d'); };
/** 缩放按钮：2D 和 3D 共用；“全景”只在 2D 有跟随镜头时出现 */
function syncCam() {
  const bar = $('camBar'), on = !!sim && !usesBench() && !(sim.board?.flat) && !sim.circuit;
  bar.hidden = !on; if (!on) return;
  const st = dim === '2d' ? stage2d.camState : null, wide = bar.querySelector<HTMLButtonElement>('[data-cam=wide]')!;
  wide.hidden = !st?.canFollow; wide.setAttribute('aria-pressed', String(!!st?.overview));
}
{
  const zoom = (f: number) => { if (dim === '2d') stage2d.zoomBy(f); else stage3d?.zoomBy(f); dirty = true; syncCam(); };
  $('camBar').querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation(); const k = b.dataset.cam;
      if (k === 'in') zoom(1.4); else if (k === 'out') zoom(1 / 1.4);
      else if (k === 'reset') { if (dim === '2d') stage2d.resetView(); else stage3d?.resetView(); }
      else if (k === 'wide') stage2d.setOverview(!stage2d.camState.overview);
      dirty = true; syncCam();
    };
  });
  // 2D：滚轮或双指缩放（以手指位置为中心），拖动平移
  const scene = $('scene'), pts = new Map<number, [number, number]>(); let pinch = 0;
  const is2d = (e: Event) => dim === '2d' && !usesBench() && !!sim && !(e.target as Element).closest('.cam-bar,.callout,.readout');
  scene.addEventListener('wheel', (e) => { if (!is2d(e)) return; e.preventDefault(); const r = scene.getBoundingClientRect(); stage2d.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0018)), e.clientX - r.left, e.clientY - r.top); dirty = true; syncCam(); }, { passive: false });
  scene.addEventListener('pointerdown', (e) => { if (!is2d(e)) return; pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  scene.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p || !is2d(e)) return;
    if (pts.size === 1) { if (!scene.classList.contains('dragging') && Math.hypot(e.clientX - p[0], e.clientY - p[1]) < 4) return; scene.classList.add('dragging'); scene.setPointerCapture?.(e.pointerId); stage2d.panBy(e.clientX - p[0], e.clientY - p[1]); }
    else if (pts.size === 2) { pts.set(e.pointerId, [e.clientX, e.clientY]); const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = scene.getBoundingClientRect(); if (pinch > 0) stage2d.zoomBy(d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); pinch = d; dirty = true; syncCam(); return; }
    pts.set(e.pointerId, [e.clientX, e.clientY]); dirty = true; syncCam();
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (!pts.size) { scene.classList.remove('dragging'); pinch = 0; } };
  scene.addEventListener('pointerup', up); scene.addEventListener('pointercancel', up);
}
/** 这道题用不上的控件不显示：电路没有速度，解析演示没有轨迹 */
let chartWanted = innerWidth > 600;
function applyTools(q?: Ask) {
  const motion = !!sim && !sim.circuit && !sim.script && !sim.board, can = !!plotData || (!!sim && hasChart(sim, w0, w1));
  $('sceneOptions').hidden = !motion; $('chartBtn').hidden = !can;
  setChart(can && (chartWanted || !$('tryCard').hidden));
  void q;
}
function sizeChart() {
  if (!sim) return;
  const total = $('scene').clientHeight + ($('chartCard').hidden ? 0 : $('chartCard').clientHeight);
  const desired = chartHeight(stage2d.contentRatio, total), height = innerWidth <= 600 ? Math.min(desired, Math.max(90, total - 170)) : desired;
  $('panel').style.setProperty('--chart-h', `${height}px`);
}
function setChart(on: boolean) { $('chartCard').hidden = !on; $('chartBtn').setAttribute('aria-pressed', String(on)); if (on && sim) { sizeChart(); draw(); } }
let lastPhase: Phase | undefined;
function draw() {
  if (!sim || document.body.dataset.state === 'busy') return;
  $('forceScaleNote').hidden = false;
  $('forceScaleNote').style.visibility = flag('force') || lesson[stepIdx]?.show.forces?.length || selected ? 'visible' : 'hidden';
  dirty = true;
  const at = view >= 0 ? P.asks[view].at : undefined;
  const before = at?.phase === 'before' || (at?.event === 'collide' && at.phase !== 'after');
  const snap = sampleAt(sim, t, before ? 'before' : 'after');
  active().update(snap); lastSnap = snap;
  const ph = phases.find((p) => t >= p.t0 - 1e-9 && t < p.t1 - 1e-9) ?? phases.at(-1);
  if (ph !== lastPhase) { lastPhase = ph; [...$('track').children].forEach((b, i) => b.classList.toggle('now', phases[i] === ph)); }
  updateToolbar();
  $('clock').innerHTML = sim.script || sim.circuit || (sim.board && !['电磁感应', '线框', '天体', '机械波', '线圈', '转动切割', '带电粒子'].includes(sim.board.name)) ? '' : `<i>t</i> = ${fmtT(t)} s${S.samples ? '（示例）' : ''}${rateText()}`;
  const span = w1 - w0 || 1, progress = (t - w0) / span;
  ($('scrub') as HTMLInputElement).value = String(Math.round(progress * 1000));
  const wait = waiting(); ($('scrub') as HTMLInputElement).disabled = wait || watching(); $('play').toggleAttribute('disabled', wait);
  ($('evPrev') as HTMLButtonElement).disabled = wait || watching() || !keyEvents.some((e) => e.t < t - 1e-9); ($('evNext') as HTMLButtonElement).disabled = wait || watching() || !keyEvents.some((e) => e.t > t + 1e-9);
  $('fill').style.width = `${progress * 100}%`;
  const mark = $('keyMark'); mark.hidden = keyT === null; if (keyT !== null) mark.style.left = `${(keyT - w0) / span * 100}%`;
  if (!$('chartCard').hidden) { if (plotData) { const pl = view >= 0 ? P.asks[view]?.plot : undefined, bp = sim.board?.plot; drawPlot(plotData, t, pl?.xLabel ?? bp?.x ?? '', pl?.yLabel ?? bp?.y ?? '', [w0, w1], chartOptions()); } else drawChart(snap, { sim, P, view, w0, w1, t, ...chartOptions() }); }
}

// ---------- 标注与点击 ----------
const askBody = (q: Ask) => q.focus?.body ?? /\b(?:v|vx|vy|x|y|cx|a|KE|rel|dx|dy)\(\s*([^,()\s]+)/.exec(q.expr ?? '')?.[1] ?? null;
function place(el: HTMLElement, p: [number, number], dx: number, dy: number) {
  const W = $('scene').clientWidth, H = $('scene').clientHeight;
  el.style.transform = `translate(${Math.round(Math.min(Math.max(p[0] + dx, 6), W - el.offsetWidth - 6))}px, ${Math.round(Math.min(Math.max(p[1] + dy, 6), H - el.offsetHeight - 6))}px)`;
}
function overlay() {
  if (!sim) return;
  const c = $('callout'), q = view >= 0 ? P.asks[view] : undefined, a = view >= 0 ? S.asks[view] : undefined, id = q ? askBody(q) : null;
  active().setFocus(id);
  const reached = !!lesson[stepIdx]?.final && !glide;
  if (a && q && id && reached && !a.error && !q.option && q.expr) {
    const p = active().screenOf(id);
    if (p) {
      const text = `${view}|${!changedConditions}`; if (c.dataset.k !== text) { c.dataset.k = text; c.innerHTML = `所求 ${q.focus?.label ? `${rich(q.focus.label)} = ` : ''}${answerHtml(a, q)}${S.samples && changedConditions ? '（示例）' : ''}`; } c.hidden = false;
      // 二维画面里找一个不压住物体和文字的空位，离所求物体越近越好
      const at = active() === stage2d ? stage2d.freeSpot(p[0] + 24, p[1] - 66, c.offsetWidth, c.offsetHeight) : null;
      if (at) c.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`; else place(c, p, 24, -66);
    } else c.hidden = true;
  } else c.hidden = true;
  const r = $('readout');
  if (selected && lastSnap?.bodies[selected]) {
    const b = lastSnap.bodies[selected], g = sim.geo.bodies.find((x) => x.id === selected)!, v = Math.hypot(b.vx, b.vy), f = force(sim, selected, b, lastSnap), ac = f ? Math.hypot(f[0], f[1]) : 0;
    r.innerHTML = `<b>${h(selected)}</b><br>速度 ${v.toFixed(2)} m/s<br>加速度 ${ac.toFixed(2)} m/s²${g.m ? `<br>动能 ${(g.m * v * v / 2).toFixed(2)} J` : ''}${S.samples ? '<br>以上数值为示例' : ''}`;
    const p = active().screenOf(selected); if (p) { r.hidden = false; place(r, p, -160, 26); } else r.hidden = true;
  }
}
let downAt: [number, number] | null = null;
$('scene').addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
$('scene').addEventListener('pointerup', (e) => {
  if (!downAt || !sim || (e.target as Element).closest('.seg,.tools,.scene-options') || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const box = $('scene').getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
  let best: string | null = null, d = 46;
  for (const g of sim.geo.bodies) { const p = active().screenOf(g.id); if (p) { const k = Math.hypot(p[0] - x, p[1] - y); if (k < d) { d = k; best = g.id; } } }
  selected = best === selected ? null : best; if (!selected) $('readout').hidden = true;
  applyStep();
});

// ---------- 播放 ----------
let last = 0;
/** 手动定位时同步步骤；预测的观看阶段保持讲解未开始。 */
function syncStep() { if (waiting() || watching() || changedConditions) return; let n = -1; for (let i = 0; i < lesson.length; i++) if (lesson[i].t <= t + 1e-9) n = i; if (n !== stepIdx) { stepIdx = n; applyStep(); renderCaption(); } }
function tick(ts: number) {
  const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
  if (sim && glide) {
    const p = Math.min(1, (performance.now() - glide.start) / glide.dur), e = p * p * (3 - 2 * p);
    t = glide.from + (glide.to - glide.from) * e; if (p >= 1) { glide = null; renderCaption(); }
    draw();
  } else if (playing && sim) {
    const wasWatching = watching();
    if (performance.now() >= holdUntil) {
      const nt = t + dt * baseRate * speed, e = holdAt.find((x) => x.t > t + 1e-12 && x.t <= nt);
      if (e) { t = e.t; holdUntil = performance.now() + 750; showEvent(e); } else t = nt;
      if (t >= w1) { t = w1; playing = false; if (watching()) revealPrediction(); else renderCaption(); }
    }
    if (!wasWatching) syncStep(); draw();
  }
  if (evtUntil && performance.now() > evtUntil) { evtUntil = 0; eventMessage = ''; updateToolbar(); }
  const icon = view === -2 ? 'play' : playing ? 'pause' : t >= w1 - 1e-9 ? 'again' : 'play'; if ($('play').dataset.icon !== icon) { $('play').dataset.icon = icon; $('play').innerHTML = ICONS[icon]; $('play').setAttribute('aria-label', playing ? '暂停' : t >= w1 - 1e-9 ? '重新播放' : '播放'); }
  if (sim && (dirty || usesBench() || dim === '3d')) { dirty = false; reserve(); active().render(ts); overlay(); }
}
const ICONS: Record<string, string> = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="2.8" height="10" rx=".8" fill="currentColor"/><rect x="9.2" y="3" width="2.8" height="10" rx=".8" fill="currentColor"/></svg>',
  again: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.2 2.5v2.8H6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
/** 浮在画面上的网页控件占的位置告诉二维画面，文字不放在那里 */
function reserve() {
  const sc = $('scene').getBoundingClientRect(), out: { x: number; y: number; w: number; h: number }[] = [];
  for (const id of ['camBar', 'sceneNote']) { const el = document.getElementById(id); if (!el || el.hidden || el.offsetParent === null) continue; const r = (id === 'sceneNote' && !(el as HTMLDetailsElement).open ? el.querySelector('summary')! : el).getBoundingClientRect(); if (r.width && r.height) out.push({ x: r.left - sc.left - 4, y: r.top - sc.top - 4, w: r.width + 8, h: r.height + 8 }); }
  stage2d.setReserved(out);
}
function loop(ts: number) { requestAnimationFrame(loop); try { tick(ts); } catch (e) { console.error(e); } }   // 一帧出错不让整个页面停住
const toggle = () => { if (!sim || waiting()) return; if (view === -2) { select(-1); playing = true; renderCaption(); return; } glide = null; holdUntil = 0; if (t >= w1 - 1e-9) { t = w0; stepIdx = -1; } playing = !playing; if (playing) syncStep(); renderCaption(); draw(); };
$('play').onclick = toggle;
($('scrub') as HTMLInputElement).oninput = (e) => { if (!sim || waiting() || watching()) return; t = w0 + (+(e.target as HTMLInputElement).value / 1000) * (w1 - w0); playing = false; glide = null; syncStep(); draw(); };
addEventListener('keydown', (e) => {
  if ((e.target as Element).closest('textarea,select,input[type=text]') || !$('pasteBox').hidden || !$('libBox').hidden) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { if (sim || P?.unsupported) goStep(stepIdx + (e.code === 'ArrowLeft' ? -1 : 1)); }
});
$('speedBtn').onclick = () => { const rates = [.5, 1, 2], names = ['慢', '中', '快']; const i = (rates.indexOf(speed) + 1) % rates.length; speed = rates[i]; $('speedBtn').textContent = names[i]; $('speedBtn').dataset.speed = String(speed); $('speedBtn').setAttribute('aria-label', `播放速度：${names[i]}，点击切换`); };
document.querySelectorAll<HTMLButtonElement>('[data-alt]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.alt === 'real')); b.onclick = () => { real = b.dataset.alt === 'real'; document.querySelectorAll('[data-alt]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); showMode(); if (sim) { active().prepare(sim, w0, w1); draw(); } }; });
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => { b.onclick = () => stage3d?.setView(b.dataset.view as 'front' | 'angle' | 'top'); });
// 左右栏拖动：宽度记在本机，双击恢复默认
{
  const app = document.querySelector<HTMLElement>('.app')!, bar = $('splitter'), sheet = document.querySelector<HTMLElement>('.sheet')!;
  const clampW = (w: number) => Math.round(Math.max(320, Math.min(w, app.clientWidth - 14 * 3 - 480)));
  const place = () => { bar.style.left = `${sheet.getBoundingClientRect().right - app.getBoundingClientRect().left}px`; };
  const setW = (w: number | null) => { if (w === null) app.style.removeProperty('--sheet-w'); else app.style.setProperty('--sheet-w', `${clampW(w)}px`); place(); };
  try { const v = +(localStorage.getItem('nanti-sheet-w') ?? ''); if (v > 0) setW(v); } catch { /* 用默认宽度 */ }
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault(); bar.setPointerCapture(e.pointerId); bar.classList.add('dragging'); document.body.classList.add('splitting');
    const x0 = e.clientX, w0 = sheet.getBoundingClientRect().width;
    const move = (m: PointerEvent) => setW(w0 + m.clientX - x0);
    const up = () => { bar.removeEventListener('pointermove', move); bar.classList.remove('dragging'); document.body.classList.remove('splitting'); try { localStorage.setItem('nanti-sheet-w', String(Math.round(sheet.getBoundingClientRect().width))); } catch { /* 记不住也行 */ } };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up, { once: true }); bar.addEventListener('pointercancel', up, { once: true });
  });
  bar.addEventListener('dblclick', () => { setW(null); try { localStorage.removeItem('nanti-sheet-w'); } catch { /* 无妨 */ } });
  new ResizeObserver(() => requestAnimationFrame(place)).observe(sheet); place();
}
{ const inset = $('insetToggle') as HTMLInputElement; inset.checked = pref('inset', false); stage2d.toggle('inset', inset.checked); inset.onchange = () => { savePref('inset', inset.checked); stage2d.toggle('inset', inset.checked); dirty = true; }; }
{ const pt = $('predictToggle') as HTMLInputElement; pt.checked = predictOn; pt.onchange = () => { predictOn = pt.checked; savePref('predict', predictOn); if (predictOn && view >= 0) { delete picked[view]; revealed[view] = false; } select(view); }; }
for (const f of ['velocity', 'force', 'trail'] as const) ($(`${f}Toggle`) as HTMLInputElement).onchange = (e) => { const on = (e.target as HTMLInputElement).checked; stage3d?.toggle(f, on); stage2d.toggle(f, on); refreshMath(); dirty = true; };
$('chartBtn').onclick = () => { chartWanted = !!$('chartCard').hidden; setChart(chartWanted); };
$('tryBtn').onclick = () => { const on = $('tryCard').hidden; $('tryCard').hidden = !on; $('tryBtn').setAttribute('aria-pressed', String(on)); if (on) { chartWanted = true; if (!baseS?.pending) void measureTry(baseP!); } applyTools(); };

// ---------- 改条件：用同一个引擎重算 ----------
function buildTry() {
  const box = $('tryPanel'); box.innerHTML = ''; $('tryHint').textContent = '松手后重算';
  const items = Object.entries(baseP?.params ?? {}).filter(([k, v]) => Array.isArray(v) && typeof v[0] === 'number' && v[0] > 0 && k !== 'g').slice(0, 7) as [string, [number, string, string]][];
  $('tryBtn').hidden = !items.length || !!baseP?.unsupported;
  for (const [k, v] of items) {
    const row = document.createElement('label'); row.className = 'try-row';
    const step = Number((v[0] / 20).toPrecision(2));
    row.innerHTML = `<span>${nameTex(k)}</span><b>${v[0]} ${h(v[1])}</b><small class="muted">原 ${v[0]} ${h(v[1])}</small><input type="range" min="${v[0] * .25}" max="${v[0] * 2}" step="${step}" value="${v[0]}" data-k="${h(k)}" aria-label="${h(k)}" />`;
    const input = row.querySelector('input')!, out = row.querySelector('b')!; input.disabled = !!S.pending;
    input.oninput = () => { out.textContent = `${input.value} ${v[1]}`; scheduleTry(); };
    input.onchange = () => { clearTimeout(tryTimer); tryTimer = 0; requestTry(); };
    box.append(row);
  }
}
/** 和实际改条件相同的输入：重新计算结论，保留符号题的示例性质。 */
function canRecalculate(q: Ask) { return !!q.expr && (!q.option || !!q.option.claim); }
function tryProblem(problem: Problem) {
  const next = structuredClone(problem);
  next.solution = undefined;
  next.asks.forEach((a) => {
    if (a.expr) { a.answer = undefined; a.answerText = undefined; }
    if (a.option?.claim) delete a.option.correct;
  });
  return next;
}
const tryTimings = new Map<string, { ms: number; computeMs: number; error?: string }>();
const measuring = new Map<string, Promise<{ ms: number; computeMs: number; error?: string }>>();
async function measureTry(problem: Problem) {
  const key = keyOf(problem), hit = tryTimings.get(key); if (hit) { if (baseP && keyOf(baseP) === key) $('tryHint').textContent = hit.ms > 300 || hit.error ? '松手后重算' : '拖动时更新'; return hit; }
  if (measuring.has(key)) return measuring.get(key)!;
  const task = new Promise<{ ms: number; computeMs: number; error?: string }>((resolve) => {
    const w = newWorker(), start = performance.now();
    const finish = (computeMs: number, error?: string) => { clearTimeout(timeout); w.terminate(); const result = { ms: performance.now() - start, computeMs, ...(error ? { error } : {}) }; tryTimings.set(key, result); measuring.delete(key); resolve(result); };
    const timeout = setTimeout(() => finish(60000, '重算超时'), 60000);
    w.onmessage = (e) => { if (!e.data.ok) finish(performance.now() - start, e.data.error); else if (!e.data.solved.pending) finish(e.data.ms); };
    w.onerror = () => finish(performance.now() - start, '重算未完成');
    w.postMessage({ id: 0, problem: tryProblem(problem) });
  });
  measuring.set(key, task);
  const result = await task;
  if (baseP && keyOf(baseP) === key) $('tryHint').textContent = result.ms > 300 || result.error ? '松手后重算' : '拖动时更新';
  return result;
}
let tryTimer = 0, tryLast = 0, tryRunning = false, tryQueued = false, tryGeneration = 0;
function scheduleTry() {
  if (!baseP) return;
  const measured = tryTimings.get(keyOf(baseP));
  if (!measured || measured.error || measured.ms > 300) return;
  if (tryTimer) return;
  tryTimer = window.setTimeout(() => { tryTimer = 0; requestTry(); }, Math.max(0, 150 - (performance.now() - tryLast)));
}
function requestTry() {
  if (tryRunning) { tryQueued = true; return; }
  void applyTry();
}
async function applyTry() {
  if (!baseP) return;
  const next = tryProblem(baseP), generation = tryGeneration;
  document.querySelectorAll<HTMLInputElement>('#tryPanel input').forEach((i) => { (next.params![i.dataset.k!] as unknown[])[0] = +i.value; });
  if (JSON.stringify(next.params) === JSON.stringify(P.params) && changedConditions) return;
  $('tryReset').hidden = false; $('tryMsg').textContent = '';
  tryRunning = true; tryLast = performance.now();
  const key = keyOf(baseP);
  try {
    await run(next, baseName, { tried: true });
    while (generation === tryGeneration && (busy || document.body.dataset.state !== 'ready')) await new Promise((resolve) => setTimeout(resolve, 20));
    if (generation !== tryGeneration) return;
    const elapsed = performance.now() - tryLast, timing = tryTimings.get(key);
    if (timing && elapsed > 300) { timing.ms = Math.max(timing.ms, elapsed); $('tryHint').textContent = '松手后重算'; }
  } finally {
    if (generation === tryGeneration) tryRunning = false;
    if (generation === tryGeneration && tryQueued) { tryQueued = false; requestTry(); }
  }
}
$('tryReset').onclick = () => {
  const v = keepView; ++tryGeneration; clearTimeout(tryTimer); tryTimer = 0; tryQueued = false;
  if (baseP) { void run(baseP, baseName, { image: baseImage, restored: true }); keepView = v; }
};
function chartOptions() {
  return { mode: waiting() ? 'waiting' as const : watching() ? 'watching' as const : 'normal' as const, letters: !!S.samples, baseSim: changedConditions ? (view >= 0 ? baseS?.asks[view]?.sim ?? baseS?.sim : baseS?.sim) : undefined, basePlot: changedConditions && view >= 0 ? baseS?.asks[view]?.plotData : undefined };
}
function comparisonHtml() {
  if (!baseS || !baseP) return '';
  const value = (a: AskResult, q: Ask, original = false) => !original && !canRecalculate(q) ? '这一问需重新判断，可对照原题讲解' : a.error ? '这组条件下没有这个结果' : q.option ? ((a.claimValue ?? (original ? q.option.correct : undefined)) === undefined ? '未给出结论' : (a.claimValue ?? (original ? q.option.correct : undefined)) ? '这个说法成立' : '这个说法不成立') : `${niceTex(a.shown)}${unitOf(q) ? unitHtml(unitOf(q)) : ''}`;
  const rows = S.asks.map((a, i) => `<p class="compare-row${canRecalculate(P.asks[i]) && (a.shown !== baseS!.asks[i].shown || a.error !== baseS!.asks[i].error) ? ' different' : ''}"><b>${h(P.asks[i].option?.label ?? qLabel(a.id))}</b><span>原题 ${value(baseS!.asks[i], baseP!.asks[i], true)} → 现在 ${value(a, P.asks[i])}</span></p>`).join('');
  const events = (solved: Solved) => {
    const map = new Map<string, EventRec>();
    for (const sim of [solved.sim, ...solved.asks.map((a) => a.sim)]) for (const e of sim?.events ?? []) if (eventText(e)) map.set(`${e.type}|${e.a ?? ''}|${e.b ?? ''}`, e);
    return map;
  };
  const old = events(baseS), now = events(S);
  const changes = [...old].filter(([k]) => !now.has(k)).map(([, e]) => `原题有“${eventText(e)}”，现在没有。`).concat([...now].filter(([k]) => !old.has(k)).map(([, e]) => `原题没有“${eventText(e)}”，现在有。`));
  const written = view >= 0 ? baseS.asks[view]?.steps ?? [] : [];
  return `<section class="comparison"><h3>和原题比</h3>${rows}<div class="event-comparison">${h(changes.join(' ') || '转折点的种类相同，具体时刻可对照图像。')}</div><p class="muted">实线是现在，虚线是原题。</p></section><details class="original-lesson"><summary>原题的讲解</summary>${written.map((st) => `<p>${rich(st.say)}${st.tex ? tex(st.tex, true) : ''}</p>`).join('') || '<p>请点上方小问查看原题的讲解。</p>'}</details>`;
}

// ---------- 选题与放题 ----------
let mine: Mine[] = [], current = '';
const catalog = new Map<string, CatalogState>();
const deleted = new Map<string, { item: Mine; index: number; timer: number }>();
let catalogLoading = false;
async function loadCatalog() {
  if (catalogLoading) return; catalogLoading = true;
  const rows = [...library.map((p) => p.P), ...mine.map((m) => m.problem)];
  for (const p of rows) {
    const key = keyOf(p); if (catalog.has(key)) continue;
    const hit = await cached(key); if (hit || p.unsupported) catalog.set(key, catalogState(p, hit));
  }
  if (!$('libBox').hidden) fillPicker();
  const pending = rows.filter((p) => !catalog.has(keyOf(p)));
  if (!pending.length) { catalogLoading = false; return; }
  const w = newWorker(); let index = 0;
  const next = () => {
    if (index >= pending.length) { w.terminate(); catalogLoading = false; return; }
    w.postMessage({ id: index, problem: pending[index++], warm: true });
  };
  w.onmessage = (e) => {
    catalog.set(keyOf(pending[e.data.id]), e.data.catalog ?? 'none');
    if (!$('libBox').hidden) {
      const input = $('libSearch') as HTMLInputElement, focused = document.activeElement === input, pos = input.selectionStart;
      fillPicker(); if (focused) { const again = $('libSearch') as HTMLInputElement; again.focus(); again.setSelectionRange(pos, pos); }
    }
    next();
  };
  w.onerror = () => { w.terminate(); catalogLoading = false; }; next();
}
let libTopic = '全部', libQuery = '';
/** 题库：上面搜索和板块筛选，卡片上先写出处再写题目 */
function fillPicker(value?: string) {
  if (value) current = value;
  const split = (t: string) => { const m = /^((?:19|20)\d\d\s*[^：:]{0,12}?\d+)\s*[：:]\s*(.+)$/.exec(t); return m ? [m[1], m[2]] : (() => { const k = /^([^：:]{1,8})[：:]\s*(.+)$/.exec(t); return k ? ['示例 · ' + k[1], k[2]] : ['', t]; })(); };
  type Card = { v: string; text: string; P: Problem; deleted?: boolean };
  const stateOf = (c: Card) => catalog.get(keyOf(c.P)) ?? catalogState(c.P);
  const card = (c: Card) => {
    if (c.deleted) return `<div class="lib-deleted" data-deleted="${h(c.v.slice(2))}">已删除 · <button class="undo-delete" data-id="${h(c.v.slice(2))}">撤销</button></div>`;
    const [tag, title] = split(c.text), status = stateOf(c), label = { engine: '全部引擎核验', partial: '有未核验的小问', none: '这道题没有动画' }[status];
    return `<div class="lib-entry"><button class="lib-card${c.v === current ? ' on' : ''}" data-v="${h(c.v)}"><span class="catalog-dot catalog-${status}" role="img" aria-label="${label}" title="${label}"></span>${tag ? `<span class="tag">${h(tag)}</span>` : ''}<span class="tt">${rich(title)}</span></button>${c.v.startsWith('m:') ? `<button class="delete-mine" data-id="${h(c.v.slice(2))}" aria-label="删除 ${h(c.text)}">删除</button>` : ''}</div>`;
  };
  const groups = new Map<string, Card[]>();
  const personal: Card[] = mine.map((m) => ({ v: `m:${m.id}`, text: m.name, P: m.problem }));
  for (const [id, d] of deleted) personal.splice(d.index, 0, { v: `m:${id}`, text: d.item.name, P: d.item.problem, deleted: true });
  if (personal.length) groups.set('我放进来的题', personal);
  library.forEach((p, i) => { const k = topicOf(p.P); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push({ v: `l:${i}`, text: p.P.title ?? p.key, P: p.P }); });
  for (const [name, rows] of groups) if (name !== '我放进来的题') rows.sort((a, b) => Number(stateOf(a) === 'none') - Number(stateOf(b) === 'none'));
  const topics = ['全部', ...groups.keys()], q = libQuery.trim().toLowerCase();
  const shown = [...groups].filter(([k]) => libTopic === '全部' || k === libTopic).map(([k, list]) => [k, list.filter((c) => !q || c.text.toLowerCase().includes(q))] as const).filter(([, list]) => list.length);
  $('libTools').innerHTML = `<label class="search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><input id="libSearch" type="text" placeholder="搜题目、年份、省份" value="${h(libQuery)}" autocomplete="off" /></label><div class="lib-topics">${topics.map((k) => `<button data-topic="${h(k)}" aria-pressed="${k === libTopic}">${h(k)}</button>`).join('')}</div>`;
  $('libList').innerHTML = shown.length ? shown.map(([k, v]) => `<section class="lib-group"><h3>${h(k)}<span>${v.length}</span></h3><div class="lib-cards">${v.map(card).join('')}</div></section>`).join('') : '<p class="lib-empty">没有找到，换个词试试</p>';
  $('libList').querySelectorAll<HTMLElement>('.lib-card').forEach((b) => { b.onclick = () => { $('libBox').hidden = true; current = b.dataset.v!; open(current); }; });
  $('libList').querySelectorAll<HTMLButtonElement>('.delete-mine').forEach((b) => b.onclick = async () => {
    const id = b.dataset.id!, index = mine.findIndex((m) => m.id === id); if (index < 0) return;
    const [item] = mine.splice(index, 1);
    deleted.set(id, { item, index, timer: window.setTimeout(() => { deleted.delete(id); fillPicker(); }, 5000) });
    await deleteMine(id); fillPicker();
  });
  $('libList').querySelectorAll<HTMLButtonElement>('.undo-delete').forEach((b) => b.onclick = async () => {
    const id = b.dataset.id!, d = deleted.get(id); if (!d) return;
    clearTimeout(d.timer); deleted.delete(id); mine.splice(Math.min(d.index, mine.length), 0, d.item);
    await saveMine(d.item); fillPicker();
  });
  $('libTools').querySelectorAll<HTMLElement>('[data-topic]').forEach((b) => { b.onclick = () => { libTopic = b.dataset.topic!; fillPicker(); }; });
  const input = $('libSearch') as HTMLInputElement; input.oninput = () => { libQuery = input.value; const pos = input.selectionStart; fillPicker(); const again = $('libSearch') as HTMLInputElement; again.focus(); again.setSelectionRange(pos, pos); };
}
function open(value: string) {
  current = value; stemOpen = false;
  if (value.startsWith('m:')) { const m = mine.find((x) => `m:${x.id}` === value); if (m) void run(m.problem, m.name, { image: m.image, repair: m.lastPasteIssue?.kind === 'unreadable' ? unreadableRepair : m.repair, modelFailure: !!m.original }); }
  else { const p = library[+value.slice(2)]; void run(p.P, p.P.title ?? p.key); }
  try { localStorage.setItem('nanti-last', value); } catch { /* 只是记住上次看到哪 */ }
}
$('libBtn').onclick = () => { pauseForDialog(); fillPicker(); void loadCatalog(); $('libBox').hidden = false; if (innerWidth > 600) ($('libSearch') as HTMLInputElement).focus(); };
$('libClose').onclick = () => { $('libBox').hidden = true; };
$('libBox').onclick = (e) => { if (e.target === $('libBox')) $('libBox').hidden = true; };
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('libBox').hidden = true; });
const copy = async (text: string): Promise<boolean> => {
  try { if (!navigator.clipboard) return false; await navigator.clipboard.writeText(text); return true; } catch { return false; }
};
const topicBox = $('topics'); let topic = '力学';
topicBox.innerHTML = topicRows(Object.keys(prompts)).map((row, i) => `<div class="topic-row${i ? ' extra' : ''}" role="group" aria-label="${i ? '其他板块' : '常见板块'}">${row.map((k) => `<button data-t="${h(k)}" aria-pressed="${k === topic}"><span class="topic-name">${h(k)}</span><span class="topic-example">${h(topicExamples[k])}</span></button>`).join('')}</div>`).join('');
topicBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.onclick = () => { topic = b.dataset.t!; topicBox.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('copyPrompt').textContent = '复制提示词'; }; });
$('copyPrompt').onclick = async () => { const ok = await copy((prompts as Record<string, string>)[topic]); $('copyPrompt').textContent = ok ? '已复制' : '复制未成功，请重试'; };
type Draft = { attempts: number; text: string; image?: string; issue?: PasteIssue };
let draft: Draft = { attempts: 0, text: '' }, draftSerial = 0, pendingImage: string | undefined;
let automaticOwner = '', copyingKey = '', copied: { owner: string; attempt: number; ok: boolean } | undefined;
let shownIssueKey = '';
const owner = () => replacingId ? `m:${replacingId}` : `d:${draftSerial}`;
const savedEditing = () => replacingId ? mine.find((m) => m.id === replacingId) : undefined;
const issueOf = (m: Mine): PasteIssue | undefined => m.lastPasteIssue ?? (m.problem.unsupported ? { kind: 'unsupported' } : m.repair ? { kind: 'result' } : undefined);
const repairOf = (m: Mine) => m.lastPasteIssue?.kind === 'unreadable' ? unreadableRepair : m.repair ?? (m.problem.unsupported ? `请对照原题补全场景，保留小问和分步解答，重新输出完整回复。${KEEP_SIM}` : '');
function renderRepairGuide() {
  const m = mine.find((m) => `m:${m.id}` === current), issue = m ? issueOf(m) : undefined;
  $('repairGuide').hidden = !(m && activeRepair);
  $('repairGuide').querySelector('span')!.textContent = issue?.kind === 'unreadable' ? '上一次的讲解可以继续看。把修改提示发回给 AI，再把新回复粘贴进来。' : P?.unsupported ? '讲解已经可以看了。想让它动起来：把修改提示发回给 AI，再把新回复粘贴进来。' : '这道题还有需要核对的地方。把修改提示发回给 AI，再把新回复粘贴进来。';
  const note = $('repairAttemptNotice'); note.hidden = !m || !issue;
  note.textContent = m && issue ? `第 ${attemptsOf(m)} 次。${adviceFor(attemptsOf(m), issue)}` : '';
  note.classList.toggle('warn', !!m && !!adviceFor(attemptsOf(m), issue));
}
/** 只有本次提交自动复制；手动打开题库里的旧题不会改剪贴板。 */
function autoRepair(who: string, attempt: number, text: string) {
  if (!text || automaticOwner !== `${who}:${attempt}`) return;
  const key = `${who}:${attempt}:${text}`; if (copyingKey === key) return; copyingKey = key;
  void copy(text).then((ok) => {
    if (copyingKey !== key) return;
    copied = { owner: who, attempt, ok };
    if (!$('pasteBox').hidden && owner() === who) renderPasteIssue();
  });
}
function renderPasteIssue() {
  const old = savedEditing(), issue = old ? issueOf(old) : draft.issue, count = old ? attemptsOf(old) : draft.attempts;
  const box = $('pasteErr'); box.hidden = !issue;
  $('pasteNew').hidden = !!old || !draft.attempts;
  if (!issue) { box.innerHTML = ''; shownIssueKey = ''; return; }
  const text = old ? repairOf(old) : unreadableRepair, key = `${owner()}:${count}`;
  const expanded = shownIssueKey === key && !!document.querySelector<HTMLDetailsElement>('#pasteRepairDetails')?.open;
  shownIssueKey = key;
  const note = noticeFor(issue, count, copied?.owner === owner() && copied.attempt === count ? copied.ok : undefined);
  box.innerHTML = `<div class="paste-error-head"><p id="pasteErrorMessage">${h(note.message)}</p><span id="pasteAttempt" class="paste-round">${h(note.round)}</span></div><p id="pasteNext">${h(note.next)}</p>${note.warning ? `<p id="pasteLimit" class="paste-warning">${h(note.warning)}</p>` : ''}<div class="paste-error-actions"><button id="pasteCopyRepair">复制修改提示</button>${old && validateLesson(old.problem) ? '<button id="pasteLesson">先看讲解</button>' : ''}</div><details id="pasteRepairDetails"${expanded ? ' open' : ''}><summary>看看哪里错了</summary><pre class="repair">${h(text)}</pre></details>`;
  ($('pasteText') as HTMLTextAreaElement).placeholder = '把 AI 的新回复贴在这里，替换原来的内容';
  $('pasteCopyRepair').onclick = async () => { copied = { owner: owner(), attempt: count, ok: await copy(text) }; renderPasteIssue(); };
  const lessonButton = document.getElementById('pasteLesson');
  if (lessonButton && old) lessonButton.onclick = () => { closeBox(); if (current === `m:${old.id}` && document.body.dataset.state === 'ready') select(0); else { open(`m:${old.id}`); keepView = 0; } };
}
const showImage = (src?: string) => { pendingImage = src; if (!replacingId) draft.image = src; ($('dropImg') as HTMLImageElement).src = src ?? ''; $('dropImg').hidden = !src; $('dropText').hidden = !!src; };
const readImage = (f: File) => { if (!f.type.startsWith('image/')) return; const r = new FileReader(); r.onload = () => showImage(String(r.result)); r.readAsDataURL(f); };
($('imageFile') as HTMLInputElement).onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) readImage(f); };
$('drop').tabIndex = 0;
$('drop').onkeydown = (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); ($('imageFile') as HTMLInputElement).click(); } };
$('pasteBox').addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); readImage(f); } });
const closeBox = () => { if (!replacingId) draft.text = ($('pasteText') as HTMLTextAreaElement).value; $('pasteBox').hidden = true; $('addBtn').focus(); };
function showPaste(id?: string) {
  replacingId = id; pauseForDialog();
  const m = savedEditing();
  showImage(m ? m.image : draft.image); ($('pasteText') as HTMLTextAreaElement).value = m ? '' : draft.text;
  ($('pasteText') as HTMLTextAreaElement).placeholder = m ? '把 AI 的新回复贴在这里，替换原来的内容' : '在这里粘贴 AI 的回复';
  $('pasteTitle').textContent = id ? '粘贴这道题的新回复' : '放一道题进来';
  $('pasteBox').hidden = false; $('copyPrompt').textContent = '复制提示词'; renderPasteIssue();
  if (id) ($('pasteText') as HTMLTextAreaElement).focus(); else { $('pasteBody').scrollTop = 0; $('pasteClose').focus({ preventScroll: true }); }
}
$('addBtn').onclick = () => showPaste();
$('pasteNew').onclick = () => { draft = { attempts: 0, text: '' }; draftSerial++; copied = undefined; showPaste(); };
$('copyRepair').onclick = () => copy(activeRepair);
$('replaceReply').onclick = () => { const m = mine.find((m) => `m:${m.id}` === current); if (m) showPaste(m.id); };
$('pasteClose').onclick = closeBox;
$('pasteBox').onclick = (e) => { if (e.target === $('pasteBox')) closeBox(); };
$('pasteBox').onkeydown = (e) => { if (e.key === 'Escape') closeBox(); };
$('pasteRun').onclick = () => {
  const old = savedEditing(), attempts = nextAttempt(old, draft.attempts);
  if (old) old.attempts = attempts; else { draft.attempts = attempts; draft.text = ($('pasteText') as HTMLTextAreaElement).value; }
  let reply: ReturnType<typeof readLessonReply>;
  try { reply = readLessonReply(($('pasteText') as HTMLTextAreaElement).value); }
  catch {
    const issue: PasteIssue = { kind: 'unreadable' };
    if (old) { old.lastPasteIssue = issue; void saveMine(old); if (current === `m:${old.id}`) { activeRepair = unreadableRepair; renderRepairGuide(); } }
    else draft.issue = issue;
    automaticOwner = `${owner()}:${attempts}`; copied = undefined; renderPasteIssue(); autoRepair(owner(), attempts, unreadableRepair);
    const input = $('pasteText') as HTMLTextAreaElement; input.focus({ preventScroll: true }); input.select(); $('pasteErr').scrollIntoView({ block: 'nearest' });
    return;
  }
  const p = reply.problem;
  const issue: PasteIssue | undefined = reply.repair ? { kind: 'scene', count: reply.issueCount } : p.unsupported ? { kind: 'unsupported' } : undefined;
  const repair = reply.repair ?? (p.unsupported ? `这道题还不能演示，请对照原题完善场景，保留小问和分步解答，重新输出完整回复。${KEEP_SIM}` : undefined);
  const m: Mine = { id: old?.id ?? crypto.randomUUID(), name: p.title ?? '我放进来的题', problem: p,
    image: pendingImage ?? old?.image, time: old?.time ?? Date.now(), original: reply.original, repair, attempts, lastPasteIssue: issue };
  if (old) mine[mine.indexOf(old)] = m; else mine.unshift(m);
  automaticOwner = `m:${m.id}:${attempts}`; copied = undefined;
  void saveMine(m); renderPasteIssue(); closeBox(); fillPicker(`m:${m.id}`); open(`m:${m.id}`);
  autoRepair(`m:${m.id}`, attempts, repair ?? '');
  if (!old) { draft = { attempts: 0, text: '' }; draftSerial++; }
  ($('pasteText') as HTMLTextAreaElement).value = ''; showImage(undefined);
};

// 空闲时把例题先算好，之后切换不用等。全在后台线程里完成，播放不会被打断
function warm() {
  const w = newWorker(); let i = 0;
  const next = () => { if (i >= library.length) { w.terminate(); return; } w.postMessage({ id: -1, problem: library[i++].P, warm: true }); };
  w.onmessage = next; w.onerror = next; next();
}
addEventListener('resize', () => { if (P) updatePaper(); if (sim) { sizeChart(); draw(); } });
document.fonts.ready.then(scheduleFormulaFit);
new ResizeObserver(scheduleFormulaFit).observe($('sheetScroll'));
new ResizeObserver(() => { dirty = true; }).observe($('scene'));
let chartFrame = 0;
new ResizeObserver(() => { cancelAnimationFrame(chartFrame); chartFrame = requestAnimationFrame(() => { if (sim && !$('chartCard').hidden) draw(); }); }).observe($('chartCard'));
addEventListener('pagehide', (e) => { if (!e.persisted) worker.terminate(); });

requestAnimationFrame(loop);
// ---------- 质检接口（只在网址带 ?qa 时有）：tests/质检 的脚本用它逐题逐问取画面记录 ----------
const QA = /[?&]qa\b/.test(location.search);
if (QA) {
  const ready = async () => { for (let i = 0; i < 2400 && (document.body.dataset.state !== 'ready' || busy); i++) await new Promise((r) => setTimeout(r, 50)); };
  const rect = (id: string) => { const el = document.getElementById(id), sc = $('scene').getBoundingClientRect(); if (!el || el.hidden || el.offsetParent === null) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.left - sc.left, y: r.top - sc.top, w: r.width, h: r.height } : null; };
  (window as unknown as { __qa: unknown }).__qa = {
    benchmark: (i: number) => measureTry(library[i].P),
    state: () => ({ prediction: waiting() ? 'waiting' : watching() ? 'watching' : 'revealed', changedConditions, view, t, w0, w1, playing, stepIdx, phases: phases.map((p) => ({ ...p })), map: lesson.map((s) => ({ say: s.say, t: s.t })), intro: storyIntro }),
    paper: () => select(-2),
    list: () => library.map((p) => ({ key: p.key, title: p.P.title ?? p.key, topic: topicOf(p.P) })),
    problem: (i: number) => library[i].P,
    async open(x: number | Problem) {
      qaFail = ''; const t0 = performance.now();
      if (typeof x === 'number') { current = `l:${x}`; void run(library[x].P, library[x].P.title ?? library[x].key); } else { current = ''; void run(x, x.title ?? '变体'); }
      await new Promise((r) => setTimeout(r, 30)); await ready();
      return { ms: performance.now() - t0, fail: qaFail, unsupported: P.unsupported ?? null, asks: (S?.asks ?? []).map((a, i) => ({ id: a.id, error: a.error ?? null, ok: a.ok ?? null, source: a.source ?? null, option: !!P.asks[i]?.option })) };
    },
    ask(i: number) {
      if (!S) return null;
      if (i >= 0 && P.asks[i]?.predict) { picked[i] = P.asks[i].predict!.answer; revealed[i] = true; }
      select(i); playing = false;
      const q = i >= 0 ? P.asks[i] : undefined;
      return { w0, w1, keyT, dim, focus: q ? askBody(q) : null, keep: q?.keep ?? [], steps: lesson.map((s) => s.t), bodies: sim?.geo.bodies.map((b) => b.id) ?? [] };
    },
    /** 和学生点画面上的物体一样：选中它（再画它的受力和读数）；传 null 取消 */
    pick(id: string | null) { selected = id; if (!selected) $('readout').hidden = true; applyStep(); return selected; },
    seek(x: number) {
      if (!sim) return null;
      t = x; playing = false; glide = null; syncStep(); draw(); dirty = false; reserve(); active().render(performance.now()); overlay();
      const ui = Object.fromEntries(['callout', 'readout', 'evtTag', 'keyHint', 'sceneNote', 'camBar', 'sceneLoading'].map((k) => [k, rect(k)]));
      if (active() === stage2d) return { ...stage2d.qa, ui, contentRatio: stage2d.contentRatio };
      const sc = $('scene').getBoundingClientRect();
      return { t, mode: usesBench() ? 'bench' : '3d', w: sc.width, h: sc.height, focus: view >= 0 ? askBody(P.asks[view]) : null, bodies: sim.geo.bodies.map((b) => { const p = active().screenOf(b.id); return p ? { id: b.id, kind: b.kind, x: p[0], y: p[1], r: 0 } : null; }).filter(Boolean), texts: [], arrows: [], labels: [], forced: 0, dropped: 0, keep: [], inset: null, ...(active() === stage3d ? { ...stage3d!.qa, arrows: stage3d!.qa.forceArrows.filter((a) => a.magnitude).map((a) => ({ x0:a.x0, y0:a.y0, x1:a.x1, y1:a.y1, inset:false })) } : {}), ui };
    },
    visual: () => ({ contentRatio: stage2d.contentRatio, chartHeight: $('chartCard').getBoundingClientRect().height, sceneHeight: $('scene').clientHeight, nowText: $('nowText').textContent, step: stepIdx, steps: lesson.map((s) => ({ say: s.say, t: s.t })), events: keyEvents.map((e) => ({ t: e.t, text: eventText(e) })) }),
    /** 切到平面/立体（这一问能用立体时） */
    step: (n: number) => goStep(n),
    dimension: () => sim ? chooseDim(sim) : null,
    async dim(d: '2d' | '3d') { if (d === '3d' && !can3d(sim)) return false; await setDim(d); return dim === d; },
    /** 画布上有内容（比纸色明显深）的范围，按 CSS 像素；只看二维画布 */
    ink() {
      const cv = $('scene').querySelector<HTMLCanvasElement>('canvas.scene2d'); if (!cv || active() !== stage2d) return null;
      const g = cv.getContext('2d')!, W = cv.width, H = cv.height, d = g.getImageData(0, 0, W, H).data, r = W / cv.getBoundingClientRect().width;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H - 40 * r; y += 2) for (let x = 0; x < W; x += 2) { const i = (y * W + x) * 4; if (d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11 < 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      return x1 < 0 ? null : { x: x0 / r, y: y0 / r, w: (x1 - x0) / r, h: (y1 - y0) / r };
    },
    errors: [] as string[],
  };
  addEventListener('unhandledrejection', (e) => (window as unknown as { __qa: { errors: string[] } }).__qa.errors.push(String(e.reason)));
  addEventListener('error', (e) => (window as unknown as { __qa: { errors: string[] } }).__qa.errors.push(String(e.message)));
  const ce = console.error.bind(console); console.error = (...a: unknown[]) => { (window as unknown as { __qa: { errors: string[] } }).__qa.errors.push(a.map(String).join(' ').slice(0, 300)); ce(...a); };
}
void (async () => {
  const stored = await allMine(); mine = [...mine, ...stored.filter((s) => !mine.some((m) => m.id === s.id))];   // 启动读取较慢时，不覆盖已经放进来的题
  let start = `l:0`; try { const v = localStorage.getItem('nanti-last'); if (v && (v.startsWith('m:') ? mine.some((m) => `m:${m.id}` === v) : library[+v.slice(2)])) start = v; } catch { /* 没有记录就从第一题开始 */ }
  if (!QA) { fillPicker(start); open(start); }
  if (!QA) setTimeout(warm, 4000);
})();
