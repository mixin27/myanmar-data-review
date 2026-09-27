import {
  mkdtempSync,
  cpSync,
  writeFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { manifest } from "./verify-artifacts.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "mdr-consumer-")));
try {
  cpSync(new URL("../vendor/myanlex", import.meta.url), join(dir, "vendor"), {
    recursive: true,
  });
  const dependencies = Object.fromEntries(
    manifest.artifacts.map(({ name, file }) => [name, "file:vendor/" + file]),
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }),
  );
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    "packages:\n  - .\noverrides:\n" +
      Object.entries(dependencies)
        .map(([name, path]) => `  "${name}": "${path}"`)
        .join("\n") +
      "\n",
  );
  // No network, no shared package store, no workspace source or inherited NODE_PATH.
  execFileSync(
    "pnpm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--store-dir",
      join(dir, "empty-store"),
    ],
    { cwd: dir, stdio: "inherit" },
  );
  for (const { name } of manifest.artifacts) {
    if (!realpathSync(join(dir, "node_modules", name)).startsWith(dir + "/"))
      throw new Error("External package link");
  }
  writeFileSync(
    join(dir, "smoke.mjs"),
    `
    import assert from 'node:assert/strict';
    import { createMyanLexApplication } from '@myanlex/application';
    const app = createMyanLexApplication();
    assert.equal(app.detectText({ text: 'မြန်မာ' }).encoding, 'unicode');
    assert.equal(app.convertText({ text: 'ျမန္မာ', from: 'zawgyi', to: 'unicode', validateSource: true }).output, 'မြန်မာ');
    assert.throws(() => app.detectText({ text: '\\ud800' }), { code: 'invalid_unicode' });
    assert.throws(() => app.detectText({ text: 'x'.repeat(100001) }), { code: 'text_too_long' });
    console.log('Isolated installed application consumer passed.');
  `,
  );
  execFileSync(
    "node",
    ["--permission", "--allow-fs-read=" + dir, join(dir, "smoke.mjs")],
    { cwd: dir, stdio: "inherit", env: { ...process.env, NODE_PATH: "" } },
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
