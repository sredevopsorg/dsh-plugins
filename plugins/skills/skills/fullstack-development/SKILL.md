---
name: fullstack-development
description: Container-based Python and Node.js/TypeScript implementation guidance — framework choices, fullstack integration (API contracts, auth, SSR, state, monorepos), Docker multi-stage images, and end-to-end testing.
whenToUse: Use when implementing or reviewing a backend, frontend, or fullstack application in Python or Node.js/JavaScript, structuring a monorepo, writing Dockerfiles or Compose/Kubernetes manifests, or wiring the frontend to a backend API.
---

# Fullstack Development (container-based, Python + Node.js)

Use this skill for hands-on implementation and review of container-based Python and Node.js/TypeScript applications, from API to UI to deployment.

## 1. Backend — Python

- **FastAPI** — the default for new typed, async APIs: pydantic v2 models at the boundary, dependency injection for wiring, OpenAPI generated for free. Keep pydantic models at the edge and plain domain objects inside.
- **Django (+ DRF)** — choose it for content/admin-heavy products: batteries-included ORM, migrations, admin, auth. Use its structure rather than fighting it.
- **Flask** — fine for small services and internal tools; prefer FastAPI when you need async or typed contracts.
- **Async** — one event loop per process; never block it with sync I/O or CPU work — offload to a threadpool or a worker. Async is for I/O concurrency, not for speed by itself.
- **Celery / RQ** — for work that outlives a request. Tasks must be idempotent and retry-safe; combine the DB write and the enqueue with a transactional outbox.
- **SQLAlchemy 2.x + Alembic** — explicit sessions and transactions; migrations are forward-only and reviewed; keep persistence models separate from rich domain models.
- **Config and packaging** — `pyproject.toml` with `uv` (or Poetry) and a committed lockfile; `ruff` for lint/format, `mypy`/`pyright` for types, `pytest` for tests.
- **Structure** — `src/<package>/{api,domain,adapters,config}`; dependencies point inward (adapters → domain, never the reverse).

## 2. Backend — Node.js / TypeScript

- **Runtime** — current Node.js LTS, ESM (`"type": "module"`), `strict: true` TypeScript.
- **Fastify** — typed, fast, schema-validated HTTP; the default for new Node APIs. **Express** where ecosystem familiarity dominates. **NestJS** when you want an opinionated DI/module structure for a larger team.
- **Validation** — validate every external input at the boundary with a schema library (Zod/TypeBox/class-validator); derive types from the schema so they cannot drift.
- **Database** — Prisma or Drizzle for typed SQL access and migrations; always use transactions for multi-write operations; never build SQL by string concatenation.
- **Structure** — feature folders (`src/<feature>/{route,service,repo,schema}.ts`) over technical layers in small apps; keep `index.ts` files as thin composition points.
- **Errors** — one error type hierarchy, mapped to HTTP status in one place; never leak stack traces or driver errors to clients.

## 3. Frontend — React / Next.js / Vue

- **Next.js (App Router)** — default for a React fullstack app: server components for data, client components only where interactivity demands it, route handlers for APIs, `output: 'standalone'` for containers.
- **React** — colocate state with the component that owns it; lift only when shared; reach for a store (Zustand/Redux) only when cross-cutting state genuinely exists.
- **Vue** — Composition API with `<script setup>`, Pinia for shared state, same colocation rule.
- **Rendering strategy** — choose deliberately: SSG for stable content, ISR for periodically changing content, SSR for per-request personalization, CSR for app-like interiors. Mixing them per route is normal.
- **Performance** — measure first (bundle analyzer, Lighthouse, Web Vitals); then code-split by route, defer non-critical work, and optimize images. Do not micro-optimize before measuring.
- **Accessibility** — semantic HTML, keyboard operability, labels, and contrast are part of "done", not a later phase.

## 4. Fullstack integration

- **API contract** — pick one and keep it honest: REST with an OpenAPI schema, GraphQL, or tRPC for end-to-end TypeScript. Generate clients and types from the schema; never hand-maintain a duplicate type.
- **One source of truth for types** — share a `packages/contracts` (or generated client) in a monorepo rather than copying interfaces between frontend and backend.
- **Auth** — prefer a proven library/framework flow (session cookies or OAuth/OIDC) over a hand-rolled one. Store sessions server-side or in signed, `HttpOnly`, `Secure`, `SameSite` cookies. Never put tokens in `localStorage` for a browser app that handles untrusted content.
- **Server state vs client state** — server data belongs in a query cache (TanStack Query/SWR) with explicit invalidation; UI state belongs in the component. Do not mirror server state into a global store.
- **BFF** — when the browser needs several services or a trimmed shape, add a backend-for-frontend rather than chaining calls in the client.
- **Monorepo layout** — `apps/*` for deployables, `packages/*` for shared libraries; one lockfile, one task runner (Turborepo/Nx), and explicit `exports` in each package.
- **Local development** — one command to bring up the stack (Docker Compose with the database and dependencies, apps run natively for fast reload); a seeded database and documented env vars in `.env.example`.
- **Supabase as the backend** — when the project uses Supabase (Postgres + Auth + Storage + Edge Functions + Realtime), load the `supabase` skill before writing client or server code and `supabase-postgres-best-practices` before touching anything in the database; the live project is reachable through the `mcp__supabase__*` tools. Never put the service-role key in a browser bundle — use the publishable/anon key plus Row-Level Security, and treat RLS policies as part of the schema review.

## 5. Containers and deployment

- **Multi-stage Dockerfile** — build stage with the full toolchain, runtime stage with only production dependencies, pinned base image (`python:3.12-slim`, `node:22-alpine`).
- **Non-root** — create and switch to an unprivileged user; drop Linux capabilities; consider a read-only root filesystem.
- **Health** — a real `HEALTHCHECK` / `readinessProbe` that exercises a dependency-free endpoint, distinct from liveness.
- **Build hygiene** — `.dockerignore` the repo noise, `pip install --no-cache-dir` / `pnpm install --frozen-lockfile`, copy the lockfile before the source to keep layers cacheable.
- **Config** — everything environment-specific comes from env vars or mounted secrets; nothing baked into the image. The same image runs in every environment.
- **Compose** — for local dev and small deployments: one service per container, health checks, named volumes, `depends_on` with conditions.
- **Kubernetes/Helm** — for multi-service scale-out: resource requests/limits, probes, PodDisruptionBudget, ConfigMap/Secret separation, and Helm values per environment.
- **Migration on deploy** — run migrations as a separate, idempotent step (init container or job), never implicitly at app startup on every replica.

## 6. Testing a fullstack app

- **Unit** — domain logic and pure functions; no I/O. The bulk of the suite, milliseconds per test.
- **Integration** — the real database and the real HTTP layer via `TestClient`/`supertest`/`httpx`; use containers (Testcontainers) or a disposable schema per run rather than mocking the database.
- **Component** — frontend behaviour with Testing Library, asserting what the user sees, not implementation details.
- **End-to-end** — Playwright over the critical journeys only (signup, login, the money path); keep the suite small and stable, run it in CI against the composed stack.
- **Contract** — validate the API against its schema in CI so frontend and backend cannot silently diverge.
- **Test data** — factory functions and per-test transactions/rollbacks; never share mutable fixtures between tests; never point tests at production data.
