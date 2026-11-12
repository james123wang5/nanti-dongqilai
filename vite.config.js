import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
// 把播放器打包成静态页面，打开时不用现场编译
export default defineConfig({ root: resolve(here, 'player'), base: './', build: { outDir: resolve(here, 'dist'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 }, worker: { format: 'es' } });
