const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const browsers = require('playwright');
const validateResult = require('../../scripts/validate-results.cjs');
const { startServer, files } = require('./server.cjs');

async function exportReport(page) {
  await page.locator('#export-btn').click();
  return JSON.parse(await page.locator('#json-output').textContent());
}

function sourceProvenance() {
  try {
    const options = { encoding: 'utf8', cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'] };
    return {
      source_revision: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
      working_tree_dirty: !!execFileSync('git', ['status', '--porcelain'], options).trim(),
    };
  } catch {
    return { source_revision: null, working_tree_dirty: null };
  }
}

for (const engine of ['chromium', 'firefox', 'webkit']) {
  test(`${engine}: real browser evidence and negative controls`, { timeout: 120000 }, async suite => {
    const { server, requests, url } = await startServer();
    let browser;
    try {
      browser = await browsers[engine].launch();
      for (const profile of ['normal', 'isolated']) {
        await suite.test(`${profile} context exports complete, internally consistent evidence`, async () => {
          const context = await browser.newContext();
          try {
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${url}/${profile}/browser-harness.html`);
            const output = await exportReport(page);
            assert.deepEqual(errors, []);
            assert.deepEqual(validateResult(output, 55), []);
            assert.equal(output.complete, true);
            assert.equal(output.summary.errors, 0);
            assert.equal(output.summary.skipped, 0);
            const runtimeFailures = output.results.filter(result => result.category !== 'isolation' && result.status !== 'pass');
            assert.deepEqual(runtimeFailures, []);
            assert.equal(output.environment.secure_context, true);
            assert.equal(output.environment.cross_origin_isolated, profile === 'isolated');
            assert.equal(output.results.find(result => result.test_id === 'iso-013').status,
              profile === 'isolated' ? 'pass' : 'fail');
            const probePath = `/${profile}/result-integrity.js`;
            const requestCount = requests.filter(request => request === probePath).length;
            const allowed = await page.evaluate(async () => {
              try { await fetch('result-integrity.js'); return true; }
              catch { return false; }
            });
            assert.equal(allowed, profile === 'normal');
            assert.equal(requests.filter(request => request === probePath).length > requestCount, profile === 'normal');
            output.provenance = {
              engine, browser_version: browser.version(), profile,
              ...sourceProvenance(),
              harness_sha256: Object.fromEntries([...files.keys()].map(filename => [filename,
                crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', filename))).digest('hex')])),
            };
            fs.mkdirSync(path.join(__dirname, '../../results'), { recursive: true });
            fs.writeFileSync(path.join(__dirname, `../../results/browser-${engine}-${profile}.json`), JSON.stringify(output, null, 2) + '\n');
          } finally {
            await context.close();
          }
        });
      }
      await suite.test('a missing suite remains visibly incomplete', async () => {
        const page = await browser.newPage();
        try {
          await page.route('**/runtime-errors/error-handling.js', route => route.abort());
          await page.goto(`${url}/normal/browser-harness.html`);
          const output = await exportReport(page);
          assert.equal(output.complete, false);
          assert.ok(validateResult(output).some(error => error.includes('incomplete')));
          assert.match(await page.locator('#suites').textContent(), /incomplete/);
        } finally {
          await page.close();
        }
      });
      await suite.test('a malformed suite cannot claim completion', async () => {
        const page = await browser.newPage();
        try {
          await page.route('**/runtime-errors/error-handling.js', route => route.fulfill({
            contentType: 'text/javascript', body: 'window.__errorResults = { results: [], summary: { total: 15 } };',
          }));
          await page.goto(`${url}/normal/browser-harness.html`);
          assert.equal((await exportReport(page)).complete, false);
        } finally {
          await page.close();
        }
      });
      await suite.test('observation text is rendered without interpreting HTML', async () => {
        const page = await browser.newPage();
        try {
          await page.route('**/javascript-features/feature-detect.js', async route => {
            const response = await route.fetch();
            const body = await response.text();
            await route.fulfill({ response, body: body + '\nwindow.__testResults.results[0].name = "<img src=x onerror=alert(1)>";\n' });
          });
          await page.goto(`${url}/normal/browser-harness.html`);
          assert.equal(await page.locator('#suites img').count(), 0);
          assert.match(await page.locator('#suites').textContent(), /<img src=x/);
          assert.equal((await exportReport(page)).complete, true);
        } finally {
          await page.close();
        }
      });
    } finally {
      if (browser) await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
