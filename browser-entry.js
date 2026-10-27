(function (root) {
  'use strict';

  function bounded(value, maximum, required) {
    if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
      throw new Error('Missing or oversized entry metadata');
    }
    return value;
  }

  function buildReport(metadata, context) {
    var kinds = ['unverified', 'desktop-control', 'target-self-report'];
    if (!metadata || kinds.indexOf(metadata.kind) === -1) throw new Error('Unknown observation type');
    if (typeof metadata.include_properties !== 'boolean') throw new Error('Explicit observation choice required');
    var report = {
      schema_version: '1.0.0',
      report_type: 'browser-entry-evidence',
      timestamp: new Date().toISOString(),
      observation_kind: metadata.kind,
      firmware_or_os: bounded(metadata.firmware, 128, true),
      entry_context: bounded(metadata.entry_context, 2000, true),
      notes: bounded(metadata.notes, 2000, false),
      environment: {
        browser_ua: String(context.navigator.userAgent || '').slice(0, 2048),
        platform: String(context.navigator.platform || '').slice(0, 256),
        page_protocol: String(context.location.protocol),
        secure_context: context.isSecureContext === true,
        cross_origin_isolated: context.crossOriginIsolated === true
      },
      properties: null,
      limitations: {
        identity_attested: false,
        native_execution_established: false,
        recovery_verified: false,
        phase_4_complete: false
      }
    };
    if (metadata.include_properties) {
      report.properties = {
        webassembly: typeof context.WebAssembly === 'object',
        worker: typeof context.Worker === 'function',
        shared_array_buffer: typeof context.SharedArrayBuffer === 'function',
        bigint: typeof context.BigInt === 'function',
        blob: typeof context.Blob === 'function',
        object_url: !!(context.URL && typeof context.URL.createObjectURL === 'function')
      };
    }
    return report;
  }

  if (typeof module === 'object' && module.exports) module.exports = buildReport;
  if (!root || !root.document) return;
  var document = root.document;
  var output = document.getElementById('entry-output');
  var status = document.getElementById('entry-status');
  var download = document.getElementById('entry-download');
  var form = document.getElementById('entry-form');
  function invalidate() {
    output.value = '';
    download.disabled = true;
    status.textContent = 'Metadata changed; create a new local report before exporting.';
  }
  form.addEventListener('input', invalidate);
  form.addEventListener('change', invalidate);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    output.value = '';
    download.disabled = true;
    try {
      var report = buildReport({
        kind: document.getElementById('entry-kind').value,
        firmware: document.getElementById('entry-firmware').value,
        entry_context: document.getElementById('entry-context').value,
        notes: document.getElementById('entry-notes').value,
        include_properties: document.getElementById('entry-properties').checked
      }, root);
      output.value = JSON.stringify(report, null, 2) + '\n';
      download.disabled = !(root.Blob && root.URL && root.URL.createObjectURL && root.URL.revokeObjectURL);
      status.textContent = 'Local report ready. This is navigation evidence, not native execution or authenticated device identity.';
    } catch (error) {
      status.textContent = 'Report not generated: ' + error.message;
    }
  });
  download.addEventListener('click', function () {
    if (!output.value || download.disabled) return;
    var url;
    try {
      url = root.URL.createObjectURL(new root.Blob([output.value], { type: 'application/json' }));
      var link = document.createElement('a');
      link.href = url;
      link.download = 'browser-entry-evidence.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000);
    } catch (error) {
      if (url) root.URL.revokeObjectURL(url);
      status.textContent = 'Download unavailable; copy the JSON instead. ' + error.message;
    }
  });
}(typeof window === 'object' ? window : null));
