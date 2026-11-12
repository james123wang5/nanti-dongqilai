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
const out = arg('--out', '/tmp/feedback-browser'); mkdirSync(out, { recursive: true });
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
  // 1. 默认设置：先预测关、放大镜关
  const board = find(/板块示例/);
  await open(board); await ready(); await ask(0); await ready();
  check('先预测默认关：板块示例(1)直接进讲解，没有预测框', await ev(()=>!document.querySelector('.predict') && !document.getElementById('predictToggle').checked && !document.getElementById('predictChip').hidden));
  await flag('predict', true); await ready(); let shown = true; try { await wait(()=>!!document.querySelector('.predict .opt'), undefined, 5000); } catch { shown = false; }
  check('打开先预测后出现预测选项', shown);
  await flag('predict', false); await ready();
  // 1b. 先预测开关一直在，没有预测题的小问变灰
  { let none = -1; for (const [i] of list.entries()) { await open(i); await ready(); await ask(0); await ready(); if (await ev(()=>document.getElementById('predictToggle').disabled)) { none = i; break; } }
    check('先预测开关一直显示，没有预测题的小问变灰不能点', none>=0 && await ev(()=>{const c=document.getElementById('predictChip');return !c.hidden&&c.offsetParent!==null&&c.classList.contains('off')&&document.getElementById('predictToggle').disabled;})); }
  await open(board); await ready(); await ask(0); await ready();
  check('有预测题的小问开关可点', await ev(()=>!document.getElementById('predictToggle').disabled && !document.getElementById('predictChip').classList.contains('off')));
  // 1c. 立体开关：平面题默认关、能打开再关上
  check('平面题立体开关可见且默认关', await ev(()=>{const b=document.getElementById('dimToggle');return !b.hidden&&b.offsetParent!==null&&b.getAttribute('aria-pressed')==='false';}));
  await ev(()=>document.getElementById('dimToggle').click()); try { await wait(()=>document.getElementById('scene').dataset.mode==='d3', undefined, 20000); } catch {}
  check('点开关切到立体', await ev(()=>document.getElementById('scene').dataset.mode==='d3'&&document.getElementById('dimToggle').getAttribute('aria-pressed')==='true'));
  await ev(()=>document.getElementById('dimToggle').click()); await sleep(300);
  check('再点回到平面', await ev(()=>document.getElementById('scene').dataset.mode==='d2'));
  check('放大镜默认关', await ev(()=>!document.getElementById('insetToggle').checked));
  // 2. 物体大小不随受力开关变化
  await ask(0); await ready(); let st = await ev(()=>__qa.state()); const mid = (st.w0+st.w1)/2;
  const r0 = (await seek(mid)).bodies.map(b=>[b.id,Math.round(b.hw),Math.round(b.hh)]);
  await flag('force', true); const r1 = (await seek(mid)).bodies.map(b=>[b.id,Math.round(b.hw),Math.round(b.hh)]);
  await ev(()=>__qa.pick('A')); const r2 = (await seek(mid)).bodies.map(b=>[b.id,Math.round(b.hw),Math.round(b.hh)]); await ev(()=>__qa.pick(null));
  check('打开受力、点选物体时物体画的大小不变', JSON.stringify(r0)===JSON.stringify(r1) && JSON.stringify(r1)===JSON.stringify(r2));
  // 3. 全库：受力箭头箭尾都在受力物体上；打开受力只画所求物体（加上这一步讲解点名的）；“固定”物体不画
  let bad = [], extra = [], anchors = [];
  for (const [i, p] of list.entries()) {
    await open(i); await ready(); const info = await ask(0); await ready(); if (!info || !info.steps) continue;
    for (const T of [info.w0, (info.w0+info.w1)/2]) {
      const f = await seek(T); if (!f?.forceArrows || !f.bodies) continue;
      if (f.mode !== '3d') for (const a of f.forceArrows.filter(a=>a.magnitude)) { const b = f.bodies.find(b=>b.id===a.body&&!b.inset); if (!b || Math.hypot(a.x0-b.x, a.y0-b.y) > 1) bad.push(`${p.title.slice(0,14)} ${a.body} ${a.label}`); }
      if (f.forceArrows.some(a=>/\d{8,}/.test(a.label))) anchors.push(p.title.slice(0,14));
      const st2 = await ev(()=>__qa.state()), owners = new Set(f.forceArrows.map(a=>a.body));
      if (owners.size > 1 && !st2.map.some(()=>true)) extra.push(p.title.slice(0,14));
    }
  }
  // 3b. 所求框不压受力箭头（框是网页浮层，量它在画布坐标里的位置）；同向的力共用一条线
  let covered = [], lanes = [];
  for (const [i, p] of list.entries()) {
    await open(i); await ready(); const info = await ask(0); await ready(); if (!info || !info.steps || info.dim === '3d') continue;
    const f = await seek(info.keyT ?? info.w1); if (!f?.forceArrows) continue;
    const box = await ev(()=>{const c=document.getElementById('callout'),s=document.querySelector('#scene canvas'); if(!c||c.hidden||!s) return null; const a=c.getBoundingClientRect(),b=s.getBoundingClientRect(); return {x:a.x-b.x,y:a.y-b.y,w:a.width,h:a.height};});
    if (box) for (const a of f.forceArrows.filter(a=>a.magnitude)) for (let k=0;k<=10;k++) { const x=a.x0+(a.x1-a.x0)*k/10, y=a.y0+(a.y1-a.y0)*k/10; if (x>box.x+2&&x<box.x+box.w-2&&y>box.y+2&&y<box.y+box.h-2) { covered.push(`${p.title.slice(0,14)} ${a.label}`); break; } }
    for (const a of f.forceArrows.filter(a=>a.magnitude)) for (const b of f.forceArrows.filter(b=>b!==a&&b.body===a.body&&b.magnitude)) { const ua=[a.x1-a.x0,a.y1-a.y0], ub=[b.x1-b.x0,b.y1-b.y0], c=(ua[0]*ub[0]+ua[1]*ub[1])/Math.hypot(...ua)/Math.hypot(...ub); if (c>.985 && Math.hypot(a.x0-b.x0,a.y0-b.y0)>0.5) lanes.push(`${p.title.slice(0,14)} ${a.label}`); }
  }
  check(`所求框不压受力箭头${covered.length?'：'+[...new Set(covered)].slice(0,5).join('；'):''}`, covered.length === 0);
  check(`同一物体同向的力共用一条线${lanes.length?'：'+lanes.slice(0,3).join('；'):''}`, lanes.length === 0);
  check(`全库受力箭头都从受力物体质心出发${bad.length?'：'+bad.slice(0,5).join('；'):''}`, bad.length === 0);
  check(`全库没有“固定”物体的天文数字受力${anchors.length?'：'+anchors.join('、'):''}`, anchors.length === 0);
  // 4. 湖北15：打开受力只画所求物体 k1；点板才画板
  await open(find(/2025.*湖北.*15/)); await ready(); await ask(0); await ready();
  let f = await seek(0.001);
  check('多物体：打开受力只画所求物体', [...new Set(f.forceArrows.map(a=>a.body))].join()==='k1');
  await ev(()=>__qa.pick('板')); f = await seek(0.001); await ev(()=>__qa.pick(null));
  check('点了板之后才画板的受力', f.forceArrows.some(a=>a.body==='板'));
  // 5. 放大镜开了也不框木板
  await flag('inset', true);
  await open(find(/2024 山东卷 17/)); await ready(); await ask(1); await ready(); st = await ev(()=>__qa.state());
  f = await seek((st.w0+st.w1)/2);
  check('放大镜不为木板/轨道这类大物体开窗', !f.inset);
  await flag('inset', false);
  // 6. 左右栏拖动
  const w0 = await ev(()=>document.querySelector('.sheet').getBoundingClientRect().width);
  const sp = await ev(()=>{const r=document.getElementById('splitter').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,ok:r.width>0};});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:sp.x,y:sp.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:sp.x+120,y:sp.y,button:'left'});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:sp.x+120,y:sp.y,button:'left',clickCount:1});
  const w1 = await ev(()=>document.querySelector('.sheet').getBoundingClientRect().width);
  check(`拖动分隔条改变左栏宽度（${Math.round(w0)}→${Math.round(w1)}）`, sp.ok && Math.abs(w1-w0-120) < 6);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:sp.x+120,y:sp.y,button:'left',clickCount:2});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:sp.x+120,y:sp.y,button:'left',clickCount:2});
  check('双击分隔条恢复默认宽度', Math.abs(await ev(()=>document.querySelector('.sheet').getBoundingClientRect().width) - w0) < 2);
  check('浏览器运行无脚本错误', await ev(()=>__qa.errors.length===0));
  console.log(`反馈修正浏览器验收：${passed}/${passed} 通过`);
} catch (e) { console.error(e); process.exitCode = 1; } finally { try { ws?.close(); } catch {} chrome.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
