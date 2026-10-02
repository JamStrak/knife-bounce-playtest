import net from "node:net";
import { fork } from "node:child_process";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root, identity } from "./server.mjs";
async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/__knife_health`, {
      signal: AbortSignal.timeout(650),
    });
    const d = await r.json();
    return d.identity === identity && d.version === "0.53.2" ? d : null;
  } catch {
    return null;
  }
}
async function occupied(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    const done = (value) => {
      s.destroy();
      resolve(value);
    };
    s.setTimeout(400, () => done(true));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}
export async function ensure({
  port = 23162,
  stateDir = path.join(root, ".runtime"),
  serverFile = path.join(root, "tools/server.mjs"),
} = {}) {
  await mkdir(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, "server.json"),
    lockFile = path.join(stateDir, "launch.lock");
  let lock;
  for (let i = 0; i < 30; i++) {
    try {
      lock = await open(lockFile, "wx");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!lock)
    throw new Error(
      "启动锁未释放，请稍后再试；若上次启动中断，请删除项目 .runtime/launch.lock 后重试。",
    );
  try {
    let stored;
    try {
      stored = JSON.parse(await readFile(stateFile, "utf8"));
    } catch {}
    for (const p of [...new Set([stored?.port, port].filter(Boolean))]) {
      const info = await health(p);
      if (info) return { ...info, reused: true };
    }
    const requestedPort = (await occupied(port)) ? 0 : port;
    return await new Promise((resolve, reject) => {
      const child = fork(serverFile, [String(requestedPort)], {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("服务启动超时，请检查 Node.js 是否可运行。"));
      }, 8000);
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(
          new Error(
            `服务启动失败（${code}），请确认 tools/server.mjs 完整且端口可用。`,
          ),
        );
      });
      child.once("message", async (info) => {
        clearTimeout(timer);
        try {
          info.pid = child.pid;
          await writeFile(stateFile, JSON.stringify(info));
          child.disconnect();
          child.unref();
          resolve({ ...info, reused: false });
        } catch (e) {
          child.kill();
          reject(e);
        }
      });
    });
  } finally {
    await lock.close();
    await unlink(lockFile).catch(() => {});
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const info = await ensure();
    console.log(`http://localhost:${info.port}`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
