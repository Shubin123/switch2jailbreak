// Deep probe: does localStorage use filesystem paths? + other fs vectors
(function() {
'use strict';
var results = [];

// Test 1: localStorage with null byte (if path-based, null truncates C string)
try {
  var r1 = {};
  var nullKey = 'before\x00after';
  localStorage.setItem(nullKey, 'nulltest');
  var val = localStorage.getItem(nullKey);
  r1.nullKeyStored = val === 'nulltest';
  // Also try reading with truncated key
  var truncVal = localStorage.getItem('before');
  r1.truncKeyMatch = truncVal === 'nulltest';
  // And with the full key
  r1.fullKeyMatch = localStorage.getItem('before\x00after') === 'nulltest';
  localStorage.removeItem(nullKey);
  results.push({name: 'ls_null_byte', data: r1});
} catch(e) {
  results.push({name: 'ls_null_byte', error: e.message.substring(0, 80)});
}

// Test 2: localStorage with extreme key length
try {
  var r2 = {};
  var lengths = [500, 769, 770, 1000, 2000, 5000, 10000, 50000];
  for (var i = 0; i < lengths.length; i++) {
    var len = lengths[i];
    try {
      var key = 'L' + len + '_' + 'X'.repeat(len);
      localStorage.setItem(key, 'v');
      r2['len_' + len] = localStorage.getItem(key) === 'v' ? 'ok' : 'mismatch';
      localStorage.removeItem(key);
    } catch(e) {
      r2['len_' + len] = e.name + ':' + e.message.substring(0, 40);
    }
  }
  results.push({name: 'ls_key_limits', data: r2});
} catch(e) {
  results.push({name: 'ls_key_limits', error: e.message.substring(0, 80)});
}

// Test 3: localStorage with filesystem special chars
try {
  var r3 = {};
  var specialKeys = {
    'slash': 'abc/def/ghi',
    'backslash': 'abc\\def\\ghi',
    'dotdot': '../../../etc/passwd',
    'colon': 'a:b:c',
    'star': 'a*b*c',
    'question': 'a?b?c',
    'pipe': 'a|b|c',
    'angle': 'a<b>c',
    'quote': 'a"b"c',
    'newline': 'a\nb\nc',
    'tab': 'a\tb\tc',
    'unicode': '\u0000\u0001\u0002\u001F',
    'longslash': '/' + '/'.repeat(769),
    'dotdotbs': 'a/..\\..\\..' + 'B'.repeat(769)
  };
  Object.keys(specialKeys).forEach(function(name) {
    try {
      localStorage.setItem(specialKeys[name], name);
      r3[name] = localStorage.getItem(specialKeys[name]) === name ? 'ok' : 'mismatch';
      localStorage.removeItem(specialKeys[name]);
    } catch(e) {
      r3[name] = e.name.substring(0, 15) + ':' + e.message.substring(0, 40);
    }
  });
  results.push({name: 'ls_special_chars', data: r3});
} catch(e) {
  results.push({name: 'ls_special_chars', error: e.message.substring(0, 80)});
}

// Test 4: webkitRequestFileSystem / requestFileSystem
try {
  var r4 = {};
  r4.webkit = typeof webkitRequestFileSystem;
  r4.standard = typeof requestFileSystem;
  r4.webkitResolve = typeof webkitResolveLocalFileSystemURL;
  r4.resolveLocal = typeof resolveLocalFileSystemURL;
  r4.FileSystem = typeof FileSystem;
  r4.FileSystemHandle = typeof FileSystemHandle;
  r4.showOpenFilePicker = typeof showOpenFilePicker;
  r4.showSaveFilePicker = typeof showSaveFilePicker;
  r4.showDirectoryPicker = typeof showDirectoryPicker;
  
  // Try webkitRequestFileSystem if available
  if (typeof webkitRequestFileSystem === 'function') {
    try {
      webkitRequestFileSystem(0, 1024, function(fs) {
        r4.fsName = fs.name;
        r4.fsRoot = fs.root.fullPath;
      }, function(e) {
        r4.fsError = e.message || e.code;
      });
    } catch(e) {
      r4.fsTry = e.message.substring(0, 60);
    }
  }
  
  results.push({name: 'filesystem_api', data: r4});
} catch(e) {
  results.push({name: 'filesystem_api', error: e.message.substring(0, 80)});
}

// Test 5: Make HTTP requests with very long paths (cache might use fs)
try {
  var r5 = {};
  // Request from our server with a long path
  var longHttpPath = '/probe/' + 'P'.repeat(800) + '/..\\data';
  try {
    var x = new XMLHttpRequest();
    x.open('GET', longHttpPath, false);
    x.send();
    r5.longHttpXhr = {status: x.status, len: x.responseText.length, text: x.responseText.substring(0, 80)};
  } catch(e) {
    r5.longHttpXhr = e.message.substring(0, 60);
  }
  
  // With Cache-Control to force caching
  try {
    var x2 = new XMLHttpRequest();
    x2.open('GET', '/probe/' + 'Q'.repeat(800), false);
    x2.setRequestHeader('Cache-Control', 'max-age=99999');
    x2.send();
    r5.longHttpCached = {status: x2.status};
  } catch(e) {
    r5.longHttpCached = e.message.substring(0, 60);
  }
  
  results.push({name: 'long_http_cache', data: r5});
} catch(e) {
  results.push({name: 'long_http_cache', error: e.message.substring(0, 80)});
}

// Test 6: Image/media with data URI (might use temp file on fs)
try {
  var r6 = {};
  // Create a large data URI
  var canvas = document.createElement('canvas');
  canvas.width = 100; canvas.height = 100;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, 100, 100);
  var dataUrl = canvas.toDataURL('image/png');
  r6.dataUrlLen = dataUrl.length;
  
  // Try to create a blob and download it
  try {
    var a = document.createElement('a');
    var longFilename = 'F'.repeat(800) + '/..\\test.png';
    a.download = longFilename;
    a.href = dataUrl;
    r6.downloadAttr = a.download.length;
    // Don't actually click — just check if the attribute is accepted
  } catch(e) {
    r6.downloadErr = e.message.substring(0, 60);
  }
  
  results.push({name: 'data_uri_fs', data: r6});
} catch(e) {
  results.push({name: 'data_uri_fs', error: e.message.substring(0, 80)});
}

// Test 7: IndexedDB (might use filesystem more directly than localStorage)
try {
  var r7 = {};
  try {
    // Try opening a database with a very long name
    var longDbName = 'db_' + 'R'.repeat(800) + '/..\\';
    var req = indexedDB.open(longDbName, 1);
    req.onerror = function(e) {
      r7.longDbName = 'err:' + (e.target.error ? e.target.error.message : 'unknown').substring(0, 60);
    };
    req.onsuccess = function(e) {
      r7.longDbName = 'opened';
      e.target.result.close();
      // Try deleting it
      indexedDB.deleteDatabase(longDbName);
    };
    req.onupgradeneeded = function(e) {
      r7.longDbUpgrade = true;
    };
  } catch(e) {
    r7.longDbName = 'throw:' + e.message.substring(0, 60);
  }
  
  // Normal DB but with long store/key names
  try {
    var req2 = indexedDB.open('probe_db', 1);
    req2.onupgradeneeded = function(e) {
      var db = e.target.result;
      try {
        var longStoreName = 'store_' + 'S'.repeat(800) + '/..\\';
        db.createObjectStore(longStoreName);
        r7.longStoreName = 'created';
      } catch(ex) {
        r7.longStoreName = 'err:' + ex.message.substring(0, 60);
      }
    };
    req2.onerror = function(e) {
      r7.normalDb = 'err';
    };
    req2.onsuccess = function(e) {
      r7.normalDb = 'opened';
      e.target.result.close();
      indexedDB.deleteDatabase('probe_db');
    };
  } catch(e) {
    r7.normalDb = 'throw:' + e.message.substring(0, 60);
  }
  
  results.push({name: 'idb_overflow', data: r7});
} catch(e) {
  results.push({name: 'idb_overflow', error: e.message.substring(0, 80)});
}

// Test 8: navigator.sendBeacon with long URL
try {
  var r8 = {};
  r8.sendBeacon = typeof navigator.sendBeacon;
  if (typeof navigator.sendBeacon === 'function') {
    try {
      var longBeaconUrl = '/beacon/' + 'T'.repeat(800) + '/..\\log';
      var sent = navigator.sendBeacon(longBeaconUrl, 'data');
      r8.longBeacon = sent ? 'sent' : 'rejected';
    } catch(e) {
      r8.longBeacon = e.message.substring(0, 60);
    }
  }
  results.push({name: 'beacon', data: r8});
} catch(e) {
  results.push({name: 'beacon', error: e.message.substring(0, 80)});
}

// Test 9: performance.mark/measure with long names (might get persisted)
try {
  var r9 = {};
  try {
    var longMarkName = 'mark_' + 'U'.repeat(800);
    performance.mark(longMarkName);
    r9.longMark = 'set';
    performance.clearMarks(longMarkName);
  } catch(e) {
    r9.longMark = e.message.substring(0, 60);
  }
  results.push({name: 'perf_marks', data: r9});
} catch(e) {
  results.push({name: 'perf_marks', error: e.message.substring(0, 80)});
}

// Test 10: Check what origin localStorage is scoped to
try {
  var r10 = {};
  // Write in main frame
  localStorage.setItem('__origin_test', location.origin);
  r10.mainOrigin = location.origin;
  
  // Check from a blob iframe
  var blobCode = '<script>try{var v=localStorage.getItem("__origin_test");parent.postMessage({lsOrigin:v,iframeOrigin:location.origin},"*")}catch(e){parent.postMessage({lsErr:e.message},"*")}<\/script>';
  var blob = new Blob([blobCode], {type: 'text/html'});
  var blobUrl = URL.createObjectURL(blob);
  var iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = blobUrl;
  
  window.addEventListener('message', function handler(e) {
    if (e.data && (e.data.lsOrigin !== undefined || e.data.lsErr)) {
      r10.blobFrameResult = e.data;
      window.removeEventListener('message', handler);
    }
  });
  
  document.body.appendChild(iframe);
  setTimeout(function() {
    iframe.remove();
    URL.revokeObjectURL(blobUrl);
    localStorage.removeItem('__origin_test');
    results.push({name: 'ls_origin_scope', data: r10});
  }, 500);
} catch(e) {
  results.push({name: 'ls_origin_scope', error: e.message.substring(0, 80)});
}

return new Promise(function(resolve) {
  setTimeout(function() {
    resolve(JSON.stringify(results));
  }, 2000);
});
})();
