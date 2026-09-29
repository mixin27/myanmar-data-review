import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = "http://127.0.0.1:4175";
const headers = JSON.parse(
  readFileSync(new URL("../deployment/headers.json", import.meta.url), "utf8"),
);
for (const path of [
  "/.env",
  "/.vite/manifest.json",
  "/assets/missing.js",
  "/health",
  "/tests/browser/worker.html",
]) {
  const response = await fetch(base + path);
  assert.equal(response.status, 404, path);
  assert.ok(
    !(await response.text()).includes('<div id="root">'),
    "Missing assets must not receive app HTML",
  );
}
const post = await fetch(base + "/", { method: "POST", body: "synthetic" });
assert.equal(post.status, 405);
const home = await fetch(base);
assert.equal(home.headers.get("cache-control"), "no-cache");
const html = await home.text();
const script = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(script);
const assets = (await (await fetch(base + script)).text()).match(
  /(?:import|engine|project)\.worker-[\w-]+\.js/g,
);
assert.ok(assets?.length);
for (const path of new Set([
  "/",
  script,
  ...assets.map((asset) => "/assets/" + asset),
])) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200);
  for (const [name, value] of Object.entries(headers))
    assert.equal(response.headers.get(name), value, `${path}: ${name}`);
}
console.log(
  "Container routes, worker headers, method restrictions and private-file exclusions passed.",
);
