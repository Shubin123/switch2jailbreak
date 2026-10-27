const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const verify = require('../scripts/verify-retained-capture.cjs');

function fixture() {
  const bytes = Buffer.alloc(32, 0x22);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  return { bytes, entry: {
    command: 'retained-bootstrap-move', verified: true, address: 2 ** 32, length: 32,
    observedSha256: digest, anchorHex: bytes.subarray(0, 16).toString('hex'), anchorOffset: 0,
    capture: { address: 2 ** 32, length: 32, sha256: digest, outputFile: '/untrusted/path-is-not-read' },
  } };
}

test('retained capture verification binds full repeat bytes but does not attest hardware', () => {
  const { entry, bytes } = fixture();
  const output = verify(entry, bytes);
  assert.equal(output.capture_consistent, true);
  assert.equal(output.device_authenticated, false);
  assert.equal(output.target_execution_verified, false);
  assert.equal(output.recovery_verified, false);
});

test('retained capture verification rejects incomplete, changed or unbound evidence', () => {
  for (const change of [
    value => { value.bytes = value.bytes.subarray(0, 16); },
    value => { value.entry.capture.length = 16; },
    value => { value.entry.capture.address += 8; },
    value => { value.entry.observedSha256 = '0'.repeat(64); },
    value => { value.entry.capture.sha256 = '0'.repeat(64); },
    value => { value.entry.anchorOffset = 24; },
    value => { value.entry.anchorHex = '33'.repeat(16); },
    value => { value.entry.address = -1; },
    value => { value.entry.verified = false; },
    value => { value.entry.command = 'read'; },
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => verify(value.entry, value.bytes));
  }
});
