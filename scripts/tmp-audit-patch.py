from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:80]!r}')
    file.write_text(text.replace(old, new, 1))


def replace_from(path, marker, new_tail):
    file = Path(path)
    text = file.read_text()
    index = text.find(marker)
    if index < 0:
        raise SystemExit(f'{path}: marker not found: {marker!r}')
    file.write_text(text[:index] + new_tail)


def replace_between(path, start, end, replacement):
    file = Path(path)
    text = file.read_text()
    left = text.find(start)
    if left < 0:
        raise SystemExit(f'{path}: start marker not found')
    right = text.find(end, left + len(start))
    if right < 0:
        raise SystemExit(f'{path}: end marker not found')
    file.write_text(text[:left] + replacement + text[right:])


def append_once(path, marker, text_to_append):
    file = Path(path)
    text = file.read_text()
    if marker in text:
        return
    file.write_text(text.rstrip() + '\n\n' + text_to_append.strip() + '\n')


# src/http/admin-auth.js
replace_once(
    'src/http/admin-auth.js',
    "const SESSION_COOKIE = 'dtpstat_admin_session';\n",
    """import {
  createAdminAuditChangeSet,
  sanitizeAdminAuditData,
} from '../data/admin-audit-details.js';
import { serviceLog } from '../service-log.js';

const SESSION_COOKIE = 'dtpstat_admin_session';
const AUDIT_CHANGES_LOCAL = 'dtpstatAdminAuditChanges';
const AUDIT_DETAILS_LOCAL = 'dtpstatAdminAuditDetails';
""",
)
replace_from(
    'src/http/admin-auth.js',
    'export function createAdminOperationAudit(securityService, operationType) {',
    """export function recordAdminOperationChanges(response, before, after, options = {}) {
  response.locals ??= {};
  const changeSet = createAdminAuditChangeSet(before, after, options);
  response.locals[AUDIT_CHANGES_LOCAL] = changeSet;
  return changeSet;
}

export function recordAdminOperationDetails(response, details) {
  response.locals ??= {};
  const current = response.locals[AUDIT_DETAILS_LOCAL] ?? {};
  response.locals[AUDIT_DETAILS_LOCAL] = {
    ...current,
    ...sanitizeAdminAuditData(details ?? {}),
  };
}

function mayRecordConcreteChanges(operationType) {
  return !operationType.startsWith('security.') && !operationType.startsWith('profile.');
}

export function createAdminOperationAudit(securityService, operationType) {
  return function auditAdminOperation(request, response, next) {
    const startedAt = Date.now();
    let recorded = false;
    const record = () => {
      if (recorded || !request.adminUser) return;
      recorded = true;
      const status = response.statusCode >= 200 && response.statusCode < 400 ? 'succeeded' : 'failed';
      const allowChanges = mayRecordConcreteChanges(operationType);
      const changeSet = allowChanges ? response.locals?.[AUDIT_CHANGES_LOCAL] : null;
      const extraDetails = allowChanges ? response.locals?.[AUDIT_DETAILS_LOCAL] : null;
      const details = {
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        ...(extraDetails ?? {}),
        ...(changeSet?.changes?.length ? { changes: changeSet.changes } : {}),
        ...(changeSet?.changesTruncated ? { changesTruncated: true } : {}),
      };
      const durationMs = Math.max(0, Date.now() - startedAt);
      const ipAddress = adminClientIp(request);
      serviceLog(status === 'succeeded' ? 'info' : 'warning', 'admin.operation', {
        operationType,
        status,
        durationMs,
        ipAddress,
        userId: request.adminUser.id,
        username: request.adminUser.username,
        ...details,
      });
      void securityService.appendAudit({
        eventType: 'operation', operationType, status,
        durationMs,
        ipAddress,
        userId: request.adminUser.id,
        username: request.adminUser.username,
        details,
      }).catch((error) => console.error('Admin audit write failed', error));
    };
    response.once('finish', record);
    response.once('close', record);
    next();
  };
}
""",
)

# line types
replace_once(
    'src/routes/line-types-api.js',
    "import { createAdminOperationAudit } from '../http/admin-auth.js';",
    """import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
} from '../http/admin-auth.js';""",
)
replace_once(
    'src/routes/line-types-api.js',
    """      try {
        const lineTypes = await lineTypesRepository.save(request.body);
        response.set('Cache-Control', 'no-store');
        response.json({ lineTypes });
""",
    """      try {
        const previousLineTypes = await lineTypesRepository.list();
        const lineTypes = await lineTypesRepository.save(request.body);
        recordAdminOperationChanges(
          response,
          { lineTypes: previousLineTypes },
          { lineTypes },
        );
        response.set('Cache-Control', 'no-store');
        response.json({ lineTypes });
""",
)

# project settings
replace_once(
    'src/routes/project-settings-api.js',
    "import { createAdminOperationAudit } from '../http/admin-auth.js';",
    """import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
} from '../http/admin-auth.js';""",
)
replace_once(
    'src/routes/project-settings-api.js',
    """      try {
        const settings = await projectSettingsRepository.save(request.body);
        response.set('Cache-Control', 'no-store');
        response.json({ settings });
""",
    """      try {
        const previousSettings = await projectSettingsRepository.get();
        const settings = await projectSettingsRepository.save(request.body);
        recordAdminOperationChanges(response, previousSettings, settings);
        response.set('Cache-Control', 'no-store');
        response.json({ settings });
""",
)
replace_once(
    'src/routes/project-settings-api.js',
    """          previousName = (await projectSettingsRepository.get()).publicDownloadName;
          const settings = await projectSettingsRepository.savePublicDownloadName(
            request.body?.publicDownloadName,
          );
          const publicDownloads = await afterPublicDownloadNameSave?.();
          response.set('Cache-Control', 'no-store').json({ settings, publicDownloads });
""",
    """          previousName = (await projectSettingsRepository.get()).publicDownloadName;
          const settings = await projectSettingsRepository.savePublicDownloadName(
            request.body?.publicDownloadName,
          );
          const publicDownloads = await afterPublicDownloadNameSave?.();
          recordAdminOperationChanges(
            response,
            { publicDownloadName: previousName },
            { publicDownloadName: settings.publicDownloadName },
          );
          response.set('Cache-Control', 'no-store').json({ settings, publicDownloads });
""",
)
replace_once(
    'src/routes/project-settings-api.js',
    """        try {
          const icon = validateCityMarkerIcon(
            request.body,
            request.get('content-type'),
          );
          const settings = await projectSettingsRepository.saveCityMarkerIcon(icon);
          response.set('Cache-Control', 'no-store').json({ settings });
""",
    """        try {
          const previousIcon = typeof projectSettingsRepository.getCityMarkerIcon === 'function'
            ? await projectSettingsRepository.getCityMarkerIcon()
            : null;
          const icon = validateCityMarkerIcon(
            request.body,
            request.get('content-type'),
          );
          const settings = await projectSettingsRepository.saveCityMarkerIcon(icon);
          recordAdminOperationChanges(
            response,
            {
              cityMarkerIcon: previousIcon
                ? { custom: true, mime: previousIcon.mime, bytes: previousIcon.data?.length ?? null }
                : { custom: false },
            },
            {
              cityMarkerIcon: {
                custom: true,
                mime: icon.mime,
                width: icon.width,
                height: icon.height,
                bytes: icon.data.length,
              },
            },
          );
          response.set('Cache-Control', 'no-store').json({ settings });
""",
)
replace_once(
    'src/routes/project-settings-api.js',
    """      async (_request, response, next) => {
        try {
          const settings = await projectSettingsRepository.clearCityMarkerIcon();
          response.set('Cache-Control', 'no-store').json({ settings });
""",
    """      async (_request, response, next) => {
        try {
          const previousIcon = typeof projectSettingsRepository.getCityMarkerIcon === 'function'
            ? await projectSettingsRepository.getCityMarkerIcon()
            : null;
          const settings = await projectSettingsRepository.clearCityMarkerIcon();
          recordAdminOperationChanges(
            response,
            {
              cityMarkerIcon: previousIcon
                ? { custom: true, mime: previousIcon.mime, bytes: previousIcon.data?.length ?? null }
                : { custom: false },
            },
            { cityMarkerIcon: { custom: false } },
          );
          response.set('Cache-Control', 'no-store').json({ settings });
""",
)

# report config
replace_once(
    'src/routes/report-config-api.js',
    "import { createAdminOperationAudit } from '../http/admin-auth.js';",
    """import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
} from '../http/admin-auth.js';""",
)
replace_once(
    'src/routes/report-config-api.js',
    """      try {
        const result = await reportConfigService.save(request.body);
        const snapshots = await afterSave(result);
""",
    """      try {
        const previousConfig = await reportConfigService.get();
        const result = await reportConfigService.save(request.body);
        recordAdminOperationChanges(
          response,
          { reportConfig: previousConfig },
          { reportConfig: result.config },
        );
        const snapshots = await afterSave(result);
""",
)

# settings transfer: compare only non-security sections
replace_once(
    'src/routes/project-settings-transfer-api.js',
    "import { createAdminOperationAudit } from '../http/admin-auth.js';",
    """import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
  recordAdminOperationDetails,
} from '../http/admin-auth.js';""",
)
replace_once(
    'src/routes/project-settings-transfer-api.js',
    """      try {
        const imported = await settingsTransferService.importSettings(request.body);
        let derived = null;
""",
    """      try {
        const before = await settingsTransferService.exportSettings();
        const imported = await settingsTransferService.importSettings(request.body);
        const after = await settingsTransferService.exportSettings();
        recordAdminOperationChanges(
          response,
          {
            projectSettings: before.projectSettings,
            lineTypes: before.lineTypes,
            reportConfig: before.reportConfig,
          },
          {
            projectSettings: after.projectSettings,
            lineTypes: after.lineTypes,
            reportConfig: after.reportConfig,
          },
        );
        recordAdminOperationDetails(response, {
          importSummary: imported,
          securityDetailsExcluded: true,
        });
        let derived = null;
""",
)

# task manager
replace_once(
    'src/data/admin-task-manager.js',
    "import crypto from 'node:crypto';\n",
    """import crypto from 'node:crypto';
import { sanitizeAdminAuditData } from './admin-audit-details.js';
import { serviceLog } from '../service-log.js';
""",
)
replace_between(
    'src/data/admin-task-manager.js',
    '  async function persistTaskAudit(task) {',
    '  /** @param {any} task @param {(context: object) => Promise<object>} executor */',
    """  async function persistTaskAudit(task) {
    if (!task.actor) return;
    const durationMs = elapsedMilliseconds(
      task.startedAt ?? task.createdAt,
      task.completedAt,
    );
    const details = {
      taskId: task.id,
      endpoint: task.endpoint,
      parameters: sanitizeAdminAuditData(task.parameters),
      ...(task.result !== undefined
        ? { changeSummary: sanitizeAdminAuditData(task.result) }
        : {}),
      ...(task.error !== undefined
        ? { error: sanitizeAdminAuditData(task.error) }
        : {}),
    };
    serviceLog(task.status === 'succeeded' ? 'info' : 'warning', 'admin.data-operation', {
      operationType: task.type,
      status: task.status,
      durationMs,
      ipAddress: task.actor.ipAddress ?? null,
      userId: task.actor.userId ?? null,
      username: task.actor.username ?? null,
      ...details,
    });
    if (!recordTaskAudit) return;
    try {
      await recordTaskAudit({
        eventType: 'operation',
        operationType: task.type,
        status: task.status,
        durationMs,
        ipAddress: task.actor.ipAddress ?? null,
        userId: task.actor.userId ?? null,
        username: task.actor.username ?? null,
        details,
      });
    } catch (error) {
      appendLog(task, 'warning', 'Не удалось записать аудит admin-операции', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

""",
)

# data routes: payload fingerprints + counts
replace_once(
    'src/routes/api.js',
    """import {
  AdminTaskAlreadyRunningError,
} from '../data/admin-task-manager.js';
""",
    """import {
  AdminTaskAlreadyRunningError,
} from '../data/admin-task-manager.js';
import { adminAuditPayloadFingerprint } from '../data/admin-audit-details.js';
""",
)
replace_once(
    'src/routes/api.js',
    """    startAdminTask(request, response, next, {
      type: 'geojson-import',
      endpoint: '/api/admin/import/lines',
      recordsSuccessfulUpdate: true,
    }, async (context) => importService.replaceFromGeoJson(
""",
    """    startAdminTask(request, response, next, {
      type: 'geojson-import',
      endpoint: '/api/admin/import/lines',
      recordsSuccessfulUpdate: true,
      parameters: {
        featureCount: Array.isArray(request.body?.features) ? request.body.features.length : null,
        businessLineTypes: Array.isArray(request.body?.lineTypes) ? request.body.lineTypes.length : null,
        payload: adminAuditPayloadFingerprint(request.body),
      },
    }, async (context) => importService.replaceFromGeoJson(
""",
)
replace_once(
    'src/routes/api.js',
    """        parameters: { dryRun },
      }, async (context) => cityBoundaryTransferService.replaceFromGeoJson(
""",
    """        parameters: {
          dryRun,
          featureCount: Array.isArray(request.body?.features) ? request.body.features.length : null,
          payload: adminAuditPayloadFingerprint(request.body),
        },
      }, async (context) => cityBoundaryTransferService.replaceFromGeoJson(
""",
)
replace_once(
    'src/routes/api.js',
    """            cityBufferMeters: options.cityBufferMeters,
          },
""",
    """            cityBufferMeters: options.cityBufferMeters,
            ...(request.body !== undefined
              ? { payload: adminAuditPayloadFingerprint(request.body) }
              : {}),
          },
""",
)
replace_once(
    'src/routes/api.js',
    """            sourceURL: options.url,
          },
""",
    """            sourceURL: options.url,
            ...(request.body !== undefined
              ? { payload: adminAuditPayloadFingerprint(request.body) }
              : {}),
          },
""",
)
replace_once(
    'src/routes/api.js',
    """      startAdminTask(request, response, next, {
        type: 'population-update',
        endpoint: '/api/admin/populations',
        recordsSuccessfulUpdate: true,
      }, async (context) => populationService.updateFromJson(
""",
    """      startAdminTask(request, response, next, {
        type: 'population-update',
        endpoint: '/api/admin/populations',
        recordsSuccessfulUpdate: true,
        parameters: {
          recordCount: Array.isArray(request.body?.populations) ? request.body.populations.length : null,
          asOf: request.body?.asOf ?? null,
          source: request.body?.source ?? null,
          payload: adminAuditPayloadFingerprint(request.body),
        },
      }, async (context) => populationService.updateFromJson(
""",
)

# portable KML
replace_once(
    'src/routes/kml-transfer-api.js',
    "import { AdminTaskAlreadyRunningError } from '../data/admin-task-manager.js';",
    """import { adminAuditPayloadFingerprint } from '../data/admin-audit-details.js';
import { AdminTaskAlreadyRunningError } from '../data/admin-task-manager.js';""",
)
replace_once(
    'src/routes/kml-transfer-api.js',
    """              businessLineTypes: collection.lineTypes.length,
            },
""",
    """              businessLineTypes: collection.lineTypes.length,
              payload: adminAuditPayloadFingerprint(request.body),
            },
""",
)

# audit UI
replace_once(
    'admin/security-editor-v2.js',
    "    summary.textContent = 'JSON';\n",
    """    const changeCount = Array.isArray(entry.details?.changes)
      ? entry.details.changes.length
      : 0;
    summary.textContent = changeCount ? `Изменения (${changeCount})` : 'JSON';
""",
)

# README
replace_once(
    'README.md',
    "- Node.js `20.19+`;",
    "- Node.js `20.19+` (для production рекомендуется Node.js `24.x`);",
)
replace_once('README.md', 'npm install\ncp .env.example .env', 'npm ci\ncp .env.example .env')
replace_once(
    'README.md',
    '- DB-backed пользователи, роли, sessions, profile/avatar, IP/account lockout и audit;',
    '- DB-backed пользователи, роли, sessions, profile/avatar, IP/account lockout и audit с конкретным before/after change-set для несекретных admin-изменений;',
)

# deployment docs
replace_once('docs/deployment.md', 'npm install\ncp .env.example .env', 'npm ci\ncp .env.example .env')
replace_once(
    'docs/deployment.md',
    """    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
""",
    """    proxy_http_version 1.1;

    # Analytics/Webvisor CSP intentionally contains many provider origins and
    # can exceed nginx's small default upstream-header buffer.
    proxy_buffer_size 32k;
    proxy_buffers 8 32k;
    proxy_busy_buffers_size 64k;

    proxy_set_header Upgrade $http_upgrade;
""",
)
append_once(
    'docs/deployment.md',
    '## Node.js / shared NVM для production',
    """## Node.js / shared NVM для production

Минимум проекта — Node.js `20.19+`; для production рекомендуется поддерживаемая ветка Node.js `24.x`. На сервере с несколькими экземплярами удобно держать один shared NVM в `/usr/local/nvm`, а стабильные runtime links — в `/usr/local/node` и `/usr/local/bin`.

Пример общей установки NVM:

```bash
sudo mkdir -p /usr/local/nvm
sudo git clone https://github.com/nvm-sh/nvm.git /usr/local/nvm
cd /usr/local/nvm
sudo git checkout "$(git describe --abbrev=0 --tags)"

sudo tee /etc/profile.d/nvm.sh >/dev/null <<'EOF'
export NVM_DIR="/usr/local/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
EOF
sudo chmod 755 /etc/profile.d/nvm.sh
sudo chmod -R a+rX /usr/local/nvm
```

Node 24 и стабильные system-wide links:

```bash
sudo bash -lc '
export NVM_DIR=/usr/local/nvm
source /usr/local/nvm/nvm.sh
nvm install 24
nvm alias default 24
'

export NVM_DIR=/usr/local/nvm
source /usr/local/nvm/nvm.sh
nvm use 24
NODE24="$(dirname "$(dirname "$(nvm which 24)")")"
sudo ln -sfn "$NODE24" /usr/local/node
sudo ln -sfn /usr/local/node/bin/node /usr/local/bin/node
sudo ln -sfn /usr/local/node/bin/npm /usr/local/bin/npm
sudo ln -sfn /usr/local/node/bin/npx /usr/local/bin/npx
sudo ln -sfn /usr/local/node/bin/corepack /usr/local/bin/corepack
hash -r
```

После major Node upgrade dependencies пересобираются из lock-файла, а PM2 переустанавливается именно новым npm:

```bash
sudo /usr/local/bin/npm install -g pm2
pm2 save
pm2 kill
pm2 resurrect
pm2 startup systemd -u dtpstat --hp /home/dtpstat
pm2 save

cd /var/www/buslanes.ru && rm -rf node_modules && npm ci
cd /var/www/tramlanes.ru && rm -rf node_modules && npm ci
```

Только после проверки `which node`, `node -v`, `which pm2`, `pm2 report` и startup logs старый distro `nodejs/npm` можно удалить через package manager. Production process log должен показывать ожидаемую версию Node.

`npm install` не используется как deployment-команда: он способен менять lock-файл. Для reproducible deploy используется `npm ci`.

## Большой CSP и nginx upstream buffers

Yandex Metrica/Webvisor использует несколько региональных collector origins. Полный CSP получается крупнее типичного заголовка приложения. Если nginx пишет:

```text
upstream sent too big header while reading response header from upstream
```

и отдаёт `502 Bad Gateway`, это не падение Node. В `location /` должны быть достаточные upstream buffers:

```nginx
proxy_buffer_size 32k;
proxy_buffers 8 32k;
proxy_busy_buffers_size 64k;
```

Диагностика разделяет Node и proxy:

```bash
curl -sI http://127.0.0.1:3001/ | head
curl -sI https://buslanes.ru/ | head
```

Первый запрос проверяет Express напрямую, второй — полный HTTPS/nginx path. После изменения nginx обязательно `sudo nginx -t` и `sudo systemctl reload nginx`.
""",
)

# admin security docs
replace_once(
    'docs/admin-security.md',
    """В audit входят login/lockout, data/settings operations, users/security и завершение background admin tasks.

`V018` добавил indexes для filters по event/operation/status/username/IP.
""",
    """В audit входят login/lockout, data/settings operations, users/security и завершение background admin tasks.

Для **несекретных mutating admin operations** `DETAILS` теперь хранит не только HTTP method/path/status, но и конкретный bounded change-set:

```json
{
  "changes": [
    { "path": "themePreset", "before": "classic", "after": "modern" },
    { "path": "showLineLabels", "before": false, "after": true }
  ]
}
```

Synchronous settings editors строят field-level `before → after`. Background data tasks записывают input parameters, SHA-256/byte-size загруженного payload там, где он есть, и sanitized `changeSummary` из результата операции. Тот же sanitized summary пишется в server service log (`admin.operation` / `admin.data-operation`), поэтому разбор инцидента возможен даже при проблеме записи DB audit.

Audit deliberately **не хранит concrete values security/profile operations**. Пароли, temporary passwords, session/cookie/Authorization values, hashes, secrets, credentials, private/API keys и поля с token-like именами не попадают в clear text. Для token-like полей несекретной конфигурации audit может показать сам факт изменения, но значения будут `[redacted]`. `settings.import` сравнивает только `projectSettings`, `lineTypes` и `reportConfig`; `securitySettings` из value-level diff исключены целиком.

Чтобы `DETAILS` не превращался в копию данных, строки/depth/collections/change count ограничены; бинарные значения сохраняются только как metadata, а `createdAt/updatedAt` игнорируются как audit noise. Для больших data imports payload не сохраняется в audit: сохраняется fingerprint, позволяющий доказать, какой именно файл/JSON был применён.

В web-admin JSON-details показывают `Изменения (N)`, когда change-set присутствует. CSV export продолжает включать `DETAILS` как JSON.

`V018` добавил indexes для filters по event/operation/status/username/IP. Новая детализация использует существующий `DETAILS JSONB`, поэтому отдельная DB migration не требуется.
""",
)

# analytics docs
append_once(
    'docs/analytics.md',
    '## Reverse proxy и размер CSP',
    """## Reverse proxy и размер CSP

Полный Yandex Metrica/Webvisor CSP содержит региональные collector origins и может превысить маленький default upstream-header buffer nginx. Production reverse proxy должен использовать достаточные `proxy_buffer_size/proxy_buffers`; рекомендуемая конфигурация и диагностика `502 upstream sent too big header` описаны в [deployment.md](deployment.md).

Runtime mapuid sync `https://yandex.ru/an/mapuid/...` разрешён намеренно только в `img-src`; `script-src` и `connect-src` этим исключением не расширяются.
""",
)

# Temporary verification files must not survive the verified commit.
Path('.github/workflows/audit-change-details.yml').unlink(missing_ok=True)
Path('scripts/tmp-audit-patch.py').unlink(missing_ok=True)
