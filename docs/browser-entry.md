# Browser entry evidence flow

The entry page is an ordinary static page and local evidence recorder, not a
WebKit exploit or native loader. It requires no SmileBASIC merely to display
the page. Whether the console can reach it through the proposed captive portal
remains unverified. Local changes are not a claim that GitHub Pages was updated.

## Preview and record

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

Open `http://127.0.0.1:8000/browser-entry.html` on the host. This loopback
preview is not reachable from a console and intentionally exposes no LAN host
bridge. Use your normal site publication process for an intentionally hosted
copy; this change does not modify repository visibility or publish a new site.

1. Choose desktop control, unverified context, or target self-report honestly.
2. Enter the observed firmware/OS (or `unknown`) and the navigation context.
3. Optionally request presence-only observations. They do not allocate test
   buffers, create workers, touch storage, contact a service or run native code.
4. Create the report, review the JSON, and download it if supported. Copying
   from the textarea remains available when downloads are unsupported.
5. Validate a saved report on the host:

```sh
node scripts/validate-browser-entry.cjs /path/to/browser-entry-evidence.json
```

The export omits the page URL, query and fragment, reducing accidental leakage
of portal/session tokens. Free-text fields and user-agent still need privacy
review. Nothing is uploaded or persisted in browser storage. Reloading loses
unsaved form data. Editing metadata clears the old export to avoid downloading
a stale report. The timestamp is the client clock, not a trusted server time.

If scripting fails, a `noscript` instruction explains manual recording. If a
script asset fails despite JavaScript being enabled, the static warning remains
and the initial status never claims a generated report. The CSP blocks form
submission and network fetches; native/host operations are not provided.

## Evidence boundary and testing

The separate report schema requires native execution, recovery, authenticated
identity and Phase 4 completion to remain false. A schema-valid self-report is
not authenticated hardware evidence. This small report is not the full
55-observation compatibility export, which must be collected separately only
after reviewing the heavier harness's resource requirements.

Host regressions exercise input bounds, optional properties, privacy exclusions
and rejection of inflated claims. Real desktop Chromium and WebKit controls
exercise UI/export/download, no automatic report generation, CSP fetch blocking,
no browser storage writes and the no-JavaScript fallback. Firefox fails locally
before page load with `Could not find profile folder`; the suite retains that
failure and still requires Firefox in Linux CI. Desktop reports are saved as
`results/entry-<engine>.json` and labeled desktop controls, not console captures.

No complete browser-native execution chain, exhaustive native review, independent
console execution or physical recovery validation is established by this work.
