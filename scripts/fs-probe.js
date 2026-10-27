// fs-probe.js — test which web APIs pass controllable paths to the fs sysmodule
// Sent to the Switch 2 browser via the debug bridge eval API.
// Each test creates filesystem activity with path-traversal markers.
// If any marker reaches fs's GetEntryType, it would trigger path normalization.
//
// SAFETY: These tests use MARKER strings, not actual overflow payloads.
// A crash of the fs sysmodule would manifest as system instability.
// The debug bridge heartbeat (1.5s poll) detects if the browser dies.

var results = [];
var marker = '/PROBE' + '/..' + '\\\\' + '/MARKER';

function log(name, status, detail) {
  results.push({ test: name, status: status, detail: detail || '' });
}

// Test 1: IndexedDB database name with path components
function testIndexedDB() {
  return new Promise(function(resolve) {
    try {
      var name = 'probe' + marker + '_idb';
      var req = indexedDB.open(name, 1);
      req.onerror = function(e) {
        log('indexedDB.open', 'error', e.target.error ? e.target.error.message : 'unknown');
        resolve();
      };
      req.onsuccess = function() {
        log('indexedDB.open', 'ok', 'database opened with path marker in name');
        req.result.close();
        var del = indexedDB.deleteDatabase(name);
        del.onsuccess = function() { resolve(); };
        del.onerror = function() { resolve(); };
      };
      req.onupgradeneeded = function(e) {
        e.target.result.createObjectStore('test');
      };
      setTimeout(function() {
        log('indexedDB.open', 'timeout', 'no response in 5s');
        resolve();
      }, 5000);
    } catch (e) {
      log('indexedDB.open', 'exception', e.message);
      resolve();
    }
  });
}

// Test 2: localStorage key with path components
function testLocalStorage() {
  try {
    var key = 'probe' + marker + '_ls';
    localStorage.setItem(key, 'test');
    var val = localStorage.getItem(key);
    localStorage.removeItem(key);
    log('localStorage', val === 'test' ? 'ok' : 'mismatch', 'key with path marker');
  } catch (e) {
    log('localStorage', 'exception', e.message);
  }
}

// Test 3: Fetch to a path with traversal sequences (local server)
function testFetch() {
  return new Promise(function(resolve) {
    try {
      var url = '/probe' + marker + '/test.txt';
      fetch(url).then(function(r) {
        log('fetch-path', r.status.toString(), 'path: ' + url);
        resolve();
      }).catch(function(e) {
        log('fetch-path', 'error', e.message);
        resolve();
      });
    } catch (e) {
      log('fetch-path', 'exception', e.message);
      resolve();
    }
  });
}

// Test 4: Worker with path-marker URL
function testWorker() {
  return new Promise(function(resolve) {
    try {
      var blob = new Blob(['postMessage("alive")'], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      var w = new Worker(url);
      w.onmessage = function() {
        log('worker-blob', 'ok', 'blob worker started');
        w.terminate();
        URL.revokeObjectURL(url);
        resolve();
      };
      w.onerror = function(e) {
        log('worker-blob', 'error', e.message || 'unknown');
        resolve();
      };
      setTimeout(function() { resolve(); }, 3000);
    } catch (e) {
      log('worker-blob', 'exception', e.message);
      resolve();
    }
  });
}

// Test 5: Create and read a Blob URL with path markers
function testBlobURL() {
  try {
    var blob = new Blob(['test'], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    log('blob-url', 'ok', 'created: ' + url.substring(0, 60));
    URL.revokeObjectURL(url);
  } catch (e) {
    log('blob-url', 'exception', e.message);
  }
}

// Test 6: Cache API (if available)
function testCacheAPI() {
  return new Promise(function(resolve) {
    if (typeof caches === 'undefined') {
      log('cache-api', 'unavailable', '');
      resolve();
      return;
    }
    try {
      caches.open('probe' + marker).then(function(cache) {
        log('cache-api', 'ok', 'cache opened with path marker');
        caches.delete('probe' + marker).then(function() { resolve(); });
      }).catch(function(e) {
        log('cache-api', 'error', e.message);
        resolve();
      });
    } catch (e) {
      log('cache-api', 'exception', e.message);
      resolve();
    }
  });
}

// Test 7: Image load with path traversal in src
function testImageLoad() {
  return new Promise(function(resolve) {
    try {
      var img = new Image();
      img.onload = function() {
        log('image-path', 'loaded', 'unexpected');
        resolve();
      };
      img.onerror = function() {
        log('image-path', 'error', 'expected 404 but path was sent');
        resolve();
      };
      img.src = '/probe' + marker + '/test.png';
      setTimeout(function() {
        log('image-path', 'timeout', '');
        resolve();
      }, 3000);
    } catch (e) {
      log('image-path', 'exception', e.message);
      resolve();
    }
  });
}

// Run all tests sequentially
(async function() {
  testLocalStorage();
  testBlobURL();
  await testIndexedDB();
  await testFetch();
  await testWorker();
  await testCacheAPI();
  await testImageLoad();
  return JSON.stringify(results);
})()
