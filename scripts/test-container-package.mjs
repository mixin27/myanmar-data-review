import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const previous = mkdtempSync(join(tmpdir(), "mdr-previous-"));
const run = (...args) =>
  execFileSync(process.execPath, ["scripts/prepare-container.mjs", ...args], {
    stdio: "pipe",
  });
try {
  mkdirSync(join(previous, "assets"));
  writeFileSync(
    join(previous, "assets", "retained-abcdef.js"),
    "/* synthetic prior asset */",
  );
  run("--previous", previous);
  assert.ok(existsSync(".container/site/assets/retained-abcdef.js"));
  assert.ok(!existsSync(".container/site/.vite"));
  assert.deepEqual(readdirSync(".container/site").sort(), [
    "assets",
    "index.html",
    "licenses",
  ]);
  const manifest = JSON.parse(
    readFileSync(".container/release-manifest.json", "utf8"),
  );
  for (const [file, digest] of Object.entries(manifest.files))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(join(".container", file)))
        .digest("hex"),
      digest,
    );
  const current = readdirSync("dist/assets").find((name) =>
    name.endsWith(".js"),
  );
  assert.ok(current);
  writeFileSync(
    join(previous, "assets", current),
    "/* invalid replacement bytes */",
  );
  assert.throws(() => run("--previous", previous), /Fingerprint collision/);
  assert.throws(
    () => run("--previous", ".container/site"),
    /outside generated/,
  );
  console.log(
    "Container package isolation, integrity, old-asset retention and collision rejection passed.",
  );
} finally {
  rmSync(previous, { recursive: true, force: true });
  run();
}
