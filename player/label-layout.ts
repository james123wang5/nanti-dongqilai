// 屏幕坐标中的标签避让。只改文字位置，不改物体和读数。
export type Rect = { x: number; y: number; w: number; h: number };
export const distanceToBox = (r:Rect,p:[number,number]) => Math.hypot(Math.max(r.x-r.w/2-p[0],0,p[0]-r.x-r.w/2),Math.max(r.y-r.h/2-p[1],0,p[1]-r.y-r.h/2));
export const overlaps = (a: Rect, b: Rect, gap = 3) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap - 1e-7 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap - 1e-7;

/** 投影外轮廓切成窄条，避免倾斜的长物体把包围矩形内的空白也算作遮挡。 */
export function projectedObstacles(points: [number, number][], width: number): Rect[] {
  const sorted = points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if (sorted.length<3) return [];
  const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=(ps:[number,number][])=>{const out:[number,number][]=[];for(const p of ps){while(out.length>1&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}return out;};
  const lower=half(sorted),upper=half(sorted.slice().reverse()),hull=[...lower.slice(0,-1),...upper.slice(0,-1)],out:Rect[]=[];
  for(let left=Math.max(0,sorted[0][0]);left<Math.min(width,sorted.at(-1)![0]);left+=12){
    const right=Math.min(left+12,width,sorted.at(-1)![0]),ys:number[]=[];
    for(let i=0;i<hull.length;i++){
      const a=hull[i],b=hull[(i+1)%hull.length];
      if(a[0]>=left&&a[0]<=right)ys.push(a[1]);
      for(const x of [left,right])if(a[0]!==b[0]&&x>=Math.min(a[0],b[0])&&x<=Math.max(a[0],b[0]))ys.push(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]));
    }
    if(ys.length){const lo=Math.min(...ys),hi=Math.max(...ys);out.push({x:(left+right)/2,y:(lo+hi)/2,w:right-left,h:hi-lo});}
  }
  return out;
}

/** 沿障碍物边缘扫描空带，包含仅有一两像素余量的空隙；固定步长的网格会漏掉它们。 */
function searchSpace(label: Rect, obstacles: Rect[], width: number, height: number, origin: Rect,
  tip?: [number, number], maxDistance = Infinity, maxMove = Infinity, top = 4, bottom = 4, gap = 1.01): Rect | undefined {
  const x0 = label.w / 2 + 4, x1 = width - label.w / 2 - 4;
  const y0 = Math.max(label.h / 2 + top, origin.y - maxMove), y1 = Math.min(height - label.h / 2 - bottom, origin.y + maxMove);
  if (x0 > x1 || y0 > y1) return;
  // 只扫描本次搜索域内的障碍；远处轨道的密集线段不参与近箭头空位搜索。
  const left = Math.max(0, origin.x-maxMove-label.w/2, tip ? tip[0]-maxDistance-label.w : -Infinity);
  const right = Math.min(width, origin.x+maxMove+label.w/2, tip ? tip[0]+maxDistance+label.w : Infinity);
  obstacles = obstacles.filter((o) => o.x+o.w/2+gap>=left && o.x-o.w/2-gap<=right && o.y+o.h/2+gap>=y0-label.h/2 && o.y-o.h/2-gap<=y1+label.h/2);
  const ys = new Set([y0, y1, Math.max(y0, Math.min(y1, origin.y)), Math.max(y0, Math.min(y1, label.y))]);
  for (const o of obstacles) for (const y of [o.y - (o.h + label.h) / 2 - gap, o.y + (o.h + label.h) / 2 + gap]) if (y >= y0 && y <= y1) ys.add(y);
  let best: Rect | undefined, score = Infinity;
  for (const y of ys) {
    const vertical = tip ? Math.max(y - label.h / 2 - tip[1], 0, tip[1] - y - label.h / 2) : 0;
    if (vertical > maxDistance) continue;
    const reach = Math.sqrt(Math.max(0, maxMove ** 2 - (y - origin.y) ** 2));
    const near = Math.sqrt(Math.max(0, maxDistance ** 2 - vertical ** 2));
    const lo = Math.max(x0, origin.x - reach, tip ? tip[0] - label.w / 2 - near : -Infinity);
    const hi = Math.min(x1, origin.x + reach, tip ? tip[0] + label.w / 2 + near : Infinity);
    if (lo > hi) continue;
    // 在这条空带内合并不能放字的横向区间。
    const blocks = obstacles.filter((o) => Math.abs(y - o.y) < (label.h + o.h) / 2 + gap - 1e-7)
      .map((o) => [o.x - (o.w + label.w) / 2 - gap, o.x + (o.w + label.w) / 2 + gap]).sort((a, b) => a[0] - b[0]);
    const intervals: [number, number][] = []; let start = lo;
    for (const [a, b] of blocks) { if (b <= start) continue; if (a > hi) break; if (a >= start) intervals.push([start, Math.min(a, hi)]); start = Math.max(start, b); }
    if (start <= hi) intervals.push([start, hi]);
    for (const [a, b] of intervals) {
      const r = { ...label, x: Math.max(a, Math.min(b, origin.x)), y };
      if (obstacles.some((o) => overlaps(r, o, 1))) continue;
      const cost = Math.hypot(r.x - origin.x, r.y - origin.y);
      if (cost < score) { score = cost; best = r; }
    }
  }
  return best;
}

export function placeLabel(label: Rect, obstacles: Rect[], width: number, height: number, tip?: [number,number]): Rect | undefined {
  const bound = (r: Rect) => ({ ...r, x: Math.max(r.w / 2 + 8, Math.min(width - r.w / 2 - 8, r.x)), y: Math.max(r.h / 2 + 44, Math.min(height - r.h / 2 - 60, r.y)) });
  const free = (r: Rect) => r.w + 16 <= width && r.h + 104 <= height && !obstacles.some((b) => overlaps(r, b));
  const preferred = bound(label);
  // 投影到可用边界后的首选位置已是最短移动；没有更近的箭头目标时可直接返回。
  if ((!tip || distanceToBox(preferred, tip) === 0) && free(preferred)) return preferred;
  const candidates = [label];
  for (const r of obstacles) {
    candidates.push({ ...label, y: r.y - (r.h + label.h) / 2 - 5 }, { ...label, y: r.y + (r.h + label.h) / 2 + 5 },
      { ...label, x: r.x - (r.w + label.w) / 2 - 5 }, { ...label, x: r.x + (r.w + label.w) / 2 + 5 });
  }
  const seen = new Set<string>();
  // 先按原有优先级排序，再按序检查碰撞，和“先全部筛选再排序”选中同一个位置。
  // 大量轨道线段会产生相同的边界候选，只保留最早出现的一份以维持同分时的顺序。
  return candidates.map(bound).filter((r) => { const key = `${r.x},${r.y}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .map((r) => ({ r, near: tip ? distanceToBox(r, tip) : 0, move: Math.hypot(r.x-label.x, r.y-label.y) }))
    .sort((a, b) => a.near-b.near || a.move-b.move).find(({ r }) => free(r))?.r
    ?? (tip ? searchSpace(label, obstacles, width, height, label, tip, Infinity, Infinity, 44, 60) : undefined);
}

/** 箭头标签：先保留上一帧的相对位置；被挤占时先在附近小步找空位，再换侧。 */
export function placeStableLabel(label: Rect, obstacles: Rect[], width: number, height: number, previous?: Rect, tip?: [number, number]): Rect | undefined {
  const bound = (r: Rect) => ({ ...r, x: Math.max(r.w/2+4,Math.min(width-r.w/2-4,r.x)), y: Math.max(r.h/2+4,Math.min(height-r.h/2-4,r.y)) });
  const distance = (r: Rect) => tip ? Math.hypot(Math.max(r.x-r.w/2-tip[0],0,tip[0]-r.x-r.w/2),Math.max(r.y-r.h/2-tip[1],0,tip[1]-r.y-r.h/2)) : 0;
  const free = (r: Rect) => r.w+8<=width && r.h+8<=height && distance(r)<=42 && !obstacles.some((o)=>overlaps(r,o,1));
  if (previous && free(bound(previous))) return bound(previous);
  if (!tip) {
    const candidates = [bound(label)];
    if (previous) for (let dy=-21;dy<=21;dy+=3) for (let dx=-21;dx<=21;dx+=3) if (Math.hypot(dx,dy)<=21) candidates.push(bound({...label,x:previous.x+dx,y:previous.y+dy}));
    for (const dx of [-label.w/2-36,-label.w/2-8,0,label.w/2+8,label.w/2+36]) for (const dy of [-label.h/2-36,-label.h/2-8,0,label.h/2+8,label.h/2+36]) candidates.push(bound({...label,x:label.x+dx,y:label.y+dy}));
    const origin = previous ?? label;
    return candidates.filter(free).sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y))[0];
  }
  if (previous) {
    const local = searchSpace(label, obstacles, width, height, previous, tip, 42, 21)
      ?? searchSpace(label, obstacles, width, height, previous, tip, 42, 21, 4, 4, 1);
    if (local) return local;
  }
  // 普通空位留出浮点余量；只有它们都放不下时，才用恰好相切的窄空隙。
  return searchSpace(label, obstacles, width, height, previous ?? label, tip, 30)
    ?? searchSpace(label, obstacles, width, height, previous ?? label, tip, 42)
    ?? searchSpace(label, obstacles, width, height, previous ?? label, tip, 42, Infinity, 4, 4, 1);
}
