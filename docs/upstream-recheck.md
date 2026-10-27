# P0 — Upstream recheck

Checked October 27, 2026 using the GitLab API over HTTPS.

- Repository: `https://gitlab.com/pepsipu/ns2jb`
- Main revision: `95f5525089273c5fce0b95047f3600f8442e96ae`
- Commit date: October 22, 2026; title: `clarify`.
- Branch endpoint returned only `main`; tag endpoint returned an empty array.
- The current README still documents SmileBASIC 4.4.9 and firmware 23.0.1,
  not a browser entry point. No WebKit release was established by these checks.

This is a bounded inspection of this repository, not proof that no other
implementation exists. It does not revalidate eShop availability or hardware
execution. Browser availability and compatibility remain unverified.

Recheck with:

```sh
curl -fsSL 'https://gitlab.com/api/v4/projects/pepsipu%2Fns2jb/repository/commits/main'
curl -fsSL 'https://gitlab.com/api/v4/projects/pepsipu%2Fns2jb/repository/branches?per_page=100'
curl -fsSL 'https://gitlab.com/api/v4/projects/pepsipu%2Fns2jb/repository/tags?per_page=100'
curl -fsSL 'https://gitlab.com/pepsipu/ns2jb/-/raw/main/README.md'
```

Follow pagination headers if subsequent responses contain additional pages.
