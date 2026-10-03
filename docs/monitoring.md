# Production monitoring

DTP-Stat exposes application metrics and structured security events, but does
not install host monitoring software itself. The files under `ops/` are
deployment templates.

## Prometheus scrape

Enable Prometheus access in admin → **Безопасность → Метрики и тайминги**,
generate/rotate the bearer token there and configure the target:

```yaml
scrape_configs:
  - job_name: dtpstat
    scheme: https
    static_configs:
      - targets:
          - tramlanes.example
    authorization:
      type: Bearer
      credentials: REPLACE_WITH_THE_ONE_TIME_TOKEN
```

The token is shown only when generated/rotated. DTP-Stat stores only its
SHA-256 hash.

Useful exported series:

```text
dtpstat_http_requests_total
dtpstat_http_request_duration_seconds_bucket
dtpstat_http_request_duration_seconds_sum
dtpstat_http_request_duration_seconds_count
dtpstat_process_uptime_seconds
dtpstat_process_resident_memory_bytes
dtpstat_process_heap_used_bytes
dtpstat_db_pool_connections
dtpstat_db_pool_max_connections
```

`ops/prometheus/dtpstat-alerts.yml` contains baseline rules. Thresholds are
deliberately conservative templates and should be tuned to real traffic.

Validate before loading:

```bash
promtool check rules ops/prometheus/dtpstat-alerts.yml
```

Typical Prometheus configuration:

```yaml
rule_files:
  - /etc/prometheus/rules/dtpstat-alerts.yml
```

## Security events and fail2ban

Security events are emitted as one-line JSON after the `[security]` prefix and
contain:

```json
{"marker":"DTPSTAT_SECURITY_V1","event":"..."}
```

The filter in `ops/fail2ban/filter.d/dtpstat-admin-lockout.conf` intentionally
matches only:

```text
admin.auth.ip_lockout
admin.request.ip_lockout
```

It does **not** ban on every failed password or isolated malformed request. The
application performs its own DB-backed threshold/lockout first; fail2ban is a
second host-firewall layer.

For a systemd deployment:

```bash
sudo install -m 0644 \
  ops/fail2ban/filter.d/dtpstat-admin-lockout.conf \
  /etc/fail2ban/filter.d/dtpstat-admin-lockout.conf

sudo install -m 0644 \
  ops/fail2ban/jail.d/dtpstat-admin.local.example \
  /etc/fail2ban/jail.d/dtpstat-admin.local
```

Edit `journalmatch` in the installed jail to the real service unit, then
validate and reload:

```bash
sudo fail2ban-client -t
sudo systemctl reload fail2ban
sudo fail2ban-client status dtpstat-admin-lockout
```

To test the regex against exported journal text without banning anything:

```bash
journalctl -u dtpstat.service --no-pager -o cat > /tmp/dtpstat-security.log

fail2ban-regex \
  /tmp/dtpstat-security.log \
  /etc/fail2ban/filter.d/dtpstat-admin-lockout.conf
```

For PM2, use the same filter with a separate local jail configured with the
actual PM2 stderr `logpath` instead of `backend = systemd` / `journalmatch`.
Do not copy a guessed PM2 path from documentation; use the path reported by the
deployment's PM2 configuration.

## Suggested dashboards

At minimum chart:

- request rate split by status class;
- p50/p95/p99 request latency from the histogram;
- PostgreSQL total/idle/waiting/max;
- RSS and heap usage;
- authentication rejection rate for `/api/admin/login` and
  `/api/admin/login/mfa`.

Keep route labels aggregated unless a specific endpoint is under investigation.
The application intentionally normalizes dynamic API paths to bounded route
templates to prevent Prometheus cardinality growth.
