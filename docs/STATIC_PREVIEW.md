# Preparing a local-only static preview

This is a hosting handoff, not authorization to publish. The app needs static
HTTPS hosting only; no accounts, processing API, database server or secrets.
Firefox, independent user testing, screen readers, shipping Safari/iOS, physical
low-memory devices and hosted CI remain outstanding. Call an early release a
preview and state known limitations; passing tests is not release approval.

## Build and test locally

Use the pinned Node/pnpm versions from `.nvmrc` and `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium firefox webkit
pnpm test:browser
pnpm test:production
pnpm preview:secure --port 4174
```

Open `http://127.0.0.1:4174`. `preview:secure` previews `dist/` with the proposed
headers and cache rules; it does not build, deploy or provide a production server.
The full test commands keep Firefox enabled. On the currently blocked macOS
machine, an explicit partial check is
`pnpm test:production --project=chromium --project=webkit`; it is not full coverage.

## Static host requirements

- Serve the complete `dist/` at the origin root over HTTPS, including worker assets
  and `licenses/`. Never upload source, `.env`, `node_modules`, test outputs or user
  files. Do not use a shared origin with unrelated untrusted applications.
- Apply every header in `deployment/headers.json` to HTML and assets, especially
  worker JavaScript. The policy intentionally has `connect-src 'none'`: local
  processing has no fetch/XHR/WebSocket dependency. Worker loading is same-origin.
  Allow no inline scripts, eval, arbitrary frames, analytics or injected widgets.
- HTML and non-fingerprinted resources: `Cache-Control: no-cache`. Fingerprinted
  `/assets/*-HASH.js` and `.css`: `public, max-age=31536000, immutable`. Never serve
  stale HTML indefinitely or rewrite missing worker/JS requests to HTML.
- Send correct JavaScript/CSS MIME types. Serve missing assets as 404 and do not
  expose directory listings. `nosniff` is intentional.
- Add HSTS only once the actual HTTPS domain and certificate renewal are confirmed;
  do not preload or include subdomains without reviewing every affected hostname.
- Disable request-body logging, analytics and automatic error uploads. Ordinary
  static-host access logs may contain IP addresses and asset paths; explain host
  retention before public use. Never add text to URLs or CSP report uploads.

Vite preview settings are not embedded in `dist/`. The deployment operator must
configure equivalent headers/cache behavior on the chosen host and verify its real
responses. The JSON policy is host-neutral; no provider configuration is implied.
The CSP is defense in depth, not a promise against a compromised host or browser.

## Updates and recovery

Publish assets before the new HTML, and retain prior fingerprinted assets while
old tabs may remain open; workers are loaded on demand. Prefer versioned/atomic
releases and retain a rollback build. Never overwrite an existing fingerprint with
different bytes. Before updates involving storage schemas, test forward migration
and document rollback compatibility: an older app may refuse a newer database.

Device saves belong to one origin/browser profile. Changing domain, port or browser
does not move them. Download a backup before moving; import and explicitly save it
at the new origin. Do not send `Clear-Site-Data` as an update mechanism. Backups may
contain private text and should not be uploaded as deployment artifacts.

After a separately authorized deployment, check the actual HTTPS origin for asset
MIME/headers, all three worker loads, inspection, original/reviewed downloads,
explicit save/reopen and backups. Local tests do not verify a CDN or TLS setup.
Offline reload/PWA behavior is not implemented or promised.

References: [Vite static deployment](https://vite.dev/guide/static-deploy),
[MDN worker CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src),
[MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy).
