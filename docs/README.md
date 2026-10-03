# Документация DTP-Stat

Этот каталог — карта актуальной технической документации проекта.

## Version anchors

На текущем состоянии исходников:

- Node.js: `>=20.19` (`package.json`);
- migration tail: `V065__admin_ip_allowlist.sql`;
- project-settings transfer: `schemaVersion 11`;
- online admin authentication: только DB-backed HttpOnly session, HTTP Basic
  для защищённого API не поддерживается;
- geometry editor: universal Point/Line/Polygon model, edit leases, local
  workspace, topology preview operations, discussions and realtime;
- admin UI: schema-driven layout/blocks/tabs with container-query responsive
  composition.

Эти anchors нельзя поддерживать вручную «по памяти»: при изменении source
обновляется и соответствующий документ.

## Карта документов

| Документ | Каноническая тема |
| --- | --- |
| [architecture.md](architecture.md) | backend boundaries, ownership, SQL/HTTP rules, admin UI architecture |
| [admin-ui.md](admin-ui.md) | admin layout, reusable visual primitives, tabs/blocks/scroll ownership |
| [admin-security.md](admin-security.md) | auth, roles, sessions, audit, rate limits, MFA, metrics, blocks/allowlist |
| [admin-discussions.md](admin-discussions.md) | geometry/OSM discussions, inbox, unread/read state |
| [geometry-editor.md](geometry-editor.md) | geometry model, leases, drafts, topology, point types, public timeline |
| [data-transfer.md](data-transfer.md) | city/line/population import/export, streaming JSON/ZIP |
| [kml-transfer.md](kml-transfer.md) | portable KML semantics |
| [project-settings-transfer.md](project-settings-transfer.md) | versioned project configuration package |
| [report-config.md](report-config.md) | metrics/table/CSV/ranking DSL |
| [deployment.md](deployment.md) | instances, migrations, nginx, PM2, production settings |
| [monitoring.md](monitoring.md) | Prometheus and fail2ban templates |
| [analytics.md](analytics.md) | Yandex Metrica / GA4 and CSP |
| [database-indexes.md](database-indexes.md) | current PostgreSQL/PostGIS access paths and index rationale |

## Проверки документации при изменениях

При функциональном изменении сверяются минимум:

1. migration number и новый DB object;
2. public/admin API contract и authentication method;
3. permission/capability;
4. admin navigation and UI ownership;
5. transfer schema/version;
6. deployment ENV/proxy consequences;
7. required test command.

Полная regression-команда проекта:

```bash
npm run check
```

При PostgreSQL/PostGIS изменениях:

```bash
npm run test:integration
```
