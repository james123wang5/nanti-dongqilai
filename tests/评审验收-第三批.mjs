// 先启动 npx vite --config 难题/vite.config.js --port 5191
// node 难题/tests/评审验收-第三批.mjs [--port 5191]
// 独立临时 Chrome profile；不访问用户浏览器数据，不修改题库。
import { assertCanLaunchBrowser } from './浏览器守卫.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, formatRepair } from '../engine/validate.ts';
import { unreadableRepair, thirdAdvice } from '../player/paste-state.ts';
await assertCanLaunchBrowser();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const url = `http://localhost:${arg('--port', '5191')}/?qa`, port = 9700 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), 'third-batch-qa-'));
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

  // 本脚本仅由普通终端执行；沙盒不要运行，即使已有守卫。
  const submit = (value) => ev((text) => { document.getElementById('pasteText').value = text; document.getElementById('pasteRun').click(); }, typeof value === 'string' ? value : JSON.stringify(value));
  const accepted = () => wait(() => document.getElementById('pasteBox').hidden && document.body.dataset.state === 'ready');
  const footerVisible = () => ev(() => {
    const button = document.getElementById('pasteRun'), r = button.getBoundingClientRect(), dialog = document.querySelector('.paste-dialog').getBoundingClientRect(), footer = button.closest('footer').getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.top >= footer.top && r.bottom <= footer.bottom && footer.bottom <= dialog.bottom + 1;
  });
  const copiedText = (text) => wait((text) => window.__clip === text, text, 5000);
  const prompts = JSON.parse(readFileSync(new URL('../prompt/提示词.json', import.meta.url), 'utf8'));
  await click('#addBtn');
  check('M13.3 题图是三步流程的第一步，建议添加并允许跳过', await ev(() => { const li = document.querySelectorAll('.paste-body .steps>li'); return li.length === 3 && li[0].querySelector('b').textContent === '放上题目截图' && !!li[0].querySelector('#imageFile') && /建议放，看讲解时能对照/.test(li[0].textContent) && /跳过/.test(li[0].textContent); }));
  check('M13 板块桌面分两行，常见6项在前、其余7项字号更小', await ev(() => {
    const rows = [...document.querySelectorAll('.topic-row')], keys = [...rows[0].querySelectorAll('button')].map((b) => b.dataset.t);
    return rows.length === 2 && JSON.stringify(keys) === JSON.stringify(['力学', '带电粒子', '电磁感应', '电路', '热学', '光学']) && rows[1].querySelectorAll('button').length === 7 && parseFloat(getComputedStyle(rows[1].querySelector('.topic-name')).fontSize) < parseFloat(getComputedStyle(rows[0].querySelector('.topic-name')).fontSize) && [...document.querySelectorAll('.topic-example')].every((s) => !!s.textContent.trim() && getComputedStyle(s).fontSize === '11px');
  }));
  await click('[data-t="运动方程"]'); await click('#copyPrompt'); await copiedText(prompts.运动方程);
  check('M13 所选板块复制原提示词正文，举例没有混入提示词', true);

  const invalid = { asks: [] };
  for (let n = 1; n <= 3; n++) {
    await submit(invalid); await copiedText(unreadableRepair);
    check(`M13.2 连续读不出时计为第${n}次，停在弹窗`, await ev((n) => !document.getElementById('pasteBox').hidden && document.getElementById('pasteAttempt').textContent === `第 ${n} 次`, n));
    check(`M13.1 第${n}次报错后桌面主按钮仍完整可见`, await footerVisible());
  }
  check('M13.2 第三次显示换AI或先看讲解的建议', await ev((text) => document.getElementById('pasteLimit').textContent === text, thirdAdvice));
  check('没有可读内容的新题不显示空的“先看讲解”入口', await ev(() => !document.getElementById('pasteLesson')));
  check('错误区在文本框正上方，橙色底，原始修改提示默认折叠', await ev(() => { const box = document.getElementById('pasteErr'), input = document.getElementById('pasteText'); return box.nextElementSibling === input && box.getBoundingClientRect().top < input.getBoundingClientRect().top && getComputedStyle(box).backgroundColor === 'rgb(252, 242, 226)' && !document.getElementById('pasteRepairDetails').open && document.getElementById('pasteNext').textContent.includes('修改提示已复制'); }));
  check('旧内容已全选，明确提示新回复替换旧内容', await ev(() => { const input = document.getElementById('pasteText'); return input.selectionStart === 0 && input.selectionEnd === input.value.length && input.placeholder.includes('替换原来的内容'); }));
  await click('#pasteRepairDetails summary');
  check('展开“看看哪里错了”能看到逐字相同的修改提示', await ev((text) => document.querySelector('#pasteRepairDetails pre').textContent === text && document.getElementById('pasteRepairDetails').open, unreadableRepair));
  for (const mobile of [false, true]) {
    if (mobile) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await ev(() => { document.getElementById('pasteText').style.height = '1000px'; document.getElementById('pasteBody').scrollTop = 0; });
    check(`M13.1 ${mobile ? '手机' : '桌面'}长内容顶部仍能看到主按钮`, await footerVisible());
    await ev(() => { const body = document.getElementById('pasteBody'); body.scrollTop = body.scrollHeight; });
    check(`M13.1 ${mobile ? '手机' : '桌面'}长内容底部仍能看到主按钮`, await footerVisible());
  }
  await ev(() => { document.getElementById('pasteText').style.height = ''; });
  await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 838, deviceScaleFactor: 1, mobile: false });
  await click('#pasteClose'); await click('#addBtn');
  check('未完成的新题关闭重开不丢计数和第三次建议', await ev(() => document.getElementById('pasteAttempt').textContent === '第 3 次' && !!document.getElementById('pasteLimit')));
  await click('#pasteNew');
  check('明确重新放一道题才重置未保存草稿的计数', await ev(() => document.getElementById('pasteErr').hidden && !document.getElementById('pasteText').value));

  const image = await ev(() => { const cv = document.createElement('canvas'); cv.width = 1000; cv.height = 700; const g = cv.getContext('2d'); g.fillStyle = 'white'; g.fillRect(0, 0, 1000, 700); g.fillStyle = 'black'; g.font = '40px serif'; g.fillText('题目截图', 100, 100); return cv.toDataURL(); });
  await ev((src) => { const bytes = Uint8Array.from(atob(src.split(',')[1]), (c) => c.charCodeAt(0)); const files = new DataTransfer(); files.items.add(new File([bytes], '题图.png', { type: 'image/png' })); const input = document.getElementById('imageFile'); input.files = files.files; input.dispatchEvent(new Event('change')); }, image);
  await wait(() => !document.getElementById('dropImg').hidden);
  const bad = structuredClone(base); bad.scene.bodies[0].on = '不存在';
  await submit(bad); await accepted(); await copiedText(formatRepair(validate(bad)));
  let saved = (await mineRows())[0], id = saved.id;
  check('M1 保持：场景有错仍自动关闭弹窗、进入讲解并保留截图', saved.attempts === 1 && saved.image === image && await ev(() => document.body.classList.contains('nosim') && !document.getElementById('repairGuide').hidden));
  for (let n = 2; n <= 3; n++) {
    await click('#replaceReply'); await submit(bad); await accepted();
    const rows = await mineRows();
    check(`M13.2 同题替换累计第${n}次，记录仍只有一道`, rows.length === 1 && rows[0].id === id && rows[0].attempts === n && await ev((n) => document.getElementById('repairAttemptNotice').textContent.startsWith(`第 ${n} 次`), n));
  }
  check('第三次场景错误在舞台占位引导条给建议', await ev((text) => document.getElementById('repairAttemptNotice').textContent.includes(text) && document.getElementById('repairGuide').getBoundingClientRect().bottom <= document.getElementById('scene').getBoundingClientRect().top, thirdAdvice));
  await click('#replaceReply');
  check('第三次场景错误重新打开弹窗仍有同一句建议及旧讲解入口', await ev((text) => document.getElementById('pasteLimit').textContent === text && !!document.getElementById('pasteLesson'), thirdAdvice));
  await click('#pasteClose');

  await ev(() => { window.__beforeReload = 1; }); await send('Page.reload'); await wait(() => !window.__beforeReload && !!window.__qa);
  await ev(() => { window.__clip = '保留原剪贴板'; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clip = t; }, readText: async () => window.__clip } }); });
  await mineRows(); await click('#libBtn');
  await ev((id) => document.querySelector(`[data-v="m:${id}"]`).click(), id); await ready();
  check('刷新后原记录保留第3次计数、建议和截图', (await mineRows())[0].attempts === 3 && (await mineRows())[0].image === image && await ev((text) => document.getElementById('repairAttemptNotice').textContent.includes(text) && window.__clip === '保留原剪贴板', thirdAdvice));
  await click('#replaceReply'); await click('#pasteLesson');
  check('已有可读题的“先看讲解”直接进入上次讲解', await ev(() => document.getElementById('pasteBox').hidden && __qa.state().view === 0 && document.querySelectorAll('.stepc').length === 4));
  await click('#replaceReply'); await submit('新回复没有完整的小问'); await copiedText(unreadableRepair);
  check('第4次新回复读不出时留弹窗，旧题和计数仍保留', (await mineRows())[0].id === id && (await mineRows())[0].attempts === 4 && await ev(() => !document.getElementById('pasteBox').hidden && document.getElementById('pasteAttempt').textContent === '第 4 次' && !!document.getElementById('pasteLesson')));
  await click('#pasteLesson');
  check('读不出的新回复可以退回旧讲解，引导条说明是上一份', await ev(() => __qa.state().view === 0 && document.getElementById('repairGuide').textContent.includes('上一次的讲解可以继续看')));
  await click('#replaceReply'); await submit(base); await accepted();
  const rows = await mineRows();
  check('正确替换继续累计第5次，恢复动画、清除失败建议，保留同一id和图片', rows.length === 1 && rows[0].id === id && rows[0].attempts === 5 && rows[0].image === image && !rows[0].lastPasteIssue && await ev(() => !document.body.classList.contains('nosim') && document.getElementById('repairGuide').hidden));

  const unsupported = { ...base, title: '自编无动画题', scene: { surfaces: [], bodies: [] }, unsupported: '暂不支持这种模型' };
  await click('#addBtn'); await submit(unsupported); await accepted();
  for (let n = 2; n <= 3; n++) { await click('#replaceReply'); await submit(unsupported); await accepted(); }
  const own = (await mineRows()).find((m) => m.name === unsupported.title);
  check('unsupported 不停弹窗，同题第三次也给建议', own.attempts === 3 && own.lastPasteIssue.kind === 'unsupported' && await ev((text) => document.getElementById('repairAttemptNotice').textContent.includes(text), thirdAdvice));
  check('新题计数独立，不改另一道题的5次记录', (await mineRows()).find((m) => m.id === id).attempts === 5);
  await click('#replaceReply');
  check('当前问题计数和建议在弹窗同步', await ev((text) => document.getElementById('pasteAttempt').textContent === '第 3 次' && document.getElementById('pasteLimit').textContent === text, thirdAdvice));
  check('页面运行无脚本错误', await ev(() => __qa.errors.length === 0));
  console.log(`第三批浏览器验收：${passed}/${passed} 通过`);
} finally {
  ws?.close(); chrome.kill();
  if (chrome.exitCode === null && !chrome.signalCode) await Promise.race([new Promise((r) => chrome.once('exit', r)), sleep(2000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
