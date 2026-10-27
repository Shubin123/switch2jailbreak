# P1 — Browser capability baseline

Target console browser access has not been demonstrated. Do not label host
results as console results or infer browser access from the user-agent string.

Open `tests/browser-harness.html` in an available desktop browser first. Record
the browser version, OS, firmware if applicable, repository revision, page URL
scheme, and any relevant response headers alongside exported JSON. Keep a
desktop control separate from a target-console observation.

All three suites must load and the export must contain 55 results with
`complete: true`. A missing suite is an incomplete run, not evidence of an
unsupported API. Classic scripts are isolated to avoid global declarations
colliding. Older engines may still reject unsupported syntax before a suite
can run; that also produces an incomplete run.

The harness records secure-context and cross-origin-isolation state because
API availability is context-dependent. Absence alone does not establish an
engine limitation or a security boundary. No target browser results are
currently available.

The runtime suite deliberately catches recursion errors and allocates a 64 MiB
buffer. Use a disposable desktop tab first; do not run on a console with unsaved
work. JSON export currently displays text for manual capture, not an upload.
