// Project-local PostgreSQL (no Docker, no admin rights) using the `embedded-postgres`
// server binaries from node_modules. Data lives in .local/pgdata (git-ignored).
//   node scripts/local-db.mjs init|start|stop|status
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const bin = join(root, "node_modules", "@embedded-postgres", `${process.platform === "win32" ? "windows" : process.platform}-x64`, "native", "bin");
const exe = (name) => join(bin, process.platform === "win32" ? `${name}.exe` : name);
const data = join(root, ".local", "pgdata");
const log = join(root, ".local", "postgres.log");
const port = process.env.LOCAL_DB_PORT ?? "54322";
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", ...opts });

const action = process.argv[2] ?? "status";
if (action === "init") {
  if (existsSync(join(data, "PG_VERSION"))) {
    console.log("Local cluster already initialized.");
  } else {
    mkdirSync(join(root, ".local"), { recursive: true });
    const pw = join(root, ".local", "pwfile");
    // Local-only superuser password; matches DATABASE_ADMIN_URL in .env.example.
    writeFileSync(pw, "postgres");
    const r = run(exe("initdb"), ["-D", data, "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${pw}`, "-E", "UTF8", "--locale=C"]);
    rmSync(pw, { force: true });
    process.exit(r.status ?? 1);
  }
} else if (action === "start") {
  // Detached so the database keeps running after this command returns.
  const r = spawnSync(exe("pg_ctl"), ["-D", data, "-o", `-p ${port} -c listen_addresses=127.0.0.1`, "-l", log, "start"], { stdio: "ignore", detached: true, timeout: 30000 });
  console.log(r.status === 0 || r.error?.code === "ETIMEDOUT" ? `Local Postgres starting on 127.0.0.1:${port} (log: .local/postgres.log)` : "pg_ctl start failed; see .local/postgres.log");
} else if (action === "stop") {
  process.exit(run(exe("pg_ctl"), ["-D", data, "stop", "-m", "fast"]).status ?? 1);
} else {
  process.exit(run(exe("pg_ctl"), ["-D", data, "status"]).status ?? 1);
}
