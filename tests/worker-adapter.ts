// Node 中运行浏览器 worker 协议，供无浏览器集成测试使用。
import { parentPort } from 'node:worker_threads';
const scope = { postMessage: (message: unknown) => parentPort!.postMessage(message), onmessage: undefined as undefined | ((e: { data: unknown }) => void) };
Object.assign(globalThis, { self: scope });
await import('../player/worker.ts');
parentPort!.on('message', (data) => scope.onmessage!({ data }));
