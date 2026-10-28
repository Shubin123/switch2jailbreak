#!/usr/bin/env node
'use strict';

const dgram = require('node:dgram');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const HTTP_PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const DNS_PORT = process.env.DNS_PORT ? Number(process.env.DNS_PORT) : 53;
const SKIP_DNS = process.argv.includes('--no-dns');

function getLanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const lanIP = getLanIP();

// --- Minimal DNS server ---
// Responds to all A queries with this machine's LAN IP.
// The Switch does a connectivity check, gets our IP, thinks
// there's a captive portal, and opens its browser to our page.

function buildDNSResponse(query, ip) {
  const parts = ip.split('.').map(Number);
  const id = query.subarray(0, 2);
  const flags = Buffer.from([0x81, 0x80]);
  const qdcount = query.readUInt16BE(4);
  const counts = Buffer.alloc(6);
  counts.writeUInt16BE(qdcount, 0);
  counts.writeUInt16BE(0, 2);
  counts.writeUInt16BE(0, 4);

  let offset = 12;
  for (let q = 0; q < qdcount; q++) {
    while (offset < query.length && query[offset] !== 0) {
      if ((query[offset] & 0xc0) === 0xc0) { offset += 2; break; }
      offset += query[offset] + 1;
    }
    if (offset < query.length && query[offset] === 0) offset++;
    offset += 4;
  }
  const question = query.subarray(12, offset);

  const answers = [];
  let qOff = 12;
  for (let q = 0; q < qdcount; q++) {
    const nameStart = qOff;
    while (qOff < query.length && query[qOff] !== 0) {
      if ((query[qOff] & 0xc0) === 0xc0) { qOff += 2; break; }
      qOff += query[qOff] + 1;
    }
    if (qOff < query.length && query[qOff] === 0) qOff++;
    const qtype = query.readUInt16BE(qOff);
    qOff += 4;

    if (qtype === 1) {
      const ans = Buffer.alloc(16);
      ans.writeUInt16BE(0xc000 | nameStart, 0);
      ans.writeUInt16BE(1, 2);
      ans.writeUInt16BE(1, 4);
      ans.writeUInt32BE(60, 6);
      ans.writeUInt16BE(4, 10);
      ans[12] = parts[0]; ans[13] = parts[1]; ans[14] = parts[2]; ans[15] = parts[3];
      answers.push(ans);
    }
  }

  return Buffer.concat([id, flags, query.subarray(4, 6), counts, question, ...answers]);
}

const dns = dgram.createSocket('udp4');
let dnsQueries = 0;
dns.on('message', (msg, rinfo) => {
  try {
    const resp = buildDNSResponse(msg, lanIP);
    dns.send(resp, rinfo.port, rinfo.address);
    dnsQueries++;
    // Parse queried hostname for logging
    let name = '', off = 12;
    while (off < msg.length && msg[off] !== 0 && (msg[off] & 0xc0) === 0) {
      const len = msg[off++];
      if (name) name += '.';
      name += msg.subarray(off, off + len).toString('ascii');
      off += len;
    }
    if (name.includes('nintendo') || name.includes('conntest') || dnsQueries <= 5) {
      console.log(`[dns] ${rinfo.address} → ${name} → ${lanIP}`);
    }
  } catch {}
});
dns.on('error', err => {
  if (err.code === 'EACCES') {
    console.error('');
    console.error('  Port 53 requires root. Run with sudo or use --no-dns:');
    console.error('  sudo node scripts/debug-server.cjs');
    console.error('  node scripts/debug-server.cjs --no-dns');
    console.error('');
    process.exit(1);
  }
  if (err.code === 'EADDRINUSE') {
    console.error(`[dns] Port ${DNS_PORT} in use (macOS mDNSResponder?). Starting HTTP-only mode.`);
    console.error('[dns] Use --no-dns to suppress this, or sudo to override.\n');
    startHTTP();
    return;
  }
  console.error('[dns]', err.message);
});

// --- HTTP state ---

let cmdId = 0;
const commands = [];
const clients = {};
const results = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 1048576) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function jsonResp(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

const rawHTML = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');

function servePage(res) {
  // Inject auto-connect script before closing </head>
  const autoConnect = `<script>window.__DEBUG_HOST__="http://${lanIP}:${HTTP_PORT}";</script>`;
  const page = rawHTML.replace('</head>', autoConnect + '</head>');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(page);
}

// --- HTTP server ---

const httpServer = http.createServer(async (req, res) => {
  const ua = req.headers['user-agent'] || '';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(); return;
  }

  if (req.method === 'POST' && req.url === '/api/capabilities') {
    try {
      const body = JSON.parse(await readBody(req));
      const key = req.socket.remoteAddress;
      const isNew = !clients[key];
      clients[key] = { caps: body, lastSeen: Date.now(), ua };
      if (isNew) {
        console.log('');
        console.log('═══════════════════════════════════════════');
        console.log('  Switch 2 browser connected!');
        console.log('═══════════════════════════════════════════');
        console.log(`  IP: ${key}`);
        console.log(`  UA: ${body.userAgent || ua}`);
        console.log(`  Screen: ${body.screenWidth}x${body.screenHeight} @${body.devicePixelRatio}x`);
        console.log(`  Touch: ${body.maxTouchPoints} points`);
        console.log('  ─── JS Engine ───');
        console.log(`  WebAssembly: ${body.webAssembly}  BigInt: ${body.bigInt}  Proxy: ${body.es6Proxy}`);
        console.log(`  SharedArrayBuffer: ${body.sharedArrayBuffer}  Atomics: ${body.atomics}`);
        console.log(`  WeakRef: ${body.weakRef}  FinalizationRegistry: ${body.finalizationRegistry}`);
        console.log('  ─── Web APIs ───');
        console.log(`  Workers: ${body.webWorkers}  Fetch: ${body.fetch}  XHR: ${body.xhr}`);
        console.log(`  WebGL2: ${body.webGL}  WebGPU: ${body.webGPU}  Crypto: ${body.crypto}`);
        console.log(`  IndexedDB: ${body.indexedDB}  LocalStorage: ${body.localStorage}`);
        console.log('  ─── Timing ───');
        console.log(`  Resolution: ${body.timerResolution}  JIT warmup: ${body.jitWarmupMs}ms`);
        console.log('═══════════════════════════════════════════');
        console.log('');
        console.log('Type JavaScript to eval in the Switch browser:');
      }
      jsonResp(res, 200, { ok: true, cmdId });
    } catch (e) { jsonResp(res, 400, { error: e.message }); }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/poll')) {
    const url = new URL(req.url, 'http://localhost');
    const after = Number(url.searchParams.get('after')) || 0;
    const key = req.socket.remoteAddress;
    if (clients[key]) clients[key].lastSeen = Date.now();
    jsonResp(res, 200, { commands: commands.filter(c => c.id > after) });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/result') {
    try {
      const body = JSON.parse(await readBody(req));
      console.log(`[${body.error ? 'ERR' : ' OK'}] ${body.result}`);
      results.push({ cmdId: body.cmdId, result: body.result, error: body.error, ts: Date.now() });
      if (results.length > 100) results.shift();
      jsonResp(res, 200, { ok: true });
    } catch (e) { jsonResp(res, 400, { error: e.message }); }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/results')) {
    const url = new URL(req.url, 'http://localhost');
    const last = Number(url.searchParams.get('last')) || 10;
    jsonResp(res, 200, { results: results.slice(-last) });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/eval') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.code) { jsonResp(res, 400, { error: 'missing code' }); return; }
      commands.push({ id: ++cmdId, type: 'eval', code: body.code });
      console.log(`[eval] queued: ${body.code.substring(0, 80)}`);
      jsonResp(res, 200, { ok: true, cmdId });
    } catch (e) { jsonResp(res, 400, { error: e.message }); }
    return;
  }

  // Serve script files for <script src="/scripts/..."> loading
  if (req.method === 'GET' && req.url.startsWith('/scripts/')) {
    const scriptName = path.basename(req.url.split('?')[0]);
    const scriptPath = path.join(__dirname, scriptName);
    try {
      const code = fs.readFileSync(scriptPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(code);
      console.log(`[http] served script: ${scriptName} (${code.length} bytes)`);
    } catch(e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return;
  }

  // Log interesting requests (skip polls)
  const host = req.headers.host || '';
  if (host.includes('nintendo') || host.includes('conntest')) {
    console.log(`[captive] ${req.method} ${host}${req.url} — portal trigger`);
  } else if (!req.url.startsWith('/api/')) {
    console.log(`[http] ${req.method} ${host}${req.url}`);
  }

  servePage(res);
});

// --- Start everything ---

let httpStarted = false;
function startHTTP(dnsActive) {
  if (httpStarted) return;
  httpStarted = true;
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    const addr = `http://${lanIP}:${HTTP_PORT}`;
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║  NS2JB Debug Server                                  ║');
    console.log('╠═══════════════════════════════════════════════════════╣');
    console.log(`║  This Mac: ${lanIP}`.padEnd(56) + '║');
    console.log(`║  Debug URL: ${addr}`.padEnd(56) + '║');
    console.log(`║  DNS: ${dnsActive ? 'active (port ' + DNS_PORT + ')' : 'off — use browser URL'}`.padEnd(56) + '║');
    console.log('╠═══════════════════════════════════════════════════════╣');
    console.log('║                                                      ║');
    if (dnsActive) {
      console.log('║  On the Switch 2:                                    ║');
      console.log('║  Settings → Internet → your network → DNS Settings   ║');
      console.log(`║  Set Manual → Primary DNS: ${lanIP}`.padEnd(56) + '║');
      console.log('║  Save, then tap "Connect to This Network"            ║');
    } else {
      console.log('║  On the Switch 2:                                    ║');
      console.log('║  Open the captive portal browser (SwitchBru DNS or   ║');
      console.log('║  Settings → Internet → connect), then navigate to:   ║');
      console.log(`║    ${addr}`.padEnd(55) + '║');
    }
    console.log('║                                                      ║');
    console.log('║  Capabilities stream here. Type JS to eval.          ║');
    console.log('║                                                      ║');
    console.log('╠═══════════════════════════════════════════════════════╣');
    console.log('║  :trigger = CVE test      :exploit = full chain      ║');
    console.log('║  :primitives = JSC helpers :overflow = fs shellcode   ║');
    console.log('║  :chain = fs exploit chain :load <file> = load JS    ║');
    console.log('║  :list  :caps  :help  :quit                          ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Waiting for Switch 2 to connect...');
    console.log('');

    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'debug> ' });
      rl.prompt();

      rl.on('line', line => {
        const t = line.trim();
        if (!t) { rl.prompt(); return; }
        if (t === ':quit' || t === ':q') { process.exit(0); }
        if (t === ':list' || t === ':ls') {
          const keys = Object.keys(clients);
          if (!keys.length) console.log('No clients');
          else keys.forEach(k => {
            const c = clients[k];
            console.log(`  ${k} — ${Math.round((Date.now() - c.lastSeen) / 1000)}s ago`);
            console.log(`    ${(c.caps.userAgent || '').substring(0, 70)}`);
          });
          rl.prompt(); return;
        }
        if (t === ':caps') { commands.push({ id: ++cmdId, type: 'request-caps' }); console.log('Requested refresh'); rl.prompt(); return; }
        if (t.startsWith(':load ')) {
          const filePath = t.slice(6).trim();
          const resolved = path.resolve(filePath);
          try {
            const code = fs.readFileSync(resolved, 'utf8');
            commands.push({ id: ++cmdId, type: 'eval', code });
            console.log(`Loaded ${path.basename(resolved)} (${code.length} bytes, cmd #${cmdId})`);
            if (!Object.keys(clients).length) console.log('(queued — no clients yet)');
          } catch(e) {
            console.log(`Failed to load: ${e.message}`);
          }
          rl.prompt(); return;
        }
        if (t === ':trigger') {
          const triggerPath = path.join(__dirname, 'cve-2023-37450-trigger.js');
          try {
            const code = fs.readFileSync(triggerPath, 'utf8');
            commands.push({ id: ++cmdId, type: 'eval', code });
            console.log(`Loaded trigger test (${code.length} bytes, cmd #${cmdId})`);
          } catch(e) { console.log(`Failed: ${e.message}`); }
          rl.prompt(); return;
        }
        if (t === ':exploit') {
          const exploitPath = path.join(__dirname, 'exploit-switch2.js');
          try {
            const code = fs.readFileSync(exploitPath, 'utf8');
            commands.push({ id: ++cmdId, type: 'eval', code });
            console.log(`Loaded full exploit (${code.length} bytes, cmd #${cmdId})`);
          } catch(e) { console.log(`Failed: ${e.message}`); }
          rl.prompt(); return;
        }
        if (t === ':primitives') {
          const primPath = path.join(__dirname, 'jsc-primitives.js');
          try {
            const code = fs.readFileSync(primPath, 'utf8');
            commands.push({ id: ++cmdId, type: 'eval', code });
            console.log(`Loaded JSC primitives (${code.length} bytes, cmd #${cmdId})`);
          } catch(e) { console.log(`Failed: ${e.message}`); }
          rl.prompt(); return;
        }
        if (t === ':overflow') {
          const scPath = path.join(__dirname, 'fs-overflow-shellcode.js');
          try {
            const code = fs.readFileSync(scPath, 'utf8');
            commands.push({ id: ++cmdId, type: 'eval', code });
            console.log(`Loaded fs overflow shellcode builder (${code.length} bytes, cmd #${cmdId})`);
          } catch(e) { console.log(`Failed: ${e.message}`); }
          rl.prompt(); return;
        }
        if (t === ':chain') {
          const chainPath = path.join(__dirname, 'fs-exploit-chain.js');
          try {
            const code = fs.readFileSync(chainPath, 'utf8');
            commands.push({ id: ++cmdId, type: 'eval', code });
            console.log(`Loaded full fs exploit chain (${code.length} bytes, cmd #${cmdId})`);
          } catch(e) { console.log(`Failed: ${e.message}`); }
          rl.prompt(); return;
        }
        if (t === ':help' || t === ':h') {
          console.log('  :trigger     — send CVE-2023-37450 trigger test');
          console.log('  :exploit     — send full exploit (all stages)');
          console.log('  :primitives  — load JSC exploit primitives (Int64, addrof, etc)');
          console.log('  :overflow    — load fs overflow shellcode builder');
          console.log('  :chain       — load full fs→code-execution chain');
          console.log('  :load <f>    — send any JS file as eval');
          console.log('  :list        — show connected clients');
          console.log('  :caps        — refresh capabilities');
          console.log('  :quit        — exit');
          console.log('  <js code>    — eval arbitrary JS on Switch');
          rl.prompt(); return;
        }
        commands.push({ id: ++cmdId, type: 'eval', code: t });
        if (!Object.keys(clients).length) console.log('(queued — no clients yet)');
        rl.prompt();
      });
      rl.on('close', () => process.exit(0));
    } else {
      console.log('(headless mode — no REPL, watching for connections)');
    }
  });
}

if (SKIP_DNS) {
  startHTTP(false);
} else {
  dns.bind(DNS_PORT, '0.0.0.0', () => {
    startHTTP(true);
  });
}
