#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${1:?Usage: bash scripts/package-hardware.sh /path/to/pinned-upstream}"
REVISION=$(node -e 'console.log(require(process.argv[1]).targets.find(target => target.id === "ns2jb-smilebasic").upstream.last_known_commit)' "$ROOT/config/targets.json")
test "$(git -C "$SOURCE" rev-parse HEAD)" = "$REVISION" || { echo 'Upstream HEAD does not match configured pin' >&2; exit 1; }
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
mkdir "$SCRATCH/ns2jb"
git -C "$SOURCE" archive "$REVISION" | tar -xf - -C "$SCRATCH/ns2jb"
node - "$SCRATCH/ns2jb" "$REVISION" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [root, revision] = process.argv.slice(2);
for (const line of fs.readFileSync(path.join(root, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match) throw Error('Malformed checksum entry');
  const [, expected, name] = match;
  if (path.isAbsolute(name) || name.split('/').includes('..')) throw Error('Unsafe checksum path');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
  const reviewedReadme = revision === '95f5525089273c5fce0b95047f3600f8442e96ae' &&
    name === 'README.md' && expected === '39aa0e490fa0dc2009a4f3c63ee4cc597982a4bbf0c29443186e1c3ac09babbf' &&
    actual === 'cb0ce047b522ef445bef68ca96c39b41d2ec606586a00d3187f0ff6725490af4';
  if (actual !== expected && !reviewedReadme) throw Error(`Checksum mismatch: ${name}`);
}
const payload = fs.readFileSync(path.join(root, 'engine/switch2/ro/payload/main'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'engine/switch2/ro/payload/manifest.json')));
if (crypto.createHash('sha256').update(payload).digest('hex') !== manifest.payloadSha256 ||
    payload.subarray(0, 4).toString() !== 'NSO0') throw Error('Invalid payload');
console.log('Pinned archive checksum policy and native payload verified.');
JS
test -s "$SCRATCH/ns2jb/engine/switch2/ro/payload/main"
mkdir -p "$ROOT/site/downloads"
git -C "$SOURCE" archive --format=tar --prefix=ns2jb/ "$REVISION" > "$SCRATCH/source.tar"
node - "$SCRATCH/source.tar" "$ROOT/site/downloads" "$REVISION" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const [source, destination, revision] = process.argv.slice(2);
const name = `ns2jb-${revision}.tar.gz`;
const bytes = zlib.gzipSync(fs.readFileSync(source), { level: 9 });
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(destination, name), bytes);
fs.writeFileSync(path.join(destination, 'SHA256SUMS'), `${digest}  ${name}\n`);
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({
  revision, archive: name, sha256: digest, bytes: bytes.length,
  route: 'SmileBASIC 4.4.9 + Node.js host; not browser-executable',
  hardwareValidatedByWorkspace: false,
  checksumException: 'Upstream README.md has the exact reviewed mismatch documented in docs/security-review.md; all other manifest entries must match.',
}, null, 2) + '\n');
JS
