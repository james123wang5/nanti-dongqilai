// 先启动 npx vite --config 难题/vite.config.js --port 5191
// node 难题/tests/评审验收-第五批.mjs [--port 5191]
// 独立临时 Chrome profile；不访问用户浏览器数据，不修改题库。
import { assertCanLaunchBrowser } from './浏览器守卫.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
await assertCanLaunchBrowser();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const url = `http://localhost:${arg('--port', '5191')}/?qa`, port = 9700 + Math.floor(Math.random() * 200);
const out = arg('--out', '难题/tests/第五批结果/第五批'); mkdirSync(out, { recursive: true });
const metrics = [];
const profile = mkdtempSync(join(tmpdir(), 'fifth-batch-qa-'));
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
  // “先预测再看”默认关；这里验的是打开它之后的流程
  await ev(() => localStorage.setItem('nanti-predict', '1')); await ev(() => { window.__beforeReload = 1; }); await send('Page.reload'); await wait(() => !window.__beforeReload && !!window.__qa);
  await ev(() => { window.__clip = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clip = t; }, readText: async () => window.__clip } }); });

  const list = await ev(() => __qa.list());
  const find = (re) => { const i=list.findIndex((p)=>re.test(p.title)); assert.ok(i>=0,`找不到 ${re}`); return i; };
  const open = (i) => ev((i)=>__qa.open(i),i);
  const ask = (i) => ev((i)=>__qa.ask(i),i);
  const flag = (name,on) => ev(({name,on})=>{const el=document.getElementById(`${name}Toggle`);el.checked=on;el.dispatchEvent(new Event('change'));},{name,on});
  const seek = (t) => ev((t)=>__qa.seek(t),t);
  const dimensions = (width,height) => send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  const shot = async (name) => { const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(out,name+'.png'),Buffer.from(r.data,'base64')); };
  const chartOn = async () => { if(await ev(()=>document.getElementById('chartCard').hidden))await click('#chartBtn'); await sleep(300); };
  const frames = async () => {const st=await ev(()=>__qa.state());const out=[];for(const u of [0,.25,.5,.75,1])out.push(await seek(st.w0+(st.w1-st.w0)*u));return out;};
  const noTextOverlap = (f) => {
    const a=(f.texts??[]).filter((t)=>!t.inset&&!t.rot&&t.w>1);
    const inter=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    return a.every((t,i)=>a.slice(i+1).every((z)=>{const m=Math.min(t.w*t.h,z.w*z.h);return m<=40||inter(t,z)<=.3*m;})); // 与质检相同的30%口径
  };
  const board=find(/板块示例/);
  await open(board); await ev(()=>__qa.dim('2d')); await click('#qs .qbtn'); await chartOn();
  check('M8.1 预测未选只画坐标轴，不画曲线、阴影、读数', await ev(()=>!document.querySelector('#chart polyline,#chart polygon,#chart circle') && document.querySelectorAll('#chart line').length>1));
  check('M8.1 未选时左栏没有步骤卡', await ev(()=>!document.querySelector('#lesson .stepc')));
  await click('.predict .opt');
  check('M8.2 选择后进入观看，隐藏对错和步骤', await ev(()=>__qa.state().prediction==='watching' && __qa.state().playing && __qa.state().stepIdx===-1 && !document.querySelector('#lesson .stepc') && !/正确的是|预测对了/.test(document.body.innerText) && document.querySelector('.watching').innerText.includes('你选了 A。看动画，验证一下。')));
  check('M8.2 观看时未来曲线不显示', await ev(()=>[...document.querySelectorAll('#chart [data-future]')].every((e)=>e.getAttribute('opacity')==='0')));
  await ev((rate)=>{ const b=document.getElementById("speedBtn"); for(let i=0;i<3&&b.dataset.speed!==rate;i++)b.click(); if(b.dataset.speed!==rate)throw new Error("速度档位切换失败"); },"2");
  await sleep(500);
  check('M8.2 播放不自动翻讲解步骤', await ev(()=>__qa.state().stepIdx===-1&&!document.querySelector('#lesson .stepc')));
  await wait(()=>!__qa.state().playing,undefined,30000);
  check('M8.3 播完即揭晓，出现步骤，主按钮为开始讲解', await ev(()=>__qa.state().prediction==='revealed' && /正确的是/.test(document.querySelector('.predict').innerText) && !!document.querySelector('#lesson .stepc') && document.querySelector('#nextStep').innerText.includes('开始讲解')));
  const st=await ev(()=>__qa.state()); const origin=await seek(st.w0+(st.w1-st.w0)*.4);
  check('M8.4 揭晓后未来曲线同色25%透明、已走过实色',await ev(()=>[...document.querySelectorAll('#chart [data-future]')].every((e)=>e.getAttribute('opacity')==='0.25'&&e.getAttribute('points').length>5)&&[...document.querySelectorAll('#chart [data-series]')].every((e)=>e.getAttribute('opacity')===null&&e.getAttribute('points').length>5)));
  check('M8.5 木板起点刻度有文字并进入实际画布',origin.texts.some((t)=>t.s==='起点'));
  await open(board);await click('#qs .qbtn');await click('.predict .opt');await click('.reveal-prediction');
  check('M8.3 直接看结论也会揭晓且停止播放',await ev(()=>__qa.state().prediction==='revealed'&&!__qa.state().playing&&!!document.querySelector('#lesson .stepc')));

  await open(board);await click('#qs .qbtn:nth-child(4)');await chartOn();
  check('M8 生热预测未选时也只画坐标轴',await ev(()=>document.querySelectorAll('#chart line').length>1&&!document.querySelector('#chart rect:not(clipPath rect),#chart polyline,#chart circle')));
  const choice=find(/选择题.*物块滑上传送带/);await open(choice);
  check('M11.1 初始四个选项原文都在题干下，每行可点',await ev(()=>document.querySelectorAll('.paper-option').length===4&&[...document.querySelectorAll('.paper-option')].every((el)=>el.innerText.trim().length>5&&el.offsetParent!==null)));
  check('M11.2 打开时页面没有正确、错误、勾叉或答案汇总',await ev(()=>!/正确|错误|✓|✗/.test(document.body.innerText)&&!document.querySelector('.option-answer,.paper-option small')));
  check('M11.2 小问只有字母和灰色核验圆点',await ev(()=>[...document.querySelectorAll('#qs .qbtn')].every((el,i)=>el.innerText.trim()===String.fromCharCode(65+i)&&!!el.querySelector('.verify-ai'))));
  await click('.paper-option');
  check('M11.3 点选项跳到讲解，结论未到不亮标签',await ev(()=>__qa.state().view===0&&!document.querySelector('.paper-option small')&&!/这个说法正确|这个说法错误/.test(document.querySelector('.result-body').innerText)));
  for(let i=0;i<4;i++){
    if(i)await click(`#qs .qbtn:nth-child(${i+1})`);
    while(await ev(()=>__qa.state().stepIdx<__qa.state().map.length-1))await next();
    check(`M11.3 选项${String.fromCharCode(65+i)}最后一步揭晓并留下对错标签`,await ev((i)=>/这个说法正确|这个说法错误/.test(document.querySelector('.result-body').innerText)&&document.querySelectorAll('.paper-option small').length===i+1,i));
  }
  await click('#paperBtn');check('M11.3 全部看完才汇总正确选项 A、C',await ev(()=>document.querySelector('.option-answer').innerText==='正确选项：A、C'));
  await open(choice);check('M11 换题后重开清空已看结论',await ev(()=>!document.querySelector('.paper-option small,.option-answer')));

  await open(board);await ask(0);await ev(()=>__qa.dim('2d'));const boardTiming=await ev((i)=>__qa.benchmark(i),board);metrics.push({case:'板块重算',...boardTiming});
  await click('#tryBtn');await sleep(400);
  check('M12.1 打开改条件图像仍可见，右栏320px',await ev(()=>!document.getElementById('chartCard').hidden&&!document.getElementById('tryCard').hidden&&Math.abs(document.getElementById('tryCard').getBoundingClientRect().width-320)<1));
  check('M12.2 滑块只写符号、完整当前值单位和原值',await ev(()=>[...document.querySelectorAll('.try-row')].every((el)=>el.querySelector('small').innerText.startsWith('原 ')&&el.querySelector('b').innerText.length>0&&!/滑块|木板|以|间/.test(el.innerText))));
  await ev(()=>{const el=document.querySelector('#tryPanel input[data-k="mu2"]');el.value='.12';el.dispatchEvent(new Event('input'));});
  if(boardTiming.ms<=300&&!boardTiming.error){ await wait(()=>__qa.state().changedConditions);await ready();check('M12.5 快题拖动中重算，无需松手',await ev(()=>__qa.state().changedConditions)); }
  else {await sleep(250);check('M12.5 慢题拖动中不重算',await ev(()=>!__qa.state().changedConditions));}
  await ev(()=>{const el=document.querySelector('#tryPanel input[data-k="mu2"]');el.value='.2';el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));});await ready();await sleep(300);
  check('M12.3 图像原题虚线40%透明，当前实线保留',await ev(()=>document.querySelectorAll('#chart [data-base]').length>0&&[...document.querySelectorAll('#chart [data-base]')].every((el)=>el.getAttribute('stroke-dasharray')==='6 4'&&el.getAttribute('opacity')==='0.4')&&!!document.querySelector('#chart [data-series]')));
  check('M12.4 左栏四问原题到现在，变化用橙色',await ev(()=>document.querySelectorAll('.compare-row').length===4&&[...document.querySelectorAll('.compare-row')].every((el)=>/原题[\s\S]+→ 现在/.test(el.innerText))&&document.querySelectorAll('.compare-row.different').length>0));
  check('M12.4 按真实事件差集显示原题有、现在没有',await ev(()=>/原题有“B 速度减为零”，现在没有/.test(document.querySelector('.event-comparison').innerText)));
  check('M12.4 原题讲解折叠保存，未换成新旁白',await ev(()=>!document.querySelector('.original-lesson').open&&document.querySelector('.original-lesson').innerText.includes('原题的讲解')&&document.querySelector('.original-lesson').textContent.includes('滑块比木板快')));
  await shot('改条件-电脑');
  await dimensions(1100,838);await sleep(350);
  check('M12.1 舞台小于900px时滑块在上、图像在下',await ev(()=>{const a=document.querySelector('#tryCard').getBoundingClientRect(),b=document.querySelector('#chartCard').getBoundingClientRect();return document.querySelector('.stage').clientWidth<900&&a.bottom<=b.top+1;}));
  await dimensions(390,844);await sleep(350);
  check('手机改条件无横向溢出，顶栏不出屏',await ev(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#nowMessage').getBoundingClientRect().right<=innerWidth+1));
  await shot('改条件-手机');
  await dimensions(1512,838);await sleep(350);await click('#tryReset');await ready();
  check('M12.4 恢复原题后虚线消失、原题讲解恢复',await ev(()=>!__qa.state().changedConditions&&!document.querySelector('.comparison,#chart [data-base]')&&!!document.querySelector('.stepc')));

  const letters=find(/2025.*山东.*18.*线框/);await open(letters);await ask(0);await ev(()=>__qa.dim('2d'));await chartOn();
  check('M14.1 字母题顶栏常驻标签、点击解释',await ev(()=>!document.querySelector('#lettersNote').hidden&&document.querySelector('#lettersNote summary').innerText==='字母题 · 画面里的数是示例'));
  await click('#lettersNote summary');check('M14.1 解释明确以式子为准',await ev(()=>document.querySelector('#lettersNote').open&&document.querySelector('#lettersNote p').innerText.includes('答案以式子为准')));await click('#lettersNote summary');
  const lf=await frames();metrics.push({case:'字母题线框',frames:lf});
  check('M14.2 五个时刻画布上的具体数值均带示例',lf.every((f)=>f.texts.every((t)=>!/[=＝]\s*[-+]?\d|\d+\.\d+/.test(t.s)||t.s.includes('示例'))));
  check('M14.2 图像没有未标示例的非零数值，纵轴只留0和量名',await ev(()=>[...document.querySelectorAll('#chart text')].every((el)=>!/[1-9]/.test(el.textContent)||el.textContent.includes('示例'))&&document.querySelector('#chart').hasAttribute('data-letters')));
  await shot('字母题-电脑');
  await dimensions(390,844);await sleep(350);check('M14 手机标签及顶栏不超出屏幕',await ev(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#lettersNote').getBoundingClientRect().right<=innerWidth+1));
  await dimensions(1512,838);
  const letterMotion=JSON.parse(readFileSync(new URL('./cases/字母自由落体.json',import.meta.url),'utf8'));
  await ev((p)=>__qa.open(p),letterMotion);await ask(0);await ev(()=>__qa.dim('2d'));const mf=await frames();
  check('M14 通用字母力学题的比例尺和刻度也不露出任取数值',mf.every((f)=>f.texts.every((t)=>!/[1-9][\d.]*\s*(?:cm|mm|m\b|s\b)/.test(t.s)||t.s.includes('示例'))));
  // 每道题在浏览器 Worker 中无缓存完整重算一次；包括传回所有快照的耗时。
  for(let i=0;i<list.length;i++) {const timing=await ev((i)=>__qa.benchmark(i),i);metrics.push({case:'重算耗时',...list[i],...timing});console.log(`重算 ${list[i].key}: ${timing.ms.toFixed(1)}ms${timing.error?' / 算不出':''}`);}
  const slow=metrics.find((m)=>m.case==='重算耗时'&&m.ms>300&&!m.error&&m.key==='2024-湖南-15');
  assert.ok(slow,'没有可验证松手策略的慢题');
  await open(list.findIndex((p)=>p.key===slow.key));await click('#tryBtn');await sleep(250);
  await ev(()=>{const el=document.querySelector('#tryPanel input');el.value=String(+el.value*1.1);el.dispatchEvent(new Event('input'));});await sleep(350);
  check('M12.5 超过300ms的题仅拖动不会重算，提示松手后重算',await ev(()=>!__qa.state().changedConditions&&document.querySelector('#tryHint').innerText==='松手后重算'));
  check('M12.5 全库逐题浏览器重算计时完成',metrics.filter((m)=>m.case==='重算耗时').length===list.length);
  check('页面运行无脚本错误',await ev(()=>__qa.errors.length===0));
  console.log(`第五批浏览器验收：${passed}/${passed} 通过`);
} finally {
  writeFileSync(join(out,'metrics.json'),JSON.stringify(metrics,null,2));
  ws?.close(); chrome.kill();
  if (chrome.exitCode === null && !chrome.signalCode) await Promise.race([new Promise((r) => chrome.once('exit', r)), sleep(2000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
