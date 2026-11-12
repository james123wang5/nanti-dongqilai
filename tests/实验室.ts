// 各板块实验室的回归：每项都和独立的解析结果比，题目来自真题或教材典型模型。
import { solveProblem, type Problem } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
let ok = 0, bad = 0;
const near = (a: number, b: number, rel = 1e-2) => Math.abs(a - b) <= Math.max(rel * Math.abs(b), 2e-3);
function check(name: string, P: Partial<Problem>, want: Record<string, number>, rel = 1e-2) {
  const p = { spec: 'v1', title: name, scene: { surfaces: [], bodies: [] }, ...P, asks: Object.entries(want).map(([id, v]) => ({ id, text: id, ...(P.asks?.find((a) => a.id === id) ?? {}), answer: v })) } as unknown as Problem;
  try {
    const errs = validate(p); if (errs.length) throw new Error(errs.join('；'));
    const S = solveProblem(p);
    for (const a of S.asks) { const w = want[a.id], got = a.value as number; if (a.error || !near(got, w, rel)) { bad++; console.log(`✗ ${name} ${a.id}：算出 ${got}，应为 ${w} ${a.error ?? ''}`); } else ok++; }
  } catch (e) { bad++; console.log(`✗ ${name}：${(e as Error).message}`); }
}
const end = { event: 'end' };
const ask = (id: string, expr: string, at: object = end) => ({ id, text: id, expr, at });

// 2025 陕晋宁青 6：两线框穿磁场。m=B=L=R=1，v0=4B²L³/(mR)=4；甲 v=0，乙 v=v0/2，Q 比 4:3
const frame = (R: number) => ({ kind: 'frame', w: 2, h: 1, R, m: 1, x: -2.0001, y: -.5, v: [4, 0], regions: [{ x: [0, 3], y: [-5, 5], B: 1 }], duration: 10 });
check('线框 甲', { scene: { surfaces: [], bodies: [], induction: frame(1) } as never, asks: [ask('v', 'val(vx)'), ask('Q', 'val(Qh)')] as never }, { v: 0, Q: 8 }, 3e-2);
check('线框 乙', { scene: { surfaces: [], bodies: [], induction: frame(2) } as never, asks: [ask('v', 'val(vx)'), ask('Q', 'val(Qh)')] as never }, { v: 2, Q: 6 });
// 单棒：x=mv0R/(B²L²)，Q=½mv0²
check('单棒减速', { scene: { surfaces: [], bodies: [], induction: { kind: 'rails', L: 1, B: 2, rods: [{ id: 'ab', m: 1, v: 4 }], load: { R: 1 }, duration: 12 } } as never, asks: [ask('x', 'val(x_ab)'), ask('Q', 'val(Qh)')] as never }, { x: 1, Q: 8 });
// 恒力单棒的稳定速度 v=FR/(B²L²)
check('恒力单棒', { scene: { surfaces: [], bodies: [], induction: { kind: 'rails', L: 1, B: 1, rods: [{ id: 'ab', m: 1, F: 2 }], load: { R: 3 }, duration: 30 } } as never, asks: [ask('v', 'val(v_ab)')] as never }, { v: 6 });
// 棒加电容：a=F/(m+CB²L²)
check('棒加电容', { scene: { surfaces: [], bodies: [], induction: { kind: 'rails', L: 1, B: 2, rods: [{ id: 'ab', m: 1, F: 6 }], load: { C: .5 }, duration: 3 } } as never, asks: [ask('a', 'val(a_ab)'), ask('v', 'val(v_ab)')] as never }, { a: 2, v: 6 });
// 双棒：共速 v0/2，Q=¼mv0²
check('双棒', { scene: { surfaces: [], bodies: [], induction: { kind: 'rails', L: 1, B: 1, rods: [{ id: 'a', m: 1, r: 1, x: 0 }, { id: 'b', m: 1, r: 1, x: 2, v: 4 }], duration: 30 } } as never, asks: [ask('v', 'val(v_a)'), ask('Q', 'val(Qh)')] as never }, { v: 2, Q: 4 });
// 线圈 B=kt：E=NSk
check('线圈', { scene: { surfaces: [], bodies: [], induction: { kind: 'coil', N: 100, S: .02, B: '0.5*t', R: 2, duration: 4 } } as never, asks: [ask('e', 'val(emf)'), ask('q', 'val(q)')] as never }, { e: 1, q: 2 });
// 转动棒 E=½BωL²
check('转动棒', { scene: { surfaces: [], bodies: [], induction: { kind: 'rotate', L: 2, B: .5, omega: 3, R: 3, duration: 2 } } as never, asks: [ask('e', 'val(emf)')] as never }, { e: 3 });
// 2024 河北 8：a=1e4 km，T=24 h，aA:aB=81
check('椭圆轨道', { scene: { surfaces: [], bodies: [], gravity: { G: 1, duration: 30, bodies: [{ id: '月', m: '4*pi^2*(1e4)^3/24^2', pos: [0, 0], fixed: true }, { id: '星', m: 1e-6, pos: [2000, 0], vel: [0, 'sqrt(4*pi^2*(1e4)^3/24^2*(2/2000-1/1e4))'] }] } } as never, constants: {}, asks: [{ id: 'r', text: '', expr: 'val(a_星)/va', at: { event: 'mark', name: '星远点' }, vals: { va: { at: { event: 'start' }, expr: 'val(a_星)' } } }, ask('T', 'val(T_星)')].map((a) => a) as never }, { r: 1 / 81, T: 24 });
// 双星：T=2π√(L³/(G(m1+m2)))
check('双星', { scene: { surfaces: [], bodies: [], gravity: { G: 1, duration: 8, bodies: [{ id: 'A', m: 3, pos: [-1, 0], vel: [0, -.25] }, { id: 'B', m: 1, pos: [3, 0], vel: [0, .75] }] } } as never, asks: [ask('r', 'sqrt(val(x_B)^2+val(y_B)^2)')] as never }, { r: 3 }, 2e-2);
// 2025 湖北 10：五个点电荷，E=4.253 kq/R²，沿 -x
const ang = (d: number) => [`cos(${d}*pi/180)`, `sin(${d}*pi/180)`] as [string, string];
check('五边形', { scene: { surfaces: [], bodies: [], electro: { k: 1, charges: [{ q: 3, at: ang(90) }, { q: 4, at: ang(18) }, { q: 5, at: ang(-54) }, { q: 1, at: ang(234) }, { q: 2, at: ang(162) }], probes: [{ id: 'O', at: [0, 0] }] } } as never, asks: [ask('E', 'val(E_O)'), ask('Ex', 'val(Ex_O)')] as never }, { E: 4.253, Ex: -4.253 });
// 2025 陕晋宁青 12：p2=3.3e5，W=1.008e4
check('轮胎', { scene: { surfaces: [], bodies: [], gas: { A: 1, chambers: [{ id: 'A', p: 3e5, L: .528, T: 300 }], pistons: [], open: false, total: .528, steps: [{ line: { chamber: 'A', V: .56, T: 350 } }] } } as never, asks: [ask('p', 'val(p_A)'), ask('W', 'val(W_A)'), ask('T', 'val(T_A)')] as never }, { p: 3.3e5, W: 1.008e4, T: 350 });
// 竖直气缸等压加热：L∝T，p=p0+mg/A
check('等压加热', { scene: { surfaces: [], bodies: [], gas: { A: .01, patm: 1e5, chambers: [{ id: 'A', L: .3, T: 300 }], pistons: [{ id: '活塞', m: 10 }], steps: [{ T: { A: '300+100*u' } }] } } as never, constants: { g: 10 }, asks: [ask('p', 'val(p_A)'), ask('L', 'val(L_A)'), ask('W', 'val(W_A)')] as never }, { p: 1.1e5, L: .4, W: 110 });
// 活塞碰到卡环后等容
check('卡环', { scene: { surfaces: [], bodies: [], gas: { A: .01, patm: 1e5, chambers: [{ id: 'A', L: .3, T: 300 }], pistons: [{ id: '活塞', stops: [0, .35] }], steps: [{ T: { A: '300+150*u' } }] } } as never, constants: { g: 10 }, asks: [ask('L', 'val(L_A)'), ask('p', 'val(p_A)')] as never }, { L: .35, p: 1e5 * .3 * 450 / 300 / .35 });
// 两段气体一活塞，封闭缸，一边加热
check('两段气体', { scene: { surfaces: [], bodies: [], gas: { A: 1, angle: 0, chambers: [{ id: 'A', p: 1e5, L: 1, T: 300 }, { id: 'B', p: 1e5, L: 1, T: 300 }], pistons: [{ id: '活塞' }], open: false, total: 2, steps: [{ T: { A: '300+300*u' } }] } } as never, asks: [ask('LA', 'val(L_A)'), ask('p', 'val(p_B)')] as never }, { LA: 4 / 3, p: 1.5e5 });
// 折射：n=√2，i=45°→r=30°；全反射
check('折射', { scene: { surfaces: [], bodies: [], optics: { media: [{ id: '玻璃', n: 'sqrt(2)', poly: [[-3, -2], [3, -2], [3, 0], [-3, 0]] }], rays: [{ id: 'L', from: [-1, 1], dir: -45 }] } } as never, asks: [ask('r', 'val(r_L1)'), ask('C', 'val(C_玻璃)')] as never }, { r: 30, C: 45 });
check('全反射', { scene: { surfaces: [], bodies: [], optics: { media: [{ id: '玻璃', n: 1.5, poly: [[0, 0], [2, 0], [0, 2]] }], rays: [{ id: 'L', from: [.5, -1], dir: 90 }] } } as never, asks: [ask('i', 'val(i_L2)'), ask('t', 'val(tir_L2)')] as never }, { i: 45, t: 1 });
check('半圆砖', { scene: { surfaces: [], bodies: [], optics: { media: [{ id: '砖', n: 1.5, arc: { center: [0, 0], radius: 1, from: 180, to: 360 } }], rays: [{ id: 'L', from: [0.5, 1], dir: -90 }] } } as never, asks: [ask('i', 'val(i_L2)')] as never }, { i: 30 });
// 波：y=A sin(ω(t-x/v))
check('行波', { scene: { surfaces: [], bodies: [], wave: { range: [0, 4], duration: 3, sources: [{ x: 0, A: .1, T: 1, v: 2, dir: 1 }], points: [{ id: 'P', x: 1 }] } } as never, asks: [{ id: 'y', text: '', expr: 'val(y_P)', at: { event: 'time', t: 0.75 } }] as never }, { y: .1 });
check('干涉', { scene: { surfaces: [], bodies: [], wave: { plane: true, steady: true, range: [-4, 4], sources: [{ x: -1, A: 1, T: 1, lambda: 1 }, { x: 1, A: 1, T: 1, lambda: 1 }], points: [{ id: 'P', x: 0, y: 2 }, { id: 'Q', x: .25, y: 0 }] } } as never, asks: [ask('a', 'val(amp_P)'), ask('b', 'val(amp_Q)')] as never }, { a: 2, b: 0 }, 1e-6);
// 氢原子：n=4 六条线，4→3 0.66 eV；光电
check('能级', { scene: { surfaces: [], bodies: [], atom: { hydrogen: 4, all: 4, metal: { W0: 2.25 } } } as never, asks: [ask('n', 'val(lines)'), ask('e', 'val(dE_43)'), ask('k', 'val(Ek_41)')] as never }, { n: 6, e: .6625, k: 10.5 }, 5e-3);
// 交流：线圈 E=NBSω/√2；变压器；输电
check('输电', { scene: { surfaces: [], bodies: [], ac: { source: { U: 250, f: 50 }, chain: [{ kind: 'T', id: '升', n1: 1, n2: 40 }, { kind: 'R', id: '线', R: 100 }, { kind: 'T', id: '降', n1: 40, n2: 1 }, { kind: 'load', id: '用户', R: .625 * 1.0 }] } } as never, asks: [ask('p', 'val(P_线)/val(P_用户)')] as never }, { p: 100 / (40 ** 2 * .625) });
check('线圈发电', { scene: { surfaces: [], bodies: [], ac: { source: { N: 100, B: .1, S: .02, w: 100, r: 1 }, chain: [{ kind: 'load', id: 'R', R: 9 }] } } as never, asks: [ask('m', 'val(Um)'), ask('i', 'val(I_R)')] as never }, { m: 20, i: 20 / Math.SQRT2 / 10 });
// 纸带逐差
check('纸带', { scene: { surfaces: [], bodies: [], experiment: { tape: { d: [.01, .03, .05, .07], T: .1 } } } as never, asks: [ask('a', 'val(a)'), ask('v', 'val(v_2)')] as never }, { a: 2, v: .4 });
check('拟合', { scene: { surfaces: [], bodies: [], experiment: { table: { x: [1, 2, 3, 4], y: [2.1, 3.9, 6.1, 7.9] } } } as never, asks: [ask('k', 'val(k)')] as never }, { k: 1.96 });
// 粒子：半圆、螺旋、斜边界、挡板
const qm = { q: 1, m: 1 };
check('有界磁场', { scene: { surfaces: [], bodies: [], particle: { duration: 5, fields: [{ kind: 'B', B: 1, region: { x: [0, 10], y: [-10, 10] } }], particles: [{ id: 'p', ...qm, pos: [-1, 0], vel: [2, 0] }] } } as never, asks: [{ id: 'y', text: '', expr: 'val(y_p)', at: { event: 'mark', name: 'p离开B1' } }, { id: 't', text: '', expr: 't', at: { event: 'mark', name: 'p离开B1' } }] as never }, { y: -4, t: .5 + Math.PI });
check('螺旋', { scene: { surfaces: [], bodies: [], particle: { duration: 2 * Math.PI, fields: [{ kind: 'B', B: 1 }], particles: [{ id: 'p', ...qm, pos: [0, 0, 0], vel: [1, 0, 3] }] } } as never, asks: [ask('z', 'val(z_p)'), ask('y', 'val(y_p)')] as never }, { z: 6 * Math.PI, y: 0 }, 5e-3);
check('斜边界', { scene: { surfaces: [], bodies: [], particle: { duration: 8, fields: [{ kind: 'B', B: -1, region: { side: { from: [0, 0], to: [1, 1] } } }], particles: [{ id: 'p', ...qm, pos: [.5, -.5], vel: ['-1/sqrt(2)', '1/sqrt(2)'] }] } } as never, asks: [{ id: 'd', text: '', expr: 'sqrt(val(x_p)^2+val(y_p)^2)', at: { event: 'mark', name: 'p离开B1' } }] as never }, { d: 2 }, 3e-2);
check('摆线', { scene: { surfaces: [], bodies: [], particle: { duration: 2 * Math.PI, fields: [{ kind: 'B', B: 1 }, { kind: 'E', E: [0, 1] }], particles: [{ id: 'p', ...qm, pos: [0, 0], vel: [0, 0] }] } } as never, asks: [ask('x', 'val(x_p)'), ask('y', 'val(y_p)')] as never }, { x: 2 * Math.PI, y: 0 }, 5e-3);
check('挡板小孔', { scene: { surfaces: [], bodies: [], particle: { duration: 3, fields: [], particles: [{ id: 'p', ...qm, pos: [0, 0], vel: [1, 0] }, { id: 'r', ...qm, pos: [0, 2], vel: [1, 0] }], walls: [{ id: '板', from: [1, -3], to: [1, 3], hole: [2.5, 3.5] }] } } as never, asks: [ask('p', 'val(x_p)'), ask('r', 'val(x_r)')] as never }, { p: 3, r: 1 });
// 电路：RC 充电、小灯泡工作点
const rc = { transient: true, duration: 5, nodes: { a: [0, 0], b: [0, 2], c: [2, 2], d: [2, 0] }, elements: [{ id: 'E', kind: 'battery', a: 'b', b: 'a', E: 10, r: 0 }, { id: 'R', kind: 'R', a: 'b', b: 'c', R: 2 }, { id: 'C', kind: 'capacitor', a: 'c', b: 'd', C: .5 }, { id: 'w', kind: 'wire', a: 'd', b: 'a' }] };
check('RC 充电', { scene: { surfaces: [], bodies: [], circuit: rc } as never, asks: [{ id: 'u', text: '', expr: 'U(C)', at: { event: 'time', t: 1 } }, ask('q', 'val(q_C)')] as never }, { u: 10 * (1 - Math.exp(-1)), q: 5 * (1 - Math.exp(-5)) }, 2e-2);
const lamp = { duration: 1, nodes: { a: [0, 0], b: [0, 2], c: [2, 2] }, elements: [{ id: 'E', kind: 'battery', a: 'b', b: 'a', E: 6, r: 2 }, { id: 'L', kind: 'lamp', a: 'b', b: 'c', curve: [[0, 0], [1, .5], [2, .8], [3, 1], [6, 1.3]] }, { id: 'w', kind: 'wire', a: 'c', b: 'a' }] };
check('灯泡工作点', { scene: { surfaces: [], bodies: [], circuit: lamp } as never, asks: [ask('i', 'I(L)')] as never }, { i: 1.3 / 1.2 }, 2e-2);
// 2024 全国甲 25：S 闭合时恒力，稳定 v0；v=v0/2 时断开 S 匀速，P外=2PR 时 Uc=BLv0/4，W=CB²L²v0²/8。取 B=L=R=1，v0=2，C=1
{ const v = 1, sc = { kind: 'rails', L: 1, B: 1, rods: [{ id: 'ab', m: 1, drive: v }], branches: [{ R: 1, C: 1 }], duration: 6 };
  check('甲卷25 第2问', { scene: { surfaces: [], bodies: [], induction: sc } as never, asks: [{ id: 'u', text: '', expr: 'val(Uc_b1)', at: { event: 'time', t: Math.LN2 } }, { id: 'w', text: '', expr: 'val(W)', at: { event: 'time', t: Math.LN2 } }] as never }, { u: .5, w: .5 }, 2e-2); }
// 2025 甘肃 15：两棒加电容，v=mv0/(2m+CB²L²)，Δx=mv0R/(B²L²)。取 m=1,v0=4,B=L=R=C=1
check('甘肃15', { scene: { surfaces: [], bodies: [], induction: { kind: 'rails', L: 1, B: 1, rods: [{ id: '1', m: 1, r: 1, v: 4 }, { id: '2', m: 1, r: 1, x: 8 }], branches: [{ C: 1 }], duration: 40 } } as never, asks: [ask('v', 'val(v_1)'), ask('v2', 'val(v_2)'), ask('d', '8-(val(x_2)-val(x_1))')] as never }, { v: 4 / 3, v2: 4 / 3, d: 4 }, 2e-2);
console.log(`\n实验室：通过 ${ok}，未通过 ${bad}`);
if (bad) process.exitCode = 1;
// 通用运动方程：单摆周期、碰撞反向、事件时刻
{ const P = { spec: 'v1', title: '摆', constants: { g: 10 }, params: { L: [1, 'm', '摆长'] }, scene: { surfaces: [], bodies: [], ode: { state: { th: .05, w: 0 }, rates: { th: 'w', w: '-g/L*sin(th)' }, events: [{ name: '最低点', when: 'th', dir: -1, stop: true }], duration: 5, view: [-1, -1, 1, 0], draw: [{ point: ['L*sin(th)', '-L*cos(th)'], label: '球' }] } }, asks: [{ id: 't', text: 't', expr: 'val(t)', answer: Math.PI / 2 * Math.sqrt(.1), at: { event: 'end' } }] } as unknown as Problem;
  const S = solveProblem(P); const a = S.asks[0]; // 这里是积分器的独立解析对照单元测试，不把其结果声明为内置物理核验。
if (a.answerMatch === true && a.source === 'custom' && a.ok === null) ok++; else { bad++; console.log('✗ 摆', a.shown, a.error); } }
console.log(`运动方程后：通过 ${ok}，未通过 ${bad}`);
