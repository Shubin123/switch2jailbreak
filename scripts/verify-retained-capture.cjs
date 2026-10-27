const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

function verifyRetainedCapture(entry, bytes) {
  assert.ok(entry && entry.command === 'retained-bootstrap-move', 'Expected a metadata-move record');
  assert.equal(entry.verified, true, 'Metadata move was not recorded as verified');
  assert.ok(Number.isSafeInteger(entry.address) && entry.address >= 2 ** 32 && entry.address < 2 ** 39, 'Invalid capture address');
  assert.ok(Number.isInteger(entry.length) && entry.length >= 32 && entry.length <= 0x4000 &&
    entry.address + entry.length < 2 ** 39, 'Invalid capture range');
  assert.ok(Buffer.isBuffer(bytes), 'Expected explicitly supplied capture bytes');
  assert.equal(bytes.length, entry.length, 'Repeated capture is shorter or longer than requested');
  assert.ok(entry.capture, 'Missing repeated capture record');
  assert.equal(entry.capture.address, entry.address, 'Capture address differs');
  assert.equal(entry.capture.length, entry.length, 'Recorded capture length differs');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(entry.capture.sha256, digest, 'Capture digest differs from supplied bytes');
  assert.equal(entry.observedSha256, digest, 'First and repeated capture digests differ');
  assert.ok(typeof entry.anchorHex === 'string' && /^(?:[0-9a-fA-F]{2}){16,128}$/.test(entry.anchorHex), 'Invalid anchor bytes');
  const anchor = Buffer.from(entry.anchorHex, 'hex');
  assert.ok(Number.isInteger(entry.anchorOffset) && entry.anchorOffset >= 0 &&
    entry.anchorOffset + anchor.length <= bytes.length, 'Anchor is outside capture');
  assert.ok(bytes.subarray(entry.anchorOffset, entry.anchorOffset + anchor.length).equals(anchor), 'Capture anchor differs');
  return {
    report_type: 'retained-capture-consistency',
    address: entry.address, bytes: bytes.length, sha256: digest,
    capture_consistent: true, device_authenticated: false,
    target_execution_verified: false, recovery_verified: false,
  };
}

module.exports = verifyRetainedCapture;

if (require.main === module) {
  const [recordFile, captureFile] = process.argv.slice(2);
  if (!recordFile || !captureFile) {
    console.error('Usage: node scripts/verify-retained-capture.cjs <metadata-move-record.json> <capture.bin>');
    process.exitCode = 1;
  } else {
    try {
      const result = verifyRetainedCapture(JSON.parse(fs.readFileSync(recordFile, 'utf8')), fs.readFileSync(captureFile));
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
