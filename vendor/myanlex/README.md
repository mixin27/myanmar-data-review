# Reproducible MyanLex integration

Pinned upstream commit: `51d8d6353d7f08fe389e046fac4c5953a70de33b`.
Consumer package version: `0.0.0-mdr.51d8d6353d7f`.

`manifest.json` records SHA-256 and byte size for every archive, original package
source tree IDs, compiler version, packaging-recipe checksum, compiler overlay,
and license hashes. The generated `engineBuild.buildId` is SHA-256 of this manifest.
Each archive also contains `BUILD_IDENTITY.json` and full notices/licenses.
These are private integration artifacts, not published upstream package releases.

The source algorithms are unchanged. The packaging overlay changes only package
version/dependency metadata, removes development scripts/dependencies, and emits
JavaScript plus declarations with source/declaration maps disabled. It removes
unused Node ambient types from the build. No unrelated source trees are shipped.

`pnpm-workspace.yaml` overrides **all three** MyanLex packages to these archives;
this resolves the exact inter-package prerelease dependencies without a registry.
The root manifest and frozen lockfile also pin them. A consumer must carry the
whole archive set and these overrides; `pnpm pack` alone cannot resolve unpublished
transitive versions. The regular build/install never reads `../myanlex`.

## Rebuild for verification

With this project's pinned dependencies installed and Python 3.12 available:

```sh
python3 scripts/package-myanlex.py /path/to/read-only/myanlex
pnpm verify:artifacts
pnpm test:consumer
```

The source path is an explicit maintainer input only. The script reads immutable
Git objects from the pinned commit into a temporary directory, builds types/core/
application in dependency order with this project's TypeScript 6.0.3, creates
sorted USTAR archives (zero IDs/timestamps), and gzip-compresses with a zero time.
It refuses to overwrite an existing archive identity with different bytes.
It never runs upstream install scripts or writes into the upstream checkout.

Initial builds and repeat verification used Node 24.21.0, TypeScript 6.0.3,
Python 3.12.12 on macOS ARM64. Byte-identical repeat builds were checked on that
host. Cross-platform archive regeneration has not been verified; CI consumes
and verifies the checked-in bytes instead of rebuilding from sibling sources.
Future packaging/toolchain changes need a new artifact identity and reviewed
manifest/lockfile updates. Do not edit archive bytes in place.

## Licenses and fixtures

The upstream MIT license and third-party notices are copied unchanged from the
pinned commit. Full Apache-2.0 text was obtained from
[Apache](https://www.apache.org/licenses/LICENSE-2.0.txt). The core detector/model
and conversion rules are adapted upstream from Google Myanmar Tools and retain
Apache-2.0. No Rabbit corpus is included in the archives; the upstream notice is
retained in full. Test fixture provenance is recorded in `tests/fixtures/README.md`.
No upstream modifications were necessary for this milestone.
