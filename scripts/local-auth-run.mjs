// Runs local Supabase Auth services without Docker:
//   mailpit (SMTP 127.0.0.1:54325, inbox UI http://127.0.0.1:54324),
//   supabase-auth (127.0.0.1:9999),
//   gateway (http://127.0.0.1:54321/auth/v1/* → auth server), matching Supabase's URL layout.
//   node scripts/local-auth-run.mjs
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const authEnv = dotenv.parse(readFileSync(join(root, ".local", "auth.env")));
const bin = (name) => join(root, ".local", "bin", process.platform === "win32" ? `${name}.exe` : name);
const children = [];

function run(name, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, { env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (d) => d.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join("\n");
  child.stdout.on("data", (d) => console.log(prefix(d)));
  child.stderr.on("data", (d) => console.log(prefix(d)));
  child.on("exit", (code) => {
    console.log(`[${name}] exited with ${code}`);
    shutdown(1);
  });
  children.push(child);
}

run("mailpit", bin("mailpit"), ["--listen", "127.0.0.1:54324", "--smtp", "127.0.0.1:54325", "--smtp-auth-accept-any", "--smtp-auth-allow-insecure"]);
run("auth", bin("supabase-auth"), ["serve"], authEnv);

// Minimal gateway: strip /auth/v1 and forward to the auth server (what Supabase's API gateway does).
const gateway = http.createServer((req, res) => {
  if (!req.url?.startsWith("/auth/v1")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Only /auth/v1 is served by the local gateway" }));
    return;
  }
  const upstream = http.request(
    { host: "127.0.0.1", port: Number(authEnv.PORT || 9999), method: req.method, path: req.url.slice("/auth/v1".length) || "/", headers: { ...req.headers, host: "127.0.0.1:9999" } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "auth server unavailable" }));
  });
  req.pipe(upstream);
});
gateway.listen(54321, "127.0.0.1", () => console.log("[gateway] http://127.0.0.1:54321/auth/v1 → 127.0.0.1:9999"));

function shutdown(code = 0) {
  for (const c of children) if (c.exitCode === null) c.kill();
  gateway.close();
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
