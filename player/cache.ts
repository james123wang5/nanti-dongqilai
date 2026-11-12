// 算过的题记在浏览器里：内存一层，IndexedDB 一层。引擎代码变了，旧结果自动作废。
import type { PasteIssue } from './paste-state.ts';
import type { Problem, Solved } from '../engine/solve.ts';

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
// 引擎的全部源文件（模拟、求解、核对、表达式、容差、来源判断、各实验室）都算进版本：改了任何一个，旧结果自动作废
const engine = import.meta.glob('../engine/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const VERSION = hash(Object.keys(engine).sort().map((k) => k + engine[k]).join(''));
export const keyOf = (p: Problem) => `${VERSION}:${hash(JSON.stringify(p))}`;

let opened: Promise<IDBDatabase | null> | undefined;
function db() {
  return opened ??= new Promise((resolve) => {
    try {
      const r = indexedDB.open('nanti', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('solved'); r.result.createObjectStore('mine', { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
function request<T>(store: string, mode: IDBTransactionMode, go: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return db().then((d) => new Promise((resolve) => {
    if (!d) return resolve(undefined);
    try { const q = go(d.transaction(store, mode).objectStore(store)); q.onsuccess = () => resolve(q.result); q.onerror = () => resolve(undefined); } catch { resolve(undefined); }
  }));
}
const memory = new Map<string, Solved>();
export async function cached(key: string): Promise<Solved | undefined> {
  const hit = memory.get(key); if (hit) return hit;
  const stored = await request<Solved>('solved', 'readonly', (s) => s.get(key));
  if (stored) memory.set(key, stored);
  return stored;
}
export const has = async (key: string) => (await request<IDBValidKey>('solved', 'readonly', (s) => s.getKey(key))) !== undefined;
export const store = (key: string, solved: Solved) => request('solved', 'readwrite', (s) => s.put(solved, key));
export function remember(key: string, solved: Solved) { memory.set(key, solved); void request('solved', 'readwrite', (s) => s.put(solved, key)); }

export type Mine = { id: string; name: string; problem: Problem; image?: string; time: number; repair?: string; original?: Problem; attempts?: number; lastPasteIssue?: PasteIssue };
export const allMine = async () => ((await request<Mine[]>('mine', 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => b.time - a.time);
export const saveMine = (m: Mine) => request('mine', 'readwrite', (s) => s.put(m));

export const deleteMine = (id: string) => request('mine', 'readwrite', (s) => s.delete(id));
export type CatalogState = 'engine' | 'partial' | 'none';
export function catalogState(p: Problem, s?: Solved): CatalogState {
  if (p.unsupported || !s?.sim && s && !s.pending) return 'none';
  return s && !s.pending && s.asks.length > 0 && s.asks.every((a) => a.verified && a.ok !== false) ? 'engine' : 'partial';
}
