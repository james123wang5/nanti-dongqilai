// 先启动 npx vite --config 难题/vite.config.js --port 5191
// node 难题/tests/评审验收-反馈修正.mjs [--port 5191]
// 独立临时 Chrome profile；不访问用户浏览器数据，不修改题库。
import { assertCanLaunchBrowser } from './浏览器守卫.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
await assertCanLaunchBrowser();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const url = `http://localhost:${arg('--port', '5191')}/?qa`, port = 9700 + Math.floor(Math.random() * 200);
const out = arg('--out', '/private/tmp/claude-501/-Volumes-Lexar----------------/9e6d56c4-2a80-42a1-8de6-2db2f82a78e0/scratchpad/shots'); mkdirSync(out, { recursive: true });
const metrics = [];
const profile = mkdtempSync(join(tmpdir(), 'feedback-qa-'));
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

  const list = await ev(() => __qa.list());
  const find = (re) => { const i=list.findIndex((p)=>re.test(p.title)); assert.ok(i>=0,`找不到 ${re}`); return i; };
  const open = (i) => ev((i)=>__qa.open(i),i);
  const ask = (i) => ev((i)=>__qa.ask(i),i);
  const flag = (name,on) => ev(({name,on})=>{const el=document.getElementById(`${name}Toggle`);el.checked=on;el.dispatchEvent(new Event('change'));},{name,on});
  const seek = (t) => ev((t)=>__qa.seek(t),t);
  const dimensions = (width,height) => send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  const ready = () => wait(() => document.body.dataset.state === 'ready');
  await dimensions(1440, 860);
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); writeFileSync(join(out, name + '.jpg'), Buffer.from(r.data, 'base64')); };
  await flag('force', true);
  for (const [re, k, name, pick] of [[/实验舱/,0,'实验舱'],[/板块示例/,1,'板块'],[/2024 山东卷 17/,1,'山东17'],[/2025 山东卷 17/,-1,'山东2025-17'],[/2025.*湖北.*15/,0,'湖北15-板','板'],[/2024.*浙江.*20/,0,'浙江20'],[/2025.*湖北.*15/,0,'湖北15'],[/圆锥摆/,0,'圆锥摆']]) {
    await open(find(re)); await ready(); await ask(k); await ready(); await ev((p)=>__qa.pick(p ?? null), pick); const st = await ev(()=>__qa.state()); await seek(st.w0 + (st.w1-st.w0)*.4); await sleep(400); await shot(name);
  }
  await open(find(/板块示例/)); await ready(); await ask(0); await ready(); await ev(()=>document.getElementById('dimToggle').click()); await sleep(3000); await shot('板块-立体');
  // 立体拖动：往上、往下各猛拖一大段，画面都不应翻倒
  const drag = async (dy) => { const r = await ev(()=>{const c=document.querySelector('#scene canvas:not(.force-layer)');const b=document.getElementById('scene').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/3};});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',clickCount:1});
    for (let k=1;k<=12;k++) await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+k*15,y:r.y+dy*k/12,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+180,y:r.y+dy,button:'left',clickCount:1}); await sleep(1200); };
  await drag(600); await shot('立体-往下拖'); await drag(-1200); await shot('立体-往上拖');
  console.log('截图完成', out);
} catch (e) { console.error(e); process.exitCode = 1; } finally { try { ws?.close(); } catch {} chrome.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
