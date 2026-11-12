// 实物电路：桌上摆着电池、电表、电阻、灯泡、滑动变阻器，用导线连起来。读数来自电路求解，指针会转，灯会亮。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SimResult, Snapshot } from '../engine/sim.ts';

type Tag = { node: HTMLDivElement; anchor: THREE.Vector3; id: string; kind: string };
type Meter = { needle: THREE.Object3D; range: number; id: string; volt: boolean };
type Lamp = { glow: THREE.MeshStandardMaterial; light: THREE.PointLight; id: string };
type Rheo = { slider: THREE.Object3D; id: string; len: number; lo: number; hi: number };
type Sw = { lever: THREE.Object3D; id: string };
const std = (color: string, more: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: .5, metalness: .1, ...more });

let woodTex: HTMLCanvasElement | undefined;
function woodCanvas() {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d')!;
  g.fillStyle = '#b48a5c'; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 260; i++) { const y = (i * 37) % 1024, a = .03 + (i % 7) * .012; g.strokeStyle = i % 2 ? `rgba(80,48,20,${a})` : `rgba(255,226,180,${a})`; g.lineWidth = 1 + (i % 5); g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x * .011 + i) * 7); g.stroke(); }
  return woodTex = c;
}
function dial(volt: boolean, range: number, letters = false) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 400; const g = c.getContext('2d')!;
  g.fillStyle = '#fbf8ef'; g.fillRect(0, 0, 512, 400); g.strokeStyle = '#1a262a'; g.fillStyle = '#1a262a'; g.lineWidth = 3;
  const cx = 256, cy = 330, R = 250; g.beginPath(); g.arc(cx, cy, R, -Math.PI * .78, -Math.PI * .22); g.stroke();
  for (let i = 0; i <= 30; i++) { const a = -Math.PI * .78 + Math.PI * .56 * i / 30, l = i % 10 === 0 ? 30 : i % 5 === 0 ? 20 : 12; g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l)); g.stroke(); if (i % 10 === 0 && (!letters || i === 0)) { g.font = '600 30px "Times New Roman"'; g.textAlign = 'center'; g.fillText(String(+(range * i / 30).toPrecision(3)), cx + Math.cos(a) * (R - 56), cy + Math.sin(a) * (R - 56) + 10); } }
  g.font = 'italic 700 74px "Times New Roman"'; g.textAlign = 'center'; g.fillText(volt ? 'V' : 'A', cx, 300);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const niceRange = (x: number) => { const p = 10 ** Math.floor(Math.log10(x || 1)); for (const k of [1, 2, 3, 5, 10]) if (x <= k * p * 1.001) return k * p; return 10 * p; };

export class Bench3D {
  readonly canvas: HTMLCanvasElement;
  private renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private scene = new THREE.Scene(); private camera = new THREE.PerspectiveCamera(32, 1, .1, 200); private controls: OrbitControls;
  private group = new THREE.Group(); private layer = document.createElement('div');
  private tags: Tag[] = []; private meters: Meter[] = []; private lamps: Lamp[] = []; private rheos: Rheo[] = []; private switches: Sw[] = [];
  private paths: { id: string; pts: THREE.Vector3[]; len: number; phase: number; battery: boolean }[] = [];
  private beads?: THREE.InstancedMesh; private sim?: SimResult; private snap?: Snapshot; private imax = 1; private last = 0;
  private observer: ResizeObserver;
  constructor(private element: HTMLElement) {
    const r = this.renderer; r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.02;
    this.canvas = r.domElement; this.canvas.className = 'bench'; element.prepend(this.canvas); this.layer.className = 'bench-labels'; element.append(this.layer);
    this.scene.background = new THREE.Color('#2a2420');
    const pm = new THREE.PMREMGenerator(r); this.scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; this.scene.environmentIntensity = .55; pm.dispose();
    const key = new THREE.DirectionalLight('#fff3e0', 2.3); key.position.set(-6, 14, 7); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); const k = key.shadow.camera; k.left = k.bottom = -13; k.right = k.top = 13; k.far = 40; key.shadow.radius = 3; key.shadow.bias = -.0003;
    this.scene.add(key, new THREE.HemisphereLight('#fff', '#6b5a48', .5), this.group);
    const tex = new THREE.CanvasTexture(woodCanvas()); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 3); tex.anisotropy = 8;
    const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), std('#fff', { map: tex, roughness: .62 })); table.rotation.x = -Math.PI / 2; table.receiveShadow = true; this.scene.add(table);
    this.controls = new OrbitControls(this.camera, this.canvas); this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * .47; this.controls.minDistance = 5; this.controls.maxDistance = 45;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(element); this.resize();
  }
  private resize() { const w = this.element.clientWidth || 800, h = this.element.clientHeight || 600; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  private add(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
  private tag(id: string, kind: string, anchor: THREE.Vector3) { const node = document.createElement('div'); node.className = 'bench-tag'; this.layer.append(node); this.tags.push({ node, anchor, id, kind }); }
  prepare(sim: SimResult, w0: number, w1: number) {
    this.sim = sim; this.group.clear(); this.layer.replaceChildren(); this.tags = []; this.meters = []; this.lamps = []; this.rheos = []; this.switches = []; this.paths = [];
    const c = sim.circuit!, ps = Object.values(c.nodes), x0 = Math.min(...ps.map((p) => p[0])), x1 = Math.max(...ps.map((p) => p[0])), y0 = Math.min(...ps.map((p) => p[1])), y1 = Math.max(...ps.map((p) => p[1]));
    const s = 11 / Math.max(x1 - x0, (y1 - y0) * 1.25, 1e-9), P = (n: string) => { const p = c.nodes[n]; return new THREE.Vector3((p[0] - (x0 + x1) / 2) * s, 0, -(p[1] - (y0 + y1) / 2) * s); };
    const snaps = sim.samples.filter((q) => q.t >= w0 && q.t <= w1 && q.circuit), list = snaps.length ? snaps : [sim.start];
    this.imax = Math.max(1e-9, ...list.flatMap((q) => Object.values(q.circuit?.I ?? {}).map(Math.abs)));
    const brass = std('#c8a14e', { metalness: .85, roughness: .32 });
    for (const n of Object.keys(c.nodes)) { const p = P(n); this.add(new THREE.CylinderGeometry(.13, .16, .2, 18), brass, this.group, p.x, .1, p.z); }
    const lead = std('#20262a', { roughness: .4 }), leadRed = std('#a92f27', { roughness: .4 });
    for (const e of c.elements) {
      const a = P(e.a), b = P(e.b), mid = a.clone().add(b).multiplyScalar(.5), dir = b.clone().sub(a), L = dir.length() || 1, ang = Math.atan2(-dir.z, dir.x), half = e.kind === 'wire' ? 0 : Math.min(L * .3, e.kind === 'ammeter' || e.kind === 'voltmeter' ? .98 : e.kind === 'lamp' || e.kind === 'capacitor' ? .5 : 1.45);
      const u = dir.clone().normalize(), parts: THREE.Vector3[][] = e.kind === 'wire' ? [[a, b]] : [[a, mid.clone().addScaledVector(u, -half)], [mid.clone().addScaledVector(u, half), b]];
      const pts: THREE.Vector3[] = [];
      parts.forEach(([p, q], i) => {
        const span = p.distanceTo(q), arch = Math.min(.5, span * .14) + .16, curve = new THREE.CatmullRomCurve3([new THREE.Vector3(p.x, .18, p.z), p.clone().lerp(q, .33).setY(arch), p.clone().lerp(q, .67).setY(arch), new THREE.Vector3(q.x, .18, q.z)]);
        this.add(new THREE.TubeGeometry(curve, 24, .05, 8), e.kind === 'battery' && i === 0 ? leadRed : lead, this.group);
        pts.push(...curve.getPoints(16));
      });
      const path = new THREE.CatmullRomCurve3(pts);
      if (e.kind !== 'voltmeter') this.paths.push({ id: e.id, pts: path.getSpacedPoints(160), len: path.getLength(), phase: 0, battery: e.kind === 'battery' });
      if (e.kind === 'wire') continue;
      const g = new THREE.Group(); g.position.copy(mid); g.rotation.y = ang; this.group.add(g);
      const anchor = mid.clone().setY(1.7);
      if (e.kind === 'battery') {
        this.add(new RoundedBoxGeometry(half * 1.9, .62, 1, 3, .07), std('#2b3f52'), g, 0, .31, 0);
        for (const d of [-1, 1]) { this.add(new THREE.CylinderGeometry(.34, .34, half * .78, 24), std('#d9a521', { metalness: .4 }), g, d * half * .45, .72, 0).rotation.z = Math.PI / 2; this.add(new THREE.CylinderGeometry(.12, .12, .1, 16), brass, g, d * half * .45 + half * .42, .72, 0).rotation.z = Math.PI / 2; }
      } else if (e.kind === 'R') {
        this.add(new RoundedBoxGeometry(half * 1.9, .14, .7, 2, .04), std('#e6ddc8'), g, 0, .07, 0);
        this.add(new THREE.CylinderGeometry(.26, .26, half * 1.3, 24), std('#c9a97c', { roughness: .4 }), g, 0, .46, 0).rotation.z = Math.PI / 2;
        [['#a92f27', -.28], ['#1f5fbf', -.06], ['#1a262a', .16], ['#c8a14e', .34]].forEach(([col, f]) => { this.add(new THREE.CylinderGeometry(.268, .268, half * .09, 24), std(col as string), g, half * 1.3 * (f as number), .46, 0).rotation.z = Math.PI / 2; });
      } else if (e.kind === 'rheostat') {
        const len = half * 1.6, stripes = document.createElement('canvas'); stripes.width = 256; stripes.height = 8; const q = stripes.getContext('2d')!; for (let i = 0; i < 64; i++) { q.fillStyle = i % 2 ? '#b8703a' : '#7c4a24'; q.fillRect(i * 4, 0, 4, 8); }
        const tx = new THREE.CanvasTexture(stripes); tx.colorSpace = THREE.SRGBColorSpace; const coil = this.add(new THREE.CylinderGeometry(.3, .3, len, 24, 1, true), std('#fff', { map: tx, roughness: .35, metalness: .5 }), g, 0, .55, 0); coil.rotation.z = Math.PI / 2; tx.wrapS = THREE.RepeatWrapping; tx.rotation = Math.PI / 2; tx.center.set(.5, .5);
        for (const d of [-1, 1]) this.add(new RoundedBoxGeometry(.24, 1.1, .9, 2, .04), std('#3a4348'), g, d * len / 2, .55, 0);
        this.add(new THREE.CylinderGeometry(.05, .05, len, 12), std('#b9c2c6', { metalness: .9, roughness: .25 }), g, 0, 1, 0).rotation.z = Math.PI / 2;
        const slider = new THREE.Group(); g.add(slider); this.add(new RoundedBoxGeometry(.3, .2, .5, 2, .04), std('#1f5fbf'), slider, 0, 1, 0); this.add(new THREE.BoxGeometry(.06, .4, .1), brass, slider, 0, .75, 0);
        const Rs = list.map((f) => Math.abs(f.circuit!.U[e.id] / (f.circuit!.I[e.id] || 1e-30))).filter(Number.isFinite);
        this.rheos.push({ slider, id: e.id, len, lo: Math.min(...Rs), hi: Math.max(...Rs) });
      } else if (e.kind === 'ammeter' || e.kind === 'voltmeter') {
        const volt = e.kind === 'voltmeter', top = Math.max(1e-9, ...list.map((f) => Math.abs(volt ? f.circuit!.U[e.id] : f.circuit!.I[e.id]))), range = niceRange(top * 1.15);
        const m = new THREE.Group(); g.add(m); g.rotation.y = 0; m.position.y = .85; m.rotation.x = -.4;
        this.add(new RoundedBoxGeometry(2, 1.6, .7, 3, .08), std(volt ? '#35566e' : '#6d3b34'), m, 0, 0, 0);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.33), new THREE.MeshStandardMaterial({ map: dial(volt, range, this.element.hasAttribute('data-letters')), roughness: .35 })); face.position.z = .36; m.add(face);
        const pivot = new THREE.Group(); pivot.position.set(0, -.5, .38); m.add(pivot); const nd = new THREE.Mesh(new THREE.BoxGeometry(.022, .95, .01), std('#b5302a')); nd.position.y = .47; pivot.add(nd);
        this.add(new THREE.SphereGeometry(.05, 12, 8), std('#1a262a'), pivot);
        this.meters.push({ needle: pivot, range, id: e.id, volt }); anchor.setY(2.35);
      } else if (e.kind === 'lamp') {
        this.add(new THREE.CylinderGeometry(.42, .5, .3, 24), std('#3a4348'), g, 0, .15, 0); this.add(new THREE.CylinderGeometry(.2, .22, .32, 20), brass, g, 0, .45, 0);
        this.add(new THREE.SphereGeometry(.46, 32, 24), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: .92, roughness: .06, thickness: .1, transparent: true, opacity: .55 }), g, 0, 1, 0);
        const glow = std('#ffe9b0', { emissive: '#ffb733', emissiveIntensity: 0 }); this.add(new THREE.SphereGeometry(.13, 16, 12), glow, g, 0, 1, 0);
        const light = new THREE.PointLight('#ffc466', 0, 9, 2); light.position.set(0, 1.1, 0); g.add(light); this.lamps.push({ glow, light, id: e.id }); anchor.setY(2);
      } else if (e.kind === 'capacitor') {
        this.add(new THREE.CylinderGeometry(.42, .42, .95, 28), std('#22416e', { roughness: .3 }), g, 0, .48, 0); this.add(new THREE.CylinderGeometry(.43, .43, .1, 28), std('#c3cbd0', { metalness: .7 }), g, 0, .9, 0);
      } else if (e.kind === 'switch') {
        this.add(new RoundedBoxGeometry(half * 1.9, .12, .7, 2, .03), std('#e6ddc8'), g, 0, .06, 0); for (const d of [-1, 1]) this.add(new THREE.BoxGeometry(.12, .34, .3), brass, g, d * half * .8, .25, 0);
        const lever = new THREE.Group(); lever.position.set(-half * .8, .36, 0); g.add(lever); this.add(new THREE.BoxGeometry(half * 1.6, .06, .14), std('#b9c2c6', { metalness: .85, roughness: .25 }), lever, half * .8, 0, 0); this.add(new THREE.SphereGeometry(.13, 12, 8), std('#1a262a'), lever, half * 1.6, 0, 0); this.switches.push({ lever, id: e.id });
      }
      this.tag(e.id, e.kind, anchor);
    }
    const n = 420; this.beads?.removeFromParent(); this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffd76a', emissive: '#ffb733', emissiveIntensity: 1.6 }), n); this.beads.count = 0; this.group.add(this.beads);
    const R = 11 * 1.2; this.camera.position.set(0, R * .92, R * 1.05); this.controls.target.set(0, .3, 0); this.controls.update();
    this.update(sim.start);
  }
  update(s: Snapshot) {
    this.snap = s; const f = s.circuit; if (!f) return;
    for (const m of this.meters) { const v = Math.abs(m.volt ? f.U[m.id] : f.I[m.id]); m.needle.rotation.z = (.5 - Math.min(1.03, v / m.range)) * Math.PI * .56; }
    for (const l of this.lamps) { const k = Math.min(1, Math.abs(f.I[l.id]) / this.imax); l.glow.emissiveIntensity = 7 * k * k; l.light.intensity = 26 * k * k; }
    for (const r of this.rheos) { const R = Math.abs(f.U[r.id] / (f.I[r.id] || 1e-30)), k = r.hi > r.lo ? (R - r.lo) / (r.hi - r.lo) : .5; r.slider.position.x = (k - .5) * r.len * .9; }
    for (const w of this.switches) w.lever.rotation.z = Math.abs(f.U[w.id]) < 1e-3 ? 0 : .55;
  }
  setFocus() { /* 电路没有运动物体 */ } toggle() { /* 同上 */ } setView() { /* 用鼠标转 */ } screenOf() { return null; }
  render(now: number) {
    if (!this.sim || !this.snap?.circuit) return;
    const f = this.snap.circuit, dt = Math.min(.05, (now - this.last) / 1000) || 0; this.last = now;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(); let k = 0; const gap = .62;
    if (this.beads) {
      for (const e of this.paths) { const I = f.I[e.id] ?? 0; if (Math.abs(I) < this.imax * 1e-4) continue; e.phase += (e.battery ? -I : I) / this.imax * 1.7 * dt; const ph = ((e.phase % gap) + gap) % gap; for (let d = ph; d < e.len && k < 420; d += gap) { p.copy(e.pts[Math.min(160, Math.round(d / e.len * 160))]); m.setPosition(p); this.beads.setMatrixAt(k++, m); } }
      this.beads.count = k; this.beads.instanceMatrix.needsUpdate = true;
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera);
    const W = this.element.clientWidth, H = this.element.clientHeight;
    for (const t of this.tags) {
      const q = t.anchor.clone().project(this.camera), x = (q.x + 1) / 2 * W, y = (1 - q.y) / 2 * H, U = Math.abs(f.U[t.id] ?? 0), I = Math.abs(f.I[t.id] ?? 0);
      const read = t.kind === 'voltmeter' ? `${U.toFixed(2)} V` : t.kind === 'ammeter' ? `${I.toFixed(2)} A` : t.kind === 'switch' ? (U < 1e-3 ? '闭合' : '断开') : t.kind === 'capacitor' ? `${U.toFixed(2)} V` : `${U.toFixed(2)} V · ${I.toFixed(2)} A`;
      const html = `<b>${t.id.replace(/^([A-Za-z])_?(\d+)$/, '<em>$1</em><sub>$2</sub>')}</b><i>${read}${read && this.element.hasAttribute('data-letters') ? '（示例）' : ''}</i>`; if (t.node.dataset.h !== html) { t.node.dataset.h = html; t.node.innerHTML = html; }
      t.node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    }
  }
}
