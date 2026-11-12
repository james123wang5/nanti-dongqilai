// 先启动 npx vite --config 难题/vite.config.js --port 5191
// node 难题/tests/评审验收-第二批.mjs [--port 5191]
// 独立临时 Chrome profile；不访问用户浏览器数据，不修改题库。
import { assertCanLaunchBrowser } from './浏览器守卫.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, formatRepair } from '../engine/validate.ts';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const url = `http://localhost:${arg('--port', '5191')}/?qa`, port = 9700 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), 'second-batch-qa-'));
await assertCanLaunchBrowser();
const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=metal', '--enable-gpu', 'about:blank'], { stdio: 'ignore' });
let launchError, ws, seq = 0, passed = 0; const pending = new Map();
chrome.on('error', (e) => { launchError = e; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, 130000);
  pending.set(id, (data) => { clearTimeout(timer); data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (fn, data) => {
  const r = await send('Runtime.evaluate', { expression: typeof fn === 'string' ? fn : `(${fn})(${JSON.stringify(data) ?? ''})`, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
async function wait(fn, data, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { if (await ev(fn, data)) return; } catch {} await sleep(50); }   // 页面刷新的瞬间执行环境会被销毁，重试即可
  throw new Error(`等待失败：${fn}`);
}
const ready = () => wait(() => document.body.dataset.state === 'ready');
const click = (selector) => ev((s) => { const el = document.querySelector(s); if (!el || el.hidden || el.disabled) throw new Error(`按钮不可用 ${s}`); el.click(); }, selector);
const next = () => click('#nextStep');
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log(`通过 ${name}`); };
const paste = async (p) => { await ev((s) => { document.getElementById('pasteText').value = s; document.getElementById('pasteRun').click(); }, typeof p === 'string' ? p : JSON.stringify(p)); await ready(); };
const mineRows = () => ev(async () => { const { allMine } = await import('./cache.ts'); return allMine(); });
const base = {
  title: '自编匀速题', stem: '物体以 2 m/s 匀速运动，求 1 s 时的位置。', params: { v0: 2 },
  scene: { surfaces: [{ id: '地', kind: 'ground', y: 0 }], bodies: [{ id: 'A', m: 1, on: '地', v: 'v0' }], tMax: 1 },
  asks: [{ id: '1', text: '求位置', expr: 'x(A)', at: { event: 'time', t: 1 }, answer: 2 }],
  solution: { '1': [{ say: '先看运动状态', tex: 'v=2' }, { say: '位移等于速度乘时间', tex: 'x=vt' }, { say: '代入题中数据', tex: 'x=2' }] },
};
try {
  for (let i = 0; i < 80 && !ws; i++) {
    if (launchError || chrome.exitCode !== null || chrome.signalCode) break;
    try { const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const page = pages.find((p) => p.type === 'page'); if (page) ws = new WebSocket(page.webSocketDebuggerUrl); } catch {}
    if (!ws) await sleep(200);
  }
  if (!ws) throw new Error(`无界面 Chrome 无法启动（${launchError?.message ?? chrome.signalCode ?? chrome.exitCode ?? '连接超时'}）。请检查当前环境是否允许启动浏览器及监听本地端口。`);
  if (ws.readyState !== 1) await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 838, deviceScaleFactor: 1, mobile: false });
  await send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Page.navigate', { url });
  await wait(() => !!window.__qa);
  // “先预测再看”默认关；这里验的是打开它之后的流程
  await ev(() => localStorage.setItem('nanti-predict', '1')); await ev(() => { window.__beforeReload = 1; }); await send('Page.reload'); await wait(() => !window.__beforeReload && !!window.__qa);
  await ev(() => { window.__clip = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clip = t; }, readText: async () => window.__clip } }); });

  const list = await ev(() => __qa.list());
  const find = (pattern) => { const i = list.findIndex((p) => pattern.test(p.title)); assert.ok(i >= 0, `题目不存在 ${pattern}`); return i; };
  const visible = (selector) => ev((s) => { const el = document.querySelector(s); if (!el || !el.offsetParent) return false; const r = el.getBoundingClientRect(), footer = document.getElementById('caption').getBoundingClientRect(); return r.top >= 0 && r.bottom <= footer.top + 1; }, selector);
  const open = (i) => ev((i) => __qa.open(i), i);

  // 每一道题开题后三秒检查；包括没有动画的题。约需四分钟。
  let idle = true, paper = true;
  for (let i = 0; i < list.length; i++) {
    await open(i); await sleep(3100);
    const result = await ev(() => ({ state: __qa.state(), label: document.getElementById('play').getAttribute('aria-label'), paper: document.body.dataset.view === 'paper' && !document.getElementById('paper').hidden }));
    idle &&= result.state.t === 0 && !result.state.playing && result.label === '播放';
    paper &&= result.paper;
  }
  check('M4.1 全库开题三秒后仍 t=0、播放键为播放，默认题目页', idle && paper);

  await open(find(/板块示例/));
  check('M4 开题主按钮是“看整个过程”', await ev(() => document.getElementById('nextStep').textContent === '看整个过程'));
  await click('#nextStep');
  check('M4 主按钮进入全过程并播放', await ev(() => __qa.state().view === -1 && __qa.state().playing));
  await click('#play'); // 暂停，检查过程地图文字
  check('M4.2 板块每行不超过30字，没有力/加速度数值及长小数', await ev(() => { const lines = [...document.querySelectorAll('.process-map .stepc>div')].map((el) => { const c = el.cloneNode(true); c.querySelectorAll('.katex-mathml').forEach((m) => m.remove()); return c.textContent; }); return lines.length > 2 && lines.every((s) => [...s].length <= 30 && !/3 N|0\.5 m\/s²|0\.6667|\d\s*N\b|加速度约/.test(s)); }));
  check('M4.2 共速速度使用分数', await ev(() => document.querySelector('.process-map').textContent.includes('2/3')));

  await open(find(/2026.*13.*实验舱/)); await click('#nextStep');
  check('M4.3/B5 实验舱有加速上升、减速上升，无离塔或空中阶段', await ev(() => { const state = __qa.state(), text = state.map.map((s) => s.say).join(' '); return state.phases.some((p) => p.label.includes('加速上升')) && state.phases.some((p) => p.label.includes('减速上升')) && !/离开塔|在空中运动/.test(text) && Math.abs(state.w1 - 3.675) < 1e-5; }));
  // 真正播放到结束（2倍速度），检查 tick 的完成转移，不以 seek 代替播放结束。
  await ev((rate)=>{ const b=document.getElementById("speedBtn"); for(let i=0;i<3&&b.dataset.speed!==rate;i++)b.click(); if(b.dataset.speed!==rate)throw new Error("速度档位切换失败"); },"2");
  await wait(() => !__qa.state().playing && __qa.state().t >= __qa.state().w1 - 1e-9, undefined, 30000);
  check('M4.3 实验舱结束仍在塔上、接近最高点', await ev(() => { const frame = __qa.seek(__qa.state().w1), body = frame.bodies.find((b) => b.id === '舱'); return body && Math.abs(body.wy - 43.75) < .5; }));
  check('M4 播完主按钮转为“看第 (1) 问”', await ev(() => document.getElementById('nextStep').textContent.includes('看第 (1) 问')));
  await click('#nextStep'); check('M4 播完后按钮进入第一问', await ev(() => __qa.state().view === 0));
  await ev((rate)=>{ const b=document.getElementById("speedBtn"); for(let i=0;i<3&&b.dataset.speed!==rate;i++)b.click(); if(b.dataset.speed!==rate)throw new Error("速度档位切换失败"); },"1");

  await open(find(/板块示例/));
  await click('#qs .qbtn'); await click('.predict .opt[data-k="2"]');
  await click('.reveal-prediction'); // 第五批：先揭晓，才进入原有步骤版面验收；所有判断不变。
  await click('.stepc[data-i="0"]'); await sleep(550);
  const boardLayout = await ev(() => {
    const cards = [...document.querySelectorAll('.stepc')], first = cards[0].getBoundingClientRect(), last = cards.at(-1).getBoundingClientRect(), footer = document.getElementById('caption').getBoundingClientRect();
    return { first: first.top, last: last.bottom, footer: footer.top, count: cards.length, scroll: document.getElementById('sheetScroll').scrollTop, sheet: document.querySelector('.sheet').getBoundingClientRect().width };
  });
  check('M5 左栏桌面宽度是 clamp(400px,36vw,540px)', Math.abs(boardLayout.sheet - 540) < 1);
  check('M5.1 板块第一步顶部不超过300px，全部原有步骤和结果首屏可见', boardLayout.first <= 300 && boardLayout.last <= boardLayout.footer + 1 && boardLayout.count === 4 && boardLayout.scroll === 0);
  check('M5 小问下只有40px题干折叠条，关键卡隐藏', await ev(() => document.getElementById('paper').hidden && Math.abs(document.getElementById('paperToggle').getBoundingClientRect().height - 40) < 1 && document.getElementById('idea').hidden));
  await click('#paperToggle');
  check('M5 展开完整题干限制在左栏45%，内部可滚动', await ev(() => { const box = document.getElementById('paper'), max = document.querySelector('.sheet').clientHeight * .45; return !box.hidden && box.getBoundingClientRect().height <= max + 1 && getComputedStyle(box).overflowY === 'auto'; }));
  await click('#paperToggle');
  check('M5 再点收起题干', await ev(() => document.getElementById('paper').hidden));

  await open(find(/2024.*13.*差压阀/)); await click('#allBtn');
  check('M5.2 差压阀全过程第一步不滚动可见，关键卡可见', await visible('.process-map .stepc') && await ev(() => document.getElementById('sheetScroll').scrollTop === 0 && !document.getElementById('idea').hidden));
  await open(find(/2025.*陕晋宁青.*6/));
  await ev(() => { [...document.querySelectorAll('#qs .qbtn')].find((b) => b.textContent.startsWith('B')).click(); });
  await sleep(550);
  check('M5.3 选项B首步式子完整显示，无横向裁切', await ev(() => { const display = document.querySelector('.stepc.on .katex-display'); return display && display.scrollWidth <= display.clientWidth + 1 && +display.dataset.scale >= .8; }));

  // 使用自编题验证完整小问原文没有被 showPaper 截断，以及每种页签的题干入口。
  const fullStem = '先读完整题干。\n(1) 第一问原文必须保留。\n(2) 第二问原文也必须保留。';
  await ev((p) => __qa.open(p), { ...base, stem: fullStem });
  for (const tab of ['#paperBtn', '#allBtn', '#qs .qbtn']) {
    await click(tab);
    if (tab !== '#paperBtn') await click('#paperToggle');
    check(`M5.4 ${tab} 两次点击内看到完整题干`, await ev(() => !document.getElementById('paper').hidden && document.getElementById('stem').textContent.includes('第二问原文也必须保留')));
  }
  await click('#paperBtn');
  check('M5 题目页显示来源、完整题干且已知条件默认展开', await ev(() => !document.getElementById('paper').hidden && !!document.getElementById('source').textContent && document.getElementById('knownBox').open));

  const long = { ...base, solution: { '1': [{ say: '把各项放在同一行。', tex: Array(22).fill('a^2+b^2').join('+') }] } };
  await ev((p) => __qa.open(p), long); await click('#qs .qbtn'); await sleep(550);
  check('M5 超宽式子至少80%，仍超宽时可滚动且有16px渐隐', await ev(() => { const d = document.querySelector('.stepc.on .katex-display'); const ok = +d.dataset.scale >= .8 && +d.dataset.scale <= 1 && d.scrollWidth > d.clientWidth && d.classList.contains('formula-overflow') && getComputedStyle(d).overflowX === 'auto' && getComputedStyle(d).maskImage !== 'none'; d.scrollLeft = d.scrollWidth; return ok; }));
  await sleep(100);
  check('M5 式子滚动到右侧时最后部分可读，渐隐消失', await ev(() => { const d = document.querySelector('.stepc.on .katex-display'); return d.classList.contains('formula-at-end') && getComputedStyle(d).maskImage === 'none'; }));
  check('B6 句末标点和末字共用不换行容器', await ev(() => [...document.querySelectorAll('.keep-punctuation')].some((el) => el.textContent.endsWith('。') && getComputedStyle(el).whiteSpace === 'nowrap')));

  await ev((p) => __qa.open(p), { ...base, story: ['自写匀速过程'] }); await click('#allBtn');
  check('story 与一段对应时使用AI过程文字', await ev(() => document.querySelector('.process-map').textContent.includes('自写匀速过程') && !document.querySelector('.story-intro')));
  await ev((p) => __qa.open(p), { ...base, story: ['第一段', '第二段'] }); await click('#allBtn');
  check('story 数量不匹配时整体列在分段上方', await ev(() => document.querySelector('.story-intro').textContent.includes('第二段') && !!document.querySelector('.process-map')));
  await ev((p) => __qa.open(p), { ...base, story: '类型不合适' }); await click('#allBtn');
  check('story 类型不对只出现一条轻提示，不阻断动画和讲解', await ev(() => document.querySelectorAll('.story-hint').length === 1 && !document.body.classList.contains('nosim') && !!document.querySelector('.process-map')));

  await ev((p) => __qa.open(p), { ...base, unsupported: '暂不支持', scene: { surfaces: [], bodies: [] } });
  check('无动画题默认也进入题目页', await ev(() => __qa.state().view === -2 && !document.getElementById('paper').hidden));
  await click('#nextStep'); await click('#paperToggle');
  check('无动画题也有新折叠条和逐步讲解', await ev(() => __qa.state().view === 0 && !document.getElementById('paper').hidden && document.querySelectorAll('.stepc').length > 0));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(100);
  check('手机无横向溢出、舞台在上、翻页仍固定底部', await ev(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('.stage').getBoundingClientRect().bottom <= document.querySelector('.sheet').getBoundingClientRect().top && getComputedStyle(document.getElementById('caption')).position === 'fixed'));
  check('浏览器运行无脚本错误', await ev(() => __qa.errors.length === 0));
  console.log(`第二批浏览器验收：${passed}/${passed} 通过`);
} finally {
  ws?.close(); chrome.kill();
  if (chrome.exitCode === null && !chrome.signalCode) await Promise.race([new Promise((r) => chrome.once('exit', r)), sleep(2000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
