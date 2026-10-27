const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { inspectAsset, reviewAssets } = require('../scripts/review-native-assets.cjs');

const signature = () => ({
  offset: 4096, bytes: '00000000', size: 4,
  sha256: crypto.createHash('sha256').update(Buffer.alloc(4)).digest('hex'),
});

test('asset checks bind declared digests to local bytes without claiming SDK authenticity', () => {
  const result = inspectAsset({ functions: { synthetic: signature() }, sha256: 'a'.repeat(64) });
  assert.equal(result.signatures.length, 1);
  assert.equal(result.signatures[0].declared_digest_checked, true);
  assert.deepEqual(result.unbound_digests, ['$.sha256']);
  assert.equal(result.provenance_independently_verified, false);
});

test('asset checks reject malformed encodings, extents, offsets and digests', () => {
  for (const change of [
    value => { value.bytes = 'not hex'; },
    value => { value.bytes = 4; },
    value => { value.bytes = '0000'; },
    value => { value.size = 8; },
    value => { value.offset = 1; },
    value => { value.offset = '4096'; },
    value => { value.offset = -4; },
    value => { value.offset = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.sha256 = 'b'.repeat(64); },
  ]) {
    const asset = signature();
    change(asset);
    assert.throws(() => inspectAsset({ functions: { synthetic: asset } }));
  }
  assert.throws(() => inspectAsset(null));
  assert.throws(() => inspectAsset([]));
  assert.throws(() => inspectAsset({ sha256: 'invalid' }));
});

test('asset review cannot run against an unidentified checkout', () => {
  assert.throws(() => reviewAssets('/nonexistent-native-source'));
});
