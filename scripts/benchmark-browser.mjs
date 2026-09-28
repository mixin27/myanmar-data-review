import { spawn, execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setInterval, clearInterval } from "node:timers";

// A sampled process-tree RSS sum includes shared pages more than once and misses
// peaks between samples. This measures the test runner and its browser children,
// not just JavaScript heap. Never treat it as a device capacity guarantee.
if (!["darwin", "linux"].includes(process.platform)) {
  throw new Error("Process-tree sampling currently supports macOS and Linux.");
}
const started = performance.now();
const run = spawn(
  "pnpm",
  [
    "exec",
    "playwright",
    "test",
    "--project=chromium",
    "--grep",
    "large imports keep|10,000 selected cells finish",
  ],
  { stdio: "inherit" },
);
let peakKiB = 0;
let samples = 0;
let sampling = false;
let samplingFailed = false;
const sample = () => {
  if (sampling) return;
  sampling = true;
  execFile("ps", ["-axo", "pid=,ppid=,rss="], (error, stdout) => {
    sampling = false;
    if (error) {
      samplingFailed = true;
      return;
    }
    const rows = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    const descendants = new Set([run.pid]);
    let added;
    do {
      added = false;
      for (const [pid, parent] of rows) {
        if (descendants.has(parent) && !descendants.has(pid)) {
          descendants.add(pid);
          added = true;
        }
      }
    } while (added);
    const rss = rows.reduce(
      (total, [pid, , memory]) => total + (descendants.has(pid) ? memory : 0),
      0,
    );
    peakKiB = Math.max(peakKiB, rss);
    samples++;
  });
};
const timer = setInterval(sample, 100);
sample();
run.on("error", (error) => {
  clearInterval(timer);
  console.error(error.message);
  process.exitCode = 1;
});
run.on("exit", (code) => {
  clearInterval(timer);
  console.log(
    JSON.stringify({
      platform: process.platform,
      architecture: process.arch,
      elapsedMs: Math.round(performance.now() - started),
      samples,
      samplingFailed,
      sampledProcessTreeRssMiB: Math.round(peakKiB / 1024),
      note: "Runner plus browser descendants; shared pages double-counted; 100ms sampling can miss peaks. Not a capacity guarantee.",
    }),
  );
  process.exitCode =
    code === null ? 1 : code || (samplingFailed || !samples ? 1 : 0);
});
