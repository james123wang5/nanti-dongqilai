// 先启动 npx vite --config 难题/vite.config.js --port 5191
// node 难题/tests/评审验收-第一批.mjs [--port 5191]
// 独立临时 Chrome profile；不访问用户浏览器数据，不修改题库。
import { assertCanLaunchBrowser } from './浏览器守卫.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, formatRepair } from '../engine/validate.ts';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const url = `http://localhost:${arg('--port', '5191')}/?qa`, port = 9700 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), 'first-batch-qa-'));
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
  await ev(() => { window.__clip = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clip = t; }, readText: async () => window.__clip } }); });

  // M1：正常 UI 输入，不通过测试接口绕开解析、保存和替换。
  const bad = structuredClone(base); bad.scene.bodies[0].on = '不存在';
  await click('#addBtn'); await paste(bad);
  await click('#qs .qbtn'); // 第二批默认先读题，进入小问后沿用全部原断言
  check('M1.1 场景坏了仍关弹窗、进入讲解、显示占位引导条', await ev(() => document.getElementById('pasteBox').hidden && document.body.classList.contains('nosim') && !document.getElementById('repairGuide').hidden && document.querySelectorAll('.stepc').length === 4 && document.getElementById('repairGuide').getBoundingClientRect().bottom <= document.getElementById('scene').getBoundingClientRect().top));
  const saved = await mineRows();
  check('M1.1 原始回复和修改提示保存在这道题上', saved.length === 1 && saved[0].original.scene.bodies[0].on === '不存在' && saved[0].repair === formatRepair(validate(bad)));
  await click('#copyRepair');
  await wait(async (expected) => window.__clip === expected, formatRepair(validate(bad)), 5000);
  check('M1.2 剪贴板与旧格式修改提示逐字一致', true);
  await click('#replaceReply'); await paste(base);
  await wait(() => !document.body.classList.contains('nosim') && !document.getElementById('sceneLoading').offsetParent);
  check('M1.3 新回复替换原记录并恢复动画', (await mineRows()).length === 1 && (await mineRows())[0].id === saved[0].id && await ev(() => !document.getElementById('scene').classList.contains('nosim')));
  await click('#addBtn'); await paste('这里没有完整的回复');
  check('M1.4 读不出仍停弹窗且只显示学生文案', await ev(() => !document.getElementById('pasteBox').hidden && document.getElementById('pasteErrorMessage').textContent === '这段回复里没有找到题目的小问。请确认复制的是 AI 的整段回复。'));
  await click('#pasteClose');

  const list = await ev(() => __qa.list());
  const find = (pattern) => { const i = list.findIndex((p) => pattern.test(p.title)); assert.ok(i >= 0, `题目不存在 ${pattern}`); return i; };
  // 无动画样例：2025 山东17 按题图重建前的旧版（方形物体被顶离地面），不依赖题库里留着坏题
  await ev(async (p) => { await __qa.open(p); }, JSON.parse(readFileSync(new URL('./fixtures/无动画-支撑失效.json', import.meta.url), 'utf8'))); await ready();
  await ev(() => __qa.ask(0));
  check('M2.1/B2 没有原始错误或“改条件”，有 3 步和结果且未提前泄露答案', await ev(() => !/单侧支撑|t=0\.32|JSON|你改了条件/.test(document.body.innerText) && document.querySelectorAll('.stepc').length === 4 && document.querySelector('.lesson-note').textContent.includes('AI 给出，未核验') && document.querySelector('.stepc.on').dataset.i === '0' && !document.querySelector('.result-body .ans')));
  for (let i = 1; i <= 3; i++) { await next(); check(`M2.1 下一步到第 ${i + 1} 张卡`, await ev((n) => document.querySelector('.stepc.on').dataset.i === String(n), i)); }
  check('M2.1 最后揭晓结果且题库没有修改按钮', await ev(() => !!document.querySelector('.result-body .ans') && document.getElementById('repairGuide').hidden && !document.querySelector('.result-repair')));
  await click('#prevStep');
  check('M2.1 上一步收起结果', await ev(() => !document.querySelector('.result-body .ans')));

  // 本地生成图片夹具，不依赖外网或题库数据。
  const image = await ev(() => { const cv = document.createElement('canvas'); cv.width = 1000; cv.height = 700; const g = cv.getContext('2d'); g.fillStyle = 'white'; g.fillRect(0, 0, 1000, 700); g.fillStyle = 'black'; g.font = '40px serif'; g.fillText('题目截图', 100, 100); return cv.toDataURL(); });
  const unsupported = { ...base, title: '自编无动画题', scene: { surfaces: [], bodies: [] }, unsupported: '这类场景尚不支持' };
  await click('#addBtn');
  await ev((src) => { const bytes = Uint8Array.from(atob(src.split(',')[1]), (c) => c.charCodeAt(0)); const transfer = new DataTransfer(); transfer.items.add(new File([bytes], '题图.png', { type: 'image/png' })); const input = document.getElementById('imageFile'); input.files = transfer.files; input.dispatchEvent(new Event('change')); }, image);
  await wait(() => !document.getElementById('dropImg').hidden);
  await paste(unsupported); await wait(() => document.querySelector('#lessonImage>img').complete);
  check('M2.2 题图等比居中、留白 24px、可见尺寸足够', await ev(() => {
    const el = document.querySelector('#lessonImage>img'), r = el.getBoundingClientRect(), scene = document.getElementById('scene').getBoundingClientRect(), ratio = el.naturalWidth / el.naturalHeight;
    const w = Math.min(r.width, r.height * ratio), h = w / ratio;
    return Math.abs((r.left + r.right) / 2 - (scene.left + scene.right) / 2) < 1 && Math.abs((r.top + r.bottom) / 2 - (scene.top + scene.bottom) / 2) < 1 && r.left >= scene.left + 23 && r.top >= scene.top + 23 && (w >= scene.width * .5 || h >= scene.height * .7);
  }));
  check('M2.2 AI unsupported 显示统一说明，隐藏播放/图像/改条件', await ev(() => document.getElementById('noAnimationReason').textContent === '这类题目前画不出来' && ['panel', 'play', 'tryBtn', 'chartBtn'].every((id) => document.getElementById(id).offsetParent === null)));
  await ev(() => document.getElementById('lessonImage').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true })));
  check('M2.2 题图滚轮放大', await ev(() => !document.querySelector('#lessonImage>img').style.transform.includes('scale(1)')));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(100);
  check('M2.3 手机题图在上、讲解在下、翻页固定底部', await ev(() => document.querySelector('.stage').getBoundingClientRect().bottom <= document.querySelector('.sheet').getBoundingClientRect().top && getComputedStyle(document.getElementById('caption')).position === 'fixed' && Math.abs(document.getElementById('caption').getBoundingClientRect().bottom - innerHeight) < 2));
  await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 838, deviceScaleFactor: 1, mobile: false });

  await ev((i) => __qa.open(i), find(/2025.*13.*盖玻片/)); await ev(() => __qa.ask(0));
  await ev(() => document.querySelector('.stepc.final').click());
  check('M3.1/B1 对不上是橙色且并列两个值，无绿勾', await ev(() => { const card = document.querySelector('.stepc.final'); return card.classList.contains('final-mismatch') && /答案给的：/.test(card.innerText) && /引擎算出：/.test(card.innerText) && /这一问先别直接信/.test(card.innerText) && !card.innerText.includes('✓') && getComputedStyle(card.querySelector('.result b')).color === 'rgb(201, 113, 26)'; }));
  await ev((i) => __qa.open(i), find(/选择题.*物块滑上传送带/));
  check('M3.2 四个选项都为 AI 灰色虚线圆点，无对错图标', await ev(() => { const dots = [...document.querySelectorAll('#qs .st')]; return dots.length === 4 && dots.every((d) => d.classList.contains('verify-ai') && !/[✓✗]/.test(d.textContent) && getComputedStyle(d).borderStyle === 'dashed'); }));
  await ev(() => __qa.ask(0));
  check('M3.选项 选项结论在最后一步之前不进入页面', await ev(() => !/这个说法正确|这个说法错误/.test(document.getElementById('lesson').textContent)));
  await ev(() => document.querySelector('.stepc.final').click());
  check('M3.选项 结果用“这个说法正确/错误”揭晓', await ev(() => /这个说法正确|这个说法错误/.test(document.querySelector('.result-body').textContent)));

  // 全题库扫描旧文案与首屏总结，避免只查示例题。
  let clean = true, visible = true;
  for (let i = 0; i < list.length; i++) {
    await ev((i) => __qa.open(i), i);
    const state = await ev(() => { scrollTo(0, 0); const r = document.getElementById('verdict').getBoundingClientRect(); return { clean: !/模拟结果和答案一致|按答案演示|AI 判定/.test(document.body.innerText), visible: r.top >= 0 && r.bottom <= innerHeight && r.height > 0 }; });
    clean &&= state.clean; visible &&= state.visible;
  }
  check('M3.3 全库界面无旧核验文案', clean);
  check('M3.4 全库 1512×838 不滚动可见总结', visible);
  check('浏览器运行无脚本错误', await ev(() => __qa.errors.length === 0));
  console.log(`第一批浏览器验收：${passed}/${passed} 通过`);
} finally {
  ws?.close(); chrome.kill();
  if (chrome.exitCode === null && !chrome.signalCode) await Promise.race([new Promise((r) => chrome.once('exit', r)), sleep(2000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
