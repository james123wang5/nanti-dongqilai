// 通用 3D 舞台：只消费几何、采样和事件；所有对象按题目坐标构建。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SimResult, Snapshot, V2 } from '../engine/sim.ts';
import { COLORS, fitFrame, bodyPose, hostBox, springEnds, surfacePoints, supportPlan, type Frame } from './geometry.ts';

import { arrowScale, forceGlyphs, forceMax, mergeEqualResultant, layoutForceLines, MEANING, type ForceGlyph } from './visual-rules.ts';
import { placeLabel, placeStableLabel, projectedObstacles, overlaps, type Rect } from './label-layout.ts';

type Label = { anchor: THREE.Object3D; node: HTMLDivElement };
type BodyView = { group: THREE.Group; point?: THREE.Mesh; link?: THREE.Line; baseLength: number; contact?: THREE.Mesh; velocity: SolidArrow; force: SolidArrow; vLabel: Label; fLabel: Label; label: Label };
type View = 'front' | 'angle' | 'top';
const Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
const material = (color: string, more = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, ...more });
// 深色胡桃木桌面上的浅色木台体：轨道、物体各用一档颜色，第一眼能分开。
const PAL = { bg: '#f6f2e8', plinth: '#b9c7c8', track: '#2c4654', mat: '#8fa5a6', belt: '#2b3437', board: '#d9b774', box: '#a8cfe0', panel: '#aebdbe', wall: '#34505e', edge: '#101417', mark: '#fff6e2' };

// 木纹只生成一次，换题时复用画布。
let woodCanvas: HTMLCanvasElement | undefined;
function wood() {
  if (woodCanvas) return woodCanvas;
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d')!;
  // 坐标纸桌面：和 2D 同一种纸，切换时不换世界
  x.fillStyle = '#f6f2e8'; x.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i <= 64; i++) { x.fillStyle = i % 8 ? '#efe9db' : '#e2dac8'; x.fillRect(i * 16, 0, i % 8 ? 1 : 2, 1024); x.fillRect(0, i * 16, 1024, i % 8 ? 1 : 2); }
  return woodCanvas = c;
}
// 箭杆和箭头都是网格，侧看、缩放后仍然有厚度。
class SolidArrow extends THREE.Group {
  private shaft: THREE.Mesh;
  private head: THREE.Mesh;
  constructor(color: string, private radius: number) {
    super();
    const mat = material(color, { roughness: 0.4, metalness: 0.2 });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), mat);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20), mat);
    this.add(this.shaft, this.head);
  }
  setDirection(dir: THREE.Vector3) { this.quaternion.setFromUnitVectors(Y, dir); }
  setLength(length: number, headLength: number, headWidth: number) {
    const shaftLength = Math.max(length - headLength, 1e-6);
    this.shaft.scale.set(this.radius, shaftLength, this.radius); this.shaft.position.y = shaftLength / 2;
    this.head.scale.set(headWidth / 2, headLength, headWidth / 2); this.head.position.y = shaftLength + headLength / 2;
  }
}

/** 情景外观的立体版：只换外形，尺寸按物体的示意大小 */
function lookMesh(look: string, s: number, color: string) {
  const G = new THREE.Group(), add = (geo: THREE.BufferGeometry, c: string, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, material(c, { roughness: .45 })); m.castShadow = true; m.position.set(x, y, z); G.add(m); return m; };
  if (look === 'car') { add(new RoundedBoxGeometry(s * 2.2, s * .6, s * 1.1, 3, s * .1), color, 0, -s * .05); add(new RoundedBoxGeometry(s * 1.1, s * .5, s, 3, s * .1), '#dbe9f3', -s * .1, s * .45); for (const x of [-s * .7, s * .7]) for (const z of [-s * .55, s * .55]) add(new THREE.CylinderGeometry(s * .26, s * .26, s * .16, 20), '#26343c', x, -s * .4, z).rotation.x = Math.PI / 2; }
  else if (look === 'person') { add(new THREE.CapsuleGeometry(s * .22, s * .75, 6, 14), color, 0, -s * .05); add(new THREE.SphereGeometry(s * .24, 20, 16), '#f3d3b5', 0, s * .68); }
  else if (look === 'rocket') { add(new THREE.CylinderGeometry(s * .32, s * .4, s * 1.3, 24), color); add(new THREE.ConeGeometry(s * .32, s * .6, 24), '#e9eef0', 0, s * .95); }
  else if (look === 'satellite') { add(new THREE.BoxGeometry(s * .7, s * .7, s * .7), color); for (const d of [-1, 1]) add(new THREE.BoxGeometry(s * 1, s * .05, s * .5), '#2d5f93', d * s * .85, 0, 0); }
  else if (look === 'boat') { add(new RoundedBoxGeometry(s * 2, s * .5, s * .9, 3, s * .15), color); add(new THREE.ConeGeometry(s * .5, s * 1.1, 3), '#ffffff', 0, s * .8); }
  else if (look === 'planet') add(new THREE.SphereGeometry(s * .7, 32, 24), color);
  else add(new RoundedBoxGeometry(s, s, s, 3, s * .06), '#c58a4a');
  return G;
}
function ballTexture(color: string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d')!;
  x.fillStyle = color; x.fillRect(0, 0, 256, 128); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 128); x.fillRect(128, 0, 64, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export class Scene3D {
  private rollers = new Map<string, { mesh: THREE.Mesh; r: number }>();
  private extra = new THREE.Group();
  private ropeLines: { rope: NonNullable<SimResult['ropes']>[number]; line: THREE.Line }[] = [];
  /** 解析演示的矢量：箭头和标签只建一次，每帧只改位置和长度 */
  private scriptVecs: { arrow: SolidArrow; label: Label }[] = []; private pivots = new Set<string>();
  private scriptMat = new THREE.LineBasicMaterial({ color: '#1b2a33' });
  private lastSnap?: Snapshot;
  /** 物体在画布上的位置（CSS 像素），给标注和点击用 */
  screenOf(id: string): [number, number] | null {
    const v = this.bodies.get(id); if (!v || !v.group.visible) return null;
    const p = v.group.getWorldPosition(new THREE.Vector3()).project(this.camera);
    return [(p.x + 1) / 2 * this.element.clientWidth, (1 - p.y) / 2 * this.element.clientHeight];
  }
  private focusId: string | null = null;
  setFocus(id: string | null) { this.focusId = id; }
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  private key = new THREE.DirectionalLight('#fff3e2', 2.6);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private model = new THREE.Group();
  private desk = new THREE.Group();
  private labels: Label[] = [];
  private labelLayer = document.createElement('div');
  private bodies = new Map<string, BodyView>();
  private hosts = new Map<string, THREE.Group[]>();
  private belts: { texture: THREE.CanvasTexture; speed: number; length: number; rollers: THREE.Mesh[] }[] = [];
  private springs = new Map<string, THREE.Mesh>();
  private trails: { line: THREE.Line; times: number[] }[] = [];
  private sim!: SimResult;
  private frame!: Frame;
  private unit = 1;
  private vmax = 1;
  private fmax = 1; private lineOrder = new Map<string, number>(); private fmaxKey = ''; private fw: [number, number] | null = null;
  private forceIds: string[] = [];
  private massSym: Record<string,string> = {};
  symbolsOnly = false;
  setMasses(m: Record<string,string>) { this.massSym=m; }
  setOverlay(o: { forces: string[] }) { this.forceIds = o.forces; }
  private forceLayer = document.createElement('canvas');
  qa: { mode: string; w: number; h: number; forceArrows: (ForceGlyph & { body: string; x0: number; y0: number; x1: number; y1: number })[]; nameDots: { id: string; color: string }[]; texts: { s: string; x: number; y: number; w: number; h: number; color: string; outline: string; outlineWidth: number }[] } = { mode: '3d', w: 0, h: 0, forceArrows: [], nameDots: [], texts: [] };
  private view: View = 'angle';
  private transition?: { start: number; from: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 };
  private target = new THREE.Vector3();
  private radius = 6;
  private frameCorners: THREE.Vector3[] = [];
  private flatness = 1;
  private flags = { velocity: true, force: false, trail: true };
  private observer: ResizeObserver;
  private lost = false;
  private status = document.createElement('div');

  constructor(private element: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.scene.background = new THREE.Color(PAL.bg);
    this.scene.fog = new THREE.Fog(PAL.bg, 30, 90);
    // 程序生成的室内环境光：不加外部贴图，让金属、玻璃有高光。
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environmentIntensity = 0.42; pmrem.dispose();
    this.renderer.domElement.setAttribute('aria-label', '可旋转的三维物理场景');
    this.renderer.domElement.setAttribute('role', 'img');
    element.prepend(this.renderer.domElement);
    this.labelLayer.className = 'scene-labels'; element.append(this.labelLayer);
    this.forceLayer.className = 'force-layer'; element.append(this.forceLayer);
    this.status.className = 'scene-message'; this.status.hidden = true; element.append(this.status);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 1; this.controls.maxDistance = 130;
    // 拖动不翻倒：最低转到水平视线（不钻到地面下），最高到正上方；转动灵敏度减半
    this.controls.minPolarAngle = 0; this.controls.maxPolarAngle = Math.PI / 2; this.controls.rotateSpeed = 0.5;
    this.controls.addEventListener('start', () => { this.transition = undefined; this.markView(''); });
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.status.hidden = false; this.status.textContent = '三维画面暂时中断，请刷新页面恢复。'; });
    const ambient = new THREE.HemisphereLight('#ffffff', '#8fa3a3', .7);
    const key = this.key; key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.far = 80;
    key.shadow.normalBias = 0.02; key.shadow.bias = -0.0002; key.shadow.radius = 2.5;
    const rim = new THREE.DirectionalLight('#a8cdf0', 1); rim.position.set(9, 7, -8);
    this.root.add(this.model); this.scene.add(this.root, this.desk, ambient, key, key.target, rim);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(element);
    this.resize();
  }

  private resize() {
    const { width, height } = this.element.getBoundingClientRect();
    this.renderer.setSize(Math.max(width, 1), Math.max(height, 1));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.camera.aspect = Math.max(width, 1) / Math.max(height, 1); this.camera.updateProjectionMatrix();
    if (this.sim) this.setView(this.view, false);
  }

  private mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) {
    const mesh = new THREE.Mesh(geometry, mat); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  /** 背面外扩的深色轮廓：任何角度都有一圈手绘式描边。 */
  private outline(mesh: THREE.Mesh, w: number, h: number, d: number) {
    const e = this.frame.span * 0.003, hull = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: PAL.edge, side: THREE.BackSide }));
    hull.scale.set(1 + 2 * e / w, 1 + 2 * e / h, 1 + 2 * e / d); hull.position.copy(mesh.position); mesh.parent!.add(hull);
  }
  private edges(mesh: THREE.Mesh, angle = 30, opacity = 0.6) {
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), new THREE.LineBasicMaterial({ color: PAL.edge, transparent: true, opacity }));
    line.position.copy(mesh.position); line.rotation.copy(mesh.rotation); mesh.parent!.add(line);
  }
  private box(w: number, h: number, d: number, color: string, parent: THREE.Object3D, round = false) {
    const geo = round ? new RoundedBoxGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6), Math.max(d, 1e-6), 3, Math.min(w, h, d) * 0.12) : new THREE.BoxGeometry(w, h, d);
    return this.mesh(geo, material(color), parent);
  }
  private label(text: string, parent: THREE.Object3D, pos = new THREE.Vector3(), cls = ''): Label {
    const anchor = new THREE.Object3D(); anchor.position.copy(pos); parent.add(anchor);
    const node = document.createElement('div'); node.className = `scene-label ${cls}`; node.textContent = text;
    this.labelLayer.append(node); const label = { anchor, node }; this.labels.push(label); return label;
  }
  private clear() {
    // 每次换题/小问释放 GPU 资源，播放时复用网格与缓冲区。
    const geometries = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    for (const group of [this.model, this.desk]) {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) geometries.add(m.geometry);
        for (const mat of m.material ? Array.isArray(m.material) ? m.material : [m.material] : []) {
          mats.add(mat); if ((mat as THREE.MeshStandardMaterial).map) textures.add((mat as THREE.MeshStandardMaterial).map!);
        }
      }); group.clear();
    }
    geometries.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose());
    this.labels = []; this.labelLayer.replaceChildren(); this.bodies.clear(); this.hosts.clear(); this.belts = []; this.springs.clear(); this.trails = [];
  }

  prepare(sim: SimResult, w0: number, w1: number) {
    this.clear(); this.sim = sim; this.frame = fitFrame(sim, w0, w1);
    const f = this.frame; this.unit = 10 / f.span;
    this.model.scale.setScalar(this.unit);
    this.model.position.set(-(f.x0 + f.x1) / 2 * this.unit, -(f.y0 + f.y1) / 2 * this.unit, 0);
    this.root.rotation.x = sim.geo.plane === 'horizontal' ? -Math.PI / 2 : 0;
    this.vmax = sim.samples.reduce((v, s) => Object.values(s.bodies).reduce((v, b) => Math.max(v, Math.hypot(b.vx, b.vy)), v), 1e-6);
    this.fw = [w0, w1]; this.fmaxKey = ''; this.lineOrder.clear();
    this.fmax = forceMax(sim, w0, w1, (id) => { const g = sim.geo.bodies, me = g.find((q) => q.id === id), o = g.filter((q) => q.id !== id && q.m > 0).map((q) => q.m); return !!me && o.length > 0 && me.m > 1e5 * Math.min(...o); });
    // 桌面高度：地面就贴地面，没有地面就贴所有物体和轨道的最低处。
    const ground = sim.geo.surfaces.filter((g) => g.kind === 'ground' && !g.host).map((g) => g.y!);
    // 解析演示没有真正的地面：桌面放低一些，向下的矢量（重力）不会钻到桌面下面
    const hasDown = !!sim.script && [sim.start, sim.end].some((q) => q.script?.vectors.some((v) => v.v[1] < 0));
    const floor = Math.min(f.content.y0 - (hasDown ? f.span * .32 : 0), ...ground.map((y) => y - f.thick));
    this.buildSurfaces(floor); this.buildBodies(); this.buildTrails(w0, w1); this.buildSprings(); this.buildRopes();
    this.update(sim.start);
    this.root.updateMatrixWorld(true);
    // 取景只看本问实际占的范围（物体、轨道、落地的台体），飞出画面的物体不算。
    const horizontal = sim.geo.plane === 'horizontal', c = f.content, depth = f.size * (horizontal ? 0.6 : 1.8);
    this.frameCorners = [];
    for (const p of f.outline) for (const z of [-depth, depth]) this.frameCorners.push(this.model.localToWorld(new THREE.Vector3(p[0], p[1], z)));
    if (!horizontal) for (const x of [c.x0, c.x1]) for (const z of [-depth, depth]) this.frameCorners.push(this.model.localToWorld(new THREE.Vector3(x, floor, z)));
    for (const s of [sim.start, sim.end]) if (s.script) for (const p of [...s.script.links.flatMap((l) => [l.a, l.b]), ...s.script.curves.flatMap((c) => c.pts)]) this.frameCorners.push(this.model.localToWorld(new THREE.Vector3(p[0], p[1], p[2] ?? 0)));
    const frameBox = new THREE.Box3().setFromPoints(this.frameCorners);
    this.target.copy(frameBox.getCenter(new THREE.Vector3()));
    this.radius = Math.max(frameBox.getSize(new THREE.Vector3()).length() / 2, 3);
    this.flatness = (c.x1 - c.x0) / Math.max(c.y1 - (horizontal ? c.y0 : floor), f.span * 0.05);
    const floorY = horizontal ? -f.size * this.unit * 0.62 : (floor + this.model.position.y / this.unit) * this.unit;
    const tex = new THREE.CanvasTexture(wood()); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(16, 16); tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const table = this.mesh(new THREE.PlaneGeometry(320, 320), material('#ffffff', { map: tex, roughness: 0.5, metalness: 0 }), this.desk);
    table.rotation.x = -Math.PI / 2; table.position.set(this.target.x, floorY, this.target.z); table.castShadow = false;
    // 光和阴影跟着场景走，阴影范围越紧越清楚。
    const reach = this.radius * 1.5; this.key.position.set(this.target.x - reach * 0.7, floorY + reach * 1.7, this.target.z + reach * 0.9); this.key.target.position.copy(this.target);
    const cam = this.key.shadow.camera; cam.left = cam.bottom = -reach * 1.25; cam.right = cam.top = reach * 1.25; cam.far = reach * 6; cam.updateProjectionMatrix();
    this.setView('angle', false);
    const note = document.querySelector('#sceneNote span');
    if (note) note.textContent = sim.geo.bodies.some((b) => b.kind === 'board' && b.L > f.span * 1.6) ? '长木板显示局部 · 不改变物理尺寸' : horizontal ? '水平面模型 · 重力垂直于运动平面' : '理想物理模型 · 外观厚度为示意';
    if (note && sim.geo.bodies.some((b) => !b.L)) note.textContent += ' · 物体按质点计算，大小仅为示意；小圆点为真实位置';
    if (note && !horizontal) note.textContent += ' · 斜着看角度会变形，量角度请点“正视”';
  }

  private buildSurfaces(floor: number) {
    const f = this.frame, width = f.size * (this.sim.geo.plane === 'horizontal' ? 1.2 : 3.6), thick = f.thick * 0.85;
    // 从轨道落到桌面的实心台体；填不了的位置用后方背板撑住。
    const plan = supportPlan(this.sim, f, floor), plinth = material(PAL.plinth, { roughness: 0.62, metalness: 0 });
    for (const ps of plan.fills) {
      const shape = new THREE.Shape(); ps.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: width * 0.9, bevelEnabled: false }); geo.translate(0, 0, -width * 0.45);
      this.edges(this.mesh(geo, plinth, this.model), 25, 0.55);
    }
    for (const b of plan.boards) {
      const panel = this.box(b.x1 - b.x0, b.y1 - b.y0, f.thick, PAL.panel, this.model, true);
      panel.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, -width / 2 - f.thick); this.edges(panel, 30, 0.7);
    }
    for (const g of this.sim.geo.surfaces) {
      const group = new THREE.Group(); this.model.add(group);
      if (g.host) { const list = this.hosts.get(g.host) ?? []; list.push(group); this.hosts.set(g.host, list); }
      const points = surfacePoints(g);
      if (g.kind === 'ground' || g.kind === 'seg') {
        const p: V2 = g.kind === 'ground' ? [f.x0 - f.span * 0.15, g.y!] : g.p0!;
        const q: V2 = g.kind === 'ground' ? [f.x1 + f.span * 0.15, g.y!] : g.p1!;
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]), ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        const base = new THREE.Group(); base.position.set(p[0], p[1], 0); base.rotation.z = ang; group.add(base);
        const slab = this.box(L, thick, g.kind === 'ground' ? width * 2.1 : width, g.belt !== undefined ? PAL.belt : g.kind === 'ground' ? PAL.mat : PAL.track, base, true);
        slab.position.set(L / 2, -thick / 2, 0); this.edges(slab, 30, 0.5);
        // 贴着地面的直线轨道和地面上表面重合：深度上让轨道略靠前，免得两个面抢着显示出条纹
        if (g.kind === 'seg') { const m = slab.material as THREE.MeshStandardMaterial; m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; }
        if (g.belt !== undefined) {
          const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
          const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4c6461'; ctx.fillRect(0, 0, 128, 128);
          ctx.fillStyle = '#8fa49b'; ctx.fillRect(0, 0, 8, 128); ctx.fillStyle = '#314b48'; ctx.fillRect(12, 0, 2, 128);
          const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(L / (f.size * 0.75), 1); tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          const skin = this.mesh(new THREE.PlaneGeometry(L, width * 0.96), material('#ffffff', { map: tex }), base);
          skin.rotation.x = -Math.PI / 2; skin.position.set(L / 2, thick * 0.035, 0);
          const rollers: THREE.Mesh[] = [];
          for (const x of [thick, L - thick]) {
            const roll = this.mesh(new THREE.CylinderGeometry(thick * 1.15, thick * 1.15, width * 1.06, 24), material('#8c9991', { metalness: 0.5 }), base);
            roll.rotation.x = Math.PI / 2; roll.position.set(x, -thick, 0); rollers.push(roll);
          }
          this.belts.push({ texture: tex, speed: g.belt, length: f.size * 0.75, rollers });
        }
        for (const [end, x] of [['start', 0], ['end', L]] as const) if (g.walls?.[end] !== undefined) {
          const wall = this.box(thick * 1.3, f.size * 3, width * 1.15, PAL.wall, base, true); wall.position.set(x, f.size * 1.5, 0); this.edges(wall, 30, 0.6);
        }
      } else if (g.side === 'tube') {
        const path = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], 0)));
        const radius = Math.max(f.body * 0.64, ...this.sim.geo.bodies.filter((b) => b.kind !== 'board').map((b) => b.L * 0.64));
        // 光滑玻璃：透明度低、环境高光强；不用环纹，只在真正的管口收一圈。
        const glass = new THREE.MeshPhysicalMaterial({ color: '#a8e4ec', transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 1, envMapIntensity: 3.2 });
        const tube = this.mesh(new THREE.TubeGeometry(path, 160, radius, 28, false), glass, group); tube.castShadow = false; tube.receiveShadow = false;
        const near = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < f.size * 0.2;
        const joined = (p: V2) => this.sim.geo.surfaces.some((o) => o !== g && o.side === 'tube' && [surfacePoints(o)[0], surfacePoints(o).at(-1)!].some((q) => near(p, q)));
        const closed = near(points[0], points.at(-1)!);
        for (const k of [0, 1]) {
          if (closed || joined(k ? points.at(-1)! : points[0])) continue;
          const ring = this.mesh(new THREE.TorusGeometry(radius, f.thick * 0.16, 12, 40), material('#d6e7e6', { metalness: 0.5, roughness: 0.25 }), group);
          ring.position.copy(path.getPoint(k)); ring.quaternion.setFromUnitVectors(Z, path.getTangent(k));
        }
      } else {
        const R = g.R!, sign = g.side === 'outside' ? -1 : 1;
        const shape = new THREE.Shape();
        points.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1]));
        for (let i = points.length - 1; i >= 0; i--) {
          const a = g.a0! + (g.a1! - g.a0!) * i / (points.length - 1);
          shape.lineTo(g.c![0] + (R + sign * thick) * Math.cos(a), g.c![1] + (R + sign * thick) * Math.sin(a));
        }
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: thick * 0.12, bevelThickness: thick * 0.12, bevelSegments: 2, steps: 1 }); geo.translate(0, 0, -width / 2);
        this.edges(this.mesh(geo, material(PAL.track), group), 30, 0.5);
        // 两侧细边有体积，也让背面视角容易读出轨道宽度。
        for (const z of [-width / 2, width / 2]) {
          const path = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], z)));
          this.mesh(new THREE.TubeGeometry(path, 128, thick * 0.2, 6, false), material('#7fd0cf', { roughness: 0.35 }), group);
        }
      }
      for (const [id, p] of Object.entries(g.marks)) {
        const dot = this.mesh(new THREE.SphereGeometry(f.size * 0.13, 12, 8), material(PAL.mark), group); dot.position.set(p[0], p[1], width / 2 + thick);
        this.label(id, group, new THREE.Vector3(p[0], p[1] - f.size * 0.35, width / 2 + thick), 'mark-label');
      }
    }
  }

  private buildBodies() {
    const f = this.frame;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!, gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    gradient.addColorStop(0, '#0a0d0eaa'); gradient.addColorStop(0.5, '#0a0d0e55'); gradient.addColorStop(1, '#0a0d0e00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
    const contactTexture = new THREE.CanvasTexture(canvas);
    for (const [i, g] of this.sim.geo.bodies.entries()) {
      const group = new THREE.Group(); this.model.add(group);
      const pose = bodyPose(this.sim, f, g.id, this.sim.start), box = g.kind === 'board' ? hostBox(this.sim, g.id, f.size) : null;
      if (box) {
        const glass = this.box(box.x1 - box.x0, box.y1 - box.y0, f.size * 4.4, PAL.box, group, true);
        glass.position.set((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, 0);
        (glass.material as THREE.MeshStandardMaterial).transparent = true; (glass.material as THREE.MeshStandardMaterial).opacity = 0.3; (glass.material as THREE.Material).depthWrite = false; glass.castShadow = false;
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry, 28), new THREE.LineBasicMaterial({ color: '#12303b', transparent: true, opacity: 0.9 })); edge.position.copy(glass.position); group.add(edge);
        const foot = this.box(box.x1 - box.x0, f.thick, f.size * 4.4, PAL.board, group, true); foot.position.set((box.x0 + box.x1) / 2, box.y0 - f.thick / 2, 0); this.edges(foot, 30, 0.6);
      } else {
        if (g.kind === 'ball') { const ball = this.mesh(new THREE.SphereGeometry(pose.size / 2, 40, 28), material('#ffffff', { map: ballTexture(COLORS[i % COLORS.length]), metalness: 0.05, roughness: 0.32 }), group); this.rollers.set(g.id, { mesh: ball, r: pose.size / 2 }); this.outline(ball, pose.size, pose.size, pose.size); }
        else if (g.look && g.kind !== 'board') group.add(lookMesh(g.look, pose.size, COLORS[i % COLORS.length]));
        else {
          const d = g.kind === 'board' ? f.size * 3 : pose.size;
          const drawnLength = g.L ? pose.length : f.body;
          const block = this.box(drawnLength, pose.size, d, g.kind === 'board' ? PAL.board : COLORS[i % COLORS.length], group, true);
          if (g.kind === 'board') this.edges(block, 30, 0.7); else this.outline(block, drawnLength, pose.size, d);
        }
        if (g.kind === 'board') for (const [side, x] of [['left', -g.L / 2], ['right', g.L / 2]] as const) if (g.walls?.[side] !== undefined && g.L <= f.span * 1.6) {
          const wall = this.box(f.thick * 0.7, f.size * 2.2, f.size * 3, PAL.wall, group, true); wall.position.set(x, f.size, 0);
        }
      }
      // 接触处的柔和暗影补足环境光；抛体和管内物体不贴一块错误的地影。
      let contact: THREE.Mesh | undefined;
      if (g.kind !== 'board' && this.sim.geo.plane !== 'horizontal') {
        contact = this.mesh(new THREE.PlaneGeometry(pose.size * 1.8, pose.size * 1.8), new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), group);
        contact.rotation.x = -Math.PI / 2; contact.position.y = -pose.size / 2 + f.size * 0.003; contact.castShadow = false; contact.receiveShadow = false;
      }
      const label = this.label(g.id, group, box ? new THREE.Vector3((box.x0 + box.x1) / 2, box.y1 + f.size * 0.4, f.size * 2.5) : new THREE.Vector3(0, pose.size * 0.75 + f.size * 0.75, pose.size * 0.6), 'body-label');
      const velocity = new SolidArrow(MEANING.velocity, f.size * 0.05);
      label.node.style.setProperty('--body-color', COLORS[i % COLORS.length]);
      const dot = document.createElement('i'); dot.className = 'body-dot'; label.node.prepend(dot);
      const force = new SolidArrow(MEANING.resultant, f.size * 0.05);
      this.model.add(velocity, force);
      const vLabel = this.label('', this.model, new THREE.Vector3(), 'vector-label velocity-label');
      const fLabel = this.label('', this.model, new THREE.Vector3(), 'vector-label force-label');
      let point: THREE.Mesh | undefined, link: THREE.Line | undefined;
      this.bodies.set(g.id, { group, point, link, baseLength: g.L ? pose.length : f.body, contact, velocity, force, vLabel, fLabel, label });
    }
    if (![...this.bodies.values()].some((v) => v.contact)) contactTexture.dispose();
  }

  private buildTrails(w0: number, w1: number) {
    const f = this.frame;
    this.sim.geo.bodies.forEach((g, i) => {
      if (g.kind === 'board') return;
      const samples = this.sim.samples.filter((s) => s.t >= w0 && s.t <= w1);
      const points = samples.map((s) => { const { c } = bodyPose(this.sim, f, g.id, s); return new THREE.Vector3(c[0], c[1], f.size * 0.65); });
      if (points.length < 2) return;
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: new THREE.Color(COLORS[i % COLORS.length]).lerp(new THREE.Color('#ffffff'), 0.35), dashSize: f.size * 0.3, gapSize: f.size * 0.2, transparent: true, opacity: 0.95 }));
      line.computeLineDistances(); this.model.add(line); this.trails.push({ line, times: samples.map((s) => s.t) });
    });
  }

  private buildRopes() {
    const f = this.frame; this.extra.clear(); this.model.add(this.extra); this.ropeLines = []; this.scriptVecs = []; this.pivots.clear();
    for (const c of this.sim.fields ?? []) { const p = this.mesh(new THREE.SphereGeometry(f.span * .05, 40, 28), material(color, { roughness: .5 }), this.model); p.position.set(c.x, c.y, 0); }
    for (const rope of this.sim.ropes ?? []) {
      const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#1b2a33' })); this.model.add(line); this.ropeLines.push({ rope, line });
      for (const p of rope.via) { const w = this.mesh(new THREE.CylinderGeometry(f.size * .34, f.size * .34, f.size * .22, 28), material('#dfe6e6', { metalness: .35 }), this.model); w.rotation.x = Math.PI / 2; w.position.set(p[0], p[1], 0); }
    }
  }
  private buildSprings() {
    const points = Array.from({ length: 321 }, (_, i) => {
      const u = i / 320, taper = Math.min(1, u * 20, (1 - u) * 20);
      return new THREE.Vector3(u, Math.cos(u * Math.PI * 24) * taper, Math.sin(u * Math.PI * 24) * taper);
    });
    for (const id of Object.keys(this.sim.start.springs ?? {})) {
      const mesh = this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 384, 0.1, 6, false), material('#b9c6cc', { metalness: 0.8, roughness: 0.28 }), this.model);
      this.springs.set(id, mesh);
    }
  }

  private drawExtras(s: Snapshot) {
    const f = this.frame;
    for (const { rope, line } of this.ropeLines) {
      const a = bodyPose(this.sim, f, rope.a, s).c, b = bodyPose(this.sim, f, rope.b, s);
      line.geometry.setFromPoints([a, ...rope.via, b].map((p) => new THREE.Vector3(p[0], p[1], 0)));
      line.visible = !!s.bodies[rope.a]?.on && !!s.bodies[rope.b]?.on;
    }
    if (!s.script) return;
    // 线（轨迹、绳）每帧重画，先释放上一帧的几何体，不然会越积越多
    for (const o of [...this.extra.children]) { const l = o as THREE.Line; if (l.isLine && l.userData.frame) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); this.extra.remove(l); } }
    const add = (pts: number[][], color = '#1b2a33') => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2] ?? 0))), new THREE.LineBasicMaterial({ color })); l.userData.frame = true; this.extra.add(l); };
    for (const c of s.script.curves) add(c.pts, '#7c8c94');
    for (const l of s.script.links) {
      add([l.a, l.b]);
      for (const p of [l.a, l.b]) { const key = p.map((x) => x.toFixed(6)).join(','); if (this.pivots.has(key) || Object.values(s.bodies).some((b) => Math.hypot(b.x - p[0], b.y - p[1], (b.z ?? 0) - (p[2] ?? 0)) < f.span * 1e-3)) continue; this.pivots.add(key); const m = this.mesh(new THREE.SphereGeometry(f.span * .012, 20, 14), material('#1b2a33', { roughness: .5 }), this.extra); m.position.set(p[0], p[1], p[2] ?? 0); }   // 固定点画一个小黑球
    }
    // 矢量：同一帧里按大小统一比例，标签写在箭头尖上
    const vs = s.script.vectors.filter((v) => s.bodies[v.on]), big = Math.max(1e-9, ...vs.map((v) => Math.hypot(v.v[0], v.v[1], v.v[2]))), k = f.span * .26 / big;
    while (this.scriptVecs.length < vs.length) { const i = this.scriptVecs.length, kind = vs[i].kind, arrow = new SolidArrow(kind === 'velocity' ? MEANING.velocity : /F合|ΣF/.test(vs[i].label??'') ? MEANING.resultant : MEANING.force, f.span * .006); this.model.add(arrow); this.scriptVecs.push({ arrow, label: this.label('', this.model, new THREE.Vector3(), `vector-label ${kind === 'velocity' ? 'velocity-label' : 'force-label'}`) }); }
    this.scriptVecs.forEach((sv, i) => {
      const v = vs[i]; sv.arrow.visible = !!v; sv.label.node.style.visibility = v ? '' : 'hidden'; if (!v) return;
      const b = s.bodies[v.on], m = Math.hypot(v.v[0], v.v[1], v.v[2]); if (m < 1e-9) { sv.arrow.visible = false; return; }
      const L = m * k, dir = new THREE.Vector3(v.v[0], v.v[1], v.v[2]).normalize();
      sv.arrow.position.set(b.x, b.y, b.z ?? 0); sv.arrow.setDirection(dir); sv.arrow.setLength(L, Math.min(L * .35, f.span * .04), f.span * .025);
      sv.label.node.textContent = v.label ?? ''; sv.label.anchor.position.set(b.x + dir.x * (L + f.span * .03), b.y + dir.y * (L + f.span * .03), (b.z ?? 0) + dir.z * (L + f.span * .03));
    });
  }
  update(s: Snapshot) {
    if (!this.sim) return;
    const f = this.frame; this.lastSnap = s; this.drawExtras(s);
    for (const [host, groups] of this.hosts) { const b = s.bodies[host]; if (b) groups.forEach((g) => g.position.set(b.x, b.y, 0)); }
    for (const belt of this.belts) { belt.texture.offset.x = -s.t * belt.speed / belt.length; belt.rollers.forEach((r) => r.rotation.y = -s.t * belt.speed / (f.thick * 0.55)); }
    const stage = this.sim.stages.find((st) => s.t >= st.t0 - 1e-9 && s.t < st.t1 - 1e-9);
    for (const g of this.sim.geo.bodies) {
      const b = s.bodies[g.id], v = this.bodies.get(g.id)!; if (!b) continue;
      const pose = bodyPose(this.sim, f, g.id, s), box = g.kind === 'board' ? hostBox(this.sim, g.id, f.size) : null;
      if (!g.L) {
        v.group.scale.set(pose.length / v.baseLength, pose.size / f.body, pose.size / f.body);
        const z = (b.z ?? 0) + Math.max(pose.size, f.size) * 0.65;
      }
      v.group.position.set(box ? b.x : pose.c[0], box ? b.y : pose.c[1], b.z ?? 0); v.group.rotation.z = box ? 0 : pose.ang;
      const roller = this.rollers.get(g.id); if (roller) roller.mesh.rotation.z = -(b.s ?? b.x) / Math.max(roller.r, 1e-6);
      if (this.sim.geo.plane === 'horizontal' && g.kind === 'ball') v.group.position.z = (pose.size - f.size) / 2;
      const center = box ? new THREE.Vector3(b.x + (box.x0 + box.x1) / 2, b.y + (box.y0 + box.y1) / 2, f.size * 2.5) : new THREE.Vector3(pose.c[0], pose.c[1], (b.z ?? 0) + Math.max(pose.size, f.size) * 0.9);
      const visible = center.x > f.x0 - f.span * 0.35 && center.x < f.x1 + f.span * 0.35 && center.y > f.y0 - f.span * 0.35 && center.y < f.y1 + f.span * 0.35;
      v.group.visible = visible; if (v.point) v.point.visible = visible; if (v.link) v.link.visible = visible;
      if (v.contact) v.contact.visible = !!b.on && this.sim.geo.surfaces.find((g) => g.id === b.on)?.side !== 'tube';
      const speed = Math.hypot(b.vx, b.vy);
      this.vector(v.velocity, v.vLabel, center, new THREE.Vector3(b.vx, b.vy, 0), speed / this.vmax * f.span * 0.14, this.flags.velocity && visible && !this.forceIds.includes(g.id), this.symbolsOnly ? 'v' : `v ${speed.toFixed(2)} m/s`);
      v.force.visible = false; v.fLabel.anchor.visible = false;

    }
    for (const [id, mesh] of this.springs) {
      const spring = s.springs?.[id]; if (!spring) { mesh.visible = false; continue; }
      const ends = springEnds(this.sim, f, s, spring), ap = ends.p, bp = ends.q;
      const dir = new THREE.Vector3(bp[0] - ap[0], bp[1] - ap[1], 0), L = dir.length(); dir.normalize();
      const insetA = ends.ia, insetB = ends.ib;
      const gap = spring.contact && spring.x >= 0 ? Math.min(L, spring.L0 ?? L) : L;
      const length = Math.max(f.size * 0.05, gap - insetA - insetB);
      mesh.visible = true; mesh.position.set(ap[0] + dir.x * insetA, ap[1] + dir.y * insetA, 0);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir); mesh.scale.set(length, f.size * 0.22, f.size * 0.22);
    }
    for (const trail of this.trails) {
      trail.line.visible = this.flags.trail;
      let lo = 0, hi = trail.times.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (trail.times[m] <= s.t) lo = m + 1; else hi = m; }
      trail.line.geometry.setDrawRange(0, lo);
    }
  }
  private sampleIndex(t: number) {
    let lo = 0, hi = this.sim.samples.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.sim.samples[m].t < t) lo = m + 1; else hi = m; } return lo;
  }
  private vector(arrow: SolidArrow, label: Label, p: THREE.Vector3, dir: THREE.Vector3, length: number, show: boolean, text: string) {
    arrow.visible = show && dir.length() > 1e-7 && length > this.frame.size * 0.08;
    label.anchor.visible = arrow.visible;
    if (!arrow.visible) return;
    dir.normalize(); arrow.position.copy(p); arrow.setDirection(dir); arrow.setLength(length, Math.min(length * 0.3, this.frame.size * 0.35), Math.min(length * 0.18, this.frame.size * 0.2));
    label.anchor.position.copy(p).addScaledVector(dir, length + this.frame.size * 0.25); label.node.textContent = text;
  }
  toggle(flag: keyof Scene3D['flags'], value: boolean) { this.flags[flag] = value; }
  /** 按钮缩放：沿视线推近拉远 */
  zoomBy(f: number) { this.transition = undefined; const d = this.camera.position.clone().sub(this.controls.target), L = THREE.MathUtils.clamp(d.length() / f, this.controls.minDistance, this.controls.maxDistance); this.camera.position.copy(this.controls.target).addScaledVector(d.normalize(), L); this.controls.update(); }
  resetView() { this.setView(this.view === ('' as View) ? 'angle' : this.view); }
  private markView(view: string) { document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view))); }
  setView(view: View, animate = true) {
    if (!this.sim) return;
    this.view = view; this.markView(view);
    const horizontal = this.sim.geo.plane === 'horizontal';
    // 斜视：场景越扁（比画布还宽），相机抬得越高，桌面把画面填满，不留空的上半部分。
    const tilt = THREE.MathUtils.clamp(0.24 + 0.2 * (this.flatness / this.camera.aspect - 1), 0.24, 0.62), yaw = 0.34;
    const dir = view === 'front' ? horizontal ? new THREE.Vector3(0, 1, 0.001) : new THREE.Vector3(0, 0, 1) : view === 'top' ? new THREE.Vector3(0, 1, 0.001) : horizontal ? new THREE.Vector3(0.45, 1.25, 0.75) : new THREE.Vector3(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt));
    // 相机的“上”始终是竖直向上：旋转控件按竖直轴算转角，俯视时若把“上”换成别的轴，转过头顶画面会整个翻倒。
    // 俯视方向留了 0.001 的偏移，屏幕上方仍对着远处，画面和以前一样。
    const up = view === 'front' && horizontal || view === 'top' ? new THREE.Vector3(0, 0, -1) : Y.clone(), cameraUpVec = Y.clone();
    // 把内容的实际投影框移到画面中央，再缩放到四周只留 8–10%。
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(up, dir).normalize(), cameraUp = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanY = Math.tan(this.camera.fov * Math.PI / 360), tanX = tanY * this.camera.aspect;
    const aim = new THREE.Box3().setFromPoints(this.frameCorners).getCenter(new THREE.Vector3());
    let distance = this.radius * 3;
    for (let pass = 0; pass < 8; pass++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const corner of this.frameCorners) {
        const d = corner.clone().sub(aim), depth = Math.max(distance - d.dot(dir), distance * 0.05);
        const x = d.dot(right) / depth / tanX, y = d.dot(cameraUp) / depth / tanY;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      aim.addScaledVector(right, (x0 + x1) / 2 * distance * tanX).addScaledVector(cameraUp, (y0 + y1) / 2 * distance * tanY);
      distance *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / 0.83;
    }
    this.target.copy(aim);
    this.controls.maxDistance = distance * 5; this.controls.minDistance = distance * 0.12;
    const to = this.target.clone().addScaledVector(dir, distance);
    this.camera.far = Math.max(1000, distance * 10); this.camera.updateProjectionMatrix();
    (this.scene.fog as THREE.Fog).near = distance * 2.2; (this.scene.fog as THREE.Fog).far = distance * 7;
    if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.transition = { start: performance.now(), from: this.camera.position.clone(), to, target: this.controls.target.clone(), up: cameraUpVec };
    else { this.transition = undefined; this.camera.position.copy(to); this.controls.target.copy(this.target); this.camera.up.copy(cameraUpVec); this.controls.update(); }
  }
  render(now: number) {
    if (this.lost) return;
    if (this.transition) {
      const a = this.transition, k = Math.min(1, (now - a.start) / 650), ease = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(a.from, a.to, ease); this.controls.target.lerpVectors(a.target, this.target, ease); this.camera.up.lerp(a.up, 0.16).normalize();
      if (k === 1) { this.camera.up.copy(a.up); this.transition = undefined; }
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera);
    const width = this.element.clientWidth, height = this.element.clientHeight;
    const occupied: Rect[] = [];
    const objects: Rect[] = [];
    for (const body of this.bodies.values()) if (body.group.visible) {
      const points: THREE.Vector3[] = [];
      body.group.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.visible || child === body.contact) return;
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox(); const box = child.geometry.boundingBox; if (!box) return;
        for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) points.push(child.localToWorld(new THREE.Vector3(x,y,z)).project(this.camera));
      });
      if (!points.every((p) => p.z > -1 && p.z < 1)) continue;
      objects.push(...projectedObstacles(points.map((p) => [(p.x+1)/2*width,(1-p.y)/2*height]),width));
    }
    // 文字保持 CSS 像素大小；边缘、背面和重叠的次要标签自动隐藏。
    for (const label of this.labels.slice().sort((a, b) => Number(b.node.classList.contains('body-label')) - Number(a.node.classList.contains('body-label')))) {
      let visible = true; for (let o: THREE.Object3D | null = label.anchor; o; o = o.parent) if (!o.visible) visible = false;
      const p = label.anchor.getWorldPosition(new THREE.Vector3()).project(this.camera), x = (p.x + 1) / 2 * width, y = (1 - p.y) / 2 * height;
      visible &&= p.z > -1 && p.z < 1 && x > 16 && x < width - 16 && y > 20 && y < height - 20;
      const w = label.node.offsetWidth || 30, h = label.node.offsetHeight || 24;
      const rect = label.node.classList.contains('body-label') ? placeLabel({ x, y, w, h }, [...objects, ...occupied], width, height) : { x, y, w, h };
      if (!rect || occupied.some((r) => overlaps(rect, r))) visible = false;
      label.node.style.display = visible ? '' : 'none';
      if (visible) { label.node.style.transform = `translate(${rect!.x}px, ${rect!.y}px) translate(-50%, -50%)`; occupied.push(rect!); }
    }
    this.drawForces(width, height, [...objects, ...occupied]);
  }
  private drawForces(width: number, height: number, occupied: Rect[]) {
    const d = Math.min(devicePixelRatio || 1, 2), canvas = this.forceLayer, g = canvas.getContext('2d')!;
    if (canvas.width !== Math.round(width*d) || canvas.height !== Math.round(height*d)) { canvas.width = Math.round(width*d); canvas.height = Math.round(height*d); }
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, width, height);
    this.qa = { mode: '3d', w: width, h: height, forceArrows: [], nameDots: this.sim.geo.bodies.map((b, i) => ({ id: b.id, color: COLORS[i % COLORS.length] })), texts: [] };
    // 解析场景的力向量直接记录实际三维箭头投影和已显示的DOM标签。
    const vectors=this.lastSnap?.script?.vectors.filter((v)=>this.lastSnap!.bodies[v.on])??[];
    for(const [i,v] of vectors.entries()) {
      const sv=this.scriptVecs[i]; if(v.kind==='velocity'||!sv?.arrow.visible)continue;
      const start=sv.arrow.getWorldPosition(new THREE.Vector3()).project(this.camera);
      const end=sv.arrow.localToWorld(new THREE.Vector3(0,sv.arrow.head.position.y+sv.arrow.head.scale.y/2,0)).project(this.camera);
      const x0=(start.x+1)*width/2,y0=(1-start.y)*height/2,x1=(end.x+1)*width/2,y1=(1-end.y)*height/2,resultant=/F合|ΣF/.test(v.label??''),color=resultant?MEANING.resultant:MEANING.force;
      this.qa.forceArrows.push({x:v.v[0],y:v.v[1],magnitude:Math.hypot(...v.v),length:Math.hypot(x1-x0,y1-y0),schematic:false,label:v.label??'',color,width:resultant?3:2,resultant,body:v.on,x0,y0,x1,y1});
      if(sv.label.node.style.display!=='none'){
        const r=sv.label.node.getBoundingClientRect(),base=this.element.getBoundingClientRect();
        this.qa.texts.push({s:sv.label.node.textContent??'',x:r.left-base.left,y:r.top-base.top,w:r.width,h:r.height,color,outline:MEANING.paper,outlineWidth:2});
      }
    }
    if (this.lastSnap?.script) return;
    if ((!this.flags.force && !this.forceIds.length) || !this.lastSnap) return;
    // 和平面同一规则：打开“受力”只画所求物体，别的物体等学生点它；“固定”用大质量代替的物体不画
    const snap=this.lastSnap, geo=this.sim.geo.bodies, anchor=(id:string)=>{const me=geo.find((q)=>q.id===id),o=geo.filter((q)=>q.id!==id&&q.m>0).map((q)=>q.m);return !!me&&o.length>0&&me.m>1e5*Math.min(...o);};
    const okF=(id:string|null|undefined)=>!!id&&!!snap.bodies[id]?.fs&&!anchor(id);
    const focus=okF(this.focusId)?this.focusId:(geo.find((q)=>q.kind!=='board'&&okF(q.id))??geo.find((q)=>okF(q.id)))?.id;
    const ids=new Set([...this.forceIds,...(this.flags.force&&focus?[focus]:[])].filter((id)=>!anchor(id)));
    // 比例只按这次画出受力的物体定（同平面规则）
    const key=[...ids].sort().join('|'); if (this.fw && this.fmaxKey!==key) { this.fmaxKey=key; this.fmax=forceMax(this.sim,this.fw[0],this.fw[1],(id)=>anchor(id)||!ids.has(id)); }
    for (const id of ids) {
      const body=this.sim.geo.bodies.find((b)=>b.id===id);if(!body)continue;
      const b = this.lastSnap.bodies[body.id], view = this.bodies.get(body.id), c = this.screenOf(body.id); if (!b?.fs || !view?.group.visible || !c) continue;
      const center = view.group.getWorldPosition(new THREE.Vector3());
      const glyphs = mergeEqualResultant(forceGlyphs(b.fs, this.fmax, arrowScale(width), this.symbolsOnly, this.massSym[body.id]));
      const x = Math.max(100, Math.min(c[0], width-125)), y = Math.max(Math.min(110,height/2), Math.min(c[1], height-Math.min(110,height/2)));
      for (const glyph of glyphs.filter((a) => !a.magnitude)) this.qa.forceArrows.push({ ...glyph, body: body.id, x0:x, y0:y, x1:x, y1:y });
      // 同平面规则：同向的力共用一条线，太短的拉长并标示意
      const dirOf = (glyph: ForceGlyph): [number, number] => {
        const dir = new THREE.Vector3(glyph.x, glyph.y, 0).normalize().transformDirection(this.model.matrixWorld), p = center.clone().project(this.camera), q = center.clone().add(dir).project(this.camera);
        let ux = (q.x-p.x)*width, uy = -(q.y-p.y)*height, mag = Math.hypot(ux, uy); if (mag < 1e-6) { ux = glyph.x; uy = -glyph.y; mag = Math.hypot(ux, uy) || 1; } return [ux/mag, uy/mag];
      };
      for (const { glyph, ux, uy, len, label, bumped } of layoutForceLines(glyphs, dirOf, 24, this.lineOrder, body.id)) {
        const ex = x+ux*len, ey = y+uy*len, head = Math.min(11, len*.45);
        g.strokeStyle = g.fillStyle = '#fffaf0e0'; g.lineWidth = glyph.width + 3; g.beginPath(); g.moveTo(x,y); g.lineTo(ex-ux*head,ey-uy*head); g.stroke();
        g.strokeStyle = g.fillStyle = glyph.color; g.lineWidth = glyph.width;
        g.beginPath(); g.moveTo(x,y); g.lineTo(ex-ux*head,ey-uy*head); g.stroke();
        g.beginPath(); g.moveTo(ex,ey); g.lineTo(ex-ux*head-uy*head*.5,ey-uy*head+ux*head*.5); g.lineTo(ex-ux*head+uy*head*.5,ey-uy*head-ux*head*.5); g.closePath(); g.fill();
        this.qa.forceArrows.push({ ...glyph, label, length: len, schematic: glyph.schematic || bumped, body: body.id, x0:x, y0:y, x1:ex, y1:ey });
      }
    }
    // 所有箭头先占位，标签再统一避让，不让后画的箭头穿过先画的字。
    for (const a of this.qa.forceArrows) if (a.magnitude) {
      const n = Math.max(1, Math.ceil(a.length / 7));
      for (let i=0;i<=n;i++) occupied.push({ x:a.x0+(a.x1-a.x0)*i/n, y:a.y0+(a.y1-a.y0)*i/n, w:6, h:6 });
    }
    for (const glyph of this.qa.forceArrows) {
      if (!glyph.label) continue;
      const ux = glyph.length ? (glyph.x1-glyph.x0)/glyph.length : 1, ex=glyph.x1, ey=glyph.y1;
      const lines = [glyph.label.replace(/（长度为示意）$/, '')];
      g.font = '500 13px "Times New Roman", "PingFang SC", serif'; const w = Math.max(...lines.map((s) => g.measureText(s).width))+6, h = lines.length*19;
      const preferred = { x: ex + (ux < 0 ? -w/2-8 : w/2+8), y: ey-8, w, h };
      const at = placeStableLabel(preferred, occupied, width, height, undefined, [ex, ey]) ?? placeLabel(preferred, occupied, width, height, [ex, ey]); if (!at) continue;
      occupied.push(at); g.textAlign = 'left'; g.lineJoin = 'round'; g.strokeStyle = MEANING.paper; g.lineWidth = 2; g.fillStyle = glyph.color;
      for (const [i, line] of lines.entries()) {
        const x = at.x-w/2+3, y = at.y-h/2+14+i*19;
        g.strokeText(line, x, y); g.fillText(line, x, y);
        this.qa.texts.push({ s:line, x, y:y-10.4, w:g.measureText(line).width, h:13, color:glyph.color, outline:MEANING.paper, outlineWidth:2 });
      }
    }
  }
  dispose() { this.observer.disconnect(); this.controls.dispose(); this.clear(); this.forceLayer.remove(); this.renderer.dispose(); }
}
