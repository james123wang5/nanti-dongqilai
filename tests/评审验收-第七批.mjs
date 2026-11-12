// 先启动 npx vite --config 难题/vite.config.js --port 5191
// node 难题/tests/评审验收-第七批.mjs [--port 5191]
// 独立临时 Chrome profile；不访问用户浏览器数据，不修改题库。
import { assertCanLaunchBrowser } from './浏览器守卫.mjs';
import assert from 'node:assert/strict';
import katex from 'katex';
import { colorMath } from '../player/math-colors.ts';
import { pieces } from '../player/typeset.ts';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
await assertCanLaunchBrowser();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const url = `http://localhost:${arg('--port', '5191')}/?qa`, port = 9700 + Math.floor(Math.random() * 200);
const out = arg('--out', fileURLToPath(new URL('./第七批结果/第七批', import.meta.url))); mkdirSync(out, { recursive: true });
const metrics = [];
const temp = join(out, 'tmp'); mkdirSync(temp, { recursive: true });
const profile = mkdtempSync(join(temp, 'seventh-batch-qa-'));
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
  // “先预测再看”默认关；B14 验的是打开它之后的文案
  await ev(() => localStorage.setItem('nanti-predict', '1')); await ev(() => { window.__beforeReload = 1; }); await send('Page.reload'); await wait(() => !window.__beforeReload && !!window.__qa);
  await ev(() => { window.__clip = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clip = t; }, readText: async () => window.__clip } }); });

  const list = await ev(() => __qa.list());
  const find = (re) => { const i=list.findIndex((p)=>re.test(p.title)); assert.ok(i>=0,`找不到 ${re}`); return i; };
  const open = (i) => ev((i)=>__qa.open(i),i), ask=(i)=>ev((i)=>__qa.ask(i),i), seek=(t)=>ev((t)=>__qa.seek(t),t);
  const flag=(name,on)=>ev(({name,on})=>{const el=document.getElementById(`${name}Toggle`);el.checked=on;el.dispatchEvent(new Event('change'));},{name,on});
  const shot=async(name)=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(out,name+'.png'),Buffer.from(r.data,'base64'));};
  const audit=(id,status,evidence)=>metrics.push({bug:id,status,evidence});
  const board=find(/板块示例/),cone=find(/圆锥摆/),glass=find(/2025.*13.*盖玻片/);
  // 无动画样例：2025 山东17 按题图重建前的旧版（弯道太急、方形物体被顶离地面），不依赖题库里留着坏题
  const noAnim=JSON.parse(readFileSync(new URL('./fixtures/无动画-支撑失效.json', import.meta.url),'utf8'));
  await open(board);await ask(2);
  check('M16(反馈修订) 平面题有立体开关、默认关',await ev(()=>{const b=document.getElementById('dimToggle');return !b.hidden&&!b.disabled&&b.getAttribute('aria-pressed')==='false'&&__qa.dimension()==='2d';}));
  check('M16 底栏恰有5个可操作控件',await ev(()=>[...document.querySelectorAll('.dock > button,.dock .evnav button,.dock input')].filter(e=>e.offsetParent!==null).length===5));
  const rates=[];for(let i=0;i<4;i++){rates.push(await ev(()=>document.getElementById('speedBtn').dataset.speed));await click('#speedBtn');}
  check('M16 一个按钮中→快→慢→中循环',JSON.stringify(rates)===JSON.stringify(['1','2','0.5','1']));
  await open(cone);await ask(0);
  check('M16(反馈修订) 圆锥摆为系统三维，立体开关固定打开',await ev(()=>{const b=document.getElementById('dimToggle');return __qa.dimension()==='3d'&&!b.hidden&&b.disabled&&b.getAttribute('aria-pressed')==='true';}));
  check('M16 立体说明初始只显示ⓘ',await ev(()=>{const e=document.getElementById('sceneNote');return !e.open&&e.querySelector('summary').textContent==='ⓘ'&&e.querySelector('span').textContent.length>0;}));
  await click('#sceneNote summary');check('M16 点ⓘ展开说明',await ev(()=>document.getElementById('sceneNote').open));await click('#sceneNote summary');
  await open(board);await ask(2);await ev(()=>__qa.step(0));await seek(.8);
  check('M17 板块(3)第一步x_A紫色',await ev(()=>{const e=document.querySelector('.stepc[data-i="0"] .katex-html [style*="color"]');return e&&getComputedStyle(e).color==='rgb(90, 75, 176)'&&e.textContent.includes('x');}));
  await flag('velocity',false);await flag('force',false);
  check('M17 速度关闭后v没有蓝色，位移仍为紫色',await ev(()=>{const e=document.querySelector('.stepc[data-i="0"]');return !e.querySelector('[style*="28, 95, 196"]')&&!e.querySelector('[style*="#1c5fc4"]')&&[...e.querySelectorAll('[style]')].some(x=>getComputedStyle(x).color==='rgb(90, 75, 176)');}));
  await flag('velocity',true);await flag('force',true);
  await open(cone);await ask(0);check('M17 受力开关对应T橙色',await ev(()=>[...document.querySelectorAll('.stepc [style]')].some(e=>getComputedStyle(e).color==='rgb(201, 113, 26)'&&/T/.test(e.textContent))));
  await flag('force',false);

  // 全部题的实际步骤DOM与原始公式都检查；切换两种配色状态覆盖替换后的渲染。
  let steps=0,texes=0;const bad=[];
  for(let i=0;i<list.length;i++){
    await open(i);
    const source=await ev((i)=>__qa.problem(i),i),raw={count:0,errors:[]};
    const scan=(s,display)=>{if(!s)return;for(const v of [{velocity:true,force:true,displacement:true},{velocity:false,force:false,displacement:false}]){raw.count++;const html=katex.renderToString(colorMath(s,v),{throwOnError:false,displayMode:display});if(html.includes('katex-error'))raw.errors.push(s);}};
    for(const rows of Object.values(source.solution??{}))for(const st of rows){scan(st.tex,true);for(const part of pieces(st.say??''))if(part.tex)scan(part.tex,false);}
    texes+=raw.count;if(raw.errors.length)bad.push({i,raw:raw.errors});
    const p=await ev((i)=>__qa.problem(i),i);
    for(let k=0;k<p.asks.length;k++){
      const info=await ask(k);steps+=info?.steps?.length??0;
      const errors=await ev(()=>[...document.querySelectorAll('#lesson .katex-error')].map(e=>e.textContent));if(errors.length)bad.push({i,k,errors});
    }
  }
  metrics.push({case:'M17全库',problems:list.length,steps,texes,bad});
  check('M17 66题全部步骤DOM与全部原始公式两种配色均无KaTeX错误',list.length===66&&steps>300&&texes>500&&bad.length===0);

  await open(glass);await ask(0);await ev(()=>__qa.step(__qa.state().map.length-1));
  check('B1 双结果橙色、无绿色核验勾',await ev(()=>{const e=document.querySelector('.stepc.final');return e.classList.contains('final-mismatch')&&e.textContent.includes('答案给的')&&e.textContent.includes('引擎算出')&&!e.textContent.includes('✓');}));audit('B1','已由第1批修复','本脚本双结果检查，第一批验收');
  await ev(async(p)=>{await __qa.open(p);},noAnim);await ready();await ask(0);check('B2/B4 无动画不显示原始错误和改条件文案',await ev(()=>{const t=document.body.innerText;return t.includes('AI 给出，未核验')&&!/单侧支撑|t=0\.32|你改了条件|JSON/.test(t)&&!document.getElementById('noAnimation').hidden;}));audit('B2','已由第1批修复','山东17第一问');audit('B4','只记录数据问题；展示由第1/7批处理','山东17仍无动画、空心点、组末');
  await open(find(/2026.*13.*实验舱/));await ask(-1);
  check('B5 加速/减速上升分开且止于所求过程',await ev(()=>{const s=__qa.state();return s.phases.some(x=>x.label.includes('加速上升'))&&s.phases.some(x=>x.label.includes('减速上升'))&&Math.abs(s.w1-3.675)<1e-5&&!/离开塔|在空中运动/.test(s.map.map(x=>x.say).join(''));}));audit('B5','已由第2批修复','实验舱过程地图');
  audit('B6','已由第2批修复','第二批punctuatedHtml规则和第二批浏览器验收');
  await open(find(/2025.*陕晋宁青.*6/));await ask(1);
  check('B7 长公式无裁切',await ev(()=>[...document.querySelectorAll('.stepc .katex-display')].every(e=>e.scrollWidth<=e.clientWidth+1||getComputedStyle(e).overflowX==='auto')));audit('B7','已由第2批修复','线框B公式，第二批验收');
  await open(find(/选择题.*传送带/));
  check('B8 A–D选项原文可见',await ev(()=>document.querySelectorAll('#options [data-option]').length===4||document.querySelectorAll('#options button').length===4));audit('B8','已由第5批修复','四个题干选项');
  audit('B9','已由第4批修复','第四批真实F/mg端点长度比5.5–6.5');audit('B10','已由第4批修复；第7批更换三维测试题','第四批圆锥摆mg/T/F合全部标签和两种画法的数值一致');audit('B11','已由第5批修复','第五批原生预测、真实播放结束后揭晓');audit('B16','已由第4批修复','第四批三题五个时刻无文字重叠、深色字及描边、避开线框边线');
  await open(board);await ask(-1);await click('#play');await click('#libBtn');const stopped=await ev(()=>__qa.state().t);await sleep(150);await click('#libClose');
  check('B15 题库打开即暂停，关闭不自动恢复',await ev((t)=>!__qa.state().playing&&__qa.state().t===t,stopped));
  await click('#play');await click('#addBtn');const stopped2=await ev(()=>__qa.state().t);await sleep(150);await click('#pasteClose');
  check('B15 放题打开即暂停，关闭不自动恢复',await ev((t)=>!__qa.state().playing&&__qa.state().t===t,stopped2));audit('B15','本批修复（放题暂停已由第3批实现）','播放中打开/关闭两种弹窗，时间不推进');

  await open(board);await ask(0);await click('#tryBtn');
  check('B3 改条件不截取式子',await ev(()=>[...document.querySelectorAll('.try-row')].every(e=>!e.textContent.includes('μ₁ = 0.')&&!e.textContent.includes('μ₂ = 0.')&&!!e.querySelector('b'))));audit('B3','已由第5批修复','滑块只显示符号和值');
  await ev(()=>{const el=document.querySelector('#tryPanel input[data-k="mu2"]');el.value='.2';el.dispatchEvent(new Event('change'));});await ready();await ask(0);
  check('B17 只有一个阶段也有名字可见',await ev(()=>{const s=__qa.state(),e=document.getElementById('track');return s.phases.length===1&&e.children.length===1&&getComputedStyle(e).display!=='none'&&e.textContent.length>0;}));audit('B17','本批修复','mu2=.2单阶段track可见');
  await click('#libBtn');
  check('M18/B12 半衰期和LC不归力学、未知板块归其他',await ev(async()=>{const {topicOf}=await import('./view-rules.ts');return __qa.list().filter(x=>/半衰期|LC/.test(x.title)).every(x=>x.topic!=='力学')&&topicOf({title:'未识别题',scene:{}})==='其他';}));audit('B12','本批修复','题库分组与未知场景兜底');
  check('M18(题库修订) 每组里空心点（未核验）的题都排在已核验的题后面',await ev(()=>[...document.querySelectorAll('.lib-cards')].every(g=>{const c=[...g.querySelectorAll('.lib-card')],k=c.findIndex(x=>x.querySelector('.catalog-none'));return k<0||c.slice(k).every(x=>x.querySelector('.catalog-none'));})));
  check('M18(题库修订) 题库每张卡均有核验圆点，绿/灰两态都有（空心态视题库而定）',await ev(()=>{const cards=[...document.querySelectorAll('.lib-card')];return cards.length>=66&&cards.every(c=>c.querySelector('.catalog-dot'))&&['engine','partial'].every(k=>document.querySelector('.catalog-'+k));}));await shot('题库');await click('#libClose');

  // 使用自己的临时题检查删除、撤销、5秒到期与刷新后的IndexedDB，不触碰原题库。
  await click('#addBtn');await ev((i)=>{const p=structuredClone(__qa.problem(i));p.title='第七批删除验收';document.getElementById('pasteText').value=JSON.stringify(p);document.getElementById('pasteRun').click();},board);await ready();await click('#libBtn');
  const id=await ev(()=>document.querySelector('.delete-mine').dataset.id);
  await click(`.delete-mine[data-id="${id}"]`);
  check('M18/B18 原地显示已删除与撤销，IndexedDB已删除',await ev(async(id)=>{const {allMine}=await import('./cache.ts');return !!document.querySelector(`[data-deleted="${id}"]`)&&document.body.innerText.includes('已删除')&&!(await allMine()).some(m=>m.id===id);},id));
  await click(`.undo-delete[data-id="${id}"]`);
  check('M18 撤销恢复卡片和原ID、原题',await ev(async(id)=>{const {allMine}=await import('./cache.ts');return !!document.querySelector(`.delete-mine[data-id="${id}"]`)&&(await allMine()).some(m=>m.id===id&&m.name==='第七批删除验收');},id));
  await click(`.delete-mine[data-id="${id}"]`);await wait((id)=>!document.querySelector(`[data-deleted="${id}"]`),id,7000);
  await ev(()=>{window.__beforeReload=1;});await send('Page.reload');await wait(()=>!window.__beforeReload&&!!window.__qa);await click('#libBtn');
  check('M18 5秒后占位消失，刷新后仍已删除',await ev(async(id)=>{const {allMine}=await import('./cache.ts');return !document.querySelector(`.delete-mine[data-id="${id}"]`)&&!(await allMine()).some(m=>m.id===id);},id));await click('#libClose');audit('B18','本批修复','删除、撤销、5秒到期及刷新持久性');

  // 多力图：实际箭尾在真正物体的边界内（允许2px描边）；没有底部排列。
  await open(find(/2025.*湖北.*15/));await ask(0);await flag('force',true);
  await ev(()=>__qa.pick('板')); // 受力默认只画所求物体；板的受力要学生点它才画
  const dense=[];
  for(const time of [0,.2,.5]){
    const f=await seek(time);dense.push(f);
    check(`多力图t=${time} 箭尾仍在受力物体上`,f.forceArrows.filter(a=>a.body==='板'&&a.magnitude).every(a=>{const b=f.bodies.find(b=>b.id===a.body);return b&&Math.abs(a.x0-b.x)<=b.hw+2&&Math.abs(a.y0-b.y)<=b.hh+2;}));
    check(`多力图t=${time} 长度示意说明全页只一次`,f.texts.every(t=>!t.s.includes('长度为示意'))&&await ev(()=>!document.getElementById('forceScaleNote').hidden));
    check(`多力图t=${time} 同类分力合并且来源k1…k6可追溯`,f.forceArrows.some(a=>a.body==='板'&&a.label.includes('共6个')&&['k1','k2','k3','k4','k5','k6'].every(k=>a.label.includes(k))));
  }
  metrics.push({case:'密集受力',frames:dense});await shot('湖北多力-改后');
  await open(find(/炮弹/));await flag('force',false);
  const bursts=[];
  for(const k of [0,2]){await ask(k);for(let round=0;round<2;round++)for(let n=0;n<60;n++)bursts.push(await seek(1.5+(n%3-1)/60));}
  const distances=bursts.flatMap(f=>(f.labels??[]).filter(l=>l.tip&&!l.inset).map(l=>Math.hypot(Math.max(l.x-l.tip[0],0,l.tip[0]-l.x-l.w),Math.max(l.y-l.tip[1],0,l.tip[1]-l.y-l.h))));
  metrics.push({case:'炮弹稳定余量',frames:bursts,maxDistance:Math.max(...distances)});
  check('炮弹(1)(3)重复240次取样，所有标签距箭头≤40px留出余量',distances.length>0&&Math.max(...distances)<=40);await shot('炮弹-改后');

  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await open(board);await click('#qs .qbtn');
  check('B14 预测提示不带方位词',await ev(()=>document.getElementById('caption').textContent.includes('先选一个预测')&&!/左边|下方/.test(document.getElementById('caption').textContent)));audit('B14','本批修复','390px原生进入预测状态');audit('B13','不做','负责人排除手机版面调整');
  check('手机页面无横向溢出、顶栏文字不出屏',await ev(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.getElementById('nowMessage').getBoundingClientRect().right<=innerWidth+1));await shot('手机');
  check('页面运行无脚本错误',await ev(()=>__qa.errors.length===0));
  console.log(`第七批浏览器验收：${passed}/${passed} 通过`);
} finally {
  writeFileSync(join(out,'metrics.json'),JSON.stringify(metrics,null,2));
  ws?.close(); chrome.kill();
  if (chrome.exitCode === null && !chrome.signalCode) await Promise.race([new Promise((r) => chrome.once('exit', r)), sleep(2000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
