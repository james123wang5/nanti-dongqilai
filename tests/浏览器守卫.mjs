// 无界面 Chrome 只能在普通终端里启动。Codex 等沙盒里启动会被系统立刻中止（SIGABRT），
// macOS 随之弹出“Chrome 意外退出”。所以在沙盒里直接退出，不去拉起 Chrome。
import { createServer } from 'node:net';
export async function assertCanLaunchBrowser() {
  const why = process.env.CODEX_SANDBOX || process.env.CODEX_SANDBOX_NETWORK_DISABLED ? '检测到 Codex 沙盒环境变量'
    : await new Promise((r) => { const s = createServer(); s.once('error', (e) => r(`本地端口不能监听（${e.code}）`)); s.listen(0, '127.0.0.1', () => s.close(() => r(''))); });
  if (why) { console.error(`跳过浏览器验收：${why}。请在普通终端里运行（不要在沙盒里启动 Chrome）。`); process.exit(3); }
}
