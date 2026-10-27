const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const files = new Map([
  ['browser-harness.html', 'text/html'],
  ['result-integrity.js', 'text/javascript'],
  ['javascript-features/feature-detect.js', 'text/javascript'],
  ['runtime-errors/error-handling.js', 'text/javascript'],
  ['isolation/sandbox-detect.js', 'text/javascript'],
]);

async function startServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    const match = /^\/(normal|isolated)\/(.*)$/.exec(request.url);
    if (!match || !files.has(match[2])) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.setHeader('Content-Type', `${files.get(match[2])}; charset=utf-8`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (match[1] === 'isolated') {
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; worker-src 'self' blob:");
    }
    response.end(fs.readFileSync(path.join(__dirname, '..', match[2])));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, requests, url: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { startServer, files };
