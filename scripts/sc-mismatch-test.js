// Structured Clone Object Pool Mismatch test
// WebKit Bug 265975 — fixed 2024-01-26 in Safari 17.3
// WebKit 613.0 (Safari 17.0) should be VULNERABLE
//
// The bug: CloneSerializer/CloneDeserializer shared m_gcBuffer for both
// object-pool references and GC keep-alive. BigInt serialization adds entries
// to the GC buffer that shift object pool indices, causing duplicate
// references to point to the wrong object on deserialization.
//
// This test checks if the bug exists without attempting exploitation.
(function() {
'use strict';

var results = {
  apis: {},
  tests: [],
  vulnerable: null,
  error: null
};

function log(msg) {
  results.tests.push(msg);
  if (typeof console !== 'undefined') console.log('[sc-test] ' + msg);
}

// Phase 1: Check required APIs
function checkAPIs() {
  results.apis.historyReplaceState = typeof history !== 'undefined' &&
    typeof history.replaceState === 'function';
  results.apis.historyState = typeof history !== 'undefined' &&
    'state' in history;
  results.apis.BigInt = typeof BigInt === 'function';
  results.apis.MessageChannel = typeof MessageChannel === 'function';
  results.apis.Symbol = typeof Symbol === 'function';
  results.apis.Proxy = typeof Proxy === 'function';
  results.apis.ArrayBuffer = typeof ArrayBuffer === 'function';
  results.apis.Uint8Array = typeof Uint8Array === 'function';

  log('API check:');
  for (var k in results.apis) {
    log('  ' + k + ': ' + results.apis[k]);
  }

  if (!results.apis.historyReplaceState) {
    results.error = 'history.replaceState not available';
    return false;
  }
  if (!results.apis.BigInt) {
    results.error = 'BigInt not available';
    return false;
  }
  return true;
}

// Phase 2: Basic structured clone roundtrip with BigInt
function testBasicClone() {
  log('Test 1: Basic structured clone with BigInt');
  try {
    var ref = { id: 42 };
    var graph = [ref, ref, 1n << 40n, ref];
    history.replaceState(graph, '');
    var clone = history.state;

    if (!clone || clone.length !== 4) {
      log('  FAIL: clone length mismatch (got ' + (clone ? clone.length : 'null') + ')');
      return false;
    }

    log('  clone[0] === clone[1]: ' + (clone[0] === clone[1]));
    log('  clone[0] === clone[3]: ' + (clone[0] === clone[3]));
    log('  clone[2] type: ' + typeof clone[2]);

    if (clone[0] !== clone[1] || clone[0] !== clone[3]) {
      log('  MISMATCH DETECTED! Object references are not equal after clone');
      return 'mismatch';
    }
    log('  OK: references preserved');
    return true;
  } catch (e) {
    log('  ERROR: ' + e.message);
    return false;
  }
}

// Phase 3: Escalated test with multiple BigInts shifting the pool
function testPoolShift() {
  log('Test 2: Pool shift with multiple BigInts');
  try {
    var ref = { marker: 0xBEEF };
    var huge = 1n << 40n;

    var inner = new Array(0x100);
    var pos = 0;
    for (var i = 0; i < 4; i++) inner[pos++] = huge + BigInt(i);
    while (pos < inner.length) inner[pos++] = {};

    var outer = new Array(0x10000 + 1);
    outer[0] = inner;
    outer[1] = ref;
    outer[2] = ref;
    outer[0x10000] = -64000;

    history.replaceState(outer, '');
    var clone = history.state;

    if (!clone) {
      log('  FAIL: clone is null');
      return false;
    }

    log('  clone.length: ' + clone.length);
    log('  clone[1] type: ' + typeof clone[1]);
    log('  clone[2] type: ' + typeof clone[2]);

    if (clone[1] === clone[2]) {
      log('  References match (no mismatch at this size)');
    } else {
      log('  MISMATCH! clone[1] !== clone[2]');
      log('  clone[1]: ' + JSON.stringify(clone[1]));
      log('  clone[2]: ' + (clone[2] instanceof Uint8Array ? 'Uint8Array(' + clone[2].length + ')' :
          typeof clone[2] === 'object' ? JSON.stringify(clone[2]) : String(clone[2])));
      return 'mismatch';
    }
    return true;
  } catch (e) {
    log('  ERROR: ' + e.message);
    return false;
  }
}

// Phase 4: Larger graph closer to exploit conditions
function testLargeGraph() {
  log('Test 3: Large graph with BigInt fill');
  try {
    var ref = { tag: 'dup' };

    var filler = new Array(0xfffd);
    var pos = 0;
    var huge = 1n << 40n;
    for (var i = 0; i < 2; i++) filler[pos++] = huge + BigInt(i);
    while (pos < filler.length) filler[pos++] = {};

    var graph = new Array(0x10000);
    graph[0] = filler;
    graph[1] = ref;
    graph[2] = ref;
    graph[0xffff] = -64000;

    history.replaceState(graph, '');
    var clone = history.state;

    if (!clone) {
      log('  FAIL: clone is null');
      return false;
    }

    log('  clone.length: ' + clone.length);

    var sameRef = clone[1] === clone[2];
    log('  clone[1] === clone[2]: ' + sameRef);

    if (!sameRef) {
      log('  MISMATCH DETECTED!');
      var t1 = typeof clone[1];
      var t2 = typeof clone[2];
      log('  clone[1] type: ' + t1);
      log('  clone[2] type: ' + t2);
      if (clone[2] instanceof Uint8Array) {
        log('  clone[2] is Uint8Array! length=' + clone[2].length);
      } else if (clone[2] instanceof ArrayBuffer) {
        log('  clone[2] is ArrayBuffer! byteLength=' + clone[2].byteLength);
      }
      return 'mismatch';
    }
    log('  References match');
    return true;
  } catch (e) {
    log('  ERROR: ' + e.message);
    return false;
  }
}

// Phase 5: Vary BigInt count (exploit does this per-attempt)
function testBigIntCounts() {
  log('Test 4: Varying BigInt counts (1,2,4,6,7)');
  var counts = [1, 2, 4, 6, 7];
  var anyMismatch = false;

  for (var ci = 0; ci < counts.length; ci++) {
    var count = counts[ci];
    try {
      var ref = { n: count };
      var filler = new Array(0xfffd);
      var pos = 0;
      var huge = 1n << 40n;
      for (var i = 0; i < count; i++) filler[pos++] = huge + BigInt(i);
      while (pos < filler.length) filler[pos++] = {};

      var graph = new Array(0x10000);
      graph[0] = filler;
      graph[1] = ref;
      graph[2] = ref;
      graph[0xffff] = -64000;

      history.replaceState(graph, '');
      var clone = history.state;

      if (!clone) {
        log('  count=' + count + ': FAIL (null clone)');
        continue;
      }

      var match = clone[1] === clone[2];
      log('  count=' + count + ': refs match=' + match +
        ' types=[' + typeof clone[1] + ',' + typeof clone[2] + ']');

      if (!match) {
        anyMismatch = true;
        if (clone[2] instanceof Uint8Array)
          log('    clone[2] is Uint8Array(' + clone[2].length + ')!');
      }
    } catch (e) {
      log('  count=' + count + ': ERROR ' + e.message);
    }
  }

  return anyMismatch ? 'mismatch' : true;
}

// Run all tests
function run() {
  log('=== Structured Clone Object Pool Mismatch Test ===');
  log('Target: WebKit Bug 265975 (fixed Safari 17.3)');
  log('Expected: VULNERABLE on WebKit 613.0 (Safari 17.0)');
  log('');

  if (!checkAPIs()) {
    return JSON.stringify(results);
  }

  var t1 = testBasicClone();
  var t2 = testPoolShift();
  var t3 = testLargeGraph();
  var t4 = testBigIntCounts();

  // Clean up history state
  try { history.replaceState(null, ''); } catch(e) {}

  if (t1 === 'mismatch' || t2 === 'mismatch' || t3 === 'mismatch' || t4 === 'mismatch') {
    results.vulnerable = true;
    log('');
    log('*** VULNERABLE: Structured clone object pool mismatch confirmed! ***');
    log('The BigInt serialization shifts object pool indices,');
    log('causing duplicate references to desync on deserialization.');
    log('This can be exploited for arbitrary R/W via history.replaceState.');
  } else if (t1 === false || t2 === false || t3 === false || t4 === false) {
    results.vulnerable = 'error';
    log('');
    log('Some tests failed — check errors above.');
  } else {
    results.vulnerable = false;
    log('');
    log('NOT VULNERABLE: All references preserved correctly.');
    log('The object pool mismatch bug appears to be fixed.');
  }

  return JSON.stringify(results);
}

return run();
})();
