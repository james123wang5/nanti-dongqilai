// 先启动 npx vite --config 难题/vite.config.js --port 5191
// node 难题/tests/评审验收-第四批.mjs [--port 5191]
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
const out = arg('--out', '/tmp/fourth-batch-browser'); mkdirSync(out, { recursive: true });
const metrics = [];
const profile = mkdtempSync(join(tmpdir(), 'fourth-batch-qa-'));
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
  const chartOn = async () => { if(await ev(()=>document.getElementById('chartCard').hidden))await click('#chartBtn'); await sleep(300); };
  const frames = async () => {const st=await ev(()=>__qa.state());const out=[];for(const u of [0,.25,.5,.75,1])out.push(await seek(st.w0+(st.w1-st.w0)*u));return out;};
  const noTextOverlap = (f) => {
    const a=(f.texts??[]).filter((t)=>!t.inset&&!t.rot&&t.w>1);
    const inter=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    return a.every((t,i)=>a.slice(i+1).every((z)=>{const m=Math.min(t.w*t.h,z.w*z.h);return m<=40||inter(t,z)<=.3*m;})); // 与质检相同的30%口径
  };
  const board=find(/板块示例/);
  await open(board); await ev(()=>__qa.dim('2d')); await ask(2); await chartOn();
  let f=await seek(.8), visual=await ev(()=>__qa.visual()), ink=await ev(()=>__qa.ink());
  metrics.push({case:'M6 板块(3)',visual,ink,frame:f});
  check('M6.1 板块(3)几何宽高比>3.2，图像200–320px且占可分配高度40%',visual.contentRatio>3.2&&visual.chartHeight>=200&&visual.chartHeight<=320&&Math.abs(visual.chartHeight-Math.min(320,Math.max(200,(visual.chartHeight+visual.sceneHeight)*.4)))<2);
  check('M6.1 ink实测内容高度至少占场景30%',!!ink&&ink.h/f.h>=.3);
  const ext=f.bodies.flatMap((b)=>[b.y-(b.kind==='board'?b.hh:b.r),b.y+(b.kind==='board'?b.hh:b.r)]).concat(f.nameDots.flatMap((d)=>[d.y-10,d.y+10]));
  const top=Math.min(...ext),bottom=f.h-Math.max(...ext),content=f.h-top-bottom;
  check('M6 内容居中，上下留白均32px至内容高度1.2倍',top>=32&&bottom>=32&&top<=content*1.2&&bottom<=content*1.2);
  check('M6 切问图像高度过渡为0.2秒',await ev(()=>getComputedStyle(document.getElementById('chartCard')).transitionDuration==='0.2s'));
  check('M10.1 名字旁的圆点、曲线、图例逐物体同色',await ev((dots)=>dots.length===2&&dots.every((d)=>document.querySelector(`#chart polyline[data-series="${d.id}"]`)?.getAttribute('stroke')===d.color&&document.querySelector(`#chart [data-legend="${d.id}"]`)?.getAttribute('fill')===d.color),f.nameDots));
  check('M10.1 物体身份色为评审指定的中性色',f.nameDots.every((d)=>['#4b5563','#a0703c','#2f8f83','#8c8c3a','#b0567a','#6b6b6b'].includes(d.color)));
  check('M10 图像当前时刻竖线深灰1px',await ev(()=>{const c=document.querySelector('#chart .chart-cursor');return c?.getAttribute('stroke')==='#38474a'&&c.getAttribute('stroke-width')==='1';}));
  check('M10 二维文字全部至少13px，物体名字14px加粗',f.texts.every((t)=>t.h>=13)&&f.nameDots.every((d)=>f.texts.some((t)=>t.s===d.id&&t.h===14&&/600/.test(t.font))));
  await open(find(/2025.*黑吉辽蒙.*13/)); await ask(0); await ev(()=>__qa.dim('2d')); await chartOn();
  visual=await ev(()=>__qa.visual());metrics.push({case:'M6 斜抛',visual});
  check('M6.2 高场景图像高度160px',Math.abs(visual.chartHeight-160)<1);

  await open(board); await ask(0); await ev(()=>__qa.dim('2d')); await click('.stepc[data-i="1"]'); await seek(.7);
  check('M7.1 板块第二步顶栏显示原讲解和红色第2步标签',await ev(()=>document.getElementById('nowStep').textContent==='第 2 步'&&document.getElementById('nowMessage').textContent.startsWith('木板受滑块向右的摩擦力')&&getComputedStyle(document.getElementById('nowStep')).backgroundColor==='rgb(196, 55, 44)'&&getComputedStyle(document.getElementById('nowText')).fontSize==='15px'));
  await dimensions(390,844);await sleep(300);
  check('M7.2（手机先不做，只查不坏）手机宽度下顶栏文字不超出屏幕、页面无横向溢出',await ev(()=>{const t=document.getElementById('nowMessage').getBoundingClientRect();return t.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1;}));
  await chartOn();
  check('手机开启图像后仍留有可见场景',await ev(()=>document.getElementById('scene').clientHeight>=140));
  await dimensions(1512,838);await sleep(300);
  await ask(-1);await click('#evNext');
  check('M7 转折点进入顶栏，不生成黑色胶囊',await ev(()=>document.getElementById('nowText').dataset.kind==='event'&&!document.querySelector('#evtTag,.evt-tag')));
  await sleep(1100);check('M7 转折提示在1.1秒时仍显示',await ev(()=>document.getElementById('nowText').dataset.kind==='event'));
  await sleep(600);check('M7 转折提示1.6秒后恢复当前步骤或阶段',await ev(()=>document.getElementById('nowText').dataset.kind!=='event'&&!document.querySelector('#evtTag,.evt-tag')));

  await open(find(/2026.*13.*实验舱/)); await ask(0);await ev(()=>__qa.dim('2d'));await flag('force',true);f=await seek(.1);
  metrics.push({case:'M9 实验舱',frame:f});
  const F=f.forceArrows.find((a)=>a.label.startsWith('F =')),mg=f.forceArrows.find((a)=>a.label.startsWith('mg =')||a.label.startsWith('Mg ='));
  const length=(a)=>Math.hypot(a.x1-a.x0,a.y1-a.y0);
  check('M9.1/B9(反馈修订) 实验舱F与mg长度比5.5–6.5；mg伸不出物体被拉长时须标示意',F&&mg&&(mg.schematic?mg.label.includes('长度为示意')&&length(F)>length(mg):length(F)/length(mg)>=5.5&&length(F)/length(mg)<=6.5));
  check('M9 合力为深橙3px、分力为橙2px，QA为实际绘制值',f.forceArrows.every((a)=>a.resultant?a.color==='#8a4a0c'&&a.width===3:a.color==='#c9711a'&&a.width===2));
  check('M9(反馈修订) 所有受力箭头按本问统一线性比例，短箭头拉长并注明示意',f.forceArrows.filter((a)=>a.magnitude).every((a)=>Math.abs(length(a)-a.length)<1e-7&&(!a.schematic||a.length>=14&&a.label.endsWith('（长度为示意）'))));
  await open(board);await ask(0);await flag('force',true);await ev(()=>__qa.pick('B'));let before=await seek(.2);await ev(()=>__qa.pick(null)); // 受力默认只画所求物体，B 要点它才画
  check('M9 开关文字为“受力”',await ev(()=>document.getElementById('forceToggle').closest('label').textContent.trim()==='受力'));
  check('M9 两个摩擦力标明地面和A施力',before.forceArrows.some((a)=>a.body==='B'&&a.label.startsWith('f(地面)'))&&before.forceArrows.some((a)=>a.body==='B'&&a.label.startsWith('f(A)')));
  await open(find(/圆锥摆/));await ask(0);await ev(()=>__qa.dim('2d'));await flag('force',true);before=await seek(.2);
  check('M16 三维复测题由chooseDim判为3d',await ev(()=>__qa.dimension()==='3d'));
  check('M9.3/B10 立体模式可用',await ev(()=>__qa.dim('3d')));await sleep(750);let after=await seek(.2);
  metrics.push({case:'M9 二维/三维',before,after});
  check('M9.3/B10 同一开关在两种画法显示相同的分力和合力',before.forceArrows.length===after.forceArrows.length&&before.forceArrows.every((a,i)=>a.label===after.forceArrows[i].label&&a.magnitude===after.forceArrows[i].magnitude&&a.resultant===after.forceArrows[i].resultant));
  check('M9 三维分力和合力确实有可读标签',after.forceArrows.length>=3&&after.forceArrows.every((a)=>after.texts.some((t)=>t.s===a.label.replace(/（长度为示意）$/,''))));
  await open(board);await ask(0);await ev(()=>__qa.dim('2d'));await flag('force',true);await click('#tryBtn');
  await ev(()=>{const el=document.querySelector('#tryPanel input[data-k="mu2"]');el.value='.2';el.dispatchEvent(new Event('change'));});await ready();await ask(0);await ev(()=>__qa.pick('B'));f=await seek(.2);await ev(()=>__qa.pick(null));
  check('M9.2 实际拖改mu2到0.2后，木板显示F合=0',f.forceArrows.some((a)=>a.body==='B'&&a.resultant&&a.label==='F合 = 0'&&a.length===0)&&f.texts.some((t)=>t.s==='F合')&&f.texts.some((t)=>t.s.includes('= 0')));

  for(const [pattern,askIndex,name] of [[/2025.*13.*盖玻片/,0,'盖玻片'],[/2025.*陕晋宁青.*6/,1,'线框'],[/2024.*13.*差压阀/,0,'差压阀']]){
    await open(find(pattern));await ask(askIndex);await ev(()=>__qa.dim('2d'));const ff=await frames();metrics.push({case:`M10/B16 ${name}`,frames:ff});
    check(`M10/B16 ${name}五个时刻标签无相互重叠`,ff.every(noTextOverlap));
    check(`M10/B16 ${name}文字至少13px、深色字、2px纸色描边`,ff.every((f)=>f.texts.length>0&&f.texts.every((t)=>t.h>=13&&t.color==='#1a262a'&&t.outline==='#f6f2e8'&&t.outlineWidth===2)));
    if(name==='线框')check('B16 速度标签避开线框边线',ff.every((f)=>f.texts.filter((t)=>/^v\s*=/.test(t.s)).every((t)=>(f.obstacles??[]).every((l)=>{for(let u=0;u<=1;u+=.05){const x=l.x0+(l.x1-l.x0)*u,y=l.y0+(l.y1-l.y0)*u;if(x>t.x&&x<t.x+t.w&&y>t.y&&y<t.y+t.h)return false;}return true;}))));
    if(name==='差压阀'){
      check('M10.2 差压阀p、V、T均保留可读数值',ff.some((f)=>['p =','V =','T ='].every((key)=>f.texts.some((t)=>t.s.includes(key)))));
      const clip=await ev(()=>{const r=document.getElementById('scene').getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height,scale:.5};});
      const shot=await send('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true});writeFileSync(join(out,'差压阀-50%.png'),Buffer.from(shot.data,'base64'));
      console.log(`待人工检查50%截图可读性：${join(out,'差压阀-50%.png')}`);
    }
  }
  check('页面运行无脚本错误',await ev(()=>__qa.errors.length===0));
  console.log(`第四批浏览器验收：${passed}/${passed} 通过；全库质检仍需另跑，50%截图请人工看一眼。`);
} finally {
  writeFileSync(join(out,'metrics.json'),JSON.stringify(metrics,null,2));
  ws?.close(); chrome.kill();
  if (chrome.exitCode === null && !chrome.signalCode) await Promise.race([new Promise((r) => chrome.once('exit', r)), sleep(2000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
