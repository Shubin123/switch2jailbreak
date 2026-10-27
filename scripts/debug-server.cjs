#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const PORT = Number(process.env.PORT) || 8080;

function getLanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const lanIP = getLanIP();
const debugHTML = fs.readFileSync(path.join(__dirname, '..', 'site', 'debug.html'), 'utf8');

// --- State ---

let cmdId = 0;
const commands = [];  // {id, type, code}
const clients = {};   // clientKey -> {caps, lastSeen, ua}

function clientKey(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown') +
    ':' + (req.headers['user-agent'] || '');
}

// --- HTTP helpers ---

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1048576) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
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

// --- Server ---

const server = http.createServer(async (req, res) => {
  const ua = req.headers['user-agent'] || 'unknown';

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API: receive capabilities
  if (req.method === 'POST' && req.url === '/api/capabilities') {
    try {
      const body = JSON.parse(await readBody(req));
      const key = clientKey(req);
      clients[key] = { caps: body, lastSeen: Date.now(), ua };
      console.log(`\n[client] ${req.socket.remoteAddress} — ${ua}`);
      console.log('[caps] === Browser Capabilities ===');
      for (const [k, v] of Object.entries(body)) {
        console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
      console.log('');
      json(res, 200, { ok: true, cmdId });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }

  // API: poll for commands
  if (req.method === 'GET' && req.url.startsWith('/api/poll')) {
    const url = new URL(req.url, 'http://localhost');
    const after = Number(url.searchParams.get('after')) || 0;
    const key = clientKey(req);
    if (clients[key]) clients[key].lastSeen = Date.now();
    const pending = commands.filter(c => c.id > after);
    json(res, 200, { commands: pending });
    return;
  }

  // API: receive eval result
  if (req.method === 'POST' && req.url === '/api/result') {
    try {
      const body = JSON.parse(await readBody(req));
      const tag = body.error ? 'ERR' : 'OK';
      console.log(`[eval ${tag}] ${body.result}`);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }

  // API: ping
  if (req.url === '/ping') {
    json(res, 200, { pong: true });
    return;
  }

  // Serve debug page for everything else
  console.log(`[http] ${req.method} ${req.url} — ${ua}`);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(debugHTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Switch 2 Browser Debug Server (HTTP)               ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  LAN:  http://${lanIP}:${PORT}`.padEnd(55) + '║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  On Switch 2:                                       ║');
  console.log('║  1. Set DNS to SwitchBru (45.55.142.122) or local   ║');
  console.log('║  2. Open captive portal browser                     ║');
  console.log(`║  3. Navigate to http://${lanIP}:${PORT}`.padEnd(55) + '║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  Commands:                                          ║');
  console.log('║  Type JS to eval in browser    :caps  for refresh   ║');
  console.log('║  :list  connected clients      :quit  to exit       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'debug> ' });
  rl.prompt();

  rl.on('line', line => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    if (trimmed === ':quit' || trimmed === ':q') {
      console.log('Shutting down...');
      server.close();
      process.exit(0);
    }

    if (trimmed === ':list' || trimmed === ':ls') {
      const keys = Object.keys(clients);
      if (!keys.length) { console.log('No clients connected'); }
      else {
        for (const key of keys) {
          const c = clients[key];
          const ago = Math.round((Date.now() - c.lastSeen) / 1000);
          console.log(`  ${key} — last seen ${ago}s ago`);
          if (c.caps.userAgent) console.log(`    UA: ${c.caps.userAgent}`);
        }
      }
      rl.prompt();
      return;
    }

    if (trimmed === ':caps') {
      commands.push({ id: ++cmdId, type: 'request-caps' });
      console.log('Requested capability refresh');
      rl.prompt();
      return;
    }

    // Send JS to eval
    commands.push({ id: ++cmdId, type: 'eval', code: trimmed });
    if (!Object.keys(clients).length) {
      console.log('No clients yet — command queued');
    }
    rl.prompt();
  });

  rl.on('close', () => {
    server.close();
    process.exit(0);
  });
});
