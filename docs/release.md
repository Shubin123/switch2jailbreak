# Phase 5 — Reproducible workspace release

This release packages research and verification source only. It does not
redistribute the upstream native payload or provide a browser jailbreak.

## Gates

1. The upstream inspection must complete successfully; network errors are not
   evidence of unchanged source.
2. All host regressions and Node.js 22/24/26 CI runs must pass. Applicability
   skips must remain explicit; a skipped browser check is not a passed check.
3. Chromium, Firefox and WebKit desktop control suites must pass in Linux CI.
   Raw capability failures remain in their JSON observations. They are not
   hidden to force a passing browser regression suite.
4. The pinned upstream host suite, payload integrity policy and Zig 0.15.2
   byte-for-byte rebuild must pass.
5. Two source packages from the same clean commit must match byte-for-byte;
   their checksums must verify. Publish the exact tested revision and evidence.

## Reproduce source packaging

```sh
git clone https://github.com/Shubin123/switch2jailbreak.git
cd switch2jailbreak
git checkout <published-full-commit>
npm ci --ignore-scripts
npm test
bash tests/run-all.sh
npx playwright install --with-deps chromium firefox webkit
npm run test:browser
bash scripts/install-zig.sh "$PWD/.tools/zig-0.15.2"
PATH="$PWD/.tools/zig-0.15.2:$PATH" REQUIRE_REBUILD=1 bash scripts/verify-upstream.sh
node scripts/package-release.cjs dist/first
node scripts/package-release.cjs dist/second
diff -r dist/first dist/second
(cd dist/first && shasum -a 256 --check SHA256SUMS)
```

Use Linux x86_64 for the full browser gate. The installer additionally supports
macOS arm64, where the current bundled Firefox has a documented launch failure.

The source archive is produced by `git archive`, not by tarring the working
directory. Ignored results, caches, compiler downloads, private local state,
and Git credentials are excluded. A clean tree is mandatory. The manifest
identifies the exact commit and archive SHA256. Existing output files are never
overwritten. Timestamps inside the source archive come from the commit, not
the packaging clock. Raw test evidence has real run timestamps and is separate
from the reproducible source package.

SHA256 establishes agreement with the supplied manifest, not publisher
authenticity. Verify the published commit and source through trusted channels.
Source dependencies are locked; browser binaries are selected by the pinned
Playwright release. A workspace release does not complete independent console
validation or a formal upstream security audit.
