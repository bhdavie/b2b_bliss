# Bliss B2B

Save-first payment plans for the booking economy. Merchants share a Bliss link with their customer, the customer commits to a dated booking and pays from their own card on a schedule they choose, the merchant gets paid in full at booking completion.

Not BNPL. No credit, no interest, no debt, no underwriting risk to the merchant.

## Status

Pre-development. Greenfield repo. Phase 0 scaffold landed; Phase 1 (merchant signup) is next per [docs/v1-build-plan.md](./docs/v1-build-plan.md).

## Project context

Read [CLAUDE.md](./CLAUDE.md) for stack, scope, copy conventions, and the working agreements for Claude Code.

Key references:

- [CLAUDE.md](./CLAUDE.md): project context, stack, scope, conventions
- [docs/data-model.md](./docs/data-model.md): full database schema
- [docs/v1-build-plan.md](./docs/v1-build-plan.md): phased build sequence
- [docs/hosted-page-spec.md](./docs/hosted-page-spec.md): consumer-facing payment plan page spec

## Run native (default dev path)

The default dev loop runs everything natively on macOS. No Docker required.

### One-time setup

Install dependencies via Homebrew:

```sh
brew install postgresql@16 openjdk@21 maven
```

Link OpenJDK 21 onto your PATH (the formula is keg-only):

```sh
echo 'export PATH="/usr/local/opt/openjdk@21/bin:$PATH"' >> ~/.zshrc
echo 'export JAVA_HOME="$(/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home)"' >> ~/.zshrc
# Apple Silicon: paths are /opt/homebrew/opt/openjdk@21/...
exec zsh
```

Start Postgres and create the dev database:

```sh
brew services start postgresql@16
createuser -s bliss
psql postgres -c "ALTER ROLE bliss WITH PASSWORD 'bliss_dev';"
createdb -O bliss bliss
```

Sanity check:

```sh
psql -U bliss -d bliss -h localhost -c 'select 1;'
java -version    # should print 21
mvn -v           # should report JAVA_HOME pointing at JDK 21
```

### Start the backend

From `backend/`:

```sh
cd backend
mvn compile exec:java
```

This boots Dropwizard on `http://localhost:8080` (admin on `:8081`). Flyway runs migrations on startup against `localhost:5432`. The `exec-maven-plugin` is configured to invoke `BlissApplication server src/main/resources/config.yml` so no extra args are needed.

Alternative (build a fat jar and run it):

```sh
mvn -DskipTests package
java -jar target/bliss-b2b-backend.jar server src/main/resources/config.yml
```

### Start the frontend

In another terminal, from `frontend/`:

```sh
cd frontend
npm install     # first time only
npm run dev
```

The dev server listens on `http://localhost:3000` and calls the backend at `http://localhost:8080` (override via `NEXT_PUBLIC_API_BASE_URL` in `.env.local`).

### Try it

1. Open `http://localhost:3000/login`.
2. Enter any email; the Phase 0 dev-login accepts anything and issues a JWT.
3. You land on `http://localhost:3000/dashboard`, which calls `/api/v1/hello/me` with the bearer token and displays your session.

Sign out clears the token from `localStorage` and bounces back to `/login`.

## Environment variables

Backend reads from env vars with sensible local defaults (see [backend/src/main/resources/config.yml](./backend/src/main/resources/config.yml)):

| Variable | Default | Notes |
| --- | --- | --- |
| `BLISS_ENV` | `development` | label only |
| `BLISS_DB_URL` | `jdbc:postgresql://localhost:5432/bliss` | |
| `BLISS_DB_USER` | `bliss` | |
| `BLISS_DB_PASSWORD` | `bliss_dev` | |
| `BLISS_JWT_SECRET` | dev placeholder | must be ≥ 32 bytes |
| `BLISS_JWT_TTL_MINUTES` | `60` | |
| `BLISS_SENTRY_DSN` | empty | Sentry disabled when empty |
| `BLISS_RUN_MIGRATIONS` | `true` | set `false` in tests |
| `BLISS_CORS_ORIGINS` | `http://localhost:3000` | comma-separated origins permitted to call the API |
| `BLISS_FRONTEND_BASE_URL` | `http://localhost:3000` | used to build magic-link URLs and Stripe return URLs |
| `BLISS_POSTMARK_TOKEN` | empty | activates Postmark (falls back to log when empty) |
| `BLISS_EMAIL_FROM` | `no-reply@bliss.com` | |
| `STRIPE_SECRET_KEY` | empty | `sk_test_...` to activate Stripe Connect endpoints |
| `STRIPE_PUBLISHABLE_KEY` | empty | optional, used client-side later |
| `STRIPE_WEBHOOK_SECRET` | empty | `whsec_...` from `stripe listen` |

Frontend reads from `NEXT_PUBLIC_*` (see [frontend/.env.example](./frontend/.env.example)):

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8080` | |
| `NEXT_PUBLIC_SENTRY_DSN` | empty | Sentry disabled when empty |
| `NEXT_PUBLIC_ENV` | `development` | |

## Stripe Connect setup

Phase 2 scaffolds Stripe Connect Express. The integration is inert until you provide keys.

1. Create a Stripe account in test mode at https://dashboard.stripe.com. Enable Connect (Settings → Connect → Get started). Pick **Platform or Marketplace**.
2. From Developers → API keys, grab the **Secret key** (`sk_test_...`).
3. Install the Stripe CLI: `brew install stripe/stripe-cli/stripe`. Run `stripe login` once.
4. In one terminal: `stripe listen --forward-to localhost:8080/api/v1/stripe/webhooks --events account.updated`. It prints a `whsec_...` secret on first run.
5. Export keys and restart the backend:

   ```sh
   export STRIPE_SECRET_KEY=sk_test_...
   export STRIPE_WEBHOOK_SECRET=whsec_...
   cd backend && mvn compile exec:java
   ```

6. In the merchant dashboard, the "Stripe Connect" card flips from "Backend not configured" to "Not started". Click **Connect with Stripe**, complete the Express flow with Stripe test data, and you return to `/onboarding/stripe-return`. Webhook updates flow through the running `stripe listen` process.

Until keys are set, the backend returns a clean 503 from `/api/v1/stripe/connect/account-link` and `/api/v1/stripe/webhooks` with body `{"error":"stripe_not_configured", ...}`. The UI renders a "Backend not configured" pill in that state.

## Run via Docker (alternative)

Docker is kept for parity with CI / future staging deploys but is not the default dev path. To run the full stack in containers:

```sh
cp .env.example .env   # adjust as needed
docker compose up --build
```

This starts Postgres 16, the backend, and the frontend dev server inside containers. Ports map to the same host ports as the native path.

## Tests

Backend smoke test boots Dropwizard end-to-end (no Postgres required; the test config disables migrations):

```sh
cd backend && mvn -ntp test
```

Frontend lint + typecheck + build:

```sh
cd frontend
npm run lint
npm run typecheck
npm run build
```

CI runs both on every push and PR via `.github/workflows/ci.yml`.

## Layout

```
backend/        Java + Dropwizard 4 + Maven, Flyway migrations under src/main/resources/db/migration/
frontend/       Next.js 15 (App Router) + TypeScript strict
docs/           Data model, v1 build plan, hosted page spec
docker-compose.yml + Dockerfiles  Container path (alternative to native)
.github/workflows/ci.yml  GitHub Actions
```

## License

Proprietary. All rights reserved.
