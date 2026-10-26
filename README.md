<div align="center">

# QUEMO

**Your money, muscles, meds and meals — tracked from any AI chat.**

Four MCP servers on Cloudflare Workers + one neon-soaked sign-in. Register with just your email, connect Claude, ChatGPT, Cursor or anything that speaks MCP, and talk to your data.

</div>

---

## The districts

| Tool | Worker | What you can say |
|---|---|---|
| 💸 **Quemo Budget** | `quemo-budget` | "spent 23€ on groceries at Rewe" · "how's my budget this month?" · "Netflix 12.99 every month from the 5th" |
| 🏋️ **Quemo Workout** | `quemo-workout` | "bench 4x8 at 70kg, then 3x10 rows" · "what are my PRs?" · "start my Push day" |
| 💊 **Quemo Health** | `quemo-health` | "took my morning meds" · "BP 128/84 today" · "what should I ask Dr. Weber on Friday?" |
| 🌮 **Quemo Food** | `quemo-food` | "chicken wrap and a coke for lunch" · "how much protein left today?" · "same breakfast as yesterday" |

Every tool has:
- **`follow_up`**: a check-in. It shows what's due, what's at risk, streaks, and plain-language nudges.
- **`generate_report`**: an organized report for any period (today, this week, last month, last 90 days, custom…). It contains KPIs, highlights, a comparison with the previous period, tables and bars. Your chat gets it as Markdown, plus a **printable page** you can save as a PDF.
- **`get_profile` / `update_profile`**: one shared profile (name, time zone, currency, metric/imperial) used by all four tools.

<details><summary><strong>All tools</strong></summary>

- **Budget**
  - Transactions: `add_transaction`, `add_transactions`, `list_transactions`, `update_transaction`, `delete_transaction`
  - Categories and accounts: `list_categories`, `rename_category`, `add_account`, `list_accounts`
  - Budgets: `set_budget`, `budget_status`
  - Recurring bills and income: `add_recurring`, `list_recurring`, `mark_recurring_paid`, `update_recurring`
  - Savings goals: `set_savings_goal`, `contribute_to_goal`, `list_savings_goals`, `delete_savings_goal`
  - Analysis: `spending_summary`, `follow_up`, `generate_report`
- **Workout**
  - Workouts and sets: `log_workout`, `add_sets`, `list_workouts`, `get_workout`, `update_workout`, `delete_workout`, `delete_set`, `update_set`
  - Exercises: `list_exercises`, `add_exercise`, `update_exercise`
  - Progress: `personal_records`, `exercise_progress`
  - Routines: `create_routine`, `list_routines`, `delete_routine`, `start_routine_workout`
  - Body metrics: `log_body_metric`, `body_metrics_history`, `delete_body_metric`
  - Goals: `set_goal`, `list_goals`, `delete_goal`
  - `follow_up`, `generate_report`
- **Health**
  - Medications: `add_medication`, `update_medication`, `list_medications`, `stop_medication`, `delete_medication`, `refill_medication`
  - Doses: `log_dose`, `log_doses`, `todays_doses`, `dose_history`, `delete_dose`, `medication_adherence`
  - Vitals: `log_vital`, `vitals_history`, `delete_vital`
  - Symptoms: `log_symptom`, `list_symptoms`, `symptom_summary`, `delete_symptom`
  - Appointments: `add_appointment`, `update_appointment`, `list_appointments`, `cancel_appointment`, `complete_appointment`
  - Health profile: `get_health_profile`, `update_health_profile`
  - `follow_up`, `generate_report`
- **Food**
  - Meals: `log_meal`, `add_food_items`, `list_meals`, `get_meal`, `update_meal`, `update_meal_item`, `delete_meal`, `delete_meal_item`, `copy_meal`
  - Food library: `save_food`, `search_foods`, `delete_food`
  - Water: `log_water`, `delete_water`
  - Goals and daily view: `set_nutrition_goals`, `get_nutrition_goals`, `daily_summary`
  - Weight: `log_weight`, `weight_history`
  - `follow_up`, `generate_report`

</details>

> Quemo Health is a tracking tool, not medical advice.

## Architecture

```
                    ┌──────────────────────────────┐
  Claude / ChatGPT  │ quemo-auth                   │  sign-up (email code / magic link),
  Cursor / any MCP ─┤  OAuth 2.1 authorization srv │  consent screen, dashboard, API keys,
  client            │  D1: users, sessions, keys   │  shared profile
                    │  KV: OAuth grants & tokens   │
                    └──────────────┬───────────────┘
                                   │ Service Binding (RPC): validateToken, getProfile…
          ┌───────────────┬────────┴──────┬───────────────┐
   quemo-budget    quemo-workout    quemo-health     quemo-food      ← each its own Worker,
   D1 quemo-budget D1 quemo-workout D1 quemo-health  D1 quemo-food      own database, own deploy
```

- **One account, four tools.** Signing up takes only an email: the first email creates the account. The user gets a 6-digit code and a magic link, so signing in works across devices. There are no passwords.
- **Tool-scoped OAuth.** Each tool is its own OAuth protected resource. A token issued for Budget is rejected by Health. Chat apps discover everything automatically (RFC 9728 / 8414, dynamic client registration, Client ID Metadata Documents).
- **API keys** (`qmk_…`) are for clients that can't do OAuth. One key works with all four tools and can be revoked from the dashboard.
- **Tokens never leave Cloudflare's network.** Tool Workers validate tokens through a private Service Binding to `quemo-auth`.
- **Account deletion** revokes every grant and key immediately. Each tool's daily cron then purges the data.
- **Time zones are respected everywhere:** "today", medication slots, weeks and streaks use the user's local time.

```
packages/core   shared: theme (the neon city UI), report engine (Markdown + printable HTML), dates, tool-worker wiring, test helpers
apps/auth       quemo-auth
apps/budget     quemo-budget       apps/workout   quemo-workout
apps/health     quemo-health       apps/food      quemo-food
apps/backup     quemo-backup       weekly encrypted backups (cron Worker)
scripts/        dev.mjs (run all locally), e2e.mjs (cross-worker test), deploy.mjs (setup + per-app deploy)
```

## Run it locally

```sh
npx -y npm@11 install      # npm ≥ 11 (npm 10 has a workspace install bug)
npm run dev                # auth :8787, budget :8788, workout :8789, health :8790, food :8791
```

Open http://localhost:8787. In dev, sign-in codes are printed in the `[auth]` log instead of emailed.

## Tests

```sh
npm run typecheck
npm test            # 152 tests: Workers runtime + real D1 per app (vitest-pool-workers)
npm run test:e2e    # boots all 5 Workers and walks the real journey across them
```

| Suite | Tests | Covers |
|---|---:|---|
| core | 7 | time-zone dates, periods, report Markdown/HTML rendering & escaping |
| auth | 18 | sign-up, codes, rate limits, lockout, magic links, open-redirect & CSRF guards, profile, API keys, full OAuth + PKCE, audience binding, account deletion |
| budget | 25 | transactions, cents precision, accounts & transfers, budgets, recurring bills, savings goals, summaries, follow-up, reports, isolation, purge, HTTP/OAuth challenge |
| workout | 34 | sets & units, PR detection, e1RM, progress, routines, body metrics, goals, streaks, reports, isolation, HTTP |
| health | 35 | schedules & dose slots, stock, adherence, refills, vitals flags, symptoms, appointments, reports, isolation, HTTP |
| food | 28 | meals & macros, saved foods, copy meal, water units, goals, daily summary, follow-up, reports, isolation, HTTP |
| backup | 5 | dump → gzip → age → GitHub commit, exact restore into an empty DB (quotes, newlines, unicode, NULLs), skip-unchanged, refuses without key/token |
| e2e | 38 checks | sign-up → API key → all tools → shared profile → reports → OAuth consent → audience-bound tokens |

## Deploy (Cloudflare free plan is enough)

```sh
npx wrangler login
npm run cf:setup          # creates 5 D1 databases + KV, writes ids into wrangler.jsonc, runs migrations
npm run secret:resend     # paste your Resend API key (sign-in emails)
npm run deploy            # deploys auth, then the four tools
```

Each Worker also deploys on its own: `npm run deploy:budget`, `deploy:workout`, `deploy:health`, `deploy:food`, `deploy:auth`.

Public URLs are derived from your `workers.dev` subdomain and stored in `deploy.config.json`. Edit that file to use custom domains, and set `"emailFrom"` to an address on a domain verified in Resend. Without a verified domain, Resend's `onboarding@resend.dev` can only email the address you signed up to Resend with. OAuth tokens are bound to these URLs, so change them before people connect, not after.

**GitHub Actions:** CI runs typecheck, unit tests and e2e on every push. `deploy.yml` deploys only the Workers whose code changed. Enable it by adding the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, a `QUEMO_DEPLOY_CONFIG` secret (contents of `deploy.config.json`), and the repo variable `QUEMO_DEPLOY_ENABLED=true`.

## Backups

**Weekly, on Cloudflare.** The `quemo-backup` Worker has a cron trigger that runs every Monday at 02:30 UTC. Each run:
1. Reads all five D1 databases through their bindings and builds a restorable SQL dump of each.
2. Gzips each dump and encrypts it with [age](https://age-encryption.org).
3. Commits everything in one commit to a **private** GitHub repo. Weeks with no changes are skipped.

Git history is the archive. Only your private key can decrypt the files, so not even GitHub can read your data.

```sh
npm run backup:setup      # private repo <you>/quemo-backups + age key pair; saves settings in deploy.config.json
node scripts/deploy.mjs backup
npx wrangler secret put GITHUB_TOKEN -c apps/backup/wrangler.jsonc   # fine-grained token: Contents R/W on that repo only
npm run backup:run        # back up now (calls the Worker)
npm run backup:list       # history
npm run backup:verify     # decrypt the latest snapshots locally and check row counts
npm run backup:restore -- budget [--from <commit>]   # restores into a NEW database, never overwrites
```

The private key is at `~/.config/quemo/backup-key.txt`. **Keep a copy in your password manager.** Without it, the backups can't be decrypted.

**Layers of protection:**
- **D1 Time Travel:** built into Cloudflare. Restores any minute from the last 30 days: `npx wrangler d1 time-travel restore quemo-<app> --timestamp=…`
- **Weekly encrypted snapshots:** kept in GitHub history indefinitely.

OAuth grants in KV are not backed up. After a disaster, chat apps just sign in again.

## One address, a path per tool

All tools are served under the sign-in origin. `quemo-auth` acts as a gateway and forwards each path to that tool's own Worker over a private Service Binding:

```
https://quemo-auth.<you>.workers.dev/finance/mcp    → quemo-budget
https://quemo-auth.<you>.workers.dev/workout/mcp    → quemo-workout
https://quemo-auth.<you>.workers.dev/health/mcp     → quemo-health
https://quemo-auth.<you>.workers.dev/food/mcp       → quemo-food
```

To rename a path, edit `"routes"` in `deploy.config.json` (for example `"budget": "money"`) and run `npm run deploy`. Do this before people connect, because OAuth tokens are bound to the exact URL.

To add a brand-new MCP:
1. Copy an app folder, for example `apps/food`, and change the tools.
2. Add its id to `TOOLS` in `packages/core/src/types.ts`.
3. Add a service binding and a `*_URL` var in `apps/auth`.
4. Add a slug under `"routes"`.

## Connect your AI

Sign in at your `quemo-auth` URL. The dashboard has copy-ready setup for every client:

- **Claude** (web, desktop, mobile): Settings → Connectors → *Add custom connector* → paste a tool's URL (`…/mcp`) → sign in with your email.
- **ChatGPT**: Settings → Apps & Connectors → Developer mode → *Create* → the tool URL with OAuth.
- **Claude Code**: `claude mcp add --transport http quemo-finance https://quemo-auth.<you>.workers.dev/finance/mcp`
- **Cursor / VS Code / anything else**: the URL plus an `Authorization: Bearer qmk_…` header.
- **stdio-only apps**: `npx mcp-remote <url> --header "Authorization: Bearer qmk_…"`

## License

MIT
