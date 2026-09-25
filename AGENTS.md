# DTP-Stat development instructions

These rules are mandatory for repository changes. Read
`docs/architecture.md` before changing ownership, composition, persistence,
HTTP routing, or shared infrastructure.

## Architecture

- Put canonical domain behavior in `src/modules/<domain>`: policies,
  validation, parsers, plans, use cases, domain transports, and focused
  domain-specific repositories.
- Domain modules must not import `src/application`, `src/db`,
  `src/routes`, `src/http`, `src/testing`, or `src/data`.
- Put cross-domain composition and long-lived runtime wiring in
  `src/application`. Transactions/orchestration spanning focused
  repositories belong here or in the owning domain service, not in
  `src/db` compatibility facades.
- Keep `src/db` focused on real persistence and database infrastructure.
  Do not add `*-service.js`, `*-runtime.js`, or `*-routes.js` composition
  facades under `src/db`.
- `src/routes` and `src/http` are HTTP adapters/composition. They receive
  repositories/services through dependencies and must not import `src/db`
  directly.
- `src/shared` is domain-neutral infrastructure. It must not depend on
  domain modules, application composition, DB repositories, or HTTP route
  layers.
- `src/data` is retired. Do not recreate it and do not add compatibility
  re-export files for old paths.
- Existing top-level composition roots (`src/app.js`, `src/server.js`,
  `src/application/server-runtime.js`, and
  `src/application/http/api-composition.js`) should stay thin.

Domain-specific SQL repositories may live with their domain when persistence
is part of that bounded implementation (for example lines/geometry/population).
Focused cross-domain or runtime storage remains in `src/db`. Do not move code
mechanically just to reduce file size.

## Ownership changes

When moving functionality to its canonical owner:

1. Move the implementation; do not leave a compatibility facade.
2. Update every source/test/script import in the same change.
3. Preserve behavior unless the task explicitly changes behavior.
4. Add or extend an architecture guard for the removed path or dependency
   rule.
5. Keep raw SQL in focused repository/storage code, not composition runtimes.
6. Keep transaction boundaries explicit when one operation spans multiple
   persistence slices.

## Required checks

Run the focused architecture suite while developing:

```bash
npm run test:architecture
```

Before considering a change complete, run:

```bash
npm run check
```

For PostgreSQL/PostGIS changes, also run the integration harness when
applicable:

```bash
npm run test:integration
```

Do not weaken architecture tests to make an invalid dependency pass. Change
the ownership/dependency instead, unless the architecture itself is being
deliberately revised together with `docs/architecture.md` and the guards.
