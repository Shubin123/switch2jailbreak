# P1 — Browser capability baseline

Target console browser access has not been demonstrated. Do not label host
results as console results or infer browser access from the user-agent string.

Open `tests/browser-harness.html` in an available desktop browser first. Record
the browser version, OS, firmware if applicable, repository revision, page URL
scheme, and any relevant response headers alongside exported JSON. Keep a
desktop control separate from a target-console observation.

All three suites must load and pass result-accounting validation; the export must contain 55 results with
`complete: true`. A missing suite is an incomplete run, not evidence of an
unsupported API. Classic scripts are isolated to avoid global declarations
colliding. Older engines may still reject unsupported syntax before a suite
can run; that also produces an incomplete run.

The harness records secure-context and cross-origin-isolation state because
API availability is context-dependent. Absence alone does not establish an
engine limitation or a security boundary. No target browser results are
currently available.

## Automated desktop controls

Install the exact development dependencies with `npm ci --ignore-scripts`, then
install the matching browsers using `npx playwright install chromium firefox
webkit`. Run `npm run test:browser`. Linux CI installs required system libraries
and runs all three engines. These are desktop engines, not Switch 2 emulators.

The loopback-only test server exposes only the harness assets, never the whole
repository. A normal context and a COOP/COEP context are compared. The latter
also supplies a CSP that denies `fetch`; the control confirms requests are
blocked before reaching the server. The harness's CSP-meta check is not treated
as a detector for response-header policy.

Each engine tests successful JSON export, missing and malformed suites, and
HTML-like observation names. The six baseline exports include browser version,
source revision, dirty-tree state and hashes of harness assets. Validate saved
evidence with `node scripts/validate-results.cjs results/browser-*.json`.

On the current macOS 27 host, Chromium and WebKit controls ran successfully.
The bundled Firefox process exited during startup with `Could not find profile
folder`; it did not execute the tests. Firefox remains a required Linux CI gate,
not a silently skipped or passing local test. Do not weaken OS privacy settings
or use an existing personal browser profile to bypass this launch failure.

The runtime suite deliberately catches recursion errors and allocates a 64 MiB
buffer. Use a disposable desktop tab first; do not run on a console with unsaved
work. JSON export currently displays text for manual capture, not an upload.
