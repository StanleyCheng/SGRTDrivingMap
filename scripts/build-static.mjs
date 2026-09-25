/**
 * Static export for GitHub Pages.
 *
 * 1. Bakes the official camera datasets into public/data/cameras.json (real data,
 *    captured by the last `?refresh=1` run — see doc/build-report.md).
 * 2. Moves app/api aside for the build, because route handlers are incompatible
 *    with `output: 'export'`; it is always restored afterwards.
 *    Considered and rejected: dropping `.ts` from `pageExtensions` in static
 *    mode, which does keep route.ts out of the export. It is documented for the
 *    Pages Router and also governs middleware/proxy discovery, so a future
 *    middleware would silently disappear from this build.
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
const nextDevDir = path.join(root, ".next", "dev");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const seed = path.join(root, "src", "data", "cameras-seed.json");
const baked = path.join(root, "public", "data", "cameras.json");
const roadSeed = path.join(root, "src", "data", "road-conditions-seed.json");
const roadBaked = path.join(root, "public", "data", "road-conditions");

/**
 * The driver layers are fed by credentialed LTA DataMall feeds, which a static
 * host cannot reach. Baking the last payload the server produced keeps those
 * layers visible on GitHub Pages, split per layer so the browser only downloads
 * the layers it has switched on, and labelled as a cached copy in the UI.
 *
 * Refresh it the same way as the camera snapshot:
 *   curl -s "http://localhost:3000/api/road-conditions" > src/data/road-conditions-seed.json
 */
function bakeRoadConditions() {
  if (!fs.existsSync(roadSeed)) {
    // Skipping this silently keeps a previous public/data in place, and on a
    // fresh checkout it would publish a site whose driver layers 404. Fail.
    throw new Error(
      `missing ${path.relative(root, roadSeed)} — refresh it from a running server (see doc/build-report.md)`,
    );
  }
  const payload = JSON.parse(fs.readFileSync(roadSeed, "utf8"));
  const byLayer = new Map();
  for (const feature of payload.features ?? []) {
    const id = feature?.properties?.layer;
    if (!id) continue;
    if (!byLayer.has(id)) byLayer.set(id, []);
    byLayer.get(id).push(feature);
  }
  fs.rmSync(roadBaked, { recursive: true, force: true });
  fs.mkdirSync(roadBaked, { recursive: true });
  for (const [id, features] of byLayer) {
    fs.writeFileSync(path.join(roadBaked, `${id}.json`), JSON.stringify({ features }));
  }
  const { features, ...index } = payload;
  fs.writeFileSync(path.join(roadBaked, "index.json"), JSON.stringify(index));
  console.log(
    `[build-static] baked driver snapshot ${payload.generatedAt} — ${features?.length ?? 0} features across ${byLayer.size} layers`,
  );
}

function bakeSnapshot() {
  if (!fs.existsSync(seed)) throw new Error(`missing ${path.relative(root, seed)}`);
  const { generatedAt, data } = JSON.parse(fs.readFileSync(seed, "utf8"));
  // Older seeds included the separate illegal-parking camera inventory in the
  // snapshot layer. Static builds expose only cameras that the image feed has
  // actually published; the browser then replaces these from the live feed.
  // The same rule lives in src/lib/camera-snapshot.ts for the server and the
  // browser — keep the two in step when the inventory changes.
  const points = data.points.filter((point) => point.layer !== "snapshot" || point.live);
  const snapshotCount = points.filter((point) => point.layer === "snapshot").length;
  const layers = data.layers.map((layer) =>
    layer.id === "snapshot"
      ? {
          ...layer,
          sources: layer.sources.filter(
            (source) =>
              !source.url.includes("d_147f4906651f5b32925dfe6560296161") &&
              !source.name.includes("Road Camera locations"),
          ),
          count: snapshotCount,
          liveCount: snapshotCount,
          kinds: { snapshot: snapshotCount },
        }
      : layer,
  );
  fs.mkdirSync(path.dirname(baked), { recursive: true });
  fs.writeFileSync(
    baked,
    JSON.stringify({ generatedAt, fromCache: false, layers, points }),
  );
  console.log(`[build-static] baked ${points.length} camera records from snapshot ${generatedAt}`);
}

/**
 * The Pages site is only correct if the pages themselves and every baked data
 * file the browser fetches made it into out/. A half-written export must fail
 * the build rather than deploy.
 */
function assertExport() {
  const dataDir = path.join(root, "out", "data");
  const index = path.join(dataDir, "road-conditions", "index.json");
  const required = [
    path.join(root, "out", "index.html"),
    path.join(dataDir, "cameras.json"),
    index,
  ];
  if (fs.existsSync(index)) {
    const payload = JSON.parse(fs.readFileSync(index, "utf8"));
    for (const layer of payload.layers ?? []) {
      required.push(path.join(dataDir, "road-conditions", `${layer.id}.json`));
    }
  }
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(
      `static export is incomplete; missing ${missing.map((f) => path.relative(root, f)).join(", ")}`,
    );
  }
  console.log(`[build-static] verified ${required.length} exported files`);
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
bakeRoadConditions();

try {
  // `next dev` writes route validators under .next/dev. Because the static build
  // temporarily removes the API routes, those generated files otherwise retain
  // imports to files that no longer exist and make TypeScript fail with TS2307.
  // Preserve .next/cache, which is the reusable build cache documented by Next.
  fs.rmSync(nextDevDir, { recursive: true, force: true });

  // A run killed between the move and the restore (SIGKILL, VM teardown) leaves
  // the API routes in .api-backup-<pid>; put them back instead of failing.
  if (!fs.existsSync(apiDir)) {
    const rescued = fs.readdirSync(root).filter((name) => name.startsWith(".api-backup-"));
    if (rescued.length === 1) {
      fs.cpSync(path.join(root, rescued[0]), apiDir, { recursive: true });
      fs.rmSync(path.join(root, rescued[0]), { recursive: true, force: true });
      console.log(`[build-static] restored src/app/api from ${rescued[0]} (earlier run was interrupted)`);
    }
  }
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
assertExport();
if (!fs.existsSync(apiDir)) throw new Error("[build-static] src/app/api was not restored");
console.log(`[build-static] static export written to ${path.join(root, "out")}`);
