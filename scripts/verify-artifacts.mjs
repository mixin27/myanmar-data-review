import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

export const manifest = JSON.parse(
  readFileSync(new URL("../vendor/myanlex/manifest.json", import.meta.url)),
);
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
assert.match(manifest.upstreamCommit, /^[0-9a-f]{40}$/);
assert.equal(
  manifest.recipeSha256,
  digest(readFileSync(new URL("./package-myanlex.py", import.meta.url))),
  "Packaging recipe changed; review artifact provenance",
);
assert.deepEqual(
  manifest.artifacts.map((entry) => entry.name),
  ["@myanlex/types", "@myanlex/core", "@myanlex/application"],
);
for (const artifact of manifest.artifacts) {
  assert.match(artifact.file, /^myanlex-[a-z]+-0\.0\.0-mdr\.[a-f0-9]+\.tgz$/);
  const data = readFileSync(
    new URL("../vendor/myanlex/" + artifact.file, import.meta.url),
  );
  assert.equal(data.length, artifact.bytes);
  assert.equal(
    digest(data),
    artifact.sha256,
    `Integrity failure: ${artifact.name}`,
  );
}
for (const [name, hash] of Object.entries(manifest.licenses)) {
  assert.equal(
    digest(
      readFileSync(new URL("../public/licenses/" + name, import.meta.url)),
    ),
    hash,
  );
}
console.log("MyanLex archive and license integrity verified.");
