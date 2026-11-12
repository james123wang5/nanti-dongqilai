import { LAB_KEYS } from './labs/index.ts';
// 格式校验：在运行引擎之前检查 AI 给的 JSON，指出哪一处不对，并生成可以贴回给 AI 的修复提示。

import { evaluate, dependencies, parseExpression, isBooleanExpression, MATH_FUNCTIONS, SNAP_ARITY, type Expr } from './expr.ts';
import { solutionFor, type Problem } from './solve.ts';
import { simulate, type EventSpec } from './sim.ts';

export const EVENTS = new Set(['when', 'split', 'release', 'force_on', 'start', 'end', 'apsis', 'mark', 'kick', 'same_velocity', 'stop', 'leave', 'enter', 'land', 'collide', 'collided', 'hit', 'pass', 'extreme', 'unlock', 'force_off', 'out', 'time', 'energy_loss', 'separate', 'slip']);

/** 可选文字的轻提示单独返回，绝不进入阻断模型/讲解的错误列表。 */
export function storyHints(P: { story?: unknown }): string[] {
  if (P.story === undefined) return [];
  return Array.isArray(P.story) && P.story.every((s) => typeof s === 'string' && s.trim() && [...s.trim()].length <= 30)
    ? [] : ['过程说明暂时用不了，已改用自动说明。'];
}
export function storyLines(P: { story?: unknown }): string[] {
  return storyHints(P).length || !Array.isArray(P.story) ? [] : P.story.map((s: string) => s.trim());
}

export function validate(P: Problem, checkSamples = true): string[] {
  const errs: string[] = [];
  if (!P || typeof P !== 'object') return ['最外层必须是一个 JSON 对象'];
  if (P.unsupported !== undefined) {
    if (typeof P.unsupported !== 'string' || !P.unsupported.trim()) errs.push('unsupported 必须写清整题无法建模的原因');
    if (P.scene?.bodies?.length) errs.push('unsupported 只用于整题不能建模；能模拟一部分时请保留场景并删去 unsupported');
    if (!Array.isArray(P.asks) || !P.asks.length) errs.push('请在 asks 和 solution 中保留题目与解答');
    return errs;
  }
  // 先查结构：结构不对时后面的检查没有意义，直接返回能看懂的错误，不让校验器自己崩溃
  if (!P || typeof P !== 'object') return ['回复里没有找到 JSON 对象'];
  if (!P.scene || typeof P.scene !== 'object' || Array.isArray(P.scene)) errs.push('缺少 scene，或 scene 不是对象');
  if (!Array.isArray(P.asks) || !P.asks.length) errs.push('缺少 asks（每一问），asks 要写成数组 [ {…}, {…} ]');
  else if (P.asks.some((a) => !a || typeof a !== 'object' || typeof a.id !== 'string')) errs.push('asks 里每一问要写成对象，并有字符串 id');
  for (const k of ['surfaces', 'bodies', 'forces', 'collisions', 'springs', 'friction', 'kicks', 'ropes'] as const) { const v = (P.scene as Record<string, unknown> | undefined)?.[k]; if (v !== undefined && !Array.isArray(v)) errs.push(`scene.${k} 要写成数组`); }
  if (errs.length) return errs;
  const sc = P.scene ?? ({} as Problem['scene']);
  const surfaces = Array.isArray(sc.surfaces) ? sc.surfaces : [];
  const bodies = Array.isArray(sc.bodies) ? sc.bodies : [];
  {   // 名字不能重复：物体、轨道共用一套名字（on 只写名字，重名就分不清）
    const seen = new Set<string>();
    for (const x of [...surfaces, ...bodies]) { if (!x || typeof x.id !== 'string' || !x.id) { errs.push('每条轨道、每个物体都要有字符串 id'); continue; } if (seen.has(x.id)) errs.push(`id "${x.id}" 重复：物体和轨道的名字不能重名`); seen.add(x.id); }
    const askIds = new Set<string>(); for (const a of P.asks) { if (askIds.has(a.id)) errs.push(`问题 id "${a.id}" 重复`); askIds.add(a.id); }
    // 支撑关系不能成环（A 在 B 上、B 又在 A 上）
    const onOf = new Map(bodies.map((b) => [b.id, b.on as string | undefined]));
    for (const b of bodies) { const path = [b.id]; let cur = onOf.get(b.id); while (cur && onOf.has(cur)) { if (path.includes(cur)) { errs.push(`物体的支撑关系成了环：${[...path, cur].join(' → ')}`); break; } path.push(cur); cur = onOf.get(cur); } }
  }
  if (!bodies.length && !sc.script && !sc.circuit && !LAB_KEYS.some((k) => sc[k])) errs.push('scene.bodies 不能为空；只有整题不能建模时，请写顶层 unsupported:"具体原因" 并保留解答；能模拟一部分则保留那部分场景');
  const keys = (where: string, value: object, allowed: string) => {
    const fields = new Set(allowed.split(' '));
    for (const key of Object.keys(value)) if (!fields.has(key)) errs.push(`${where}.${key} 不支持，不会生效；请使用已说明的字段`);
  };
  keys('scene', sc, 'notes backdrop surfaces bodies friction forces collisions springs resistance until tMax plane ropes fields kicks script em circuit optics gas wave electro atom ac induction gravity experiment particle ode statics nuclear slit lc splits');
  {   // 分裂：碎片 from 指向的母体要存在、要在 splits 里有触发；每个母体至少两块；最多一块不写速度
    const bl = (sc.bodies ?? []) as { id: string; from?: string; on?: string; v?: unknown; vel?: unknown }[], sp = ((sc as { splits?: { on?: string; when?: unknown }[] }).splits) ?? [];
    for (const b of bl) if (b.from !== undefined && !bl.some((x) => x.id === b.from)) errs.push(`bodies ${b.id}.from "${b.from}" 不是已有物体`);
    for (const [i, k] of sp.entries()) { const kids = bl.filter((b) => b.from === k.on); if (!bl.some((b) => b.id === k.on)) errs.push(`splits[${i}].on "${String(k.on)}" 不是已有物体`); else if (kids.length < 2) errs.push(`splits[${i}]：${k.on} 至少要有两块碎片（bodies 里写 from:"${k.on}"）`); if (!k.when) errs.push(`splits[${i}] 要写 when（什么时候分裂）`); if (kids.filter((b) => b.v === undefined && b.vel === undefined).length > 1) errs.push(`splits[${i}]：碎片最多一块不写速度（由动量守恒算出）`); }
    for (const b of bl) if (b.from && !sp.some((k) => k.on === b.from)) errs.push(`碎片 ${b.id} 的母体 ${b.from} 没有写进 splits，不会分裂`);
  }
  if (sc.lc) { const l = sc.lc as unknown as Record<string, unknown>; keys('scene.lc', l, 'L C R U0 q0 I0 duration'); for (const k of ['L', 'C']) if (l[k] === undefined) errs.push(`scene.lc 要写 ${k}`); if (l.U0 === undefined && l.q0 === undefined && l.I0 === undefined) errs.push('scene.lc 要写初始电压 U0、电荷 q0 或电流 I0 之一'); }
  if (sc.slit) { const sl = sc.slit as unknown as Record<string, unknown>; keys('scene.slit', sl, 'lambda d L a film probes range duration color'); for (const k of ['lambda', 'd', 'L']) if (sl[k] === undefined) errs.push(`scene.slit 要写 ${k}（单位 m）`); }
  if (sc.nuclear) {   // 原子核：衰变链引用、核反应粒子的写法
    const nu = sc.nuclear as unknown as Record<string, unknown>, at = 'scene.nuclear';
    keys(at, nu, 'duration dots species reaction');
    const sp = (nu.species as Record<string, unknown>[] | undefined) ?? [], ids = new Set(sp.map((x) => x.id));
    if (!sp.length && !nu.reaction) errs.push(`${at} 至少写 species（衰变）或 reaction（核反应方程）之一`);
    for (const [i, x] of sp.entries()) { if (typeof x.id !== 'string') errs.push(`${at}.species[${i}] 要有 id`); if (x.to !== undefined && !ids.has(x.to)) errs.push(`${at}.species[${i}].to "${String(x.to)}" 不在 species 里`); }
    const rx = nu.reaction as { left?: unknown[]; right?: unknown[] } | undefined;
    if (rx) for (const side of ['left', 'right'] as const) { const list = rx[side]; if (!Array.isArray(list) || !list.length) errs.push(`${at}.reaction.${side} 要写粒子数组`); else for (const n of list) if (!Array.isArray(n) || n.length !== 3 || typeof n[0] !== 'string' || typeof n[1] !== 'number' || typeof n[2] !== 'number') errs.push(`${at}.reaction.${side} 每个粒子写成 ["符号", 质量数, 电荷数]，如 ["He",4,2]`); }
  }
  if (sc.statics) {   // 受力平衡：结点、绳、杆、弹簧、接触面、外力的结构和引用
    const st = sc.statics as unknown as Record<string, unknown>, at = 'scene.statics';
    keys(at, st, 'duration g triangle plot points ropes rods springs surfaces forces');
    const pts = Array.isArray(st.points) ? st.points as { id?: unknown; at?: unknown; fixed?: unknown; m?: unknown }[] : [];
    if (!pts.length) errs.push(`${at}.points 至少要有一个结点或物体`);
    const ids = new Set<string>(); for (const p of pts) { if (typeof p.id !== 'string') errs.push(`${at}.points 每项要有字符串 id`); else if (ids.has(p.id)) errs.push(`${at}.points 的 id "${p.id}" 重复`); else ids.add(p.id); if (p.fixed && !Array.isArray(p.at)) errs.push(`${at}.points ${String(p.id)} 是固定点，必须写 at`); }
    if (!pts.some((p) => !p.fixed)) errs.push(`${at} 至少要有一个不固定的结点/物体（对它列平衡方程）`);
    const ref = (where: string, id: unknown) => { if (typeof id !== 'string' || !ids.has(id)) errs.push(`${where} 引用的结点 "${String(id)}" 不在 points 里`); };
    for (const k of ['ropes', 'rods', 'springs'] as const) for (const [i, r] of ((st[k] as Record<string, unknown>[] | undefined) ?? []).entries()) { if (typeof r.id !== 'string') errs.push(`${at}.${k}[${i}] 要有 id`); ref(`${at}.${k}[${i}].a`, r.a); ref(`${at}.${k}[${i}].b`, r.b); if (k === 'ropes') for (const v of (r.via as unknown[] | undefined) ?? []) if (typeof v === 'string') ref(`${at}.ropes[${i}].via`, v); else if (!Array.isArray(v) || v.length !== 2) errs.push(`${at}.ropes[${i}].via 每项是结点 id（光滑挂钩/动滑轮）或 [x,y]（定滑轮）`); if (k === 'springs' && (r.k === undefined || r.L0 === undefined)) errs.push(`${at}.springs[${i}] 要写 k 和 L0`); }
    for (const [i, f] of ((st.surfaces as Record<string, unknown>[] | undefined) ?? []).entries()) { ref(`${at}.surfaces[${i}].on`, f.on); if (f.angle === undefined && f.normal === undefined) errs.push(`${at}.surfaces[${i}] 要写 angle（面的倾角，度）或 normal（法向）`); }
    for (const [i, f] of ((st.forces as Record<string, unknown>[] | undefined) ?? []).entries()) { ref(`${at}.forces[${i}].on`, f.on); if (!f.F && f.dir === undefined) errs.push(`${at}.forces[${i}] 要写 F:[Fx,Fy]，或 dir（方向角，度）加 mag / unknown:true`); if (!f.F && !f.unknown && f.mag === undefined) errs.push(`${at}.forces[${i}] 写了 dir 还要写 mag，或 unknown:true 让引擎求大小`); }
  }
  const solvers = [...LAB_KEYS.filter((k) => sc[k]), ...(sc.script ? ['script'] : []), ...(sc.circuit ? ['circuit'] : [])];
  if (solvers.length > 1) errs.push(`scene 同时写了 ${solvers.join('、')}，引擎只会执行一个；跨实验室耦合请改用 ode 自写方程或 script 演示`);
  if (solvers.length && (bodies.length || ['forces', 'collisions', 'springs', 'ropes', 'friction', 'resistance', 'em', 'fields', 'kicks'].some((k) => (sc as unknown as Record<string, unknown[]>)[k]?.length))) errs.push('实验室/circuit/script 不会与原生 bodies、受力、碰撞、场自动耦合；请改用一个 ode 自写方程或一个 script 演示，删去不会生效的原生字段');

  const sIds = new Set([...surfaces.map((s) => s.id), ...(sc.em ?? []).map((f, i) => f.id ?? `${f.kind === 'B' ? '磁场' : f.kind === 'E' ? '电场' : '点电荷'}${i + 1}`)]), bIds = new Set(bodies.map((b) => b.id));
  const springIds = new Set((sc.springs ?? []).map((s) => s.id));
  const marks = new Set(surfaces.flatMap((s) => Object.keys(s.marks ?? {})));
  for (const id of [...sIds].filter((x) => bIds.has(x))) errs.push(`"${id}" 同时被用作轨道和物体的名字，请改成不同的名字`);

  // 变量：常量、已知量、未知量（包括各问自己的）
  const vars: Record<string, number> = { g: 9.8 };
  for (const k of Object.keys(P.unknowns ?? {})) vars[k] = 1;
  for (const a of P.asks ?? []) for (const k of Object.keys(a.unknowns ?? {})) vars[k] = 1;
  const tryEval = (where: string, x: unknown) => {
    if (x === undefined) return;
    if (typeof x === 'number') { if (!Number.isFinite(x)) errs.push(`${where} 必须是有限数值`); return; }
    if (typeof x !== 'string') { errs.push(`${where} 应该是数字或表达式字符串`); return; }
    try { if (!Number.isFinite(evaluate(x, { vars }))) errs.push(`${where} 结果必须是有限数值`); } catch (e) { errs.push(`${where}：${(e as Error).message}；已知量写进 params（字母题给示例数值并写 samples）；如果它是题目要你求的量，写进 unknowns 并用 conditions 求出，不要自己填数`); }
  };
  for (const [k, v] of Object.entries(P.constants ?? {})) { tryEval(`constants.${k}`, v); try { vars[k] = evaluate(v, { vars }); } catch { /* 已报 */ } }
  for (const [k, v] of Object.entries(P.params ?? {})) { const x = Array.isArray(v) ? v[0] : v; tryEval(`params.${k}`, x); try { vars[k] = evaluate(x as never, { vars }); } catch { /* 已报 */ } }
  const arbitrary = Object.entries(P.params ?? {}).filter(([, v]) => Array.isArray(v) && v[2]?.includes('数值任取')).map(([k]) => k);
  if (checkSamples && arbitrary.length && (!Array.isArray(P.samples) || P.samples.length !== 1)) errs.push('字母题需 samples: [{参数名: 第二组数值, …}]，第一组写在 params；必须给两组');
  if (P.samples !== undefined && (!Array.isArray(P.samples) || P.samples.length !== 1)) errs.push('samples 必须是只含第二组参数对象的数组');
  for (const k of arbitrary) if (vars[k] === 1) errs.push(`params.${k} 标有“数值任取”，不得取 1`);
  if (Array.isArray(P.samples) && P.samples.length === 1) {
    const second = P.samples[0];
    if (!second || typeof second !== 'object' || Array.isArray(second)) errs.push('samples[0] 必须是参数名到示例数值的对象');
    else {
      for (const k of arbitrary) if (!(k in second)) errs.push(`samples[0].${k} 缺少第二组数值，请由 AI 按题目隐含条件取值`);
      const next = { ...vars };
      for (const [k, v] of Object.entries(second)) {
        if (!(k in (P.params ?? {}))) errs.push(`samples[0].${k} 不是 params 中的参数`);
        if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`samples[0].${k} 必须直接写有限数值`);
        else { next[k] = v; if (arbitrary.includes(k) && v === 1) errs.push(`samples[0].${k} 标有“数值任取”，不得取 1`); }
      }
      if (!Object.keys(second).some((k) => next[k] !== vars[k])) errs.push('第二组与第一组相同，请提供不同的示例数值');
      if (checkSamples) errs.push(...validate({ ...P, samples: undefined, params: { ...P.params, ...second } }, false).map((e) => `第二组：${e}`));
    }
  }
  const unsupported = new Set(['inertia', 'momentOfInertia', 'rotation', 'rotational', 'pulley', 'pulleys', 'I']);
  const scanUnsupported = (v: unknown, at: string) => {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'marks' || k === 'script') continue; // 命名点 I 等只是名字，不是转动惯量字段。
      if (unsupported.has(k) || (k === 'kind' && ['rotor'].includes(String(x)))) errs.push(`${at}.${k}：不支持转动惯量和绳轮耦合`);
      scanUnsupported(x, `${at}.${k}`);
    }
  };
  scanUnsupported(sc, 'scene');

  for (const s of surfaces) {
    const w = `轨道 ${s.id}`, ground = s.kind === 'ground' || (s.y !== undefined && !s.from && !s.center);
    keys(w, s, 'id kind from to dir length y center radius start end turn side mu speed next marks walls on resistance losses rails tether');
    if (s.kind && !['segment', 'ground', 'arc'].includes(s.kind)) errs.push(`${w}.kind 不支持`);
    if (ground && (s.from || s.to || s.dir || s.center)) errs.push(`${w} 是地面，几何只写 y`);
    if (s.kind !== 'arc' && !s.center && s.to && (s.dir || s.length !== undefined)) errs.push(`${w} 的 from+to 与 dir+length 只能选一种`);
    if ((s.kind === 'arc' || s.center) && (s.from || s.to || s.dir || s.length !== undefined || s.y !== undefined)) errs.push(`${w} 的圆弧不能混用线段几何字段`);
    if (!s.id) errs.push('有一段轨道没有 id');
    if (ground && (s.walls || s.next || s.length !== undefined || s.marks && Object.values(s.marks).some(Array.isArray))) errs.push(`${w} 是无限地面，不支持端点、walls、next、length 或方向式标记；请使用有限线段`);
    if ((s.kind === 'arc' || s.center) && (s.speed !== undefined || s.walls)) errs.push(`${w} 的圆弧不支持传送带 speed 或端点 walls`);
    if (s.kind === 'arc' || s.center) {
      if (!s.center || s.radius === undefined || s.start === undefined || s.end === undefined) errs.push(`${w} 是圆弧，需要 center、radius、start、end`);
    } else if (s.kind !== 'ground' && s.y === undefined && !(s.from && (s.to || (s.dir && s.length !== undefined)))) errs.push(`${w} 需要 from + to，或 from + dir + length（地面写 kind:"ground" 和 y）`);
    for (const v of [s.from, s.to, s.dir, s.center].filter(Boolean) as unknown[][]) v.forEach((x, i) => tryEval(`${w} 的坐标第 ${i + 1} 个分量`, x));
    for (const k of ['length', 'radius', 'y', 'speed'] as const) tryEval(`${w}.${k}`, s[k]);
    for (const mu of s.mu === undefined ? [] : Array.isArray(s.mu) ? s.mu : [s.mu]) { tryEval(`${w}.mu`, mu); try { if (evaluate(mu, { vars }) < 0) errs.push(`${w}.mu 必须非负`); } catch { /* 已报 */ } }
    for (const k of ['length', 'radius'] as const) if (s[k] !== undefined) try { if (evaluate(s[k]!, { vars }) <= 0) errs.push(`${w}.${k} 必须大于零`); } catch { /* 已报 */ }

    if (s.next && !sIds.has(s.next) && !bIds.has(s.next)) errs.push(`${w}.next 指向的 "${s.next}" 不存在`);
    if (s.on && !bIds.has(s.on)) errs.push(`${w}.on 指向的物体 "${s.on}" 不存在`);
    if (s.resistance !== undefined) {
      try { const z = evaluate(s.resistance, { vars: { ...vars, s: 0, v: 0, t: 0 } }); if (!Number.isFinite(z) || z < 0) errs.push(`${w}.resistance 必须非负且有限`); }
      catch (e) { errs.push(`${w}.resistance：${(e as Error).message}`); }
      if (s.on) errs.push(`${w}.resistance 暂不支持可动轨道的阻力反作用耦合`);
    }
    for (const loss of s.losses ?? []) {
      keys(`${w}.losses`, loss, 'at energy fraction');
      if (loss.at === undefined) errs.push(`${w}.losses 缺少 at（损失位置）`);
      tryEval(`${w}.losses.at`, loss.at);
      if ((loss.energy === undefined) === (loss.fraction === undefined)) errs.push(`${w}.losses 每项必须只写 energy 或 fraction`);
      for (const k of ['energy', 'fraction'] as const) if (loss[k] !== undefined) {
        tryEval(`${w}.losses.${k}`, loss[k]);
        try { const x = evaluate(loss[k]!, { vars }); if (x < 0 || (k === 'fraction' && x > 1)) errs.push(`${w}.losses.${k} 范围错误`); } catch { /* 已报 */ }
      }
      if (s.on || s.speed !== undefined) errs.push(`${w}.losses 只支持静止轨道，损失按沿轨道动能计算`);
    }
  }
  // 支撑/约束能力边界：宁可给出可操作的拒绝原因，也不把运动约束当固定外力静默算错。
  const fallback = '；请改用 ode 实验室自写方程或 script 解析演示';
  const rootTrack = (id: string | undefined) => {
    const seen = new Set<string>();
    while (id && bIds.has(id) && !seen.has(id)) { seen.add(id); id = bodies.find((b) => b.id === id)?.on; }
    return surfaces.find((s) => s.id === id);
  };
  const lineGeo = (s: typeof surfaces[number]) => {
    const val = (x: unknown) => evaluate((x ?? 0) as number | string, { vars });
    const p = s.from?.map(val) ?? [0, val(s.y)], d = s.to ? s.to.map((v, i) => val(v) - p[i]) : s.dir?.map(val) ?? [1, 0], l = Math.hypot(...d);
    return { p, u: d.map((v) => v / l) };
  };
  const moving = surfaces.filter((s) => s.on), loaded = new Set<string>();
  for (const s of moving) {
    let h = bodies.find((b) => b.id === s.on); const seen = new Set<string>();
    while (h && !seen.has(h.id)) { seen.add(h.id); loaded.add(h.id); h = bodies.find((b) => b.id === h?.on); }
    const H = bodies.find((b) => b.id === s.on), S = rootTrack(H?.on);
    if (H?.kind !== 'board' || !S || S.on || S.kind === 'arc' || S.center) errs.push(`轨道 ${s.id} 的宿主必须是沿固定直线纯平移的木板（可叠放在其他木板上），不支持自由/转动/嵌套可动支撑${fallback}`);
    if (s.kind === 'ground') errs.push(`可动轨道 ${s.id} 需有限直线或圆弧，不能使用无限 ground${fallback}`);
    if (s.walls) errs.push(`可动轨道 ${s.id} 的挡板冲量尚未耦合${fallback}`);
    if (s.next) { const next = surfaces.find((v) => v.id === s.next); if (next ? next.on !== s.on : s.next !== s.on) errs.push(`可动轨道 ${s.id}.next 只能接同宿主轨道或宿主木板，不支持跨参考系冲量${fallback}`); }
  }
  for (const s of surfaces.filter((s) => !s.on && s.next)) if (surfaces.find((n) => n.id === s.next)?.on) errs.push(`固定轨道 ${s.id} 不能直接 next 到可动轨道；请通过宿主木板的 next 平滑接续${fallback}`);
  const endpoint = (s: typeof surfaces[number], end: boolean) => {
    const val = (x: unknown) => evaluate((x ?? 0) as number | string, { vars });
    if (s.kind === 'arc' || s.center) {
      const a = end ? s.end : s.start, th = Array.isArray(a) ? Math.atan2(val(a[1]), val(a[0])) : val(a) * Math.PI / 180, sign = s.turn === 'cw' ? -1 : 1;
      return { p: [val(s.center?.[0]) + val(s.radius) * Math.cos(th), val(s.center?.[1]) + val(s.radius) * Math.sin(th)], u: [-sign * Math.sin(th), sign * Math.cos(th)] };
    }
    const { p, u } = lineGeo(s), len = s.to ? Math.hypot(...s.to.map((x, i) => val(x) - p[i])) : val(s.length);
    return { p: p.map((x, i) => x + (end ? len * u[i] : 0)), u };
  };
  const smoothJoin = (name: string, a: { p: number[]; u: number[] }, b: { p: number[]; u: number[] }) => {
    if (Math.hypot(...a.p.map((x, i) => x - b.p[i])) > 1e-7 || a.u.reduce((v, u, i) => v + u * b.u[i], 0) < 1 - 1e-10) errs.push(`${name} 的接续端点及正向切线必须一致，不支持折角冲量/位置跳变${fallback}`);
  };
  for (const s of moving) try {
    if (s.next) { const N = surfaces.find((n) => n.id === s.next), H = bodies.find((b) => b.id === s.on);
      if (N?.on === s.on) smoothJoin(`可动轨道 ${s.id}→${N.id}`, endpoint(s, true), endpoint(N, false));
      else if (s.next === H?.id) smoothJoin(`可动轨道 ${s.id}→宿主`, endpoint(s, true), { p: [0, 0], u: lineGeo(rootTrack(H.on)!).u });
    }
  } catch { /* 参数/几何另报 */ }
  for (const H of bodies.filter((b) => b.next)) try {
    const s = surfaces.find((s) => s.id === H.next), S = rootTrack(H.on);
    if (s?.on === H.id && S) { const u = lineGeo(S).u, L = evaluate(H.length ?? 0, { vars }); smoothJoin(`木板 ${H.id}.next`, { p: u.map((v) => v * L), u }, endpoint(s, false)); }
  } catch { /* 参数/几何另报 */ }
  for (const b of bodies) {
    const S = rootTrack(b.on);
    if (S?.on && b.x !== undefined) errs.push(`物体 ${b.id} 在可动轨道上请用相对坐标 at，不能用世界 x`);
    if ((S?.kind === 'arc' || S?.center || S?.on) && bodies.some((c) => c.on === b.id)) errs.push(`物体 ${b.id} 不支持在圆弧/可动轨道上继续承载叠放物体${fallback}`);
    if (b.locked && (bIds.has(b.on!) || S?.on || S?.kind === 'arc' || S?.center)) errs.push(`物体 ${b.id} 的 locked 只支持直接沿固定直线的完全固定装置，不支持叠放/曲线锁定${fallback}`);
    if (loaded.has(b.id) && b.walls) errs.push(`承载可动轨道的木板 ${b.id} 不支持挡板冲量${fallback}`);
    if (b.next && surfaces.find((s) => s.id === b.next)?.on !== b.id) errs.push(`木板 ${b.id}.next 必须是固定在自身的轨道${fallback}`);
    if (b.on && ((b.q !== undefined && sc.em?.length) || sc.fields?.length)) errs.push(`物体 ${b.id} 的轨道约束尚未联立电磁力/中心引力${fallback}`);
  }
  // 管道 N 可以换符号，干摩擦需另解内/外壁接触；本次不把 N 当成始终为正。
  if (moving.length) for (const s of surfaces) if (s.side === 'tube' && s.mu !== undefined) {
    try { if ((Array.isArray(s.mu) ? s.mu : [s.mu]).some((v) => evaluate(v, { vars }) !== 0)) errs.push(`圆管 ${s.id} 与可动支撑共存时不支持有摩擦的双侧接触${fallback}`); } catch { /* 数值另报 */ }
  }
  for (const r of sc.ropes ?? []) {
    keys('ropes', r, 'id between via');
    if (!Array.isArray(r.between) || r.between.length !== 2) { errs.push('ropes.between 需两个物体'); continue; }
    for (const id of r.between) { const b = bodies.find((b) => b.id === id), S = rootTrack(b?.on);
      if (!b || !S || bIds.has(b.on!) || S.on || S.kind === 'arc' || S.center || loaded.has(id)) errs.push(`绳端 ${id} 只支持直接沿固定直线运动，不支持板上物体/可动支撑/圆弧${fallback}`);
    }
    for (const id of r.between) {
      const S = rootTrack(bodies.find((b) => b.id === id)?.on);
      if (S?.walls || S?.losses?.length || sc.collisions?.some((c) => c.bodies?.includes(id)) || sc.kicks?.some((k) => k.on === id)) errs.push(`绳端 ${id} 的碰撞/挡板/瞬时损失/变速尚未联立绳的冲量约束${fallback}`);
    }
    r.via?.forEach((p) => p.forEach((x) => tryEval('ropes.via', x)));
    try {
      const ends = r.between.map((id) => bodies.find((b) => b.id === id)!);
      if (ends.every((b) => b?.on && surfaces.some((s) => s.id === b.on && !s.on && s.kind !== 'arc' && !s.center))) {
        const gs = ends.map((b) => lineGeo(rootTrack(b.on)!)), ps = ends.map((b, i) => {
          const d = b.x === undefined ? evaluate(b.at ?? 0, { vars }) : (evaluate(b.x, { vars }) - gs[i].p[0]) / gs[i].u[0];
          return gs[i].p.map((v, k) => v + d * gs[i].u[k]);
        });
        const ks = ps.map((p, i) => { const via = i === 0 ? r.via?.[0] : r.via?.at(-1), q = via ? via.map((x) => evaluate(x, { vars })) : ps[1 - i], d = q.map((x, k) => x - p[k]), len = Math.hypot(...d); return d.reduce((v, x, k) => v + x / len * gs[i].u[k], 0); });
        if (ks.some((k) => !Number.isFinite(k) || Math.abs(Math.abs(k) - 1) > 1e-10)) errs.push(`绳 ${r.id ?? ''} 端点到定滑轮的方向必须沿各自轨道${fallback}`);
        else if (Math.abs(ks.reduce((v, k, i) => v + k * evaluate(ends[i].v ?? 0, { vars }), 0)) > 1e-9) errs.push(`绳 ${r.id ?? ''} 初速度不满足绳长约束；不支持初始松弛或瞬时绷紧${fallback}`);
      }
    } catch { /* 坐标/变量已单独校验 */ }
  }
  for (const c of sc.collisions ?? []) {
    const ids = c.bodies ?? [], trackBodies = ids.filter((id) => rootTrack(bodies.find((b) => b.id === id)?.on)?.on);
    if (ids.some((id) => loaded.has(id)) || trackBodies.length > 1) errs.push(`碰撞 ${ids.join('/')} 涉及可动支撑上的冲量/粘连，尚未联立求解${fallback}`);
    try { if (evaluate(c.e, { vars }) === 0 && ((sc.em?.length && ids.some((id) => bodies.find((b) => b.id === id)?.q !== undefined)) || sc.fields?.length)) errs.push(`碰撞 ${ids.join('/')} 粘连后尚未联立电磁力/中心引力的整体约束${fallback}`); } catch { /* e 另报 */ }
    // 一端先出轨再撞固定物体是合法的；仍在可动轨道时相撞由运行期保护明确拒绝。
  }

  for (const k of sc.kicks ?? []) if (loaded.has(k.on) || rootTrack(bodies.find((b) => b.id === k.on)?.on)?.on) errs.push(`瞬时变速 ${k.on} 尚不支持可动支撑的反冲耦合${fallback}`);
  const order = bodies.map((b) => b.id);
  for (const b of bodies) {
    const w = `物体 ${b.id}`;
    keys(w, b, 'id kind m length on at x v pos vel walls next locked look q from release');
    if (b.on && (b.pos || b.vel)) errs.push(`${w} 在轨道上，pos/vel 不会生效，请使用 at/v`);
    if (b.locked && b.v !== undefined) try { if (evaluate(b.v, { vars }) !== 0) errs.push(`${w} 已锁定，初速度 v 必须是 0`); } catch { /* 数值另报 */ }
    if (b.kind === 'board' && b.length === undefined) errs.push(`${w} 的 board 缺少 length`);
    if (!b.id) errs.push('有一个物体没有 id');
    if (b.m === undefined) errs.push(`${w} 缺少质量 m`);
    tryEval(`${w}.m`, b.m);
    for (const k of ['m', 'length'] as const) if (b[k] !== undefined) {
      try { if (evaluate(b[k]!, { vars }) <= 0) errs.push(`${w}.${k} 必须大于零`); } catch { /* 已报 */ }
    }
    for (const k of ['length', 'at', 'x', 'v'] as const) tryEval(`${w}.${k}`, b[k]);
    for (const k of ['pos', 'vel'] as const) b[k]?.forEach((x, i) => tryEval(`${w}.${k}[${i}]`, x));
    if (b.on) {
      if (!sIds.has(b.on) && !bIds.has(b.on)) errs.push(`${w}.on 指向的 "${b.on}" 不存在`);
      if (bIds.has(b.on) && order.indexOf(b.on) > order.indexOf(b.id)) errs.push(`${w} 放在 ${b.on} 上，${b.on} 要写在它前面`);
    } else if (!b.pos && !(b as { from?: string }).from) errs.push(`${w} 既没有 on（在哪条轨道或哪块木板上），也没有 pos（抛体的初位置）`);
    if (!b.on && !(b as { from?: string }).from && (b.locked || b.walls || b.next || b.v !== undefined || b.at !== undefined || b.x !== undefined)) errs.push(`${w} 是空中物体，不支持 locked、walls、next 或沿轨道的 v/at/x；请用 pos/vel`);
    if (b.next && !sIds.has(b.next)) errs.push(`${w}.next 指向的轨道 "${b.next}" 不存在`);
  }
  const needBody = (w: string, id: string) => { if (!bIds.has(id)) errs.push(`${w} 里的物体 "${id}" 不存在`); };
  for (const f of sc.friction ?? []) {
    keys('friction', f, 'between mu'); f.between?.forEach((id) => needBody('friction', id));
    if (!Array.isArray(f.between) || f.between.length !== 2 || f.mu === undefined) errs.push('friction 需 between:[两个物体] 和 mu');
    tryEval('friction.mu', f.mu);
    try { if (evaluate(f.mu, { vars }) < 0) errs.push('friction.mu 必须非负'); } catch { /* 已报 */ }
  }
  for (const c of sc.collisions ?? []) c.bodies?.forEach((id) => needBody('collisions', id));
  for (const c of sc.collisions ?? []) {
    keys('collisions', c, 'bodies e');
    if (!Array.isArray(c.bodies) || new Set(c.bodies).size < 2) errs.push('collisions.bodies 需至少两个不同的物体');
    tryEval('collisions.e', c.e);
    if (c.e === undefined) errs.push('collisions 缺少恢复系数 e');
    try { const e = evaluate(c.e, { vars }); if (e < 0 || e > 1) errs.push('collisions.e 必须在 0 到 1 之间'); } catch { /* 已报 */ }
  }
  for (const sp of sc.springs ?? []) {
    keys(`弹簧 ${sp.id}`, sp, 'id between k L0 anchors mode unlock');
    sp.between?.forEach((id) => needBody(`弹簧 ${sp.id}`, id));
    if (sp.mode !== undefined && sp.mode !== 'contact') errs.push(`弹簧 ${sp.id}.mode 只能是 contact 或省略`);
    if (sp.k === undefined) errs.push(`弹簧 ${sp.id} 缺少 k`);
    tryEval(`弹簧 ${sp.id}.k`, sp.k); tryEval(`弹簧 ${sp.id}.L0`, sp.L0);
    const endpoints = (sp.between ?? []).map((id) => bodies.find((b) => b.id === id));
    if (endpoints.length !== 2) errs.push(`弹簧 ${sp.id}.between 需两个端点`);
    if (endpoints.some((b) => { const s = rootTrack(b?.on); return !s || s.kind === 'arc' || !!s.center || !!s.on; })) errs.push(`弹簧 ${sp.id} 两端需沿共线直线运动；可以连接木板和板上物体，不支持圆弧或空中弹簧${fallback}`);
    const tracks = endpoints.map((b) => rootTrack(b?.on));
    if (tracks.every((s) => s && !s.on && s.kind !== 'arc' && !s.center)) try {
      const A = lineGeo(tracks[0]!), B = lineGeo(tracks[1]!), cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];
      if (Math.abs(cross(A.u, B.u)) > 1e-10 || Math.abs(cross(B.p.map((x, i) => x - A.p[i]), A.u)) > 1e-9) errs.push(`弹簧 ${sp.id} 两端直线必须共线，不支持平行错开或非共线弹簧${fallback}`);
    } catch { /* 几何另报 */ }
    if (sp.anchors !== undefined) {
      if (!Array.isArray(sp.anchors) || sp.anchors.length !== 2) errs.push(`弹簧 ${sp.id}.anchors 需两个沿各端物体轨道方向的连接点偏移`);
      else sp.anchors.forEach((x, i) => tryEval(`弹簧 ${sp.id}.anchors[${i}]`, x));
    }
  }
  for (const f of sc.forces ?? []) {
    keys(`forces.${f.on}`, f, 'on F along until after');
    needBody('forces', f.on);
    if (f.F === undefined && f.along === undefined) errs.push(`forces.${f.on} 缺少 F 或 along`);
    if (f.F !== undefined && (!Array.isArray(f.F) || f.F.length !== 2)) errs.push(`forces.${f.on}.F 需两个分量`);
    if (f.along !== undefined && !bodies.find((b) => b.id === f.on)?.on) errs.push(`forces.${f.on}.along 需轨道；空中物体请写 F:[Fx,Fy]`);
    for (const x of [...(f.F ?? []), f.along ?? 0]) {
      try { if (!Number.isFinite(evaluate(x, { vars: { ...vars, ...Object.fromEntries(bodies.map((b) => [`v_${b.id}`, 1])), t: 0, v: 1, vx: 1, vy: 1 } }))) errs.push('forces 表达式必须有限'); } catch (e) { errs.push(`forces：${(e as Error).message}`); }
    }
  }
  for (const r of sc.resistance ?? []) {
    keys(`resistance.${r.on}`, r, 'on magnitude relativeTo');
    if (r.magnitude === undefined) errs.push(`resistance.${r.on} 缺少 magnitude（单位 N）`);
    needBody('resistance', r.on); tryEval('resistance.magnitude', r.magnitude);
    const b = bodies.find((b) => b.id === r.on);
    if (!b?.on) errs.push(`resistance.${r.on} 需在轨道或支撑物上；暂不支持空中恒模阻力`);
    if (r.relativeTo && r.relativeTo !== b?.on) errs.push(`resistance.${r.on}.relativeTo 必须是当前支撑物`);
    if (surfaces.find((s) => s.id === b?.on)?.on) errs.push(`resistance.${r.on} 暂不支持可动轨道的阻力反作用耦合`);
    try { if (evaluate(r.magnitude, { vars }) < 0) errs.push('resistance.magnitude 必须非负'); } catch { /* 已报 */ }
  }

  if ((sc.ropes?.length || moving.length) && !errs.length && !Object.keys(P.unknowns ?? {}).length && !sc.script && !sc.circuit && !LAB_KEYS.some((k) => sc[k])) try {
    simulate({ ...sc, tMax: 0, until: undefined }, vars, { whenValue: () => 1 });
  } catch (e) { errs.push(`支撑/轻绳初态约束不能成立：${(e as Error).message}${fallback}`); }

  const checkExpression = (where: string, expression: string, times: Record<string, EventSpec> = {}, vals: Record<string, unknown> = {}, boolean = false, locals: Record<string, unknown> = {}) => {
    try {
      const ast = parseExpression(expression); if (boolean && !isBooleanExpression(ast)) errs.push(`${where} 必须是布尔判断式，例如 v(A)>0 或 approx(v(A),v0,1e-6,0)`);
      const ids = new Set([...bIds, ...Object.keys(sc.script?.bodies ?? {})]);
      const walk = (e: Expr) => {
        if (e.kind === 'name') { if (!(e.name in vars) && !(e.name in locals) && !(e.name in vals) && !(e.name in times) && !['t', 'pi', 'true', 'false'].includes(e.name)) errs.push(`${where} 的变量 ${e.name} 没有定义`); }
        else if (e.kind === 'unary') walk(e.arg);
        else if (e.kind === 'binary') { walk(e.left); walk(e.right); }
        else if (e.kind === 'call') {
          if (!(Object.hasOwn(SNAP_ARITY, e.name))) { if (!MATH_FUNCTIONS.has(e.name)) errs.push(`${where} 不认识函数 ${e.name}()`);
            const n = e.args.length, valid = ['min', 'max'].includes(e.name) ? n >= 1 : e.name === 'approx' ? n >= 2 && n <= 4 : ['atan2', 'mod'].includes(e.name) ? n === 2 : n === 1;
            if (!valid) errs.push(`${where} 的 ${e.name}() 参数个数不对`); e.args.forEach(walk); return; }
          const n = SNAP_ARITY[e.name], min = ['T', 'Q', 'count'].includes(e.name) ? 0 : n;
          if (e.args.length < min || e.args.length > n + 1) errs.push(`${where} 的 ${e.name}() 参数个数不对`);
          for (let i = 0; i < Math.min(n, e.args.length); i++) {
            const arg = e.args[i]; if (arg.kind !== 'name') { errs.push(`${where} 的 ${e.name}() 前 ${n} 个参数需写对象名字`); continue; }
            const pool = e.name === 'val' ? undefined : ['Ep', 'Fs'].includes(e.name) ? springIds : e.name === 'T' ? new Set((sc.ropes ?? []).map((r, i) => r.id ?? (i ? `绳${i + 1}` : '绳'))) : ['I', 'Is', 'U', 'P'].includes(e.name) ? new Set(sc.circuit?.elements.map((c) => c.id)) : e.name === 'Vn' ? new Set(Object.keys(sc.circuit?.nodes ?? {})) : e.name === 'path' && i === 1 ? sIds : ['Q', 'count'].includes(e.name) ? new Set([...ids, ...sIds, ...(e.name === 'Q' ? ['碰撞'] : [])]) : ids;
            if (pool && !pool.has(arg.name)) errs.push(`${where} 的 ${e.name}() 引用的对象 ${arg.name} 不存在`);
          }
          if (e.args.length === n + 1) { const alias = e.args[n]; if (alias.kind !== 'name' || !(alias.name in times)) errs.push(`${where} 的末尾时刻参数必须是 asks.times 声明的事件别名`); }
        }
      };
      walk(ast);
    } catch (e) { errs.push(`${where}：${(e as Error).message}`); }
  };
  const checkEvent = (w: string, e?: EventSpec, locals: Record<string, unknown> = {}) => {
    if (!e) return;
    if (e.phase !== undefined && !['before', 'after'].includes(e.phase)) errs.push(`${w}.phase 只能是 before 或 after`);
    if (!EVENTS.has(e.event)) { errs.push(`${w} 的事件名 "${e.event}" 不认识，可用：${[...EVENTS].join('、')}`); return; }
    if (e.event === 'when' && e.expr) checkExpression(`${w}.expr`, e.expr, {}, {}, false, locals);
    if (e.event === 'when' && !e.expr) errs.push(`${w} 的 when 事件需写 expr（这个式子等于 0 的时刻）`);
    if (e.event === 'time') {
      if (e.t === undefined) errs.push(`${w} 的 time 事件需写 t`);
      else { tryEval(`${w}.t`, e.t); try { if (evaluate(e.t, { vars }) < 0) errs.push(`${w} 的 time.t 不得小于零`); } catch { /* 已报 */ } }
    }
    if (e.event === 'mark' && e.name && (sc.ode || sc.script || sc.circuit)) {
      const names = new Set([...(sc.ode?.events ?? []).map((e) => e.name), ...(sc.script?.marks ?? []).map((e) => e.label), ...(sc.circuit?.marks ?? []).map((e) => e.label)]);
      if (!names.has(e.name)) errs.push(`${w} 的命名事件 ${e.name} 不存在，请检查 events/marks 的 name/label`);
    }
    if (e.body && !bIds.has(e.body) && !springIds.has(e.body)) errs.push(`${w} 的事件里物体 "${e.body}" 不存在`);
    const other = e.from ?? e.to;
    if (other && !sIds.has(other) && !bIds.has(other) && !marks.has(other)) errs.push(`${w} 的事件里 "${other}" 不是已有的轨道、物体或命名点`);
    e.bodies?.forEach((id) => { if (!bIds.has(id)) errs.push(`${w} 的事件里物体 "${id}" 不存在`); });
  };
  const checkConditions = (list: Problem['conditions'], where: string, locals: Record<string, unknown> = {}) => {
    if (list?.some((c) => c.just) && (list.length !== 1 || list[0].eq !== undefined)) errs.push(`${where} 的 just 目前只能独立使用，不能忽略其余等式条件`);
    for (const [i, c] of (list ?? []).entries()) {
      keys(`${where} ${i + 1}`, c, 'at eq just times vals say');
      if (c.eq === undefined && !c.just) errs.push(`${where} ${i + 1} 缺少 eq 或 just`);
      checkEvent(`${where} ${i + 1}`, c.at, locals); checkEvent(`${where} ${i + 1}`, c.just, locals);
    }
  };
  checkConditions(P.conditions, '条件');
  for (const f of sc.forces ?? []) { checkEvent('forces.until', f.until); checkEvent('forces.after', f.after); }
  checkEvent('scene.until', sc.until);
  for (const b of sc.bodies ?? []) if ((b as { release?: EventSpec }).release) checkEvent(`物体 ${b.id}.release`, (b as { release?: EventSpec }).release);
  tryEval('scene.tMax', sc.tMax);
  for (const a of P.asks ?? []) {
    const w = `第 (${a.id}) 问`;
    for (const k of Object.keys(a.with ?? {})) if (k in (a.unknowns ?? {})) errs.push(`${w} 的 ${k} 不能同时写 with 已知值和 unknowns`);
    if (a.scene) {
      errs.push(...validate({ ...P, scene: a.scene, samples: undefined, params: { ...P.params, ...a.with }, unknowns: a.unknowns, conditions: a.conditions ?? [], asks: [{ ...a, scene: undefined, with: undefined, unknowns: undefined, conditions: undefined }], solution: { [a.id]: solutionFor(P, a.id) ?? [] } }, false).map((e) => `${w} 独立场景：${e}`));
      continue;
    }
    if (a.expr !== undefined && (typeof a.expr !== 'string' || !a.expr.trim())) errs.push(`${w} expr 要写非空表达式；仅代数小问请省略 expr`);
    if (a.expr === undefined && a.answer === undefined && a.answerText === undefined && !a.option) errs.push(`${w} 省略 expr 时需保留 answer 或 answerText（仅代数，未模拟验证）`);
    if (a.option !== undefined) {
      const o = a.option;
      if (!o || typeof o !== 'object' || Array.isArray(o)) errs.push(`${w}.option 必须是对象`);
      else {
        keys(`${w}.option`, o, 'label text correct claim');
        if (typeof o.label !== 'string' || typeof o.text !== 'string') errs.push(`${w}.option 需字符串 label/text`);
        if (o.correct !== undefined && typeof o.correct !== 'boolean') errs.push(`${w}.option.correct 必须是布尔值，改条件后可省略`);
        if (!o.claim && o.correct === undefined) errs.push(`${w}.option 至少提供 claim 或 correct`);
        if (o.claim !== undefined) { if (typeof o.claim !== 'string' || !o.claim.trim()) errs.push(`${w}.option.claim 必须是非空判断式`); else checkExpression(`${w}.option.claim`, o.claim, a.times, a.vals, true, a.with); }
      }
    }
    for (const k of ['verified', 'source', 'claimValue', 'claimOk', 'claimSource']) if (k in a) errs.push(`${w}.${k} 由引擎生成，不能由 AI 声明`);
    if ((a as unknown as Record<string, unknown>).claim !== undefined) errs.push(`${w} 的判断式请写在 option.claim`);
    // 数值式沿用同一事件别名语法；旧单参数表达式不额外做静态变量推断。
    if (a.expr && Object.keys(a.times ?? {}).length) checkExpression(`${w}.expr`, a.expr, a.times, a.vals, false, a.with);
    for (const [name, v] of Object.entries(a.vals ?? {})) { checkEvent(`${w} vals.${name}`, v.at, a.with); if (a.option?.claim) checkExpression(`${w} vals.${name}.expr`, v.expr, a.times, a.vals, false, a.with); }
    const visiting = new Set<string>(), visited = new Set<string>();
    const visitAlias = (name: string) => {
      if (visiting.has(name)) { errs.push(`${w}.vals 存在循环引用：${[...visiting, name].join(' → ')}`); return; }
      if (visited.has(name)) return; visiting.add(name);
      try { for (const dep of dependencies(a.vals![name].expr).names) if (dep in (a.vals ?? {})) visitAlias(dep); } catch { /* 表达式在实际使用处报错 */ }
      visiting.delete(name); visited.add(name);
    };
    for (const name of Object.keys(a.vals ?? {})) visitAlias(name);
    checkEvent(w, a.at, a.with);
    for (const [k, e] of Object.entries(a.times ?? {})) checkEvent(`${w} times.${k}`, e, a.with);
    checkConditions(a.conditions, `${w} 条件`, a.with);
    if (a.keep !== undefined) {
      const segs = new Set((sc.surfaces ?? []).filter((q) => (q as { kind?: string }).kind !== 'arc' && (q as { kind?: string }).kind !== 'ground').map((q) => q.id));
      const boards = new Set((sc.bodies ?? []).filter((b) => b.kind === 'board').map((b) => b.id)), bodies = new Set((sc.bodies ?? []).map((b) => b.id));
      if (!Array.isArray(a.keep)) errs.push(`${w} 的 keep 要写成数组，如 [{"angle":"斜面"}]`);
      else for (const k of a.keep) {
        if (!k || typeof k !== 'object') { errs.push(`${w} 的 keep 每一项要写成对象`); continue; }
        if (k.angle !== undefined && !segs.has(k.angle)) errs.push(`${w} 的 keep.angle "${k.angle}" 要写一段直轨道的 id`);
        if (k.length !== undefined && !segs.has(k.length) && !boards.has(k.length)) errs.push(`${w} 的 keep.length "${k.length}" 要写木板或直轨道的 id`);
        if (k.gap !== undefined && (!Array.isArray(k.gap) || k.gap.length !== 2 || k.gap.some((x) => !bodies.has(x)))) errs.push(`${w} 的 keep.gap 要写两个物体的 id，如 ["A","B"]`);
        if (k.angle === undefined && k.length === undefined && k.gap === undefined) errs.push(`${w} 的 keep 每一项写 angle、length 或 gap 之一`);
      }
    }
    if (a.predict !== undefined) {
      const pr = a.predict;
      if (!pr || typeof pr.q !== 'string' || !pr.q) errs.push(`${w} 的 predict 缺少 q（预测题的题干）`);
      if (!Array.isArray(pr?.options) || pr.options.length < 2 || pr.options.some((o) => typeof o !== 'string')) errs.push(`${w} 的 predict.options 要写至少两个选项（字符串）`);
      else if (!Number.isInteger(pr.answer) || pr.answer < 1 || pr.answer > pr.options.length) errs.push(`${w} 的 predict.answer 要写正确选项的序号，从 1 开始，在 1 到 ${pr.options.length} 之间`);
    }
  }
  for (const [id, steps] of Object.entries(P.solution ?? {})) {
    if (!(P.asks ?? []).some((a) => a.id === id || a.id.startsWith(id))) errs.push(`solution 里的 "${id}" 没有对应的问题 id`);
    if ((P.asks ?? []).some((a) => a.scene && (a.id === id || a.id.startsWith(id)))) continue; // 已在该问独立场景内校验
    for (const [i, st] of (steps ?? []).entries()) if (st.check) checkEvent(`第 (${id}) 问解题第 ${i + 1} 步`, st.check.at);
  }
  return errs;
}

export function formatRepair(errs: string[]): string {
  return ['你给的 JSON 有几处格式问题，网站读不懂。请逐条改正，然后重新输出完整的 JSON（只输出一个 ```json 代码块）：', ...errs.map((e) => `- ${e}`), '改的时候不要为了躲开报错把小问改成只含参数的式子：每一问的 expr 要读模拟量（如 v(A)、KE(A)、val(I)），场景按题意建模。'].join('\n');
}
