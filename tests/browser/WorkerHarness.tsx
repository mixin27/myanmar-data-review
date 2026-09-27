import { useEffect, useRef, useState } from "react";
import { createLocalWorkerClient } from "../../src/processing/browser-client";
import { LocalProcessingError } from "../../src/processing/worker-client";
import type { ProcessingResult } from "../../src/processing/contracts";
import { engineBuild } from "../../src/generated/engine-build";

export function WorkerHarness() {
  const [text, setText] = useState("");
  const [convert, setConvert] = useState(false);
  const [normalize, setNormalize] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const revision = useRef(0);
  const client = useRef<ReturnType<typeof createLocalWorkerClient> | null>(
    null,
  );

  useEffect(() => {
    const current = createLocalWorkerClient();
    client.current = current;
    return () => {
      revision.current++;
      current.cancel();
      client.current = null;
    };
  }, []);

  function invalidate() {
    revision.current++;
    client.current?.cancel();
    setResult(null);
    setRunning(false);
    setStatus("Ready");
  }

  async function run() {
    const current = client.current;
    if (!current) return;
    const runRevision = ++revision.current;
    setRunning(true);
    setResult(null);
    setStatus("Processing locally");
    try {
      const next = await current.execute(
        { text, convertToUnicode: convert, normalizeNfc: normalize },
        runRevision,
      );
      if (revision.current !== runRevision) return;
      setResult(next);
      setStatus(
        next.unresolvedReason
          ? "Completed — unresolved text retained"
          : "Completed",
      );
    } catch (error) {
      if (revision.current !== runRevision) return;
      setStatus(
        error instanceof LocalProcessingError
          ? `${error.code}: ${error.message}`
          : "Local processing failed",
      );
    } finally {
      if (revision.current === runRevision) setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <p className="eyebrow">Milestone 1 · Integration screen</p>
        <h1>Myanmar Data Review</h1>
        <p>
          Inspect text locally in a dedicated worker. Nothing you enter is
          uploaded or saved.
        </p>
      </header>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label htmlFor="input">Text to inspect</label>
        <textarea
          id="input"
          value={text}
          rows={7}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            invalidate();
            setText(event.target.value);
          }}
        />
        <label className="option">
          <input
            type="checkbox"
            checked={convert}
            onChange={(event) => {
              invalidate();
              setConvert(event.target.checked);
            }}
          />
          Propose guarded conversion to Unicode
        </label>
        <label className="option">
          <input
            type="checkbox"
            checked={normalize}
            onChange={(event) => {
              invalidate();
              setNormalize(event.target.checked);
            }}
          />
          Apply NFC when Unicode processing is appropriate
        </label>
        <div className="flex gap-3">
          <button type="submit" disabled={running}>
            Run locally
          </button>
          <button
            type="button"
            disabled={!running}
            onClick={() => {
              revision.current++;
              client.current?.cancel();
              setRunning(false);
              setStatus("Cancelled");
            }}
          >
            Cancel
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {result && (
        <section className="space-y-3" aria-label="Processing result">
          <h2>Result</h2>
          <p>Encoding evidence: {result.detection.encoding}</p>
          {result.unresolvedReason && (
            <p>Unresolved: {result.unresolvedReason}. Original retained.</p>
          )}
          <label htmlFor="output">
            Output preview — not an approved change
          </label>
          <textarea id="output" value={result.output} readOnly rows={5} />
          <details>
            <summary>Integration diagnostics</summary>
            <pre data-testid="result-json">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
          <p>
            Detection and structural checks do not establish linguistic
            correctness. Offsets refer to code points in each result’s input.
          </p>
        </section>
      )}
      <footer>
        <p>
          Local engine {engineBuild.upstreamCommit.slice(0, 12)} · Unsaved
          memory only
        </p>
        <p>
          <a href="/licenses/MyanLex-MIT.txt">MyanLex license</a> ·{" "}
          <a href="/licenses/MyanLex-THIRD_PARTY_NOTICES.md">
            Third-party notices
          </a>{" "}
          · <a href="/licenses/Apache-2.0.txt">Apache-2.0</a>
        </p>
      </footer>
    </main>
  );
}
