// Compact fs-probe for eval delivery — each test is self-contained and async-aware
// Tests which web APIs pass controllable path components to the fs sysmodule

// Test 1: IndexedDB with path traversal in database name
(async function(){
  try {
    var name = 'probe/../\\\\MARKER_idb';
    var req = indexedDB.open(name, 1);
    return await new Promise(function(ok) {
      req.onerror = function(e) {
        ok('idb-error: ' + (e.target.error ? e.target.error.message : '?'));
      };
      req.onsuccess = function() {
        req.result.close();
        indexedDB.deleteDatabase(name);
        ok('idb-ok: opened with traversal marker');
      };
      req.onupgradeneeded = function(e) {
        e.target.result.createObjectStore('t');
      };
      setTimeout(function() { ok('idb-timeout'); }, 5000);
    });
  } catch(e) { return 'idb-exception: ' + e.message; }
})()
