# Supabase backend

Database schema, row level security, storage and the three Deno edge functions that talk to
OpenAI.

```
supabase/
├── config.toml                        local development settings
├── .env.example                       edge function secrets (never committed)
├── migrations/
│   ├── 20260101000000_init.sql        enums, tables, triggers, RLS, admin RPCs
│   └── 20260101000100_storage.sql     private vsl-uploads bucket + policies
└── functions/
    ├── _shared/
    │   ├── http.ts                    CORS, JSON responses, HttpError, handler wrapper
    │   ├── supabase.ts                service-role client + authenticate/requireApproved/requireAdmin
    │   ├── openai.ts                  chat client with retries, param fallbacks, timeout
    │   ├── analysis.ts                VslAnalysis type + normaliser (the shared contract)
    │   └── prompts.ts                 analysis, sales page and quiz prompts
    ├── analyze-vsl/index.ts           VSL text  → analysis brief on projects.analysis
    ├── generate-asset/index.ts        analysis  → sales_page | quiz HTML in assets
    └── admin-users/index.ts           privileged user mutations + audit log
```

---

## 1. Apply the schema

### With the CLI (recommended)

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### Without the CLI

Open the Supabase dashboard → **SQL Editor** and run the two migration files **in filename
order**: `20260101000000_init.sql`, then `20260101000100_storage.sql`.

### Locally

```bash
supabase start      # Postgres, Auth, Storage, Studio on localhost
supabase db reset   # applies every migration from scratch
```

---

## 2. Secrets

Edge functions read their configuration from Supabase secrets. `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — you only set
the rest:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set OPENAI_MODEL=gpt-4.1
# optional
supabase secrets set OPENAI_TIMEOUT_MS=180000
supabase secrets set ALLOWED_ORIGIN=https://app.yourdomain.com
```

For local development put the same values in `supabase/.env` (see `.env.example`) and run
`supabase functions serve --env-file ./supabase/.env`.

> The service role key bypasses RLS. It exists only inside edge functions. Never put it in a
> frontend `.env`, a client bundle, or a repository.

---

## 3. Deploy the functions

```bash
supabase functions deploy analyze-vsl
supabase functions deploy generate-asset
supabase functions deploy admin-users
```

All three have `verify_jwt = true`, and each additionally re-checks the caller's profile:

| Function | Guard | Notes |
|---|---|---|
| `analyze-vsl` | `requireApproved` | Owner (or an admin) of the project only. 40/day per user. |
| `generate-asset` | `requireApproved` | Requires a stored analysis. 60/day per user. |
| `admin-users` | `requireAdmin` | Validates last-admin and self-action rules, writes an audit row. |

---

## 4. Auth configuration

Dashboard → **Authentication**:

- **URL Configuration → Site URL**: your user app URL (`http://localhost:5173` in dev).
- **Redirect URLs**: add both apps, local and production, including `/reset-password`.
- **Providers → Email**: email + password is all this project needs.
- **Confirm email**: your choice. Both flows are handled — with confirmation on, signup shows a
  "check your inbox" screen; with it off, the user lands straight on the waiting-room page.

---

## 5. Bootstrap an administrator

```sql
select public.promote_to_admin('you@example.com');
```

The function is `security definer` and granted to `service_role` only, so it can be run from the
SQL editor but never called from a browser session. It sets `role = 'admin'` and
`status = 'approved'` in one step.

---

## 6. Security model

**Row Level Security is on for every table.** Two `security definer` helpers avoid recursive
policy evaluation:

- `public.is_approved(uid)` — the account exists and an admin has approved it.
- `public.is_admin(uid)` — the account is an approved administrator.

| Table | Read | Write |
|---|---|---|
| `profiles` | own row; admins read all | own row (role/status blocked by trigger); admins update all |
| `projects` | own rows when approved; admins read all | own rows when approved; admins may delete |
| `assets` | own rows when approved; admins read all | **service role only** — no client INSERT/UPDATE policy exists |
| `audit_logs` | admins only | service role only |
| `storage.objects` | own folder when approved; admins read all | own folder when approved |

Additional protections:

- `protect_profile_privileges` — a `BEFORE UPDATE` trigger that raises `42501` if a non-admin
  tries to change their own `role` or `status`, even through a crafted PostgREST request.
- `handle_new_user` — every `auth.users` insert gets a matching profile with `status = 'pending'`.
- `handle_user_email_change` — keeps `profiles.email` in sync with `auth.users.email`.
- `set_asset_version` — auto-increments `version` per `(project_id, type)`.
- Generated HTML is previewed in an iframe sandboxed with `allow-scripts` **without**
  `allow-same-origin`, so a generated page can never touch the dashboard's session.

---

## 7. Admin RPCs

| Function | Returns |
|---|---|
| `admin_dashboard_stats()` | jsonb counters: users by status, admins, projects, assets, 7-day activity |
| `admin_activity_series(days)` | daily signup and project counts, for charting |
| `promote_to_admin(email)` | the updated profile row (service role only) |

The first two raise `Forbidden (42501)` for non-admins, so they are safe to expose to
`authenticated`.

---

## 8. Editing the AI behaviour

Everything the model is told lives in `functions/_shared/prompts.ts`:

- `ANALYSIS_SYSTEM` + `buildAnalysisPrompt` — the strategist brief and its JSON shape.
- `SHARED_BUILD_RULES` — technical and content rules that apply to **both** assets (self-contained
  HTML, mobile-first, accessibility, no invented facts, output the raw document only).
- `SALES_PAGE_SYSTEM` + `buildSalesPagePrompt` — the twelve required page sections.
- `QUIZ_SYSTEM` + `buildQuizPrompt` — screens, navigation, weighted scoring, result logic.

`buildAdaptationBrief` builds the TARGET PRODUCT block from `projects.generation_settings`.
It is prepended identically to both generator prompts, and `applySettings` (in `analysis.ts`) folds
the same overrides into the analysis object itself - so the two assets cannot be adapted
differently. Operator custom instructions are injected last and declared highest priority.

If you change the analysis JSON shape, update `functions/_shared/analysis.ts` (the `VslAnalysis`
type and `normalizeAnalysis`) and the `AnalysisPanel` component in both frontends to match.

The normaliser is deliberately forgiving: it accepts key aliases, coerces loose values, drops
empties and fills defaults, so a slightly off-spec model response still produces a valid brief
rather than a crash.

---

## 9. Local testing

```bash
supabase start
supabase functions serve --env-file ./supabase/.env

# get a JWT by signing in from the running user app, then:
curl -i --location http://127.0.0.1:54321/functions/v1/analyze-vsl \
  --header "Authorization: Bearer <access-token>" \
  --header "Content-Type: application/json" \
  --data '{"projectId":"<uuid>"}'
```
