// 空隙完整性、投影遮挡和旧缓存的独立几何约束；全库像素结果另由原质检脚本检查。
import assert from 'node:assert/strict';
import { distanceToBox, overlaps, placeStableLabel, projectedObstacles } from '../player/label-layout.ts';
import { canvasEnvironment, loadScene } from './helpers/画布替身.ts';

let passed = 0;
const test = (name: string, run: () => void) => { run(); passed++; console.log(`通过 ${name}`); };

test('窄空带能容纳完整标签，且不穿物体、箭头和地面', () => {
  const obstacles = [
    { x: 135, y: 206, w: 116, h: 116 },
    { x: 440, y: 359, w: 880, h: 142 },
    { x: 65, y: 260, w: 8, h: 8 },
  ];
  const tip: [number, number] = [51, 274];
  const rect = placeStableLabel({ x: 101, y: 267, w: 91, h: 22 }, obstacles, 880, 430, undefined, tip);
  assert.ok(rect, '物体底部264至地面288之间应能放下22px高的完整标签');
  assert.ok(!obstacles.some((o) => overlaps(rect, o, 1)));
  assert.ok(distanceToBox(rect, tip) <= 42);
});

test('投影窄条覆盖长板实体，同时保留矩形空角的空位', () => {
  const obstacles = projectedObstacles([[0, 80], [400, 180], [400, 200], [0, 100]], 400);
  for (let x = 2; x < 400; x += 4) for (let y = 82 + x / 4; y < 100 + x / 4; y += 4) {
    assert.ok(obstacles.some((r) => Math.abs(x-r.x) <= r.w/2+1e-9 && Math.abs(y-r.y) <= r.h/2+1e-9), `实体内的${x},${y}没有占位`);
  }
  const text = { x: 330, y: 100, w: 60, h: 22 };
  assert.ok(!obstacles.some((o) => overlaps(text, o)));
  assert.ok(obstacles.reduce((sum, r) => sum+r.w*r.h, 0) < 400*120*.3);
});

test('向左的箭头附近仍优先保留可用的旧位置', () => {
  const preferred = { x: 220, y: 120, w: 91, h: 22 };
  const previous = { ...preferred, x: 202, y: 142 };
  assert.deepEqual(placeStableLabel(preferred, [], 880, 430, previous, [260, 140]), previous);
});

const env = canvasEnvironment();
try {
  const Scene = await loadScene();
  test('力标签的远距旧缓存与速度标签一样重新寻找近处空位', () => {
    const scene = new Scene(env.element(880, 430));
    // 不构造物理题：只调用真实标签排布入口，注入一个已经远离箭头的力标签缓存。
    scene.w = 880; scene.h = 430; scene.taken = [];
    const key = 'N#c9711a@force:物体:支撑#0';
    scene.lastSpot.set(key, [0, 120]);
    const point = scene.spotNear(405, 150, 80, 40, key, false, [400, 160]);
    assert.ok(point);
    assert.ok(distanceToBox({ x: point[0]+40, y: point[1]+20, w: 80, h: 40 }, [400, 160]) <= 42);
  });
} finally { env.restore(); }
console.log(`第四批修正3规则：${passed}/${passed} 通过`);
