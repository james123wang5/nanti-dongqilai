// 画面自动质检：在无界面 Chrome 里把题库每道题的每一问都放一遍，逐帧量出重叠、出画面、标签跳动、考点画错等问题。
// 用法（先开播放器开发服务器，默认端口 5190，可用 --port 改）：
//   node tests/质检/质检.mjs                 全题库，电脑尺寸
//   node tests/质检/质检.mjs --mobile        手机尺寸
//   node tests/质检/质检.mjs --variants 3    每道题再随机改 3 组数据
//   node tests/质检/质检.mjs --only 5,12     只跑第 5、12 道
//   node tests/质检/质检.mjs --shots 12      最差的 12 处截图（默认 12）
//   node tests/质检/质检.mjs --files 目录     改查外部 JSON：目录下各子文件夹里的 回复*.json（AI 实测回复），结果放 结果/外部-<目录名>/
// 输出：tests/质检/结果/<尺寸>/报告.md、数据.json、截图/*.png
import { assertCanLaunchBrowser } from '../浏览器守卫.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const MOBILE = process.argv.includes('--mobile'), D3 = process.argv.includes('--3d');
const VARIANTS = +arg('--variants', 0), SHOTS = +arg('--shots', 12), ONLY = arg('--only', '')?.split(',').filter(Boolean).map(Number);
const FILES = arg('--files', '');
const FRAMES = MOBILE ? 14 : 22, PORT = 9350 + Math.floor(Math.random() * 400);
const SIZE = MOBILE ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const OUT = join(HERE, '结果', FILES ? `外部-${FILES.replace(/\/+$/, '').split('/').pop()}${MOBILE ? '-手机' : ''}` : (MOBILE ? '手机' : '电脑') + (D3 ? '-立体' : '')); rmSync(join(OUT, '截图'), { recursive: true, force: true }); mkdirSync(join(OUT, '截图'), { recursive: true });

// ================= 判断规则 =================
function issue(cat, score, msg, t) { return { cat, score, msg, ...(t !== undefined ? { t } : {}) }; }
function fmt(t) { return Math.abs(t) < .01 && t !== 0 ? t.toExponential(2) : (+t.toFixed(3)).toString(); }
const DESC = {
  文字重叠: '两段文字压在一起（交叠超过小的那段的 30%）',
  文字压物体: '文字盖住物体图标',
  文字压箭头: '箭头穿过文字',
  物体画重叠: '实际分开的两个物体，画出来叠在一起',
  所求物体出画面: '这一问要看的物体跑到画面外',
  运动物体出画面: '在动的物体超过三成时间在画面外',
  运动看不出: '所求物体实际在动，画面上移动不到 25 像素',
  画面太空: '画面上的内容（按画布像素算）只占画面宽、高的不到 30%',
  标签挤不下: '找不到空位，标签被迫压在别的东西上',
  次要标签被省略: '次要标签找不到空位没画（只记录）',
  标签离箭头远: '箭头的名字离箭头尖超过 45 像素',
  标签跳动: '连续几帧（1/60 s）里标签相对它想放的位置跳了 24 像素以上（箭头反向换边不算）',
  考点画错: '要求保持准确的角度、长度，画面上量出来不对',
  考点不在画面: '考点（角度顶点、尺寸线）在画面外',
  考点没画: '这一问标了考点，但画面上没画出来（比如 3D 下）',
  浮层挡住: '网页上的浮层（所求框、读数、事件提示、镜头按钮）盖住物体或文字',
  放大窗挡住: '放大镜小窗盖住了主画面上的物体或文字',
  空白画面: '画面上什么物体都没有',
  报错: '页面或引擎报错',
  和答案对不上: '核验没通过',
  改数据后算不出: '随机改数据后引擎算不出（只说明鲁棒性）',
  整题不能演示: '题目走了 unsupported 出口',
  算得太慢: '打开到能播超过 8 秒',
};
function inter(a, b) { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h : 0; }
function bodyBox(b) { return b.kind === 'board' ? { x: b.x - b.hw, y: b.y - b.hh, w: 2 * b.hw, h: 2 * b.hh } : { x: b.x - b.r, y: b.y - b.r, w: 2 * b.r, h: 2 * b.r }; }
function onScreen(b, f, m = 0) { return b.x >= -m && b.x <= f.w + m && b.y >= -m && b.y <= f.h + m; }
const white = (c) => /^#fff(fff)?$/i.test(c) || c === 'rgb(255, 255, 255)';
function measure(frames, bursts, info) {
  const out = [], worst = new Map();
  const put = (cat, score, msg, t) => { const w = worst.get(cat); if (!w || score > w.score) worst.set(cat, { score, msg, t, n: (w?.n ?? 0) + 1 }); else w.n++; };
  if (!frames.length) return [issue('空白画面', 7, '一帧也没画出来')];
  const is2d = frames[0].mode !== '3d' && frames[0].mode !== 'bench';
  let focusOff = 0, focusN = 0; const offBy = new Map(), path = [];
  for (const f of frames) {
    const W = f.w, H = f.h;
    const texts = (f.texts ?? []).filter((x) => !white(x.color) && !x.rot && x.w > 1);
    const main = texts.filter((x) => !x.inset), bodies = (f.bodies ?? []).filter((b) => !b.inset);
    // 文字互相重叠（同一段文字拆成几次画的不算：要求两段都比较大、交叠占小的 30% 以上）
    for (let i = 0; i < main.length; i++) for (let j = i + 1; j < main.length; j++) {
      const a = main[i], b = main[j], o = inter(a, b), m = Math.min(a.w * a.h, b.w * b.h);
      if (o > .3 * m && m > 40) put('文字重叠', 3 + o / m, `“${a.s}”和“${b.s}”压在一起`, f.t);
    }
    // 文字压物体
    for (const x of main) for (const b of bodies) if (b.kind !== 'board' && onScreen(b, f) && b.r > 3) { const o = inter(x, bodyBox(b)); if (o > .35 * x.w * x.h) put('文字压物体', 3 + o / (x.w * x.h), `“${x.s}”盖住了物体 ${b.id}`, f.t); }
    // 箭头穿过文字
    for (const ar of (f.arrows ?? []).filter((a) => !a.inset)) { const L = Math.hypot(ar.x1 - ar.x0, ar.y1 - ar.y0), n = Math.ceil(L / 4);
      for (const x of main) { const box = { x: x.x + 2, y: x.y + 2, w: x.w - 4, h: x.h - 4 }; let hit = 0; for (let s = 2; s < n - 1; s++) { const px = ar.x0 + (ar.x1 - ar.x0) * s / n, py = ar.y0 + (ar.y1 - ar.y0) * s / n; if (px > box.x && px < box.x + box.w && py > box.y && py < box.y + box.h) hit++; } if (hit >= 2) put('文字压箭头', 2 + hit / 4, `箭头穿过“${x.s}”`, f.t); } }
    // 实际分开、画出来叠在一起的物体
    const pts = bodies.filter((b) => b.kind !== 'board' && onScreen(b, f) && b.r > 0);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y), real = Math.hypot(a.wx - b.wx, a.wy - b.wy), need = (a.size + b.size) / 2;
      if (d < .7 * (a.r + b.r) && real > need * 1.05 + 1e-9 && real > 1e-6 * (Math.abs(a.wx) + Math.abs(a.wy) + 1e-12)) put('物体画重叠', 4 + (1 - d / (a.r + b.r)) * 3, `${a.id} 和 ${b.id} 实际相距 ${real.toPrecision(3)} m，画出来叠在一起`, f.t);
    }
    // 出画面
    if (info.focus) { const b = bodies.find((x) => x.id === info.focus); if (b) { focusN++; const off = !onScreen(b, f, b.kind === 'board' ? b.hw : 0); if (off) { focusOff++; put('所求物体出画面', 6, `所求物体 ${b.id} 在画面外`, f.t); } path.push([b.x, b.y, f.follow]); } }
    for (const b of bodies) if (b.kind !== 'board') { const o = offBy.get(b.id) ?? { off: 0, n: 0, w: [] }; o.n++; if (!onScreen(b, f)) o.off++; o.w.push([b.wx, b.wy, f.t]); offBy.set(b.id, o); }
    // 标签挤不下、被省略、离箭头远
    if (f.forced) put('标签挤不下', 2 + f.forced, `${f.forced} 个标签找不到空位，压在别的东西上`, f.t);
    if (f.dropped) put('次要标签被省略', .5, `${f.dropped} 个次要标签没地方放，没画`, f.t);
    for (const l of (f.labels ?? []).filter((x) => x.tip && !x.inset)) { const cx = Math.min(Math.max(l.tip[0], l.x), l.x + l.w), cy = Math.min(Math.max(l.tip[1], l.y), l.y + l.h), d = Math.hypot(cx - l.tip[0], cy - l.tip[1]); if (d > 45) put('标签离箭头远', 1 + d / 45, `标签离箭头尖 ${Math.round(d)} 像素`, f.t); }
    // 考点
    for (const k of f.keep ?? []) {
      if (k.kind === 'angle' && Math.abs(k.screen - k.real) > .5) put('考点画错', 9, `角 ${k.id} 实际 ${k.real.toFixed(1)}°，画面上 ${k.screen.toFixed(1)}°`, f.t);
      if (k.kind === 'length' && Math.abs(k.screen - k.real) > 1e-6 * Math.max(1, k.real)) put('考点画错', 9, `长度 ${k.id} 实际 ${k.real}，画面按 ${k.screen} 画`, f.t);
      if (!onScreen(k, f)) put('考点不在画面', 5, `考点 ${k.id} 在画面外`, f.t);
    }
    // 浮层
    const ui = f.ui ?? {};
    for (const [name, r] of Object.entries(ui)) {
      if (!r || name === 'sceneLoading') continue;
      for (const b of bodies) if (onScreen(b, f) && b.kind !== 'board') { const o = inter(r, bodyBox(b)); if (o > .3 * bodyBox(b).w * bodyBox(b).h) put('浮层挡住', b.id === info.focus ? 6 : 4, `浮层 ${name} 盖住物体 ${b.id}`, f.t); }
      for (const x of main) if (inter(r, x) > .4 * x.w * x.h) put('浮层挡住', 3, `浮层 ${name} 盖住文字“${x.s}”`, f.t);
    }
    if (f.inset) { for (const b of bodies) if (onScreen(b, f) && b.kind !== 'board' && inter(f.inset, bodyBox(b)) > 0) put('放大窗挡住', b.id === info.focus ? 6 : 4, `放大窗盖住物体 ${b.id}`, f.t); for (const x of main) if (inter(f.inset, x) > .3 * x.w * x.h) put('放大窗挡住', 3, `放大窗盖住文字“${x.s}”`, f.t); }
    if (is2d && f.mode === 'bodies' && !bodies.some((b) => onScreen(b, f, b.hw))) put('空白画面', 7, '画面上一个物体都没有', f.t);
  }
  // 在动的物体大部分时间在画面外
  for (const [bid, o] of offBy) { const moved = o.w.some((p) => Math.hypot(p[0] - o.w[0][0], p[1] - o.w[0][1]) > 1e-9); if (moved && bid !== info.focus && o.off / o.n > .3) put('运动物体出画面', 3 + o.off / o.n * 2, `${bid} 有 ${Math.round(o.off / o.n * 100)}% 的时间在画面外`, o.w[o.w.findIndex((_, i) => true)][2]); }
  // 所求物体在画面上几乎不动
  if (info.focus && path.length > 2 && !path.some((p) => p[2])) { const o = offBy.get(info.focus); const realMove = o ? Math.max(...o.w.map((p) => Math.hypot(p[0] - o.w[0][0], p[1] - o.w[0][1]))) : 0; let px = 0; for (const p of path) px = Math.max(px, Math.hypot(p[0] - path[0][0], p[1] - path[0][1])); if (realMove > 1e-12 && px < 25) put('运动看不出', 4, `${info.focus} 实际移动 ${realMove.toPrecision(3)} m，画面上只动了 ${px.toFixed(0)} 像素`, frames[frames.length - 1].t); }
  // 画面太空：物体和文字的外框占画面的比例
  if (is2d) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const W = frames[0].w, H = frames[0].h;
    for (const f of frames) { for (const b of (f.bodies ?? []).filter((b) => !b.inset && onScreen(b, f))) { const q = bodyBox(b); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); } for (const x of (f.texts ?? []).filter((x) => !x.inset && x.y < H - 30)) { x0 = Math.min(x0, x.x); y0 = Math.min(y0, x.y); x1 = Math.max(x1, x.x + x.w); y1 = Math.max(y1, x.y + x.h); } }
    for (const f of frames) if (f.ink) { x0 = Math.min(x0, f.ink.x); y0 = Math.min(y0, f.ink.y); x1 = Math.max(x1, f.ink.x + f.ink.w); y1 = Math.max(y1, f.ink.y + f.ink.h); }
    if (x1 > x0) { const fill = Math.max((x1 - x0) / W, (y1 - y0) / H); if (fill < .3) put('画面太空', 3 + (1 - fill / .3) * 2, `内容只占画面宽或高的 ${Math.round(fill * 100)}%`, frames[Math.floor(frames.length / 2)].t); } }
  // 考点没画
  if (info.keep?.length && !frames.some((f) => f.keep?.length)) put('考点没画', 6, `这一问标了 ${info.keep.length} 个考点，画面上没画（${is2d ? '二维' : '三维'}）`, frames[0].t);
  // 标签跳动：连续帧里同一个标签相对箭头尖的位置变化
  for (const b of bursts) for (let i = 1; i < b.length; i++) {
    const prev = new Map((b[i - 1].labels ?? []).filter((l) => l.tip).map((l) => [l.s, l]));
    for (const l of (b[i].labels ?? []).filter((l) => l.tip)) { const p = prev.get(l.s); if (!p) continue; const ox = l.ax ?? l.tip[0], oy = l.ay ?? l.tip[1], px = p.ax ?? p.tip[0], py = p.ay ?? p.tip[1], d = Math.hypot((l.x - ox) - (p.x - px), (l.y - oy) - (p.y - py)); if (d > 24) put('标签跳动', 2 + d / 24, `标签“${l.s.split('#')[0].replace(/#?[0-9a-f]{6}$/i, '')}”相对想放的位置跳了 ${Math.round(d)} 像素`, b[i].t); }
  }
  for (const [cat, w] of worst) out.push(issue(cat, w.score, `${w.msg}${w.n > 1 ? `（共 ${w.n} 帧次）` : ''}`, w.t));
  return out;
}

// ================= 随机改数据 =================
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/** 每个数值参数乘 0.6–1.6 之间的随机数（g 和整数个数不动），清掉答案和讲解，只看画面 */
function perturb(base, rnd) {
  const P = structuredClone(base), ps = P.params ?? {}; let n = 0;
  for (const [k, v] of Object.entries(ps)) {
    if (k === 'g' || !Array.isArray(v) || typeof v[0] !== 'number' || v[0] === 0) continue;
    if (/个数|次数|匝数|^n$|^N$/.test(`${k}${v[2] ?? ''}`) && Number.isInteger(v[0])) continue;
    v[0] = +(v[0] * (0.6 + rnd())).toPrecision(3); n++;
  }
  if (!n) return null;
  P.samples = undefined; P.solution = undefined; for (const a of P.asks ?? []) a.answer = undefined;
  return P;
}

// ---------- 浏览器 ----------
const prof = mkdtempSync(join(tmpdir(), 'qa-prof-'));
await assertCanLaunchBrowser();
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, `--window-size=${SIZE.width},${SIZE.height}`, '--use-angle=metal', '--enable-gpu', 'about:blank'], { stdio: 'ignore' });
const dbg = (...a) => { if (process.env.QA_DEBUG) console.error('[dbg]', ...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pend = new Map();
for (let i = 0; i < 80 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p = l.find((x) => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} await sleep(200); }
dbg('ws', !!ws); if (ws.readyState !== 1) await new Promise((r) => ws.onopen = r); dbg('open');
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (js) => { const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); return r.result?.result?.value; };
await send('Emulation.setDeviceMetricsOverride', SIZE);
if (SIZE.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `http://localhost:${arg('--port', '5190')}/?qa` });
async function waitQa() { for (let i = 0; i < 100; i++) { await sleep(200); try { if (await ev('!!window.__qa')) return; } catch {} } }
await waitQa();
const shot = async (file) => { const box = await ev(`(() => { scrollTo(0, 0); const r = document.getElementById('scene').getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, width: r.width, height: r.height }; })()`); const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 }, captureBeyondViewport: true }); writeFileSync(file, Buffer.from(r.result.data, 'base64')); };

// ---------- 留出集：按板块分层，固定种子随机抽三分之一。写规则时不看这些题，只在检验时看 ----------
dbg('qa ready'); const list = await ev('__qa.list()'); dbg('list', list.length);
const splitFile = join(HERE, '留出集.json');
let held;
if (existsSync(splitFile)) held = new Set(JSON.parse(readFileSync(splitFile, 'utf8')).留出);
else {
  const rnd = mulberry(20261109), by = new Map();
  for (const p of list) { if (!by.has(p.topic)) by.set(p.topic, []); by.get(p.topic).push(p.key); }
  held = new Set();
  for (const keys of by.values()) { const a = [...keys].sort(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } a.slice(0, Math.round(a.length / 3)).forEach((k) => held.add(k)); }
  writeFileSync(splitFile, JSON.stringify({ 说明: '画面质检的留出集：找问题、写规则时不看这些题，只在检验规则时看。按板块分层、固定种子随机抽三分之一。', 留出: [...held].sort() }, null, 1));
}

// ---------- 逐题逐问取画面 ----------
const results = [];
// 外部 JSON（--files）：每个子文件夹里的 回复*.json 各算一道题
const extra = [];
if (FILES) {
  const { readdirSync } = await import('node:fs');
  const { extractJson } = await import('../../engine/parse.ts');
  for (const d of readdirSync(FILES).sort()) {
    let fs2 = []; try { fs2 = readdirSync(join(FILES, d)).filter((f) => /^回复.*\.json$/.test(f)).sort(); } catch { continue; }
    for (const f of fs2) { const txt = readFileSync(join(FILES, d, f), 'utf8'); if (!txt.trim()) continue; let P = null; try { P = extractJson(txt); } catch (e) { P = { __bad: String(e.message) }; } extra.push({ key: `${d}/${f}`, title: d, topic: '外部', P }); }
  }
}
const idx = FILES ? extra.map((_, i) => i) : ONLY?.length ? ONLY : list.map((_, i) => i);
const t0 = Date.now();
for (const i of idx) {
  const meta = FILES ? extra[i] : list[i];
  const runs = [{ label: '原题', P: FILES ? meta.P : null }];
  if (FILES && meta.P?.__bad) { results.push({ i, key: meta.key, title: meta.title, topic: meta.topic, held: false, run: '原题', asks: [], issues: [issue('报错', 9, `JSON 提取失败：${meta.P.__bad.slice(0, 140)}`)] }); continue; }
  if (VARIANTS) { const base = await ev(`__qa.problem(${i})`); const rnd = mulberry(1000 + i); for (let v = 0; v < VARIANTS; v++) { const P = perturb(base, rnd); if (P) runs.push({ label: `变体${v + 1}`, P }); } }
  for (const run of runs) {
    const rec = { i, key: meta.key, title: meta.title, topic: meta.topic, held: !FILES && held.has(meta.key), run: run.label, asks: [], issues: [] };
    let opened;
    const openJs = run.P ? `__qa.open(${JSON.stringify(run.P)})` : `__qa.open(${i})`;
    try { opened = await ev(openJs); if (!opened) { await waitQa(); opened = await ev(openJs); } if (!opened) throw new Error('页面没有响应'); }
    catch (e) { rec.issues.push(issue('报错', 9, `打开失败：${String(e.message).slice(0, 160)}`)); results.push(rec); continue; }
    rec.ms = Math.round(opened.ms);
    if (opened.fail) rec.issues.push(issue(run.P && !FILES ? '改数据后算不出' : '报错', run.P && !FILES ? 3 : 9, opened.fail.slice(0, 160)));
    if (opened.unsupported) rec.issues.push(issue('整题不能演示', 1, opened.unsupported.slice(0, 120)));
    if (rec.ms > 8000) rec.issues.push(issue('算得太慢', 2, `${(rec.ms / 1000).toFixed(1)} s`));
    if (opened.fail || opened.unsupported) { results.push(rec); continue; }
    const askIdx = [...(opened.asks.length > 1 ? [-1] : []), ...opened.asks.map((_, k) => k)];
    for (const k of askIdx) {
      const a = k >= 0 ? opened.asks[k] : { id: '全部' };
      const ar = { k, id: a.id, issues: [] };
      if (a.error) ar.issues.push(issue('报错', 8, `这一问引擎出错：${String(a.error).slice(0, 140)}`));
      if ((!run.P || FILES) && a.ok === false) ar.issues.push(issue('和答案对不上', 6, '模拟结果和答案对不上'));
      let info;
      try { info = await ev(`__qa.ask(${k})`); } catch (e) { ar.issues.push(issue('报错', 8, `选这一问时出错：${String(e.message).slice(0, 140)}`)); rec.asks.push(ar); continue; }
      if (!info) { rec.asks.push(ar); continue; }
      if (D3) { const ok = await ev(`__qa.dim('3d')`); if (!ok) { rec.asks.push(ar); continue; } info.dim = '3d'; }
      ar.info = { w0: info.w0, w1: info.w1, dim: info.dim, focus: info.focus };
      // 均匀取 FRAMES 帧，加上讲解步骤和关键时刻；再在三处各取 8 帧连续画面（按实际播放速度，每帧 1/60 s）量标签跳动
      const span = info.w1 - info.w0, ts = new Set();
      for (let f = 0; f < FRAMES; f++) ts.add(info.w0 + span * f / (FRAMES - 1));
      for (const s of info.steps) if (s >= info.w0 && s <= info.w1) ts.add(s);
      if (info.keyT !== null) ts.add(info.keyT);
      const frames = [];
      const errs0 = (await ev('__qa.errors.length')) ?? 0;
      try {
        let fi = 0; for (const t of [...ts].sort((x, y) => x - y)) { const fr = await ev(`__qa.seek(${t})`); if (fr) { if (fi++ % 4 === 0) fr.ink = await ev('__qa.ink()'); frames.push(fr); } }
        const dt = span / 12 / 60, bursts = [];
        for (const c of [.2, .5, .8]) { const b = []; for (let f = 0; f < 8; f++) { const fr = await ev(`__qa.seek(${info.w0 + span * c + f * dt})`); if (fr) b.push(fr); } bursts.push(b); }
        ar.issues.push(...measure(frames, bursts, info));
      } catch (e) { ar.issues.push(issue('报错', 8, `播放时出错：${String(e.message).slice(0, 140)}`)); }
      const errs = await ev(`__qa.errors.slice(${errs0})`);
      if (errs?.length) ar.issues.push(issue('报错', 8, `页面报错：${errs[0].slice(0, 140)}`));
      rec.asks.push(ar);
    }
    results.push(rec);
    const n = rec.issues.length + rec.asks.reduce((s, a) => s + a.issues.length, 0);
    process.stdout.write(`${String(i).padStart(2)} ${run.label} ${meta.key}  ${n ? `${n} 处` : '无问题'}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
}

// ---------- 截图：每类问题挑最严重的几处 ----------
const flat = results.flatMap((r) => [...r.issues.map((x) => ({ r, a: null, x })), ...r.asks.flatMap((a) => a.issues.map((x) => ({ r, a, x })))]);
const picks = [], seen = new Set();
for (const cat of [...new Set(flat.map((f) => f.x.cat))]) {
  const c = flat.filter((f) => f.x.cat === cat && f.a && f.x.t !== undefined && f.r.run === '原题' && !f.r.held).sort((p, q) => q.x.score - p.x.score);
  for (const f of c.slice(0, Math.max(1, Math.round(SHOTS / 6)))) { const key = `${f.r.i}|${f.a.k}`; if (!seen.has(key + cat)) { seen.add(key + cat); picks.push(f); } }
}
for (const [n, f] of picks.slice(0, SHOTS).entries()) {
  try {
    await ev(FILES ? `__qa.open(${JSON.stringify(extra[f.r.i].P)})` : `__qa.open(${f.r.i})`);   // 外部 JSON 按内容重开，不能按题库序号 await ev(`__qa.ask(${f.a.k})`); await ev(`__qa.seek(${f.x.t})`); await sleep(60);
    const file = `${String(n + 1).padStart(2, '0')}-${f.x.cat}-${f.r.key}-${f.a.id}.png`.replace(/[\/\\:]/g, '_');
    await shot(join(OUT, '截图', file)); f.x.shot = file;
  } catch {}
}

ws.close(); chrome.kill(); try { rmSync(prof, { recursive: true, force: true }); } catch {}

// ---------- 报告 ----------
writeFileSync(join(OUT, '数据.json'), JSON.stringify({ size: SIZE, variants: VARIANTS, when: new Date().toISOString(), results }, null, 1));
const cats = [...new Set(flat.map((f) => f.x.cat))].sort((a, b) => flat.filter((f) => f.x.cat === b).length - flat.filter((f) => f.x.cat === a).length);
const asksOf = (filter) => results.filter(filter).reduce((s, r) => s + Math.max(1, r.asks.length), 0);
const cnt = (cat, filter) => new Set(flat.filter((f) => f.x.cat === cat && filter(f.r)).map((f) => `${f.r.i}|${f.r.run}|${f.a?.k ?? 'p'}`)).size;
const dev = (r) => !r.held && r.run === '原题', hold = (r) => r.held && r.run === '原题', vari = (r) => r.run !== '原题';
let md = `# 画面质检报告（${MOBILE ? '手机 390×844' : '电脑 1440×900'}）\n\n生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Singapore' })}（新加坡时间）。题 ${idx.length} 道${VARIANTS ? `，每道另加 ${VARIANTS} 组随机改数据` : ''}。\n\n`;
md += `“问”= 题里的一个小问（多问题另算一个“全部”）。开发集 ${asksOf(dev)} 问，留出集 ${asksOf(hold)} 问${VARIANTS ? `，变体 ${asksOf(vari)} 问` : ''}。\n\n| 问题类型 | 开发集 | 留出集 |${VARIANTS ? ' 变体 |' : ''} 说明 |\n|---|---|---|${VARIANTS ? '---|' : ''}---|\n`;
for (const c of cats) md += `| ${c} | ${cnt(c, dev)} | ${cnt(c, hold)} |${VARIANTS ? ` ${cnt(c, vari)} |` : ''} ${DESC[c] ?? ''} |\n`;
md += `\n## 每道题\n\n`;
for (const r of results) {
  const all = [...r.issues.map((x) => ['', x]), ...r.asks.flatMap((a) => a.issues.map((x) => [a.id, x]))];
  if (!all.length) continue;
  md += `### ${r.held ? '［留出］' : ''}${r.key}${r.run !== '原题' ? ` · ${r.run}` : ''}\n\n`;
  for (const [aid, x] of all) md += `- ${aid ? `(${aid}) ` : ''}**${x.cat}**：${x.msg}${x.t !== undefined ? `（t=${fmt(x.t)}）` : ''}${x.shot ? ` → 截图/${x.shot}` : ''}\n`;
  md += '\n';
}
writeFileSync(join(OUT, '报告.md'), md);
console.log(`\n完成，用时 ${((Date.now() - t0) / 1000).toFixed(0)} s。报告：${join(OUT, '报告.md')}`);
for (const c of cats) console.log(`${c.padEnd(10)} 开发 ${cnt(c, dev)}  留出 ${cnt(c, hold)}${VARIANTS ? `  变体 ${cnt(c, vari)}` : ''}`);

