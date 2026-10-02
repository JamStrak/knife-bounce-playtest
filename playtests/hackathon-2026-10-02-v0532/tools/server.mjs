import http from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const identity = createHash("sha256")
  .update(root.toLowerCase())
  .digest("hex")
  .slice(0, 16);
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405);
        res.end();
        return;
      }
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/__knife_health") {
        const port = req.socket.localPort;
        const ips = Object.values(os.networkInterfaces())
          .flat()
          .filter((x) => x.family === "IPv4" && !x.internal)
          .map((x) => `http://${x.address}:${port}`);
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            app: "knife-club",
            version: "0.53.2",
            identity,
            port,
            lanUrls: ips,
          }),
        );
        return;
      }
      const name = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      if (
        !/^\/(index\.html|style\.css|toy-theme\.css|theme-system\.css|mask-editor\.css|balance-lab\.css|audio-lab\.css|release-lab\.css|start-screen\.css|glitch-theme\.css|stage-ui\.css|src\/[\w.-]+\.mjs|assets\/[\w\u4e00-\u9fff /.-]+)$/.test(
          name,
        )
      ) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const file = path.resolve(root, "." + name);
      if (
        name.startsWith("/assets/") &&
        !file.startsWith(path.join(root, "assets") + path.sep)
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      const resolved = await realpath(file);
      if (
        !resolved.startsWith(root + path.sep) ||
        (name.startsWith("/assets/") &&
          !resolved.startsWith(path.join(root, "assets") + path.sep))
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      const types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
      };
      res.setHeader(
        "Content-Type",
        types[path.extname(file)] || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const data = await readFile(file);
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.argv[2] || 23147),
    server = createServer();
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") server.listen(0, "0.0.0.0");
    else {
      console.error(e.message);
      process.exit(1);
    }
  });
  server.listen(port, "0.0.0.0");
  server.on("listening", () => {
    if (process.send) process.send({ port: server.address().port, identity });
    else console.log(`http://localhost:${server.address().port}`);
  });
}
