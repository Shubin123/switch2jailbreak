const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const browsers = require('playwright');
const validateEntry = require('../../scripts/validate-browser-entry.cjs');
const { startServer } = require('./server.cjs');

for (const engine of ['chromium', 'firefox', 'webkit']) {
  test(`${engine}: browser entry requires action and exports only bounded navigation evidence`, { timeout: 60000 }, async () => {
    const { server, url, requests } = await startServer();
    let browser;
    try {
      browser = await browsers[engine].launch();
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${url}/entry/browser-entry.html?token=secret#private`);
      assert.equal(await page.locator('#entry-output').inputValue(), '');
      assert.equal(await page.locator('#entry-download').isDisabled(), true);
      await page.locator('#entry-kind').selectOption('desktop-control');
      await page.locator('#entry-firmware').fill('Desktop test control');
      await page.locator('#entry-context').fill('Direct navigation; not a console run');
      await page.locator('#entry-notes').fill('<script>throw new Error("untrusted")</script>');
      await page.locator('button[type="submit"]').click();
      const report = JSON.parse(await page.locator('#entry-output').inputValue());
      assert.deepEqual(validateEntry(report), []);
      assert.equal(report.properties, null);
      assert.equal(report.limitations.native_execution_established, false);
      assert.ok(!JSON.stringify(report).includes('token=secret'));
      await page.locator('#entry-properties').check();
      await page.locator('button[type="submit"]').click();
      assert.deepEqual(validateEntry(JSON.parse(await page.locator('#entry-output').inputValue())), []);
      assert.deepEqual(errors, []);
      const reachedServer = await page.evaluate(async () => {
        try { await fetch('browser-entry.js'); return true; } catch { return false; }
      });
      assert.equal(reachedServer, false);
      assert.deepEqual(requests.filter(request => !request.includes('favicon')).map(request => request.split('?')[0]).sort(),
        ['/entry/browser-entry.html', '/entry/browser-entry.js', '/entry/styles.css']);
      assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
      const downloadEvent = page.waitForEvent('download');
      await page.locator('#entry-download').click();
      const downloaded = await downloadEvent;
      const downloadedReport = JSON.parse(fs.readFileSync(await downloaded.path(), 'utf8'));
      assert.deepEqual(validateEntry(downloadedReport), []);
      assert.equal(downloadedReport.observation_kind, 'desktop-control');
      const resultDirectory = path.join(__dirname, '../../results');
      fs.mkdirSync(resultDirectory, { recursive: true });
      fs.writeFileSync(path.join(resultDirectory, `entry-${engine}.json`), JSON.stringify(downloadedReport, null, 2) + '\n');
      await page.locator('#entry-notes').fill('Changed metadata');
      assert.equal(await page.locator('#entry-output').inputValue(), '');
      assert.equal(await page.locator('#entry-download').isDisabled(), true);
      await page.evaluate(() => { URL.createObjectURL = undefined; });
      await page.locator('button[type="submit"]').click();
      assert.deepEqual(validateEntry(JSON.parse(await page.locator('#entry-output').inputValue())), []);
      assert.equal(await page.locator('#entry-download').isDisabled(), true);
      await page.close();
      const noScript = await browser.newContext({ javaScriptEnabled: false });
      const staticPage = await noScript.newPage();
      await staticPage.goto(`${url}/entry/browser-entry.html`);
      assert.match(await staticPage.locator('noscript').textContent(), /manually save/);
      await noScript.close();
    } finally {
      if (browser) await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
