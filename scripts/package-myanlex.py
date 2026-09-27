#!/usr/bin/env python3
"""Build pinned MyanLex archives from read-only Git objects, never its checkout."""
import gzip
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMMIT = '51d8d6353d7f08fe389e046fac4c5953a70de33b'
VERSION = '0.0.0-mdr.' + COMMIT[:12]
PACKAGES = ['types', 'core', 'application']


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/package-myanlex.py /path/to/read-only/myanlex')
    repo = pathlib.Path(sys.argv[1]).resolve()
    def git(*args):
        return run('git', '-C', str(repo), *args)
    if git('rev-parse', COMMIT).decode().strip() != COMMIT:
        raise SystemExit('Pinned commit unavailable')
    tsc = ROOT / 'node_modules/typescript/bin/tsc'
    compiler = run('node', str(tsc), '--version').decode().strip()
    if compiler != 'Version 6.0.3':
        raise SystemExit('Artifact compiler must be TypeScript 6.0.3')
    identity = {
        'schemaVersion': 1, 'upstreamCommit': COMMIT,
        'packageVersion': VERSION, 'compiler': compiler,
        'recipe': 'scripts/package-myanlex.py',
        'recipeSha256': sha(pathlib.Path(__file__).read_bytes()),
        'compilerOverlay': {'types': [], 'sourceMap': False, 'declarationMap': False},
        'archive': 'sorted USTAR, uid/gid/mtime=0, gzip mtime=0, level=9',
    }
    output = ROOT / 'vendor/myanlex'
    output.mkdir(parents=True, exist_ok=True)
    notices = ROOT / 'public/licenses'
    notices.mkdir(parents=True, exist_ok=True)
    (notices / 'MyanLex-MIT.txt').write_bytes(git('show', COMMIT + ':LICENSE'))
    (notices / 'MyanLex-THIRD_PARTY_NOTICES.md').write_bytes(git('show', COMMIT + ':THIRD_PARTY_NOTICES.md'))
    apache = (notices / 'Apache-2.0.txt').read_bytes()
    artifacts = []
    with tempfile.TemporaryDirectory(prefix='mdr-myanlex-build-') as temp:
        stage = pathlib.Path(temp)
        (stage / 'tsconfig.base.json').write_bytes(git('show', COMMIT + ':tsconfig.base.json'))
        (stage / 'node_modules/@myanlex').mkdir(parents=True)
        for name in PACKAGES:
            prefix = 'packages/' + name + '/'
            files = git('ls-tree', '-r', '--name-only', COMMIT, prefix).decode().splitlines()
            for file in files:
                if '/src/' not in file and file != prefix + 'package.json':
                    continue
                dest = stage / file
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(git('show', COMMIT + ':' + file))
            package = stage / prefix
            meta = json.loads((package / 'package.json').read_text())
            meta['version'] = VERSION
            meta.pop('scripts', None)
            meta.pop('devDependencies', None)
            meta['files'] = ['dist', 'LICENSE', 'Apache-2.0.txt', 'THIRD_PARTY_NOTICES.md', 'BUILD_IDENTITY.json']
            if 'dependencies' in meta:
                meta['dependencies'] = {key: VERSION for key in meta['dependencies']}
            write_json(package / 'package.json', meta)
            write_json(package / 'tsconfig.build.json', {
                'extends': '../../tsconfig.base.json',
                'compilerOptions': {'rootDir': 'src', 'outDir': 'dist', 'types': [],
                                    'sourceMap': False, 'declarationMap': False},
                'include': ['src/**/*.ts'],
            })
            (stage / 'node_modules/@myanlex' / name).symlink_to(package, target_is_directory=True)
        for name in PACKAGES:
            package = stage / 'packages' / name
            subprocess.run(['node', str(tsc), '-p', str(package / 'tsconfig.build.json')], check=True)
            (package / 'LICENSE').write_bytes((notices / 'MyanLex-MIT.txt').read_bytes())
            (package / 'Apache-2.0.txt').write_bytes(apache)
            (package / 'THIRD_PARTY_NOTICES.md').write_bytes((notices / 'MyanLex-THIRD_PARTY_NOTICES.md').read_bytes())
            write_json(package / 'BUILD_IDENTITY.json', identity)
            entries = [p for p in package.rglob('*') if p.is_file() and
                       (p.relative_to(package).parts[0] == 'dist' or p.name in
                        ['package.json', 'LICENSE', 'Apache-2.0.txt', 'THIRD_PARTY_NOTICES.md', 'BUILD_IDENTITY.json'])]
            tar_bytes = io.BytesIO()
            with tarfile.open(fileobj=tar_bytes, mode='w', format=tarfile.USTAR_FORMAT) as archive:
                for path in sorted(entries):
                    data = path.read_bytes()
                    info = tarfile.TarInfo('package/' + path.relative_to(package).as_posix())
                    info.size = len(data)
                    info.mode = 0o644
                    archive.addfile(info, io.BytesIO(data))
            compressed = io.BytesIO()
            with gzip.GzipFile(filename='', mode='wb', fileobj=compressed, mtime=0, compresslevel=9) as stream:
                stream.write(tar_bytes.getvalue())
            data = compressed.getvalue()
            filename = f'myanlex-{name}-{VERSION}.tgz'
            target = output / filename
            if target.exists() and target.read_bytes() != data:
                raise SystemExit('Refusing to overwrite immutable archive: ' + filename)
            target.write_bytes(data)
            artifacts.append({'name': '@myanlex/' + name, 'version': VERSION, 'file': filename,
                              'sha256': sha(data), 'bytes': len(data),
                              'sourceTree': git('rev-parse', COMMIT + ':packages/' + name).decode().strip()})
    write_json(output / 'manifest.json', {
        **identity, 'artifacts': artifacts,
        'licenses': {p.name: sha(p.read_bytes()) for p in sorted(notices.iterdir()) if p.is_file()},
    })
    print('Built and verified immutable archives for ' + COMMIT)


if __name__ == '__main__':
    main()
