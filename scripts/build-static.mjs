/**
 * Static export for GitHub Pages.
 *
 * 1. Bakes the official camera datasets into public/data/cameras.json (real data,
 *    captured by the last `?refresh=1` run — see doc/2026-09-21-design.md).
 * 2. Moves app/api aside for the build, because route handlers are incompatible
 *    with `output: 'export'`; it is always restored afterwards.
 * 3. Runs `next build` with STATIC_EXPORT=1, writing out/.
 *
 * Copy+delete is used instead of rename because OneDrive on Windows denies
 * directory renames (EPERM).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "src", "app", "api");
const backupDir = path.join(root, `.api-backup-${process.pid}`);
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const seed = path.join(root, "src", "data", "cameras-seed.json");
const baked = path.join(root, "public", "data", "cameras.json");

function bakeSnapshot() {
  if (!fs.existsSync(seed)) throw new Error(`missing ${path.relative(root, seed)}`);
  const { generatedAt, data } = JSON.parse(fs.readFileSync(seed, "utf8"));
  fs.mkdirSync(path.dirname(baked), { recursive: true });
  fs.writeFileSync(
    baked,
    JSON.stringify({ generatedAt, fromCache: false, layers: data.layers, points: data.points }),
  );
  const points = data.points.length;
  console.log(`[build-static] baked ${points} camera records from snapshot ${generatedAt}`);
}

let apiMovedAside = false;
function restoreApi() {
  if (!apiMovedAside) return;
  apiMovedAside = false;
  fs.cpSync(backupDir, apiDir, { recursive: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
  console.log("[build-static] restored src/app/api");
}
process.on("exit", restoreApi);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restoreApi();
    process.exit(130);
  });
}

bakeSnapshot();

try {
  if (!fs.existsSync(apiDir)) throw new Error("src/app/api not found; is another build running?");
  fs.cpSync(apiDir, backupDir, { recursive: true });
  fs.rmSync(apiDir, { recursive: true });
  apiMovedAside = true;
  console.log("[build-static] moved src/app/api aside; running next build (STATIC_EXPORT=1)");

  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, STATIC_EXPORT: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  restoreApi();
}

if (process.exitCode) throw new Error(`[build-static] next build failed with exit code ${process.exitCode}`);
console.log(`[build-static] static export written to ${path.join(root, "out")}`);
