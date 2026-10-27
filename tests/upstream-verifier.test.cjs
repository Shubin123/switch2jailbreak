const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function verifyFixture(change = () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-verifier-'));
  try {
    const source = path.join(directory, 'source');
    const workspace = path.join(directory, 'workspace');
    const bin = path.join(directory, 'bin');
    fs.mkdirSync(path.join(source, 'engine/switch2/ro/payload'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'config'));
    fs.mkdirSync(bin);
    fs.copyFileSync(path.join(__dirname, '../scripts/verify-upstream.sh'), path.join(workspace, 'scripts/verify-upstream.sh'));
    fs.copyFileSync(path.join(__dirname, '../config/targets.json'), path.join(workspace, 'config/targets.json'));
    fs.writeFileSync(path.join(source, 'README.md'), 'fixture documentation\n');
    fs.writeFileSync(path.join(source, 'test.cjs'), "require('node:test')('fixture passes', () => {});\n");
    fs.writeFileSync(path.join(source, 'engine/build-payload.cjs'), 'process.exit(0);\n');
    const payload = Buffer.from('NSO0fixture');
    fs.writeFileSync(path.join(source, 'engine/switch2/ro/payload/main'), payload);
    fs.writeFileSync(path.join(source, 'engine/switch2/ro/payload/manifest.json'), JSON.stringify({
      payloadSha256: crypto.createHash('sha256').update(payload).digest('hex'),
    }));
    const files = ['README.md', 'test.cjs', 'engine/build-payload.cjs',
      'engine/switch2/ro/payload/main', 'engine/switch2/ro/payload/manifest.json'];
    fs.writeFileSync(path.join(source, 'SHA256SUMS'), files.map(filename =>
      `${crypto.createHash('sha256').update(fs.readFileSync(path.join(source, filename))).digest('hex')}  ${filename}\n`).join(''));
    fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'init') fs.cpSync(process.env.FIXTURE_SOURCE, args.at(-1), { recursive: true });
else if (args[0] === 'rev-parse') console.log('95f5525089273c5fce0b95047f3600f8442e96ae');
else if (args[0] !== '-C') process.exit(2);
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'zig'), '#!/bin/sh\nprintf "0.15.2\\n"\n', { mode: 0o755 });
    change(source, bin);
    return spawnSync('bash', [path.join(workspace, 'scripts/verify-upstream.sh')], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, FIXTURE_SOURCE: source, REQUIRE_REBUILD: '1', PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('upstream verifier accepts matching files and successful tests', () => {
  const result = verifyFixture();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /8 pass, 0 fail, 0 skip/);
});

test('upstream verifier fails when the test process fails', () => {
  const result = verifyFixture(source => fs.appendFileSync(path.join(source, 'test.cjs'), 'process.exitCode = 1;\n'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[FAIL\] Upstream tests/);
});

test('upstream verifier rejects an unreviewed README mismatch', () => {
  const result = verifyFixture(source => fs.appendFileSync(path.join(source, 'README.md'), 'unreviewed change\n'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[FAIL\] SHA256 checksums/);
});

test('upstream verifier rejects missing checksummed files', () => {
  const result = verifyFixture(source => fs.unlinkSync(path.join(source, 'README.md')));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[FAIL\] SHA256 checksums/);
});

test('upstream verifier rejects a missing checksum manifest', () => {
  const result = verifyFixture(source => fs.unlinkSync(path.join(source, 'SHA256SUMS')));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /SHA256SUMS file not found/);
});

test('upstream verifier rejects a missing payload', () => {
  const result = verifyFixture(source => fs.unlinkSync(path.join(source, 'engine/switch2/ro/payload/main')));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[FAIL\] Payload binary matches manifest/);
});

test('upstream verifier rejects a failed payload rebuild', () => {
  const result = verifyFixture(source => fs.writeFileSync(path.join(source, 'engine/build-payload.cjs'), 'process.exit(1);\n'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[FAIL\] Payload rebuild matches shipped binary/);
});
