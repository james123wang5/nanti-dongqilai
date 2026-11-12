// 在后台线程里解题，避免反解未知数时卡住页面
import { solveProgressively, type Problem } from '../engine/solve.ts';

self.onmessage = async (e: MessageEvent<{ id: number; problem: Problem; warm?: boolean }>) => {
  const { id, problem, warm } = e.data;
  if (warm) {   // 空闲时预算：结果直接写进本地缓存，不回传主线程，播放不受影响
    let catalog = 'none';
    try { const { keyOf, cached, store, catalogState } = await import('./cache.ts'); const key = keyOf(problem); const hit = await cached(key); if (hit) catalog = catalogState(problem, hit); else { let last; for (const s of solveProgressively(problem, 1 / 30)) last = s; if (last && !last.pending) { await store(key, last); catalog = catalogState(problem, last); } } } catch { /* 这题算不出，用到时再报 */ }
    (self as unknown as Worker).postMessage({ id, ok: true, warmed: true, catalog }); return;
  }
  try {
    const t0 = performance.now();
    for (const solved of solveProgressively(problem, 1 / 30)) {
      (self as unknown as Worker).postMessage({ id, ok: true, solved, ms: performance.now() - t0 });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message });
  }
};
