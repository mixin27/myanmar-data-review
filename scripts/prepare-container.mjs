import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, "..");
const staging = join(root, ".container");
execFileSync(process.execPath, ["scripts/verify-bundle.mjs"], {
  cwd: root,
  stdio: "inherit",
});
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--previous"))
  throw Error(
    "Usage: pnpm container:prepare [--previous /path/to/previous/dist]",
  );
const previous = args[1] ? resolve(args[1]) : null;
if (previous && (previous === staging || previous.startsWith(staging + "/")))
  throw Error("Previous release must be outside generated .container staging.");
// This directory is generated output only; never include source or local env files.
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, "site"), { recursive: true });
for (const name of ["index.html", "assets", "licenses"])
  cpSync(join(root, "dist", name), join(staging, "site", name), {
    recursive: true,
  });
if (previous) {
  for (const entry of readdirSync(join(previous, "assets"), {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/^[\w.-]+-[\w-]+\.(js|css)$/.test(entry.name))
      throw Error(
        "Unexpected previous asset; only regular fingerprinted JS/CSS files are allowed.",
      );
    const source = readFileSync(join(previous, "assets", entry.name));
    const target = join(staging, "site", "assets", entry.name);
    if (existsSync(target) && !source.equals(readFileSync(target)))
      throw Error("Fingerprint collision between releases.");
    writeFileSync(target, source);
  }
}
const headers = JSON.parse(
  readFileSync(join(root, "deployment/headers.json"), "utf8"),
);
const block =
  "header {\n" +
  Object.entries(headers)
    .map(([name, value]) => `\t\t${name} ${JSON.stringify(value)}`)
    .join("\n") +
  "\n\t}";
const template = readFileSync(
  join(root, "deployment/Caddyfile.template"),
  "utf8",
);
writeFileSync(
  join(staging, "Caddyfile"),
  template.replace("__HEADERS__", block),
);
cpSync(join(root, "deployment/Dockerfile"), join(staging, "Dockerfile"));
writeFileSync(
  join(staging, ".dockerignore"),
  "**\n!Dockerfile\n!Caddyfile\n!site/\n!site/**\n",
);
const files = {};
function inventory(directory, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      inventory(join(directory, entry.name), relative + "/");
    else
      files[relative] = createHash("sha256")
        .update(readFileSync(join(directory, entry.name)))
        .digest("hex");
  }
}
inventory(staging);
writeFileSync(
  join(staging, "release-manifest.json"),
  JSON.stringify({ format: 1, files }, null, 2) + "\n",
);
console.log(
  "Prepared isolated Docker context in .container; release-manifest.json records SHA-256 contents.",
);
