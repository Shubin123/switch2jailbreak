const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const packageRelease = require('../scripts/package-release.cjs');

function fixture(check) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-fixture-'));
  const root = path.join(directory, 'source');
  fs.mkdirSync(root);
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    fs.writeFileSync(path.join(root, 'README.md'), 'reproducible fixture\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'private-data\n');
    fs.writeFileSync(path.join(root, 'private-data'), 'must never be published\n');
    git(['add', '.']);
    git(['commit', '-qm', 'Fixture source']);
    check(root, directory, git);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('release archives and manifests reproduce byte-for-byte from one clean commit', () => fixture((root, directory, git) => {
  const first = path.join(directory, 'first');
  const second = path.join(directory, 'second');
  const manifest = packageRelease(root, first);
  assert.deepEqual(packageRelease(root, second), manifest);
  assert.equal(manifest.source_revision, git(['rev-parse', 'HEAD']));
  for (const filename of [manifest.archive, 'release-manifest.json', 'SHA256SUMS']) {
    assert.deepEqual(fs.readFileSync(path.join(first, filename)), fs.readFileSync(path.join(second, filename)));
  }
  const archive = path.join(first, manifest.archive);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), manifest.archive_sha256);
  const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' });
  assert.match(entries, /switch2jailbreak\/README.md/);
  assert.doesNotMatch(entries, /private-data|\.git\//);
  assert.throws(() => packageRelease(root, first), /Refusing to overwrite/);
}));

test('release packaging refuses modified and untracked source files', () => fixture((root, directory) => {
  fs.appendFileSync(path.join(root, 'README.md'), 'not committed\n');
  assert.throws(() => packageRelease(root, path.join(directory, 'modified')), /clean working tree/);
  fs.writeFileSync(path.join(root, 'README.md'), 'reproducible fixture\n');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'not committed\n');
  assert.throws(() => packageRelease(root, path.join(directory, 'untracked')), /clean working tree/);
}));
