# CSE Staff Directory (PWA)

**Architecture:** one Node/Express service = REST API (`/api/*`) + static PWA (`/public`) → PostgreSQL.
Offline: service worker caches the app shell; contacts are cached in localStorage and synced incrementally (`?since=`; deletions are soft-deleted so clients remove them).
Conflicts: server is the source of truth (last write wins by `updated_at`).

## API
| Method | Path | Auth |
|---|---|---|
| GET | /api/contacts[?since=ISO] | public |
| POST | /api/login | public (10/15min) |
| POST / PUT / DELETE | /api/contacts[/:id] | admin |
| POST | /api/import/preview (multipart `file`) → items + duplicate info | admin |
| POST | /api/import/commit `{items:[{...,action:skip\|update\|create,matchId}]}` | admin |
| GET | /api/admin/stats (totals, recent, duplicates, audit) | admin |
| GET | /api/export/vcf\|csv\|xlsx | admin |

Schema: `schema.sql` (auto-applied on boot). Indexes: phone_norm, lower(name), updated_at.

## Run locally
```
npm install
DATABASE_URL=postgres://user:pass@localhost/cse JWT_SECRET=$(openssl rand -hex 32) ADMIN_USER=admin ADMIN_PASS='ChangeMe!123' npm start
```
`ADMIN_PASS` is only used on first run to create the bcrypt-hashed admin.

## Free hosting (Render + Neon)
1. Create a free Postgres at neon.tech → copy the connection string.
2. Push this folder to a GitHub repo.
3. Render.com → New Web Service → select repo. Build: `npm install`, Start: `npm start`, Free instance.
4. Environment variables: `DATABASE_URL`, `JWT_SECRET` (long random), `ADMIN_USER`, `ADMIN_PASS`.
5. Open the `*.onrender.com` URL → Admin → log in. Installable via browser "Install app".
Note: free instances sleep when idle (first load can take ~1 min); cached data still works offline. Free-tier terms change, so verify current limits.

## VPS
Install Node 18+ and PostgreSQL, clone repo, set env vars in a `.env`/systemd unit, run with `pm2 start server.js`, put Nginx in front (`proxy_pass http://127.0.0.1:3000`) and enable HTTPS with certbot (required for PWA install).

## Maintenance
Back up with `pg_dump`. Rotate `JWT_SECRET` to force logout. To change the admin password: `DELETE FROM admin;` then restart with a new `ADMIN_PASS`. Update deps with `npm update`.
