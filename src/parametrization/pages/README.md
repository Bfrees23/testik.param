# Source HTML mirrors

Served pages live in `src/public/*.html` (source of truth).

Copies under `pages/` are kept in sync by `./scripts/sync-public-js.sh` so stale LKG/nav cannot drift.
Edit HTML only in `src/public/`, then run the sync script.
