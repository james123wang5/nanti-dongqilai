// 修改提示：引擎能跑完、但有小问算不出或和答案对不上时，汇总成一段话，学生复制发回给 AI 改 JSON。
// 格式错误用 validate.formatRepair；整题运行报错由播放器拼；这里管“跑完了但结果有问题”。
import type { Solved, AskResult } from './solve.ts';
import type { SimResult } from './sim.ts';
import { nice } from './num.ts';
import { verificationCounts } from './source.ts';

/** 修改提示的统一结尾：防止 AI 为了躲开报错把小问改成只含参数的式子 */
export const KEEP_SIM = '不要为了躲开报错把小问改成只含参数的式子：每一问的 expr 要读模拟量（如 v(A)、x(B)、KE(A)、val(y_P)、val(I)），场景按题意建模，这样网站才能用模拟核对答案。';

type Group = { label?: string; asks: AskResult[]; repair?: string; error?: string; sim?: SimResult };

/** 引擎实际记录到的事件，写成 JSON 里 at 的写法，AI 可以照抄 */
function eventList(sim: SimResult | undefined): string {
  const evs = (sim?.events ?? []).filter((e) => !['start', 'end', 'time', 'when'].includes(e.type)).slice(0, 16);
  if (!evs.length) return sim ? '引擎在整个模拟过程中没有记录到任何碰撞、进入轨道、共速之类的事件，说明场景里物体之间没有发生题目描述的过程，请检查物体放在哪条轨道或哪块木板上、初速度和受力。' : '';
  const seen = new Map<string, number>();
  const one = (e: SimResult['events'][number]) => {
    const spec: Record<string, unknown> = { event: e.type };
    if (['collide', 'collided', 'same_velocity'].includes(e.type) && e.b) spec.bodies = [e.a, e.b];
    else { if (e.a) spec[e.type === 'mark' ? 'name' : 'body'] = e.a; if (e.b) spec[e.type === 'leave' ? 'from' : 'to'] = e.b; }
    const key = JSON.stringify(spec), n = (seen.get(key) ?? 0) + 1; seen.set(key, n); if (n > 1) spec.n = n;
    return `${JSON.stringify(spec)}（t=${nice(e.t)} s${e.from ? `，从 ${e.from} 过来，也可写 {"event":"leave","body":"${e.a}","from":"${e.from}"}` : ''}）`;
  };
  return `引擎实际记录到的事件（按时间先后）：\n${evs.map((e) => `  ${one(e)}`).join('\n')}`;
}

export function resultRepair(S: Solved): string {
  const groups: Group[] = S.samples?.length ? S.samples.map((g, i) => ({ ...g, label: i === 0 ? '第一组数值' : '第二组数值', sim: g.sim ?? (i === 0 ? S.sim : undefined) })) : [S];
  const seen = new Set<string>(), lines: string[] = [];
  let events = '';
  const add = (s: string) => { if (!seen.has(s)) { seen.add(s); lines.push(s); } };
  for (const g of groups) {
    const pre = groups.length > 1 ? `${g.label}：` : '';
    if (g.error) add(`${pre}运行出错：${g.error}`);
    for (const a of g.asks) {
      if (a.source === 'unsupported') continue;
      if (a.error) { add(`${pre}第 (${a.id}) 问算不出：${a.error}`); if (!events && /事件没有发生/.test(a.error)) events = eventList(g.sim); }
      else if (a.ok === false && Number.isFinite(a.value) && a.answer !== undefined) add(`${pre}第 (${a.id}) 问：引擎按你写的场景算出 ${a.shown}，你给的答案是 ${nice(a.answer)}`);
    }
    // 解题步骤和引擎对不上：只取逐条内容，不带 repairPrompt 自己的开头结尾
    if (g.repair) for (const l of g.repair.split('\n')) { const m = /^\s*-\s*(第 \(.*)$/.exec(l); if (m) add(`${pre}${m[1]}`); }
  }
  if (!lines.length) {
    // 跑通了，但没有一问由模拟核对（全是代数式或 AI 结论）：给改进提示
    const c = verificationCounts(S.asks), weak = c.algebra + c.ai + c.custom;
    if (S.sim && !c.engine && weak > 0 && !S.sim.script) return `网页能运行你的 JSON，但这 ${S.asks.length} 问都没有读取模拟量（只写了参数式子或文字结论），网站没法用模拟核对答案。\n` +
      `请改进：${KEEP_SIM}一问求几个量时拆成 1a、1b 几项。某个时刻的量用 at 指定事件（如 {"event":"when","expr":"val(y_P)","n":2}、{"event":"collided","bodies":["A","B"]}）。要求的未知量写进 unknowns，用 conditions 求出。题目数据不要改。确实模拟不了的小问保留原样。改好后重新输出完整 JSON（只输出一个 \`\`\`json 代码块）。`;
    return '';
  }
  return `网页引擎按你的 JSON 模拟以后，下面几处有问题：\n${lines.map((l) => `- ${l}`).join('\n')}\n${events ? `${events}\n` : ''}` +
    '请对照题目逐条检查：物体的初始位置和速度、质量、摩擦、轨道几何、事件和条件的写法是否符合题意。' +
    '题目数据不要改，不要为了凑答案改场景；如果是题目条件抄错了，同时改正场景。' + KEEP_SIM + '引擎确实模拟不了的部分，按提示词改用 ode 自写方程、script 解析演示或 asks[].scene。改好后重新输出完整 JSON（只输出一个 ```json 代码块）。';
}
