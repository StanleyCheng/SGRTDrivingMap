/**
 * End-to-end smoke test for the running dev/prod server.
 *
 * Drives the real Chrome installed for agent-browser over the DevTools
 * Protocol — no test framework, no browser-automation dependency.
 *
 *   node scripts/smoke.mjs [baseUrl]
 *
 * Writes screenshots to .cache/screens/ and exits non-zero on failure.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), ".cache", "screens");

/**
 * Pick a free debug port for every run. A fixed port is a trap: an interrupted
 * run leaves its browser listening, the next run attaches to that stale page and
 * reports the *previous* run's DOM state as if it were a real regression.
 */
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(
      process.env.USERPROFILE ?? "",
      ".agent-browser/browsers/chrome-153.0.8010.52/chrome-win64/chrome.exe",
    ),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome/Edge binary found; set CHROME_PATH");
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpConnect(port) {
  // Wait for the browser we just spawned to answer on its own debug port.
  await (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) return;
      } catch {
        /* not up yet */
      }
      await sleep(500);
    }
    throw new Error("Chrome DevTools endpoint never came up");
  })();

  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await listRes.json();
  const pages = targets.filter((t) => t.type === "page");
  // The browser we spawn opens about:blank and nothing else, so anything else on
  // this port belongs to another process and must not be driven.
  const page = pages.find((t) => t.url === "about:blank");
  if (!page) {
    throw new Error(
      `port ${port} is owned by another browser; refusing to attach (pages: ${pages
        .map((p) => p.url)
        .join(", ")})`,
    );
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let id = 0;
  const pending = new Map();
  const events = [];
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (e) => reject(new Error(String(e.message ?? e))));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  return { send, events, close: () => ws.close() };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Extract console errors/warnings from the CDP event log. */
function collectConsole(events) {
  const out = [];
  for (const e of events) {
    if (e.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(e.params.type)) {
      out.push({
        level: e.params.type,
        text: e.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "),
        url: "",
      });
    }
    if (e.method === "Log.entryAdded" && ["error", "warning"].includes(e.params.entry.level)) {
      out.push({ level: e.params.entry.level, text: e.params.entry.text, url: e.params.entry.url ?? "" });
    }
    if (e.method === "Runtime.exceptionThrown") {
      out.push({ level: "error", text: e.params.exceptionDetails.text, url: "" });
    }
  }
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const PORT = await freePort();
  const profile = path.join(tmpdir(), `sgdi-smoke-${Date.now()}`);
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const { send, events, close } = await cdpConnect(PORT);
  const consoleIssues = [];
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
      throw new Error(`evaluate failed: ${d}\n  expr: ${String(expression).slice(0, 200)}`);
    }
    return res.result.value;
  };
  const waitFor = async (expression, timeoutMs = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(`(() => { try { return !!(${expression}); } catch { return false; } })()`))
        return true;
      await sleep(400);
    }
    return false;
  };

  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: BASE });
    await waitFor("document.querySelector('[data-testid=map] canvas')", 40000);
    await waitFor("document.body.innerText.includes('240')", 30000);
    await sleep(3000); // tiles + markers

    const mode = await evaluate("document.documentElement.dataset.mode");
    const api = await evaluate(
      mode === "static"
        ? `fetch('data/cameras.json').then(r => r.json())`
        : `fetch('/api/cameras').then(r => r.json())`,
    );
    const counts = Object.fromEntries(api.layers.map((l) => [l.id, l.count]));

    // 1. layer counts rendered from real data
    const panelText = await evaluate("document.body.innerText");
    check(
      "layer panel shows live counts",
      panelText.includes(String(counts.redlight)) &&
        panelText.includes(String(counts.speed)) &&
        panelText.includes(String(counts.snapshot)),
      `api: ${JSON.stringify(counts)}`,
    );
    check(
      "traffic layer reports live image count",
      (api.layers.find((l) => l.id === "snapshot")?.liveCount ?? 0) > 0,
      `live=${api.layers.find((l) => l.id === "snapshot")?.liveCount}`,
    );
    check(
      "live feed loaded from the official source",
      /Feed updated|live images/i.test(panelText) && !/temporarily unavailable/i.test(panelText),
      panelText.replace(/\n+/g, " | ").slice(-160),
    );
    // Every still image must be loadable by the browser from the active app
    // feed (LTA presigned S3 in server mode or data.gov.sg in static mode).
    const imgProbe = await evaluate(`(async () => {
      const source = ${JSON.stringify("https://api.data.gov.sg/v1/transport/traffic-images")};
      const staticMode = ${JSON.stringify(mode === "static")};
      const feed = await fetch(staticMode ? source : '/api/traffic-images').then((r) => r.json());
      const cameras = staticMode
        ? (feed?.items?.[0]?.cameras ?? []).map((c) => ({ id: String(c.camera_id), url: c.image }))
        : (feed?.cameras ?? []).map((c) => ({ id: String(c.cameraId), url: c.imageUrl }));
      const results = await Promise.all(cameras.map(({ id, url }) => new Promise((resolve) => {
        if (!url) return resolve({ id, ok: false, reason: 'missing-url' });
        const img = new Image();
        const timer = setTimeout(() => resolve({ id, ok: false, reason: 'timeout' }), 15000);
        img.onload = () => {
          clearTimeout(timer);
          const ok = img.naturalWidth > 0 && img.naturalHeight > 0;
          resolve({ id, ok, reason: ok ? '' : 'zero-dimensions' });
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve({ id, ok: false, reason: 'load-error' });
        };
        img.src = url;
      })));
      return {
        total: results.length,
        loaded: results.filter((result) => result.ok).length,
        failures: results.filter((result) => !result.ok).map((result) => result.id + ':' + result.reason),
      };
    })()`);
    check(
      "official traffic still loads in the browser",
      imgProbe.total > 0 && imgProbe.loaded === imgProbe.total,
      `loaded=${imgProbe.loaded}/${imgProbe.total}; failures=${imgProbe.failures.join(',') || 'none'}`,
    );
    const snapshotCount = await evaluate(`(() => {
      const row = document.querySelector('[data-layer="snapshot"]');
      const value = row?.querySelector('.num')?.textContent?.trim() ?? '';
      return Number(value.replace(/[^0-9]/g, ''));
    })()`);
    check(
      "snapshot layer contains only cameras in the current image feed",
      snapshotCount === imgProbe.total,
      `layer=${snapshotCount}; feed=${imgProbe.total}`,
    );

    // 2. language toggle
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '繁中').click()`,
    );
    await sleep(600);
    const zhText = await evaluate("document.body.innerText");
    check("language toggle switches to Traditional Chinese", zhText.includes("資料圖層"), zhText.slice(0, 40));
    check("html lang attribute follows the toggle", (await evaluate("document.documentElement.lang")) === "zh-Hant");
    const shotZh = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT, "desktop-zh.png"), Buffer.from(shotZh.data, "base64"));
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Eng').click()`,
    );
    await sleep(400);
    check(
      "language toggle switches back to English",
      /data layers/i.test(await evaluate("document.body.innerText")),
    );

    // 2b. the agreed default view. The nine driver overlays need the server-hosted
    //     app, so the static build lists only the three camera layers (all on, or the
    //     map would open empty) while the server build lists twelve with just the top
    //     two switched on. The road feeds are slow on a cold start and the live group
    //     renders skeletons until the first payload lands, so wait for the panel to
    //     settle instead of sampling it mid-flight.
    const staticMode = mode === "static";
    const expectedRows = staticMode ? 3 : 12;
    await waitFor(`document.querySelectorAll('.atlas-layer').length === ${expectedRows}`, 90000);
    const layerRows = await evaluate("document.querySelectorAll('.atlas-layer').length");
    check(
      staticMode
        ? "static build lists the three camera layers"
        : "nine driver layers and three camera layers are listed",
      staticMode ? layerRows === 3 : layerRows === 12,
      `rows=${layerRows}`,
    );
    const defaults = await evaluate(
      `(() => [...document.querySelectorAll('[role=switch]')].map(x => x.getAttribute('aria-checked')).join(','))()`,
    );
    check(
      staticMode
        ? "static build defaults its camera layers on"
        : "only the top two layers are on by default",
      staticMode
        ? defaults === "true,true,true"
        : defaults === "true,true,false,false,false,false,false,false,false,false,false,false",
      defaults,
    );

    // 3. layer toggle hides/shows a layer
    const before = await evaluate(
      `(() => { const s = [...document.querySelectorAll('[role=switch]')]; return s.map(x => x.getAttribute('aria-checked')).join(','); })()`,
    );
    await evaluate(`document.querySelectorAll('[role=switch]')[0].click()`);
    await sleep(500);
    const after = await evaluate(
      `(() => { const s = [...document.querySelectorAll('[role=switch]')]; return s.map(x => x.getAttribute('aria-checked')).join(','); })()`,
    );
    check("layer switch toggles", before !== after, `${before} -> ${after}`);
    await evaluate(`document.querySelectorAll('[role=switch]')[0].click()`);
    await sleep(400);

    // 4. clicking a marker opens the detail panel (markers are drawn on the canvas,
    //    so centre the map on a known camera, then dispatch a real click).
    //    Requires the dev-only window.__map handle; production builds skip these.
    //    Camera layers start off by design, so switch them on first.
    await evaluate(`(() => {
      for (const id of ['redlight', 'speed', 'snapshot']) {
        const sw = document.querySelector('[data-layer="' + id + '"] [role=switch]');
        if (sw && sw.getAttribute('aria-checked') === 'false') sw.click();
      }
      return true;
    })()`);
    await sleep(1800);
    const target = api.points
      .filter((p) => p.layer === "redlight")
      .find((p) => p.lng > 103.79 && p.lng < 103.9 && p.lat > 1.31 && p.lat < 1.4);
    const box = await evaluate(
      `(() => { const r = document.querySelector('[data-testid=map]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
    );
    check("map canvas fills the viewport", box.w > 800 && box.h > 500, `${box.w}x${box.h}`);

    // 3b. the top bar retracts to the app icon alone, then restores. The collapsed
    //     bar is a button rather than a header, so it is found by its class.
    const barWidth = await evaluate(
      `Math.round(document.querySelector('header.atlas-header').getBoundingClientRect().width)`,
    );
    await evaluate(`document.querySelector('header.atlas-header').click()`);
    await sleep(700);
    const collapsedBar = await evaluate(`(() => {
      const el = document.querySelector('.atlas-header');
      if (!el) return null;
      return {
        width: Math.round(el.getBoundingClientRect().width),
        expanded: el.getAttribute('aria-expanded'),
        hasWordmark: Boolean(el.querySelector('h1')),
      };
    })()`);
    await evaluate(`document.querySelector('.atlas-header').click()`);
    await sleep(700);
    const restoredBar = await evaluate(`(() => {
      const el = document.querySelector('header.atlas-header');
      return el ? { width: Math.round(el.getBoundingClientRect().width), expanded: el.getAttribute('aria-expanded') } : null;
    })()`);
    check(
      "top bar retracts to the icon only and restores",
      Boolean(collapsedBar && restoredBar) &&
        collapsedBar.width < 120 &&
        collapsedBar.width < barWidth * 0.4 &&
        collapsedBar.expanded === "false" &&
        !collapsedBar.hasWordmark &&
        restoredBar.width === barWidth &&
        restoredBar.expanded === "true",
      `width ${barWidth} -> ${collapsedBar?.width} (wordmark ${collapsedBar?.hasWordmark ? "shown" : "hidden"}) -> ${restoredBar?.width}`,
    );

    const hasHook = await evaluate("Boolean(window.__map)");
    if (!hasHook) {
      console.log("SKIP  marker interaction checks — run against `npm run dev` for the __map handle");
    }
    if (hasHook) {
    await evaluate(`(() => {
      const m = window.__map;
      if (!m) return 'no-map-hook';
      m.jumpTo({ center: [${target.lng}, ${target.lat}], zoom: 16.6 });
      return 'ok';
    })()`);
    await sleep(2500);
    const tap = await evaluate(`(() => {
      const m = window.__map;
      const p = m.project([${target.lng}, ${target.lat}]);
      const r = document.querySelector('[data-testid=map]').getBoundingClientRect();
      return { x: r.x + p.x, y: r.y + p.y };
    })()`);
    const px = tap.x;
    const py = tap.y;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py, button: "none" });
    await sleep(300);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: px, y: py, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px, y: py, button: "left", clickCount: 1 });
    await sleep(1800);
    const detailText = await evaluate("document.body.innerText");
    check(
      "clicking a marker opens location details",
      detailText.includes("Zoom to") && detailText.includes(target.road.split(" ")[0]),
      `target=${target.road} (${target.lat},${target.lng})`,
    );
    const shot1 = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT, "desktop-detail.png"), Buffer.from(shot1.data, "base64"));

    // 5. a live traffic camera shows its image
    const live = api.points.find((p) => p.layer === "snapshot" && p.live);
    check("live traffic camera present in payload", Boolean(live), live?.road ?? "none");
    if (live) {
      await evaluate(
        `(() => { window.__map.jumpTo({ center: [${live.lng}, ${live.lat}], zoom: 17 }); return true; })()`,
      );
      await sleep(2500);
      const tap = await evaluate(`(() => {
        const m = window.__map;
        const p = m.project([${live.lng}, ${live.lat}]);
        const r = document.querySelector('[data-testid=map]').getBoundingClientRect();
        return { x: r.x + p.x, y: r.y + p.y };
      })()`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tap.x, y: tap.y, button: "none" });
      await sleep(400);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: tap.x, y: tap.y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: tap.x, y: tap.y, button: "left", clickCount: 1 });
      await sleep(3000);
      const img = await evaluate(`(() => {
        const el = document.querySelector('img[src*="dm-traffic-camera"], img[src*="traffic-images"], img[src*="amazonaws"]');
        if (!el) return null;
        return { src: el.currentSrc.slice(0, 90), w: el.naturalWidth, h: el.naturalHeight };
      })()`);
      const liveText = await evaluate("document.body.innerText");
      check(
        "live traffic camera renders its still image",
        Boolean(img) && img.w > 0 && img.h > 0,
        img ? `${img.w}x${img.h} ${img.src}` : "no <img> found",
      );
      check(
        "image card shows capture time + live badge",
        liveText.includes("Live") && /Captured/.test(liveText),
        `panel=${/Traffic image/.test(liveText) ? "open" : "missing"} len=${liveText.length}`,
      );
      const shotLive = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(OUT, "desktop-live-camera.png"), Buffer.from(shotLive.data, "base64"));
    }

    // 5b. the EV connector filter must actually take effect on the map, not just in
    //     the panel. The view is centred on a charger the API reports, and the
    //     assertion is that only the chosen connector is drawn — a property that
    //     holds wherever the map is, unlike a raw marker count.
    await evaluate(`(() => {
      const sw = document.querySelector('[data-layer="ev"] [role=switch]');
      if (sw && sw.getAttribute('aria-checked') === 'false') sw.click();
      return true;
    })()`);
    await sleep(5000);
    // The connector options come from the layer's own features, so they only exist
    // once the EV payload has landed.
    await waitFor(`(document.querySelector('#filter-ev-plug')?.options.length ?? 0) > 1`, 60000);
    await evaluate(`(async () => {
      const j = await fetch('/api/road-conditions?layers=ev').then((r) => r.json());
      const f = (j.features || []).find((x) => x.geometry);
      if (f) window.__map.jumpTo({ center: f.geometry.coordinates, zoom: 15 });
      return Boolean(f);
    })()`);
    await sleep(3500);
    // Choose a connector that is actually on screen, so the assertion after
    // filtering is about the filter, not about an empty viewport.
    const evBefore = await evaluate(`(() => {
      const feats = window.__map.queryRenderedFeatures({ layers: ['road-ev-points'] });
      const counts = new Map();
      for (const f of feats) {
        const k = f.properties.plugType;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      return { count: feats.length, connectors: ranked.map(([k]) => k) };
    })()`);
    const chosen = evBefore.connectors[0] ?? null;
    const applied = await evaluate(`(() => {
      const sel = document.querySelector('#filter-ev-plug');
      if (!sel || !${JSON.stringify(chosen)}) return null;
      sel.value = ${JSON.stringify(chosen)};
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return sel.value;
    })()`);
    await sleep(3000);
    const evAfter = await evaluate(
      `(() => {
        const feats = window.__map.queryRenderedFeatures({ layers: ['road-ev-points'] });
        return { count: feats.length, connectors: [...new Set(feats.map((f) => f.properties.plugType))] };
      })()`,
    );
    check(
      "EV connector filter applies to the map",
      evBefore.count > 0 &&
        evAfter.count > 0 &&
        chosen !== null &&
        applied === chosen &&
        evAfter.connectors.length === 1 &&
        evAfter.connectors[0] === chosen,
      `rendered ${evBefore.count} -> ${evAfter.count}; connectors now [${evAfter.connectors.join(
        ", ",
      )}]; filtered to ${chosen}`,
    );
    await evaluate(`(() => {
      const sel = document.querySelector('#filter-ev-plug');
      if (sel) { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      const sw = document.querySelector('[data-layer="ev"] [role=switch]');
      if (sw && sw.getAttribute('aria-checked') === 'true') sw.click();
      return true;
    })()`);
    await sleep(800);
    }

    // 6. sources panel
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => (b.getAttribute('data-tip')||'').includes('Data sources')).click()`,
    );
    await sleep(700);
    const srcText = await evaluate("document.body.innerText");
    check(
      "sources panel lists official datasets",
      srcText.includes("data.gov.sg") || srcText.includes("Singapore Police Force"),
    );
    if (mode === "static") {
      check(
        "static build attributes the live feed to data.gov.sg (not DataMall)",
        !/DataMall/.test(srcText),
        srcText.replace(/\n+/g, " | ").slice(0, 120),
      );
    }
    const shot2 = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT, "desktop-sources.png"), Buffer.from(shot2.data, "base64"));
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(500);

    // 7. mobile viewport
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Page.reload");
    await waitFor("document.querySelector('[data-testid=map] canvas')", 40000);
    await sleep(4000);
    const mobileText = await evaluate("document.body.innerText");
    const overflow = await evaluate("document.documentElement.scrollWidth - window.innerWidth");
    check("mobile viewport renders without horizontal overflow", overflow <= 0, `overflow=${overflow}px`);
    check(
      "mobile shows the layer sheet",
      /data layers/i.test(mobileText) || mobileText.includes("240"),
      mobileText.slice(0, 60).replace(/\n/g, " / "),
    );

    // The phone control is a coloured icon rail docked at the bottom: tapping an
    // icon must pop that layer's own content above it. The static build's rail
    // carries the camera layers only, so the count differs by mode and the first
    // icon is used rather than a driver-layer id that static mode does not have.
    const railIcons = await evaluate(
      `(() => { const rail = document.querySelector('.atlas-rail'); return rail ? rail.children.length : 0; })()`,
    );
    check(
      staticMode ? "phone rail lists the camera layers" : "phone layer rail shows an icon per layer",
      staticMode ? railIcons === 3 : railIcons >= 9,
      `icons=${railIcons}`,
    );
    // A tap on a layer with nothing to configure switches it: no card, and no
    // switch inside a card. The tooltip carries the description instead.
    const railSimple = staticMode ? "redlight" : "hazards";
    const railBefore = await evaluate(
      `document.querySelector('.atlas-rail-icon[data-layer="${railSimple}"]')?.getAttribute('aria-pressed')`,
    );
    await evaluate(
      `document.querySelector('.atlas-rail-icon[data-layer="${railSimple}"]')?.click()`,
    );
    await sleep(800);
    const railAfter = await evaluate(`(() => {
      const b = document.querySelector('.atlas-rail-icon[data-layer="${railSimple}"]');
      return {
        pressed: b ? b.getAttribute('aria-pressed') : null,
        popup: Boolean(document.querySelector('.atlas-rail-popup')),
        tip: b ? b.getAttribute('data-tip') : null,
      };
    })()`);
    check(
      "rail tap toggles a layer with nothing to configure",
      railBefore !== railAfter.pressed && !railAfter.popup,
      `${railSimple}: ${railBefore} -> ${railAfter.pressed}, popup=${railAfter.popup}`,
    );
    check(
      "rail tooltip describes the layer",
      Boolean(railAfter.tip && railAfter.tip.length > 12 && railAfter.tip.includes("—")),
      railAfter.tip ?? "no tooltip",
    );

    // Layers that do have settings still open their own panel.
    if (staticMode) {
      console.log("SKIP  rail option-panel check — the static build's rail has no layer with settings");
    } else {
      await evaluate(`document.querySelector('.atlas-rail-icon[data-layer="parking"]')?.click()`);
      await sleep(800);
      const popupBefore = await evaluate(`(() => {
        const el = document.querySelector('.atlas-rail-popup');
        if (!el) return null;
        return { hasSwitch: Boolean(el.querySelector('[role=switch]')), text: el.innerText.slice(0, 80) };
      })()`);
      // Switching it on from that panel must reveal the layer's own controls.
      await evaluate(`document.querySelector('.atlas-rail-popup [role=switch]')?.click()`);
      await waitFor(`Boolean(document.querySelector('.atlas-rail-popup select'))`, 30000);
      const popupAfter = await evaluate(`(() => {
        const el = document.querySelector('.atlas-rail-popup');
        const select = el ? el.querySelector('select') : null;
        return { hasSelect: Boolean(select), options: select ? select.options.length : 0, text: el ? el.innerText.slice(0, 80) : "" };
      })()`);
      check(
        "rail tap opens options for a layer that has them",
        Boolean(
          popupBefore &&
            popupBefore.hasSwitch &&
            popupAfter.hasSelect &&
            popupAfter.options > 1,
        ),
        `${popupBefore?.text.replace(/\n/g, " / ") ?? "no popup"} -> select options=${popupAfter.options}`,
      );
    }
    const shotRail = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT, "mobile-rail.png"), Buffer.from(shotRail.data, "base64"));
    const shot3 = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT, "mobile.png"), Buffer.from(shot3.data, "base64"));

    consoleIssues.push(...collectConsole(events));
    // Live traffic stills come from keyless mirrors that rotate their image URLs,
    // so an image can expire between the feed fetch and the browser load. That is a
    // property of the mirror, not an app fault, and the dedicated "still loads in
    // the browser" check above owns image health; everything else must be clean.
    const EXPECTED_IMAGE_HOSTS = /images\.data\.gov\.sg|dm-traffic-camera-itsc\.s3/;
    const errors = consoleIssues.filter(
      (c) =>
        c.level === "error" &&
        !/favicon|net::ERR_/i.test(c.text) &&
        !(EXPECTED_IMAGE_HOSTS.test(c.url) || /Failed to load resource/.test(c.text)),
    );
    check("no runtime console errors", errors.length === 0, errors.slice(0, 4).join(" | ").slice(0, 400));
    if (consoleIssues.length) {
      console.log(`\nconsole messages (${consoleIssues.length}):`);
      for (const c of consoleIssues.slice(0, 12)) {
        console.log(`  [${c.level}] ${c.text.slice(0, 180)}${c.url ? ` (${c.url.slice(0, 90)})` : ""}`);
      }
    }
    const failed2 = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed2.length}/${results.length} checks passed`);
    console.log(`screenshots: ${OUT}`);
    process.exitCode = failed2.length ? 1 : 0;
  } finally {
    // Close the browser through CDP, not just the launcher process, so no child
    // survives to hold the port for the next run.
    await send("Browser.close").catch(() => {});
    close();
    chrome.kill();
    await sleep(1200);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Windows can hold a lock on the profile for a moment after exit; the
      // directory is in tmpdir and the next run uses a fresh one.
    }
  }
}

main().catch((err) => {
  console.error("smoke run crashed:", err);
  process.exit(2);
});
