# Portable hosting on DigitalOcean or AWS EC2

The existing Vercel deployment is unchanged. These files prepare an alternative;
no instance, DNS change, image publication or deployment has been performed.
Both providers run the same static Caddy image. Text processing and project saves
stay in the browser. No MyanLex API, sign-in, database or server document storage.

## What is packaged

`pnpm container:prepare` builds the pinned Vite application, verifies worker/license
boundaries, then creates a generated `.container/` directory. Only `index.html`,
compiled assets and license notices enter the web root. Source, environment files,
Git metadata, test pages, the build manifest and user CSVs are excluded.
`release-manifest.json` outside the web root records SHA-256 checksums of the context.
Caddy headers are generated from `headers.json` to avoid policy drift.

The runtime is official Caddy 2.11.4-alpine pinned to the multi-platform image index
`sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b`.
The image runs as UID/GID 10001, with a read-only root filesystem and limited
capabilities/resources. The production `/data` volume stores TLS account keys and
certificates only; protect it and do not delete it during routine updates. The
local configuration uses temporary `/data`. Request access logging is not enabled;
Caddy operational logs remain and Docker rotates them in production.

Build artifacts are reproducibly pinned, but dependencies/images still require
periodic security review and updates. The image has not been vulnerability-audited. Run `pnpm test:container-package`
to verify package isolation, checksums, old-asset retention and collision rejection.

## Try locally

With Docker Engine/Desktop and Compose available, from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm container:prepare
docker compose -f compose.local.yaml up -d --build --wait
pnpm test:container
```

Open `http://127.0.0.1:4175`. This is the actual container, not Vite's preview
server. `pnpm test:container` checks missing/private paths, blocked POSTs, worker
headers and browser workflows. It keeps all three browser engines enabled. On the
currently blocked macOS Firefox environment, explicitly use
`pnpm test:container --project=chromium --project=webkit` for partial verification.

Stop local resources with:

```sh
docker compose -f compose.local.yaml down
```

The two Compose files are standalone alternatives. Do not combine them: the local
file publishes loopback port 4175 only; `compose.yaml` publishes public HTTP/HTTPS.

## Prepare a server release (no registry required)

Use an immutable release name rather than reusing `latest`. The following commands
are examples to run only when ready; replace `RELEASE_ID` with your own release ID.
On Apple Silicon, choose the target architecture explicitly. Typical x86 Droplets
and EC2 use `linux/amd64`; AWS Graviton uses `linux/arm64`.

```sh
pnpm container:prepare
docker build --platform linux/amd64 -t myanmar-data-review:RELEASE_ID .container
docker image save -o /tmp/myanmar-data-review-RELEASE_ID.tar myanmar-data-review:RELEASE_ID
```

Transfer the image archive, `compose.yaml`, `deployment/server.env.example`, and the
release manifest to the server using your normal secure deployment process. Keep
checksums with the archive and verify them after transfer. The server needs only
Docker Engine with Compose, not Node/pnpm or the private repository. Install Docker
using its [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/)
on a supported Ubuntu image. Restrict Docker administration to trusted operators.

On the server, after separately approving deployment:

```sh
docker image load -i myanmar-data-review-RELEASE_ID.tar
cp server.env.example .server.env
```

Edit `.server.env` to set the actual bare hostname (no scheme, path, wildcard or
port) and matching image tag:

```dotenv
MDR_DOMAIN=review.example.com
MDR_IMAGE=myanmar-data-review:RELEASE_ID
```

Point that hostname to the instance IP. Publish an AAAA record only if IPv6 routes
and firewall rules work. Then:

```sh
docker compose --env-file .server.env config
docker compose --env-file .server.env up -d --wait
docker compose --env-file .server.env ps
docker compose --env-file .server.env logs --tail 50
```

Caddy automatically obtains and renews TLS certificates and redirects HTTP to HTTPS
when the domain resolves and ports 80/443 are reachable. Certificate issuance is
not tested by loopback HTTP checks. The private health listener is internal on
127.0.0.1:9090 and is not published. Automatic container restart is enabled, but
Docker health status alone does not restart an unhealthy process; monitor it.
The 256 MiB container limit concerns the static server, not users' browser memory.

## Provider differences

|                  | DigitalOcean Droplet                                             | AWS EC2                                                                                             |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Address          | Use a stable public address; a Reserved IP eases future moves    | Use an Elastic IP when the address must survive stop/start                                          |
| Network firewall | Attach a Cloud Firewall to the Droplet                           | Attach an appropriate security group to the instance                                                |
| Inbound          | TCP 80/443 from visitors; SSH 22 only from your administrator IP | TCP 80/443 from visitors; SSH 22 only from your administrator IP, or use configured Session Manager |
| Outbound         | Allow DNS and HTTPS for certificate authorities and maintenance  | Allow DNS and HTTPS for certificate authorities and maintenance                                     |
| Administration   | Maintain OS/Docker updates and backups                           | Maintain OS/Docker updates and backups; use least-privilege instance IAM if needed                  |

Do not expose 4175, 8080, 9090, Docker's socket/API or Caddy administration to the
internet. Configure IPv6 rules too if enabled. Review Docker-published ports against
both the host and provider firewall; do not assume a host firewall alone covers them.
No load balancer, Kubernetes, managed database or cloud API credentials are needed
for this single-server setup. High availability is separate work.

## Moving from Vercel

Leave Vercel running while testing a temporary hostname on the new server. Verify
HTTPS, security headers, workers, import/inspection, downloads, save/reopen and backup
restore on that actual hostname before switching DNS. No existing Vercel configuration
has been changed or audited by this task.

Browser saves belong to the origin: scheme, hostname and port. If the same custom
HTTPS hostname moves from Vercel to the server, browser storage remains associated
with that origin. A move from `*.vercel.app` to another domain is a different origin:
download a backup on the old site, open it on the new site, and save explicitly.
Do not delete the old deployment until users have a migration path. Keep the same
app/storage schema during the hosting move; do not combine it with incompatible data
migrations. There is no server-side project database to transfer.

## Updates and rollback

Keep the previous image and source release artifacts. Open tabs may load old workers
later; retain old fingerprinted assets in the next image:

```sh
pnpm container:prepare --previous /path/to/previous/dist
```

Use the previous generated `.container/site` archive as the previous directory if it
already contains assets retained from older releases. Copy only regular fingerprinted
JS/CSS files; conflicting bytes under the same name are rejected. Never put the previous
release inside `.container`, which is regenerated on every prepare. Archive the new
site directory outside `.container` before preparing a later release.

Build a new immutable image, transfer it, update `MDR_IMAGE`, and run Compose `up`.
Single-container replacement may briefly interrupt static requests. To roll back,
restore the previous image tag and run `up` again. Keep `/data` across both actions;
never use `down -v` as a normal update. Browser schema rollback compatibility must
still be checked. Back up `/data` securely; TLS private keys must not enter Git or
public artifacts. Do not use `Clear-Site-Data` or clear users' browser storage.

## Evidence and open requirements

Local checks do not prove cloud networking, real-domain ACME issuance, Vercel parity,
CDN behavior, provider costs or high availability. Consult PRODUCT_PLAN.md for exact
executed results. Firefox, screen readers, shipping Safari/iOS, physical low-memory
devices, independent operators and hosted CI remain outstanding unless explicitly
verified. No deployment or production-readiness claim is implied.

References: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[Caddy file server](https://caddyserver.com/docs/caddyfile/directives/file_server),
[Docker Compose production](https://docs.docker.com/compose/how-tos/production/),
[DigitalOcean firewall rules](https://docs.digitalocean.com/products/networking/firewalls/how-to/configure-rules/),
[AWS security-group rules](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html).
