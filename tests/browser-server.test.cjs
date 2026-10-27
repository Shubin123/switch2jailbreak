const assert = require('node:assert/strict');
const test = require('node:test');
const { startServer } = require('./browser/server.cjs');

test('browser test server serves only the harness allowlist on loopback', async () => {
  const { server, url } = await startServer();
  try {
    for (const pathname of ['/normal/.git/config', '/normal/../config/targets.json', '/normal/package.json', '/normal/%2e%2e/config/targets.json']) {
      assert.equal((await fetch(url + pathname)).status, 404);
    }
    const normal = await fetch(`${url}/normal/browser-harness.html`);
    assert.equal(normal.status, 200);
    assert.equal(normal.headers.get('cross-origin-opener-policy'), null);
    const isolated = await fetch(`${url}/isolated/browser-harness.html`);
    assert.equal(isolated.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(isolated.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.match(isolated.headers.get('content-security-policy'), /connect-src 'none'/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
