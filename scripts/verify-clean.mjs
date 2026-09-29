import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = realpathSync(mkdtempSync(join(tmpdir(), "mdr-clean-")));
const project = join(temp, "project");
mkdirSync(project);
console.log("Clean uncommitted source snapshot:", project);
try {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  for (const file of new Set(files)) {
    const destination = join(project, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, file), destination);
  }
  for (const args of [
    ["install", "--frozen-lockfile", "--store-dir", join(temp, ".fresh-store")],
    ["format:check"],
    ["check"],
    ["test:browser"],
    ["test:production"],
  ])
    execFileSync("pnpm", args, {
      cwd: project,
      stdio: "inherit",
      env: { ...process.env, NODE_PATH: "" },
    });
  console.log(
    "Clean snapshot passed without node_modules, dist, generated types, shared package store or sibling repository.",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
