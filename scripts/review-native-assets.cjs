const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inventory } = require('./native-coverage.cjs');

function inspectAsset(value) {
  const signatures = [];
  const unboundDigests = [];
  function walk(node, location) {
    if (!node || typeof node !== 'object') return;
    if (Object.hasOwn(node, 'bytes')) {
      assert.equal(typeof node.bytes, 'string', `${location}: expected encoded bytes`);
      assert.match(node.bytes, /^(?:[0-9a-fA-F]{8})+$/, `${location}: expected whole instruction words`);
      const bytes = Buffer.from(node.bytes, 'hex');
      if (Object.hasOwn(node, 'size')) assert.equal(node.size, bytes.length, `${location}: declared size mismatch`);
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (Object.hasOwn(node, 'sha256')) assert.equal(node.sha256, digest, `${location}: signature digest mismatch`);
      signatures.push({ location, bytes: bytes.length, sha256: digest, declared_digest_checked: Object.hasOwn(node, 'sha256') });
    }
    for (const [key, child] of Object.entries(node)) {
      if (/offset$/i.test(key)) {
        assert.ok(Number.isSafeInteger(child) && child >= 0 && child % 4 === 0, `${location}.${key}: invalid aligned offset`);
      }
      if (/sha256$/i.test(key)) {
        assert.equal(typeof child, 'string', `${location}.${key}: expected digest string`);
        assert.match(child, /^[0-9a-f]{64}$/, `${location}.${key}: invalid digest`);
        if (key !== 'sha256' || typeof node.bytes !== 'string') unboundDigests.push(`${location}.${key}`);
      }
      walk(child, `${location}.${key}`);
    }
  }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Asset must be an object');
  walk(value, '$');
  return { signatures, unbound_digests: unboundDigests, provenance_independently_verified: false };
}

function reviewAssets(root) {
  const source = inventory(root);
  const assets = source.files.filter(file => file.path.startsWith('engine/') && file.path.endsWith('.json')).map(file => {
    const bytes = execFileSync('git', ['-C', root, 'cat-file', 'blob', `${source.upstream_revision}:${file.path}`]);
    try {
      return { path: file.path, source_sha256: file.sha256, status: 'pass', ...inspectAsset(JSON.parse(bytes.toString('utf8'))) };
    } catch (error) {
      return { path: file.path, source_sha256: file.sha256, status: 'fail', error: error.message };
    }
  });
  assert.ok(assets.length, 'No assets found');
  return {
    report_type: 'native-asset-structural-review',
    schema_version: '1.0.0',
    upstream_revision: source.upstream_revision,
    scope: 'JSON instruction-word encoding, numeric offset alignment, local byte lengths and digests only; no instruction semantics, SDK authenticity or target execution verification',
    counts: {
      total_assets: assets.length,
      passed: assets.filter(asset => asset.status === 'pass').length,
      failed: assets.filter(asset => asset.status === 'fail').length,
      signatures: assets.reduce((total, asset) => total + (asset.signatures || []).length, 0),
      unbound_digests: assets.reduce((total, asset) => total + (asset.unbound_digests || []).length, 0),
    },
    phase_4_complete: false,
    assets,
  };
}

module.exports = { inspectAsset, reviewAssets };

if (require.main === module) {
  const [root, output] = process.argv.slice(2);
  if (!root || !output) {
    console.error('Usage: node scripts/review-native-assets.cjs <pinned-upstream-checkout> <output.json>');
    process.exitCode = 1;
  } else {
    try {
      const report = reviewAssets(root);
      fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify(report.counts));
      if (report.counts.failed) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
