// 新拿到的 2025、2026 高考压轴题：只按提示词的写法建模，看系统能不能算出官方答案。
// 用法：node 难题/tests/压轴.ts            只看汇总
//       node 难题/tests/压轴.ts 关键字     只跑名字含关键字的
import { solveProblem, type Problem } from '../engine/solve.ts';
import { validate } from '../engine/validate.ts';
type Case = { name: string; P: Record<string, unknown> };
const S = (x: object) => ({ surfaces: [], bodies: [], ...x });
const end = { event: 'end' }, mark = (name: string, n?: number) => ({ event: 'mark', name, ...(n ? { n } : {}) });
const cases: Case[] = [];
const add = (name: string, P: Record<string, unknown>) => cases.push({ name, P });

add('2025 新课标 15 组合场', {
  constants: {}, params: { m: [2, 'kg', '质量 m，数值任取'], q: [3, 'C', '电量 q，数值任取'], v0: [1.5, 'm/s', '速度 v0，数值任取'], h: [2, 'm', '距离 h，数值任取'] },
  samples: [{ m: 3, q: 2, v0: 2, h: 1.5 }],
  unknowns: { B: { range: ['0.3*m*v0/(q*h)', '0.8*m*v0/(q*h)'] }, E: { range: ['0.2*m*v0^2/(q*h)', '1.5*m*v0^2/(q*h)'] } },
  conditions: [{ at: mark('p离开磁场'), eq: 'atan2(-val(vy_p),val(vx_p))*180/pi-60' }, { at: mark('p进入磁场'), eq: 'val(x_p)-2*sqrt(3)*h' }],
  scene: S({ particle: { duration: '12*h/v0', fields: [{ id: '磁场', kind: 'B', B: 'B', region: { y: [0, '40*h'] } }, { id: '电场', kind: 'E', E: [0, 'E'], region: { y: ['-40*h', 0] } }], particles: [{ id: 'p', q: 'q', m: 'm', pos: [0, 'h'], vel: ['v0', 0] }] } }),
  asks: [{ id: '1', text: 'B', expr: 'B', answer: 'm*v0/(2*q*h)' }, { id: '2', text: 'E', expr: 'E', answer: 'm*v0^2/(2*q*h)' },
    { id: '3', text: '漂移速度', scene: S({ particle: { duration: '60*h/v0', fields: [{ id: '磁场', kind: 'B', B: 'm*v0/(2*q*h)', region: { y: [0, '400*h'] } }, { id: '电场', kind: 'E', E: [0, 'm*v0^2/(2*q*h)'], region: { y: ['-400*h', 0] } }], particles: [{ id: 'p', q: 'q', m: 'm', pos: [0, 'h'], vel: [0, '-v0'] }] } }), expr: 'abs(x2-x1)/(t2-t1)', times: { t1: mark('p进入电场', 1), t2: mark('p进入电场', 2) }, vals: { x1: { at: mark('p进入电场', 1), expr: 'val(x_p)' }, x2: { at: mark('p进入电场', 2), expr: 'val(x_p)' } }, answer: '3*sqrt(3)/(6*sqrt(3)+8*pi)*v0' }],
});
add('2025 新课标 14 防滑带', {
  constants: { g: 10 }, params: { mu: [.5, '', 'μ'], l1: [3, 'm', '间隔'], l2: [2.4, 'm', '宽度'], m1: [2, 'kg', 'P'], m2: [4, 'kg', 'Q'], v0: [7, 'm/s', 'Q 初速'], e: [.5, '', '碰后 P 速度 7 m/s 对应的恢复系数'] },
  scene: { surfaces: [{ id: '来路', from: [-3, 0], to: [0, 0], next: '带1' }, { id: '带1', from: [0, 0], to: ['l2', 0], mu: 'mu', next: '光1' }, { id: '光1', from: ['l2', 0], to: ['l2+l1', 0], next: '带2' }, { id: '带2', from: ['l2+l1', 0], to: ['2*l2+l1', 0], mu: 'mu', next: '光2' }, { id: '光2', from: ['2*l2+l1', 0], to: ['2*l2+2*l1', 0], next: '带3' }, { id: '带3', from: ['2*l2+2*l1', 0], to: ['3*l2+2*l1', 0], mu: 'mu' }],
    bodies: [{ id: 'Q', kind: 'block', m: 'm2', on: '来路', at: 2.5, v: 'v0' }, { id: 'P', kind: 'block', m: 'm1', on: '带1', at: 0 }], collisions: [{ bodies: ['Q', 'P'], e: 'e' }], tMax: 12 },
  asks: [{ id: '1', text: '损失机械能', at: { event: 'collided', bodies: ['Q', 'P'] }, expr: 'Q(P,Q)', answer: 24.5, unit: 'J' }, { id: '2', text: 'P 运动时间', times: { t1: { event: 'collided', bodies: ['Q', 'P'] }, t2: { event: 'stop', body: 'P' } }, expr: 't2-t1', answer: 5, unit: 's' }],
});
add('2025 新课标 13 液滴', {
  params: { m: [2e-10, 'kg', 'm'], q: [1e-13, 'C', 'q'], v: [2, 'm/s', 'v'], l: [.02, 'm', '板长'], E: [2e5, 'N/C', 'E'], h: [.1, 'm', '板下距离'] },
  scene: S({ particle: { duration: '(l+h)/v', fields: [{ id: '电场', kind: 'E', E: ['E', 0], region: { y: ['-l', 0], x: [-1, 1] } }], particles: [{ id: 'A', q: 'q', m: 'm', pos: [0, 0.0000001], vel: [0, '-v'] }, { id: 'B', q: '-q', m: 'm', pos: [0, 0.0000001], vel: [0, '-v'] }] } }),
  asks: [{ id: '1', text: '偏转距离', at: mark('A离开电场'), expr: 'val(x_A)', answer: .005, unit: 'm' }, { id: '2', text: '间距', expr: 'val(x_A)-val(x_B)', answer: .11, unit: 'm' }],
});
add('2025 地方 13 盖玻片', {
  params: { n: [1.5, '', '折射率'], d: [.002, 'm', '厚度'], h: [.0002, 'm', '间距'], no: [1, '', '间隙介质'] }, constants: { c: 3e8 },
  scene: S({ optics: { media: [{ id: '盖玻片', n: 'n', poly: [[-.01, 0], [.01, 0], [.01, 'd'], [-.01, 'd']] }, { id: '间隙', n: 'no', poly: [[-.01, 'd'], [.01, 'd'], [.01, 'd+h'], [-.01, 'd+h']] }], screens: [{ id: '物镜', from: [-.01, 'd+h'], to: [.01, 'd+h'] }], rays: [{ id: 'a', from: [0, 1e-7], dir: 90 }] } }),
  asks: [{ id: '1', text: '透光面积', expr: 'pi*(d*tan(val(C_盖玻片)*pi/180))^2', answer: 1.0e-5, unit: 'm²' }, { id: '2', text: '时间差', expr: 't1-val(time_a)', vals: { t1: { expr: 'val(time_a)' } }, with: { no: 1.5 }, answer: -3.3e-13 }],
});
add('2026 卷 15 电子偏转', {
  params: { m: [2, 'kg', 'm，任取'], e: [3, 'C', 'e，任取'], B0: [2, 'T', 'B0，任取'], R: [1.5, 'm', 'R，任取'], L: [2, 'm', 'L，任取'], d: [4, 'm', 'd，任取'], U2: [3, 'V', 'U2，任取'] }, samples: [{ m: 3, e: 2, B0: 3, R: 2, L: 3, d: 5, U2: 4 }],
  scene: S({ particle: { fields: [{ id: '板间', kind: 'E', E: [0, 'U2/d'], region: { x: [0, 'L'], y: ['-d/2', 'd/2'] } }], particles: [{ id: '电子', q: '-e', m: 'm', pos: [-0.001, 0], vel: ['e*B0*R/m', 0] }], walls: [{ id: '屏', from: ['6*L', '-50*L'], to: ['6*L', '50*L'] }], duration: '7*L/(e*B0*R/m)' } }),
  asks: [{ id: '2', text: '偏移距离', at: mark('电子打到屏'), expr: 'abs(val(y_电子))', answer: '11*m*L^2*U2/(2*d*R^2*B0^2*e)' }],
});
add('2026 卷 14 小球打板', {
  constants: { g: 10 }, params: { mA: [.4, 'kg', '木板'], mB: [.1, 'kg', '物块'], mC: [.1, 'kg', '小球'], L: [.9, 'm', '绳长'], x0: [.1, 'm', '弹簧伸长'], k: [2, 'N/m', '题未给，任取，不影响结果'] },
  unknowns: { mu: { range: [.205, .6] } },
  conditions: [{ at: { event: 'when', expr: 'Fs(弹簧)+k*x0', dir: -1 }, eq: 'v(B)-0.8' }],
  scene: { surfaces: [{ id: '摆', kind: 'arc', center: [0, 'L'], radius: 'L', start: -30, end: -90, turn: 'cw', side: 'inside', next: '地面', tether: 'rope' }, { id: '地面', kind: 'ground', y: 0 }],
    bodies: [{ id: 'C', kind: 'ball', m: 'mC', on: '摆', at: 0 }, { id: 'A', kind: 'board', m: 'mA', length: 2, on: '地面', x: -2.2 }, { id: 'B', kind: 'block', m: 'mB', on: 'A', at: 1 }],
    springs: [{ id: '弹簧', between: ['A', 'B'], k: 'k', L0: '0.7-x0', anchors: [1.7, 0] }], friction: [{ between: ['A', 'B'], mu: 'mu' }], collisions: [{ bodies: ['C', 'A'], e: 1 }], tMax: 3 },
  asks: [{ id: '1', text: 'vA', at: { event: 'collided', bodies: ['C', 'A'] }, expr: 'v(A)', answer: 1.2, unit: 'm/s' }, { id: '2', text: 'μ', expr: 'mu', answer: .28 }],
});
add('2026 卷 13 洛伦兹力演示仪', {
  params: { m: [2, 'kg', '任取'], e: [3, 'C', '任取'], v: [2, 'm/s', '任取'], R: [1.5, 'm', '任取'] }, samples: [{ m: 3, e: 2, v: 3, R: 2 }],
  unknowns: { B: { range: ['0.6*m*v/(e*R)', '1.8*m*v/(e*R)'] } }, conditions: [{ at: { event: 'when', expr: 'val(x_电子)', dir: 1 }, eq: 'val(y_电子)-R' }],
  scene: S({ particle: { duration: '3*R/v*1.2', fields: [{ id: '磁场', kind: 'B', B: '-B', region: { center: [0, 0], radius: 'R*1.1' } }], particles: [{ id: '电子', q: '-e', m: 'm', pos: [0, '-0.8*R'], vel: ['-v', 0] }] } }),
  asks: [{ id: '1', text: 'B', expr: 'B', answer: '10*m*v/(9*e*R)' }, { id: '2', text: '时间', at: { event: 'when', expr: 'val(x_电子)', dir: 1 }, expr: 't', answer: '9*pi*R/(10*v)' }],
});
add('2025 地方 14 磁屏蔽', {
  params: { m: [2, 'kg', '任取'], q: [3, 'C', '任取'], L: [1.5, 'm', '任取'], v: [2, 'm/s', '速度 U/(B0 d)，任取'] }, samples: [{ m: 3, q: 2, L: 2, v: 3 }],
  unknowns: { B2: { range: ['0.3*m*v/(q*L)', '0.7*m*v/(q*L)'] } }, conditions: [{ at: { event: 'when', expr: 'val(x_p)', dir: -1 }, eq: 'val(y_p)-2*L' }],
  scene: S({ particle: { duration: '7*L/v', fields: [{ id: '外', kind: 'B', B: '-m*v/(q*L)', region: { x: [0, '40*L'], y: ['-40*L', '40*L'] } }, { id: '屏蔽区', kind: 'B', B: '-B2', over: true, region: { x: [0, '2*L'], y: [0, '2*L'] } }], particles: [{ id: 'p', q: 'q', m: 'm', pos: [0, '-L'], vel: ['v', 0] }] } }),
  asks: [{ id: '3', text: 'η', expr: '(m*v/(q*L)-B2)/(m*v/(q*L))', answer: .6 }],
});
add('2026 卷 13 实验舱', {
  constants: { g: 10 }, params: { F: [3e4, 'N', '电磁力'], m: [500, 'kg', '舱'], h: [6.25, 'm', '加速距离'] },
  scene: { surfaces: [{ id: '塔', from: [0, 0], to: [0, 60], marks: { M: 'h' } }], bodies: [{ id: '舱', kind: 'block', m: 'm', on: '塔', at: 0 }],
    forces: [{ on: '舱', F: [0, 'F'], until: { event: 'pass', body: '舱', to: 'M' } }, { on: '舱', F: [0, 'm*g/6'], after: { event: 'pass', body: '舱', to: 'M' } }], tMax: 8 },
  asks: [{ id: '1', text: 'vm', at: { event: 'pass', body: '舱', to: 'M' }, expr: 'v(舱)', answer: 25, unit: 'm/s' }, { id: '2', text: '时间', times: { t1: { event: 'pass', body: '舱', to: 'M' }, t2: { event: 'stop', body: '舱' } }, expr: 't2-t1', answer: 3, unit: 's' }],
});
add('2026 湖南 14 三触点开关', {
  params: { E: [6, 'V', 'E，任取'], B: [2, 'T', 'B，任取'], L: [.5, 'm', 'L，任取'], m: [.5, 'kg', 'm，任取'], r: [2, 'Ω', 'r，任取'], k: [4, 'V/C', 'k，任取'], R: [3, 'Ω', 'R，任取'], U0: [1.5, 'V', 'U0，任取'], t0: [12, 's', '棒已匀速的时刻'] }, samples: [{ E: 9, B: 3, L: .5, m: .75, r: 1.5, k: 3, R: 4, U0: 2, t0: 8 }],
  scene: S({ induction: { kind: 'rails', L: 'L', B: 'B', rods: [{ id: '棒', m: 'm', r: 'r' }], branches: [{ E: '-E', on: 't<t0' }, { C: '1/k', on: 't>=t0' }], duration: '3*t0' } }),
  asks: [{ id: '1', text: '初始加速度', at: { event: 'start' }, expr: 'abs(val(a_棒))', answer: 'B*E*L/(m*r)' },
    { id: '2', text: '储能器电压 U0 时的速度', at: { event: 'when', expr: 'abs(val(Uc_b2))-U0', dir: 1 }, expr: 'abs(val(v_棒))', answer: 'E/(B*L)-B*L*U0/(m*k)' },
    { id: '3', text: '棒上焦耳热', scene: S({ induction: { kind: 'rails', L: 'L', B: 'B', rods: [{ id: '棒', m: 'm', r: 'r' }], branches: [{ E: '-E', on: 't<t0' }, { R: 'R', on: 't>=t0' }], duration: '3*t0' } }), expr: 'val(Q_棒)', answer: '(R+2*r)*m*E^2/(2*(R+r)*B^2*L^2)' }],
});
add('2026 湖南 15 杆球', {
  constants: { g: 10 }, params: { Lg: [2, 'm', 'L，任取'], m: [2, 'kg', 'm，任取'] }, samples: [{ Lg: 3, m: 3 }],
  scene: { surfaces: [{ id: '杆', kind: 'arc', center: [0, 0], radius: 'Lg', start: 89.9, end: 0, turn: 'cw', side: 'outside' }, { id: '地面', kind: 'ground', y: 0 }], bodies: [{ id: '球', kind: 'ball', m: 'm', on: '杆', at: 0 }], tMax: 20, until: { event: 'land', body: '球' } },
  asks: [{ id: '1', text: 'v', at: { event: 'land', body: '球' }, expr: 'v(球)', answer: 'sqrt(2*g*Lg)' }, { id: '2', text: 'tanα', at: { event: 'land', body: '球' }, expr: 'abs(vy(球)/vx(球))', answer: 'sqrt(23)/2' }],
});
add('2026 四川 15 多区磁场', {
  params: { q: [2, 'C', '任取'], m: [3, 'kg', '任取'], B: [1.5, 'T', '任取'], d: [2, 'm', '任取'] }, samples: [{ q: 3, m: 2, B: 2, d: 1.5 }],
  scene: S({ particle: { duration: '(3*pi+4)*m/(q*B)', fields: [{ id: 'Ⅰ', kind: 'B', B: 'B', region: { side: { from: ['d+50*d', '-50*d'], to: ['-50*d', 'd+50*d'] } } }, { id: 'Ⅱ', kind: 'B', B: '-B', region: { side: { from: ['-50*d', '3*d+50*d'], to: ['3*d+50*d', '-50*d'] } } }], particles: [{ id: '甲', q: 'q', m: 'm', pos: ['d', 0], vel: ['q*B*d/m', 0] }] } }),
  asks: [{ id: '2', text: '周期（核对：一周后回到起点）', expr: 'val(x_甲)', answer: 'd' }],
});
add('2026 广东 15 带电摆', {
  constants: { g: 10 }, params: { d: [2, 'm', '任取'], m: [2, 'kg', '任取'] }, samples: [{ d: 3, m: 3 }],
  scene: S({ ode: { state: { th: 'pi/6', w: 0 }, rates: { th: 'w', w: '-g/d*sin(th)-g/(d*sqrt(3))*cos(th)' }, vals: { T2: 'm*d*w^2+m*g*cos(th)-m*g/sqrt(3)*sin(th)' }, events: [{ name: '碰 M', when: 'th+pi/6', dir: -1, stop: true }], duration: 10, view: ['-d', '-1.2*d', 'd', '0.1*d'], draw: [{ line: [[0, 0], ['d*sin(th)', '-d*cos(th)']], kind: 'rope' }, { point: ['d*sin(th)', '-d*cos(th)'], label: '小球' }] } }),
  asks: [{ id: '2', text: '单根绳拉力', expr: 'val(T2)/sqrt(2)', answer: '2*sqrt(6)/3*m*g' }],
});
add('2026 广东 14 机器人', {
  constants: { g: 10 }, params: { m: [1, 'kg', '摆锤'], M: [4, 'kg', '总质量'], R: [.4, 'm', '绳长'], v0: [4, 'm/s', '初速度'] },
  scene: S({ ode: { state: { th: 0, w: 'v0/R', y: 0, vy: 0, ph: 0 }, rates: { th: 'w', w: '(1-ph)*(-g/R*sin(th))', y: 'vy', vy: 'ph*(-g)' }, events: [{ name: '碰挡板', when: 'th-pi/2', dir: 1, set: { w: 0, ph: 1, vy: '2*m*w*R/M' } }, { name: '最高点', when: 'vy', dir: -1 }, { name: '落地', when: 'y+1e-9', dir: -1, stop: true }], duration: 3, view: [-1, -1, 1, 1.5], draw: [{ point: ['R*sin(th)', 'y-R*cos(th)'], label: '摆锤' }, { circle: [0, 'y', 'R*1.3'] }] } }),
  asks: [{ id: '1', text: 'Ek', at: mark('碰挡板'), expr: '0.5*M*val(vy)^2', answer: 4, unit: 'J' }, { id: '2', text: 'h', at: mark('最高点'), expr: 'val(y)', answer: .1, unit: 'm' }],
});
add('2026 卷 6 电磁泵', {
  constants: { g: 10 }, params: { B: [1, 'T', '任取'], L: [2, 'm', '任取'], m: [2, 'kg', '任取'], R: [3, 'Ω', '任取'], k: [20, 'N/m', '任取'] }, samples: [{ B: 2, L: 1.5, m: 3, R: 2, k: 30 }],
  scene: S({ induction: { kind: 'rails', L: 'L', B: 'B', incline: 90, rods: [{ id: 'ab', m: 'm', r: 'R', F: '-k*x' }], branches: [{ R: 0.000001 }], duration: 6 } }),
  asks: [{ id: 'C', text: '到最低点流过的电荷量', at: { event: 'when', expr: 'val(v_ab)', dir: -1 }, expr: 'val(q)/(B*L*val(x_ab)/R)', answer: 1 }],
});
add('2026 卷 14 气动装置', {
  constants: { g: 10 }, params: { p0: [1e5, 'Pa', 'p0'], S1: [.001, 'm²', 'S1'], S2: [.004, 'm²', 'S2'], m: [10, 'kg', 'm'], V0: [.002, 'm³', 'V0'], Hh: [.1, 'm', 'H'], Q: [50, 'J', '吸热'] },
  scene: S({ gas: { patm: 'p0', chambers: [{ id: '气', p: 'p0', V: 'V0', T: 300 }], pistons: [{ id: 'a', A: 'S1', out: 'right', drive: true }, { id: 'b', A: 'S2', out: 'down', load: 'm*g', f: 'm*g' }], steps: [{ label: '拉 a', move: { a: '2*m*g*V0/(S1*(p0*S2-2*m*g))*u' } }] } }),
  asks: [{ id: '3', text: '第 3 问拉力做功', scene: S({ gas: { patm: 'p0', chambers: [{ id: '气', p: 'p0-2*m*g/S2', V: 'V0*p0*S2/(p0*S2-2*m*g)', T: 300 }], pistons: [{ id: 'a', A: 'S1', out: 'right' }, { id: 'b', A: 'S2', out: 'down', load: 'm*g', f: 'm*g' }], steps: [{ label: '继续拉', move: { a: 'Hh*S2/S1*u' } }] } }), expr: 'val(Wd_a)', answer: '2*m*g*Hh' }, { id: '2', text: '位移', expr: 'val(x_a)', answer: '2*m*g*V0/(S1*(p0*S2-2*m*g))', unit: 'm' }, { id: '2b', text: '拉力做功', expr: 'val(Wd_a)', answer: '2*m*g*p0*V0/(p0*S2-2*m*g)-p0*V0*log((p0*S2)/(p0*S2-2*m*g))' }],
});

if (process.env.DUMP) { console.log(JSON.stringify(cases)); process.exit(0); }
const only = process.argv[2]; let pass = 0, fail = 0, unverified = 0; const log: string[] = [];
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  const P = { spec: 'v1', title: c.name, ...c.P } as unknown as Problem;
  try {
    const errs = validate(P); if (errs.length) throw new Error('格式：' + errs.slice(0, 3).join('；'));
    const S2 = solveProblem(P);
    for (const a of S2.asks) { if (a.ok) { pass++; if (only) console.log(`  ✓ ${c.name} ${a.id} = ${a.shown}`); } else if (a.ok === null) { unverified++; if (only) console.log(`  ○ ${c.name} ${a.id}：${a.source}，数值对照 ${a.answerMatch}`); } else { fail++; log.push(`✗ ${c.name} (${a.id}) 算出 ${a.shown}，答案 ${a.answer ?? ''} ${a.error ?? ''}`); } }
  } catch (e) { fail++; log.push(`✗ ${c.name}：${(e as Error).message.slice(0, 200)}`); }
}
console.log(log.join('\n')); console.log(`\n压轴测试：通过 ${pass}，未通过 ${fail}，未核验 ${unverified}`); if (fail) process.exitCode = 1;
