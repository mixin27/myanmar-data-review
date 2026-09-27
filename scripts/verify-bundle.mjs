import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
const assets = new URL("../dist/assets/", import.meta.url);
const files = readdirSync(assets);
const workers = files.filter((file) => /^engine\.worker-.*\.js$/.test(file));
assert.equal(workers.length, 1, "Expected a dedicated production worker chunk");
const worker = readFileSync(new URL(workers[0], assets), "utf8");
assert.ok(
  worker.includes("zawgyi-unicode-v1"),
  "Worker must contain the installed engine",
);
for (const file of files.filter(
  (file) => file.endsWith(".js") && !workers.includes(file),
)) {
  const source = readFileSync(new URL(file, assets), "utf8");
  assert.ok(
    !source.includes("zawgyi-unicode-v1"),
    "Engine leaked into main-thread bundle",
  );
  assert.ok(
    !source.includes("google-zawgyi"),
    "Engine model leaked into main-thread bundle",
  );
}
assert.ok(
  existsSync(new URL("../dist/licenses/Apache-2.0.txt", import.meta.url)),
);
assert.ok(
  existsSync(new URL("../dist/licenses/MyanLex-MIT.txt", import.meta.url)),
);
assert.ok(
  existsSync(
    new URL("../dist/licenses/MyanLex-THIRD_PARTY_NOTICES.md", import.meta.url),
  ),
);
console.log(
  "Dedicated worker bundle, main-thread separation and shipped notices verified.",
);
