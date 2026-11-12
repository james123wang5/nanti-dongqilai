// 第二批没见过的压轴题（2024），同样只按提示词写法建模。
import { solveProblem, type Problem } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
const S = (x: object) => ({ surfaces: [], bodies: [], ...x });
const mark = (name: string, n?: number) => ({ event: 'mark', name, ...(n ? { n } : {}) });
const cases: [string, Record<string, unknown>][] = [];
const add = (n: string, P: Record<string, unknown>) => cases.push([n, P]);
add('2024 北京 20 电磁枪', { params: { B: [2, 'T', '任取'], L: [.5, 'm', '任取'], C: [3, 'F', '任取'], R: [2, 'Ω', '任取'], m: [1.5, 'kg', '任取'], Q0: [12, 'C', '开关闭合前的电荷量，任取'] }, samples: [{ B: 3, L: .4, C: 2, R: 3, m: 2, Q0: 9 }],
  scene: S({ induction: { kind: 'rails', L: 'L', B: '-B', rods: [{ id: '棒', m: 'm', r: 'R' }], branches: [{ C: 'C', q0: 'Q0' }], duration: '6*C*R' } }),
  asks: [{ id: '1', text: 'I', at: { event: 'start' }, expr: 'val(I)', answer: 'Q0/(C*R)' }, { id: '2', text: 'a', at: { event: 'start' }, expr: 'abs(val(a_棒))', answer: 'B*Q0*L/(C*R*m)' }] });
add('2024 卷 13 差压阀', { constants: { g: 10 }, params: { p0: [1e5, 'Pa', 'p0'], VA: [.04, 'm³', 'VA1'], VB: [.03, 'm³', 'B 的体积，题未给，不影响结果'], S: [.1, 'm²', 'S'] },
  scene: S({ gas: { patm: 'p0', chambers: [{ id: 'A', p: 'p0', V: 'VA', T: 300 }, { id: 'B', p: 'p0', V: 'VB', T: 300 }], pistons: [{ id: '活塞', A: 'S', of: 'A', out: 'up' }], valves: [{ from: 'A', to: 'B', dp: '0.11*p0' }], steps: [{ label: '降温', T: { A: '300-30*u', B: '300-30*u' } }, { label: '倒铁砂', force: { 活塞: '-250*g*u' } }] } }),
  asks: [{ id: '1', text: 'pB2', at: mark('降温'), expr: 'val(p_B)', answer: 9e4, unit: 'Pa' }, { id: '2', text: 'VA2', at: mark('降温'), expr: 'val(V_A)', answer: .036, unit: 'm³' }, { id: '3', text: '铁砂质量', at: { event: 'when', expr: 'val(p_B)-p0', dir: 1 }, expr: '(val(p_A)-p0)*S/g', answer: 110, unit: 'kg' }] });
add('2024 卷 15 交变电压', { params: { m: [2, 'kg', '任取'], B: [1.5, 'T', '任取'], t0: [2, 's', '任取'], U0: [3, 'V', '任取'] }, samples: [{ m: 3, B: 2, t0: 1.5, U0: 4 }],
  constants: {}, scene: S({ particle: { duration: '8*t0', fields: [{ id: '左电场', kind: 'E', E: ['m*pi*sqrt(pi*U0/(24*B*t0))/(pi*m/(B*t0)*t0)', 0], region: { x: [-200, 0] } }, { id: '板间', kind: 'E', E: [0, '(U0/sqrt(3*pi*t0*U0/(8*B)))*(mod(t,t0)<t0/2)-(U0/sqrt(3*pi*t0*U0/(8*B)))*(mod(t,t0)>=t0/2)'], region: { x: [0, 'pi/3*sqrt(3*pi*t0*U0/(8*B))'], y: [-.05, 'sqrt(3*pi*t0*U0/(8*B))'] } }, { id: '磁场', kind: 'B', B: 'B', region: { x: ['pi/3*sqrt(3*pi*t0*U0/(8*B))', 200] } }], particles: [{ id: 'p', q: 'pi*m/(B*t0)', m: 'm', pos: ['-pi*sqrt(pi*U0/(24*B*t0))*t0/2', 0.00001], vel: [0, 0] }], walls: [{ id: '上板', from: [0, 'sqrt(3*pi*t0*U0/(8*B))'], to: ['pi/3*sqrt(3*pi*t0*U0/(8*B))', 'sqrt(3*pi*t0*U0/(8*B))'] }] } }),
  asks: [{ id: '2', text: '第一次离开时速度水平', at: { event: 'time', t: '2*t0' }, expr: 'val(vx_p)/val(v_p)', answer: 1 }, { id: '3', text: '电场力做的功', at: mark('p打到上板'), expr: 'val(KE_p)', answer: 'pi*m*U0*(pi^2+16)/(48*B*t0)' }] });
add('2024 卷 14 带电小球', { params: { m: [2, 'kg', '任取'], q: [3, 'C', '任取'], L: [1.5, 'm', '任取'], U: [40, 'V', '任取'] }, samples: [{ m: 3, q: 2, L: 2, U: 60 }], constants: { g: 10 },
  scene: S({ ode: { state: { th: 0, w: 'sqrt((U*q-m*g*L)/m)/L' }, rates: { th: 'w', w: '-(g-q*U/(L*m))/L*sin(th)' }, events: [{ name: 'B 点', when: 'th-pi/2', dir: 1, stop: true }], duration: 8, view: ['-1.3*L', '-1.3*L', '1.3*L', '1.3*L'], draw: [{ circle: [0, 0, 'L'] }, { line: [[0, 0], ['L*sin(th)', '-L*cos(th)']], kind: 'rope' }, { point: ['L*sin(th)', '-L*cos(th)'], label: '小球' }] } }),
  asks: [{ id: '2', text: 'vB', expr: 'val(w)*L', answer: 'sqrt(3*(U*q-m*g*L)/m)' }] });
add('2024 卷 15 转动棒', { params: { B: [2, 'T', '任取'], L: [1.5, 'm', '任取'], w: [3, 'rad/s', '任取'], R: [2, 'Ω', '任取'] }, samples: [{ B: 3, L: 2, w: 2, R: 3 }],
  scene: S({ induction: { kind: 'rotate', L: 'L/max(abs(cos(a)),abs(sin(a)))', B: 'B', omega: 'w', R: 'R', duration: 'pi/(2*w)' } }),
  asks: [{ id: '1', text: 'Fmax 对应的安培力（CD 棒长 L）', at: { event: 'time', t: 'pi/(4*w)' }, expr: 'val(I)*B*L', answer: 'B^2*L^3*w/R' }, { id: '2', text: 'Fmin', at: { event: 'start' }, expr: 'val(I)*B*L', answer: 'B^2*L^3*w/(2*R)' }] });
add('2024 卷 19 三区域', { params: { m: [2, 'kg', '任取'], q: [3, 'C', '任取'], B: [1.5, 'T', '任取'], v0: [2, 'm/s', '任取'] }, samples: [{ m: 3, q: 2, B: 2, v0: 3 }],
  scene: S({ particle: { duration: '20*m/(q*B)', fields: [{ id: 'Ⅲ磁', kind: 'B', B: '-B' }, { id: 'Ⅲ电', kind: 'E', E: ['B*v0', 0] }], particles: [{ id: 'p', q: 'q', m: 'm', pos: [0, 0], vel: ['0.96*v0', '-0.28*v0'] }] } }),
  asks: [{ id: '3a', text: '最大速度', at: { event: 'when', expr: 'val(vx_p)', dir: -1 }, expr: 'val(v_p)', answer: '2.6*v0' }] });
add('2024 卷 13 乙追甲', { params: { q: [2, 'C', '任取'], m: [3, 'kg', '任取'], v0: [1.5, 'm/s', '任取'], w: [.8, 'N/(C·s)', 'ω，任取'], d0: [2, 'm', '开始时的间距，任取'] }, samples: [{ q: 3, m: 2, v0: 2, w: .6, d0: 1.5 }],
  scene: S({ particle: { duration: '2', fields: [{ id: 'Ⅳ', kind: 'E', E: ['w*t-w/(3*v0)*x', 0], region: { x: ['-3*d0', 300] } }], particles: [{ id: '甲', q: 'q', m: 'm', pos: [0, 0], vel: ['3*v0', 0] }, { id: '乙', q: 'q', m: 'm', pos: ['-d0', 0], vel: ['2*v0', 0] }] } }),
  asks: [{ id: '3', text: 'F 与 Δx 的比值', at: { event: 'time', t: 1 }, expr: 'q*(w*1-w/(3*v0)*val(x_乙))/(val(x_甲)-val(x_乙))', answer: 'q*w/(3*v0)' }, { id: '3b', text: '甲匀速', expr: 'val(v_甲)', answer: '3*v0' }] });
if (process.env.DUMP) { console.log(JSON.stringify(cases)); process.exit(0); }
const only = process.argv[2]; let pass = 0, fail = 0, unverified = 0; const log: string[] = [];
for (const [name, c] of cases) {
  if (only && !name.includes(only)) continue;
  const P = { spec: 'v1', title: name, ...c } as unknown as Problem;
  try { const errs = validate(P); if (errs.length) throw new Error('格式：' + errs.slice(0, 3).join('；')); const R = solveProblem(P); for (const a of R.asks) { if (a.ok === true) pass++; else if (a.ok === null) unverified++; else { fail++; log.push(`✗ ${name} (${a.id}) 算出 ${a.shown}，答案 ${a.answer ?? ''} ${a.error ?? ''}`); } } } catch (e) { fail++; log.push(`✗ ${name}：${(e as Error).message.slice(0, 220)}`); }
}
console.log(log.join('\n')); console.log(`\n第二批：通过 ${pass}，未通过 ${fail}，未核验 ${unverified}`); if (fail) process.exitCode = 1;
