import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
const output = resolve(process.argv[2] ?? "dist");
const integration = process.argv[2] === ".test-build";
const assets = join(output, "assets");
const files = readdirSync(assets);
const csvWorkers = files.filter((file) => /^import\.worker-.*\.js$/.test(file));
assert.equal(csvWorkers.length, 1, "Expected a dedicated CSV worker chunk");
const languageWorkers = files.filter((file) =>
  /^engine\.worker-.*\.js$/.test(file),
);
assert.equal(
  languageWorkers.length,
  1,
  "Expected the dedicated local language worker",
);
for (const file of files.filter(
  (file) => file.endsWith(".js") && !languageWorkers.includes(file),
)) {
  const source = readFileSync(join(assets, file), "utf8");
  assert.ok(
    !source.includes("zawgyi-unicode-v1"),
    "Language engine leaked into main-thread bundle",
  );
  if (!integration) {
    assert.ok(
      !source.includes("Integration diagnostics"),
      "Test screen leaked into product",
    );
    assert.ok(
      !source.includes("Milestone 1"),
      "Development copy leaked into product",
    );
  }
}
if (integration)
  assert.ok(
    readFileSync(join(assets, languageWorkers[0]), "utf8").includes(
      "zawgyi-unicode-v1",
    ),
  );
else assert.ok(!existsSync(join(output, "tests")), "Test routes must not ship");
for (const file of [
  "Apache-2.0.txt",
  "MyanLex-MIT.txt",
  "MyanLex-THIRD_PARTY_NOTICES.md",
])
  assert.ok(existsSync(join(output, "licenses", file)));
console.log(
  "Dedicated workers, main-thread separation, product-only entrypoints and shipped notices verified.",
);
