# Deploying BHT Gurukul to Azure

The app runs as one Node.js process: the Express API also serves the built website when
`NODE_ENV=production`. It needs a PostgreSQL database.

## 1. Azure resources

- **Azure Database for PostgreSQL – Flexible Server**, PostgreSQL 16. Create an empty database
  (for example `gurukul`) and allow the app's outbound IPs in the server firewall.
- **Azure App Service** (Linux, Node 24 LTS) or a container host. Set the startup command to
  `node --enable-source-maps artifacts/api-server/dist/index.mjs`.

## 2. Environment variables (App Service → Configuration)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgres://USER:PASSWORD@SERVER.postgres.database.azure.com:5432/gurukul?sslmode=require` |
| `SESSION_SECRET` | A long random value (for example `openssl rand -hex 32`). Keep it secret; changing it signs everyone out. |
| `PORT` | Set automatically by App Service. |
| `SUPER_ADMIN_INITIAL_PASSWORD` | Initial super admin password (12+ characters). Used only when the account does not exist yet. |
| `SUPER_ADMIN_VERIFICATION_EMAIL` | Inbox that receives the super admin's sign-in codes. Needed unless `admin@gurukul.org` is a mailbox you can read. |
| `MEMBER_EMAIL_PROVIDER` | `smtp` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mail server for verification codes (for example Azure Communication Services SMTP, or Gmail with an app password). |

Do **not** set `SEED_DEMO_DATA` in production. The `gmail`/`resend` providers use Replit connectors
and do not work on Azure; use `smtp`.

## 3. Build

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/gurukul run build
```

The website build is written to `artifacts/gurukul/dist/public`, which the API serves.

## 4. Database schema and reference data (first deployment)

Run these once against the production database, with `DATABASE_URL` set:

```bash
pnpm --filter @workspace/db run push
SUPER_ADMIN_INITIAL_PASSWORD='…' pnpm --filter @workspace/scripts run bootstrap
```

- `push` creates the tables. On an existing database, answer **No** if it ever offers to truncate
  or delete data.
- `bootstrap` loads reference data from `scripts/reference-data/`: portal settings, the course
  catalogue with levels, membership tiers, and the super admin account. It only adds what is
  missing, so it is safe to run again. Edit the JSON files first to change course details or to
  pre-set course fees. `--overwrite-settings` and `--update-courses` reapply the files to existing rows.

## 5. After the first deployment (administrator)

1. Log in at `/admin` as `admin@gurukul.org` and change the password. Admin sign-in emails a
   6-digit code, so SMTP and `SUPER_ADMIN_VERIFICATION_EMAIL` must work first. Every admin you add
   needs a valid email address to sign in. Admin sessions last 2 hours.
2. **Settings:** registration curriculum year, registration open/close dates, session start/end
   dates, annual membership fee, Bag & Supplies fee (defaults to $11.00), and Stripe keys for
   online payment.
3. **Course Management:** set each course's fee and confirm its class timing. Courses without a
   fee cannot be selected by parents.
4. Create sections and add teachers and staff as needed.

Public registration stays closed until the session start date and registration window are set.

## Starting over on a non-production database

`reset-transactional` deletes all members, students, registrations, payments, staff, content and
logs, and keeps settings, courses, levels, sections, membership tiers and the super admin.
Take a backup first.

```bash
pnpm --filter @workspace/scripts run reset-transactional -- --yes
```

It refuses to run when `NODE_ENV=production` unless `--production` is also passed.
