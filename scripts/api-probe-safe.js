// API probe - SAFE half: no DOM mutation, no CSS animation, no sort mutation
(function() {
'use strict';

var results = { tests: [] };

function test(name, fn) {
  try {
    var r = fn();
    r.name = name;
    results.tests.push(r);
  } catch(e) {
    results.tests.push({ name: name, error: e.message });
  }
}

function f64ToHex(v) {
  var buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = v;
  var u = new Uint32Array(buf);
  return '0x' + u[1].toString(16).padStart(8,'0') + u[0].toString(16).padStart(8,'0');
}

// ─── Test 1: Available API surface ───
test('api_surface', function() {
  return {
    result: 'apis',
    structuredClone: typeof structuredClone,
    abTransfer: typeof ArrayBuffer.prototype.transfer,
    abResize: typeof ArrayBuffer.prototype.resize,
    abTransferToFixed: typeof ArrayBuffer.prototype.transferToFixedLength,
    requestAnimationFrame: typeof requestAnimationFrame,
    MutationObserver: typeof MutationObserver,
    ResizeObserver: typeof ResizeObserver,
    indexedDB: typeof indexedDB,
    TextEncoder: typeof TextEncoder,
    TextDecoder: typeof TextDecoder,
    AbortController: typeof AbortController,
    ReadableStream: typeof ReadableStream,
    CompressionStream: typeof CompressionStream,
    fetch: typeof fetch,
    URLPattern: typeof URLPattern,
    Iterator: typeof Iterator
  };
});

// ─── Test 2: structuredClone() function ───
test('structuredClone_func', function() {
  if (typeof structuredClone !== 'function') return { result: 'not_available' };

  // Test BigInt confusion via structuredClone
  var buf = new ArrayBuffer(64);
  new Uint8Array(buf).fill(0xAA);
  var v1 = new Uint8Array(buf);
  var v2 = new Uint8Array(buf);

  var filler = [1n, buf, v1, v2];
  while (filler.length < 80) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(83);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[82] = -1;

  var c = structuredClone(outer);
  if (!c) return { result: 'null' };

  var cv = c[0][3];
  if (!(cv instanceof Uint8Array)) return { result: 'not_u8' };

  return {
    result: cv[0] === 0xAA ? 'CONFUSED' : 'normal_' + cv[0],
    byte0: cv[0],
    mismatch: c[1] !== c[2]
  };
});

// ─── Test 3: ArrayBuffer.transfer ───
test('ab_transfer', function() {
  if (typeof ArrayBuffer.prototype.transfer !== 'function') return { result: 'not_available' };

  var buf = new ArrayBuffer(64);
  new Uint8Array(buf).fill(0xBB);
  var view = new Uint8Array(buf);

  var buf2 = buf.transfer();

  return {
    result: 'transferred',
    origLen: buf.byteLength,
    newLen: buf2.byteLength,
    viewDetached: view.byteLength === 0,
    newByte0: new Uint8Array(buf2)[0]
  };
});

// ─── Test 4: ArrayBuffer.transfer + resize ───
test('ab_transfer_resize', function() {
  if (typeof ArrayBuffer.prototype.transfer !== 'function') return { result: 'not_available' };

  // Transfer to larger size
  var buf = new ArrayBuffer(64);
  new Uint8Array(buf).fill(0xCC);

  try {
    var bigger = buf.transfer(256);
    var v = new Uint8Array(bigger);
    return {
      result: 'resized',
      newLen: bigger.byteLength,
      byte0: v[0],
      byte64: v[64],
      byte65: v[65]
    };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 60) };
  }
});

// ─── Test 5: transfer + SC confusion combo ───
test('transfer_after_confusion', function() {
  if (typeof ArrayBuffer.prototype.transfer !== 'function') return { result: 'not_available' };

  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xDD);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xEE);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  var filler = [1n, target, v1, v2];
  while (filler.length < 80) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(83);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[82] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null' };

  var cv = c[0][3];
  if (!(cv instanceof Uint8Array) || cv[0] !== 0xDD) return { result: 'no_confusion' };

  // Transfer the confused buffer to a LARGER size
  try {
    var confusedBuf = cv.buffer;
    var expanded = confusedBuf.transfer(4096);

    // cv should now be detached
    // expanded has the old data + new zeroed space
    var ev = new Uint8Array(expanded);

    return {
      result: 'expanded',
      cvDetached: cv.byteLength === 0,
      expandedLen: expanded.byteLength,
      byte0: ev[0],
      byte63: ev[63],
      byte64: ev[64],
      byte100: ev[100],
      nonZeroAfter64: (function() {
        for (var i = 64; i < ev.length; i++) {
          if (ev[i] !== 0) return { idx: i, val: ev[i] };
        }
        return null;
      })()
    };
  } catch(e) {
    return { result: 'transfer_err', msg: e.message.substring(0, 60) };
  }
});

// ─── Test 6: RegExp edge cases (no mutation) ───
test('regexp_edge', function() {
  var r = {};

  try {
    var re = /a{0,2147483647}/;
    r.largeQuant = re.test('aaa') ? 'ok' : 'no';
  } catch(e) { r.largeQuant = 'err:' + e.message.substring(0, 40); }

  try {
    var re3 = /a/g;
    re3.lastIndex = 2147483647;
    r.lastIndexMax = re3.exec('a') === null ? 'null_ok' : 'matched';
  } catch(e) { r.lastIndexMax = 'err:' + e.message.substring(0, 40); }

  try {
    r.hasMatchAll = typeof String.prototype.matchAll;
  } catch(e) { r.hasMatchAll = 'err'; }

  try {
    r.hasLookbehind = (function() { try { new RegExp('(?<=a)b'); return true; } catch(e) { return false; } })();
  } catch(e) { r.hasLookbehind = 'err'; }

  // Regex replace with backrefs
  try {
    r.replaceFn = 'hello'.replace(/(.)(.)(.)(.)(.)/, function() { return arguments.length; });
  } catch(e) { r.replaceFn = 'err'; }

  return { result: 'regexp', data: r };
});

// ─── Test 7: TextEncoder/TextDecoder ───
test('text_codec', function() {
  if (typeof TextEncoder === 'undefined') return { result: 'not_available' };
  var r = {};

  try {
    var enc = new TextEncoder();
    r.surrogateLen = enc.encode('\uD800').length;
  } catch(e) { r.surrogateLen = 'err'; }

  try {
    var dec = new TextDecoder('utf-8', { fatal: true });
    dec.decode(new Uint8Array([0xFF, 0xFE]));
    r.fatalDecode = 'no_throw';
  } catch(e) { r.fatalDecode = 'threw'; }

  try {
    var dec2 = new TextDecoder('utf-8');
    var p1 = dec2.decode(new Uint8Array([0xE4, 0xB8]), { stream: true });
    var p2 = dec2.decode(new Uint8Array([0xAD]));
    r.streamDecode = p1.length + '_' + p2;
  } catch(e) { r.streamDecode = 'err'; }

  return { result: 'text', data: r };
});

// ─── Test 8: Proxy invariant violation ───
test('proxy_invariant', function() {
  var obj = {};
  Object.defineProperty(obj, 'x', { value: 42, writable: false, configurable: false });
  var p = new Proxy(obj, {
    get: function(t, prop) {
      if (prop === 'x') return 99;
      return t[prop];
    }
  });

  try {
    var val = p.x;
    return { result: 'no_throw', val: val };
  } catch(e) {
    return { result: 'threw', msg: e.message.substring(0, 60) };
  }
});

// ─── Test 9: Intl edge cases ───
test('intl_edge', function() {
  var r = {};

  try {
    var nf = new Intl.NumberFormat('en', { maximumFractionDigits: 100 });
    r.bigFracDigits = nf.format(Math.PI).length;
  } catch(e) { r.bigFracDigits = 'err:' + e.message.substring(0, 40); }

  try {
    r.maxSafeFormat = new Intl.NumberFormat('en').format(Number.MAX_SAFE_INTEGER);
  } catch(e) { r.maxSafeFormat = 'err'; }

  return { result: 'intl', data: r };
});

return JSON.stringify(results);
})();
