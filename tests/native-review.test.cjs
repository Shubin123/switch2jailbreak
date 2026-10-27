const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { sourceFiles, elfFixture, validateImage, inspectSource, reviewNative } = require('../scripts/review-native.cjs');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = image => ({ payloadBytes: image.length, payloadSha256: hash(image) });

function imageFixture() {
  const image = Buffer.alloc(0x110 + 12);
  image.write('NSO0');
  image.writeUInt32LE(0x78, 12);
  image.write('main', 0x100);
  for (let index = 0; index < 3; index += 1) {
    const offset = 0x110 + index * 4;
    image.fill(index + 1, offset, offset + 4);
    image.writeUInt32LE(offset, 0x10 + index * 16);
    image.writeUInt32LE(index * 4096, 0x14 + index * 16);
    image.writeUInt32LE(4, 0x18 + index * 16);
    image.writeUInt32LE(4, 0x60 + index * 4);
    crypto.createHash('sha256').update(image.subarray(offset, offset + 4)).digest().copy(image, 0xa0 + index * 32);
  }
  crypto.createHash('sha256').update(image.subarray(0x110)).digest().copy(image, 0x40);
  return image;
}

test('native image validator accepts bounded synthetic data segments', () => {
  const image = imageFixture();
  const segments = validateImage(image, manifest(image));
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map(segment => segment.bytes), [4, 4, 4]);
  const elf = elfFixture();
  assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46');
  assert.equal(elf.readUInt16LE(60), 5);
});

test('native audit refuses an unreviewed revision before reading or importing it', async () => {
  await assert.rejects(reviewNative('/nonexistent-upstream-checkout', 'f'.repeat(40)), /No recorded static review/);
});

test('native image validation checks inner structure even when outer manifest is recomputed', () => {
  for (const [change, expected] of [
    [image => { image[0] = 0; }, /container magic/],
    [image => image.writeUInt32LE(0, 12), /builder flags/],
    [image => image.writeUInt32LE(0x110, 0x20), /overlapping segment/],
    [image => image.writeUInt32LE(0, 0x24), /Overlapping memory/],
    [image => image.writeUInt32LE(4097, 0x24), /Unaligned memory/],
    [image => image.writeUInt32LE(99999, 0x18), /outside image/],
    [image => image.writeUInt32LE(9, 0x60), /Stored size mismatch/],
    [image => { image[0xa0] ^= 1; }, /Segment digest/],
    [image => { image[0x40] ^= 1; }, /Module content digest/],
  ]) {
    const image = imageFixture();
    change(image);
    assert.throws(() => validateImage(image, manifest(image)), expected);
  }
  const image = imageFixture();
  assert.throws(() => validateImage(image, { ...manifest(image), payloadBytes: 1 }), /length mismatch/);
  assert.throws(() => validateImage(image, { ...manifest(image), payloadSha256: '0'.repeat(64) }), /Manifest digest/);
  assert.throws(() => validateImage(image.subarray(0, 4), manifest(image)), /Truncated image/);
});

test('native source inspection rejects wrong revisions, dirty trees and symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-source-fixture-'));
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    for (const filename of sourceFiles) {
      fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
      fs.writeFileSync(path.join(root, filename), 'fixture data\n');
    }
    git(['add', '.']);
    git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture source']);
    const revision = git(['rev-parse', 'HEAD']);
    const files = inspectSource(root, revision);
    assert.equal(Object.keys(files).length, 20);
    assert.equal(files[sourceFiles[0]].sha256, hash(Buffer.from('fixture data\n')));
    assert.equal(files[sourceFiles[0]].lines, 1);
    assert.throws(() => inspectSource(root, 'f'.repeat(40)), /Wrong upstream revision/);
    git(['update-index', '--assume-unchanged', sourceFiles[0]]);
    fs.appendFileSync(path.join(root, sourceFiles[0]), 'changed\n');
    assert.equal(git(['status', '--porcelain']), '');
    assert.throws(() => inspectSource(root, revision), /Source differs from pinned blob/);
    git(['update-index', '--no-assume-unchanged', sourceFiles[0]]);
    assert.throws(() => inspectSource(root, revision), /Dirty upstream checkout/);
    fs.unlinkSync(path.join(root, sourceFiles[0]));
    fs.symlinkSync('lib/native.cjs', path.join(root, sourceFiles[0]));
    git(['add', '.']);
    git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture symlink']);
    assert.throws(() => inspectSource(root, git(['rev-parse', 'HEAD'])), /Not a regular source file/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
