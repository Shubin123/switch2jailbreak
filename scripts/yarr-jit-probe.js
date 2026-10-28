// YARR JIT probe — test if the regex JIT is active and probe for known regex bugs
// Even with DFG/FTL disabled, YARR JIT might be independently enabled
(function() {
'use strict';
var results = [];

// Test 1: Regex JIT detection via timing
// A compiled regex should be MUCH faster than interpreted
try {
  var longStr = '';
  for (var i = 0; i < 100000; i++) longStr += 'a';
  longStr += 'b';

  var re = /a*b/;

  // Cold run
  var t0 = performance.now();
  for (var i = 0; i < 100; i++) re.test(longStr);
  var t1 = performance.now();
  var cold = t1 - t0;

  // Hot runs (should be JIT compiled after many executions)
  for (var i = 0; i < 1000; i++) re.test(longStr);

  var t2 = performance.now();
  for (var i = 0; i < 100; i++) re.test(longStr);
  var t3 = performance.now();
  var hot = t3 - t2;

  results.push({
    name: 'yarr_timing',
    coldMs: cold.toFixed(2),
    hotMs: hot.toFixed(2),
    speedup: (cold / (hot || 0.001)).toFixed(1),
    jitLikely: hot < cold * 0.5
  });
} catch(e) {
  results.push({ name: 'yarr_timing', error: e.message.substring(0, 60) });
}

// Test 2: Complex regex timing (backtracking-heavy)
try {
  var re2 = /(a+)+$/;
  var evil = '';
  for (var i = 0; i < 25; i++) evil += 'a';
  evil += 'X';

  var t0 = performance.now();
  re2.test(evil);
  var t1 = performance.now();

  results.push({
    name: 'catastrophic_bt',
    timeMs: (t1 - t0).toFixed(2),
    len: evil.length
  });
} catch(e) {
  results.push({ name: 'catastrophic_bt', error: e.message.substring(0, 60) });
}

// Test 3: YARR JIT-specific features
try {
  var r = {};

  // Named groups
  try {
    var m = 'test123'.match(/(?<word>\w+)(?<num>\d+)/);
    r.namedGroups = m && m.groups ? m.groups.word + '/' + m.groups.num : 'no';
  } catch(e) { r.namedGroups = 'err:' + e.message.substring(0, 30); }

  // Unicode property escapes
  try {
    var re3 = new RegExp('\\p{Letter}+', 'u');
    r.unicodeProp = re3.test('abc') ? 'ok' : 'no';
  } catch(e) { r.unicodeProp = 'err:' + e.message.substring(0, 30); }

  // dotAll flag
  try {
    var re4 = new RegExp('.', 's');
    r.dotAll = re4.test('\n') ? 'ok' : 'no';
  } catch(e) { r.dotAll = 'err'; }

  // Quantifier edge cases
  try {
    var re5 = new RegExp('a{0,4294967295}');
    r.maxQuant = re5.test('a') ? 'ok' : 'no';
  } catch(e) { r.maxQuant = 'err:' + e.message.substring(0, 30); }

  // Uint32 overflow in quantifier
  try {
    var re6 = new RegExp('a{4294967296}');
    r.overflowQuant = 'parsed';
  } catch(e) { r.overflowQuant = 'err:' + e.message.substring(0, 30); }

  results.push({ name: 'yarr_features', data: r });
} catch(e) {
  results.push({ name: 'yarr_features', error: e.message.substring(0, 60) });
}

// Test 4: Regex replace with complex patterns (potential YARR bugs)
try {
  var r4 = {};

  // Large number of capture groups
  var pat = '';
  for (var i = 0; i < 100; i++) pat += '(a?)';
  var re7 = new RegExp(pat);
  var m7 = 'a'.match(re7);
  r4.groups100 = m7 ? m7.length : 'null';

  // Nested quantifiers
  var re8 = /((a{1,10}){1,10}){1,10}/;
  r4.nestedQuant = re8.test('aaaa') ? 'ok' : 'no';

  // Backreference to unmatched group
  var re9 = /(a)?\1/;
  r4.backrefUnmatched = re9.test('') ? 'matched_empty' : 'no';
  r4.backrefUnmatched2 = re9.test('a') ? 'yes' : 'no';

  results.push({ name: 'yarr_complex', data: r4 });
} catch(e) {
  results.push({ name: 'yarr_complex', error: e.message.substring(0, 60) });
}

// Test 5: Error stack traces — do they leak addresses?
try {
  function inner() { throw new Error('probe'); }
  function middle() { return inner(); }
  function outer() { return middle(); }

  try { outer(); } catch(e) {
    results.push({
      name: 'error_stack',
      stack: e.stack ? e.stack.substring(0, 500) : 'none',
      hasAddr: e.stack ? /0x[0-9a-f]{8,}/i.test(e.stack) : false
    });
  }
} catch(e) {
  results.push({ name: 'error_stack', error: e.message.substring(0, 60) });
}

// Test 6: Function.caller (might be restricted but worth checking)
try {
  var r6 = {};
  function callerTest() {
    try {
      r6.caller = typeof callerTest.caller;
      r6.callerVal = String(callerTest.caller).substring(0, 100);
    } catch(e) {
      r6.caller = 'err:' + e.message.substring(0, 40);
    }
    try {
      r6.arguments = typeof callerTest.arguments;
    } catch(e) {
      r6.arguments = 'err:' + e.message.substring(0, 40);
    }
  }
  callerTest();
  results.push({ name: 'function_caller', data: r6 });
} catch(e) {
  results.push({ name: 'function_caller', error: e.message.substring(0, 60) });
}

// Test 7: Memory pressure — allocate many objects and check if GC behavior
// reveals heap info via WeakRef
try {
  var refs = [];
  var targets = [];

  // Create objects and weak references
  for (var i = 0; i < 200; i++) {
    var obj = { idx: i, data: new ArrayBuffer(256) };
    refs.push(new WeakRef(obj));
    if (i < 100) targets.push(obj); // Keep first 100 alive
  }
  // Let last 100 be GC-eligible (no strong reference)

  // Force GC pressure
  var spray = [];
  for (var j = 0; j < 500; j++) spray.push(new ArrayBuffer(1024));
  spray = null; // release

  // Check which WeakRefs are still alive
  var alive = 0, dead = 0;
  for (var i = 0; i < refs.length; i++) {
    if (refs[i].deref()) alive++;
    else dead++;
  }

  results.push({
    name: 'gc_weakref',
    alive: alive,
    dead: dead,
    total: refs.length,
    gcRan: dead > 0
  });
} catch(e) {
  results.push({ name: 'gc_weakref', error: e.message.substring(0, 60) });
}

// Test 8: Proxy + Object.getOwnPropertyDescriptor — can we observe internal slots?
try {
  var buf = new ArrayBuffer(64);
  var view = new Uint8Array(buf);

  var r8 = {};

  // Descriptor for TypedArray indexed properties
  var desc0 = Object.getOwnPropertyDescriptor(view, '0');
  r8.idx0 = desc0 ? JSON.stringify(desc0).substring(0, 100) : 'none';

  // Descriptor for length
  var descLen = Object.getOwnPropertyDescriptor(view, 'length');
  r8.length = descLen ? JSON.stringify(descLen).substring(0, 100) : 'none';

  // Descriptor for buffer
  var descBuf = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'buffer');
  r8.bufferDesc = descBuf ? Object.keys(descBuf).join(',') : 'none';
  r8.bufferGet = descBuf && descBuf.get ? typeof descBuf.get : 'none';

  // Can we redefine the buffer getter?
  try {
    Object.defineProperty(view, 'buffer', { get: function() { return 'hijacked'; } });
    r8.bufferRedefine = view.buffer === 'hijacked' ? 'HIJACKED' : 'original';
  } catch(e) {
    r8.bufferRedefine = 'err:' + e.message.substring(0, 30);
  }

  // byteLength descriptor
  var descBL = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'byteLength');
  r8.byteLenGet = descBL && descBL.get ? typeof descBL.get : 'none';

  // Try calling the buffer getter with a wrong "this"
  try {
    var bufGetter = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'buffer').get;
    var wrongThis = { not: 'a view' };
    var stolen = bufGetter.call(wrongThis);
    r8.wrongThisBuffer = typeof stolen;
  } catch(e) {
    r8.wrongThisBuffer = 'err:' + e.message.substring(0, 40);
  }

  // Try calling with an ArrayBuffer as this (type confusion of getter)
  try {
    var bufGetter2 = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'buffer').get;
    var stolen2 = bufGetter2.call(buf);
    r8.abThisBuffer = typeof stolen2;
  } catch(e) {
    r8.abThisBuffer = 'err:' + e.message.substring(0, 40);
  }

  results.push({ name: 'typedarray_internals', data: r8 });
} catch(e) {
  results.push({ name: 'typedarray_internals', error: e.message.substring(0, 60) });
}

// Test 9: Canvas toDataURL + SVG foreignObject — render DOM to canvas
try {
  var canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  var ctx = canvas.getContext('2d');

  // Draw something
  ctx.fillStyle = '#FF0000';
  ctx.fillRect(0, 0, 64, 64);

  // Get pixel data
  var imgData = ctx.getImageData(0, 0, 64, 64);
  var pixBuf = imgData.data.buffer;

  results.push({
    name: 'canvas_buffer',
    bufLen: pixBuf.byteLength,
    isSAB: typeof SharedArrayBuffer !== 'undefined' && pixBuf instanceof SharedArrayBuffer,
    isAB: pixBuf instanceof ArrayBuffer,
    dataLen: imgData.data.length,
    byte0: imgData.data[0],
    byte1: imgData.data[1],
    byte2: imgData.data[2],
    byte3: imgData.data[3]
  });

  // Can we confuse this canvas buffer via SC?
  // The canvas ImageData buffer should be SC-cloneable
  try {
    var testClone = structuredClone(imgData);
    results.push({
      name: 'canvas_sc',
      cloned: testClone instanceof ImageData,
      clonedBuf: testClone.data.buffer.byteLength,
      byte0: testClone.data[0]
    });
  } catch(e) {
    results.push({ name: 'canvas_sc', error: e.message.substring(0, 60) });
  }
} catch(e) {
  results.push({ name: 'canvas_buffer', error: e.message.substring(0, 60) });
}

// Test 10: AudioContext existence
try {
  var r10 = {};
  r10.AudioContext = typeof AudioContext;
  r10.webkitAudioContext = typeof webkitAudioContext;
  r10.OfflineAudioContext = typeof OfflineAudioContext;
  r10.webkitOfflineAudioContext = typeof webkitOfflineAudioContext;

  if (typeof webkitAudioContext !== 'undefined' || typeof AudioContext !== 'undefined') {
    var AC = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;
    try {
      var actx = new AC();
      r10.sampleRate = actx.sampleRate;
      r10.state = actx.state;
      r10.destination = typeof actx.destination;
      actx.close();
    } catch(e) {
      r10.create = 'err:' + e.message.substring(0, 40);
    }
  }

  results.push({ name: 'audio', data: r10 });
} catch(e) {
  results.push({ name: 'audio', error: e.message.substring(0, 60) });
}

return JSON.stringify(results);
})();
