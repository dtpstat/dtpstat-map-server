import {
  AdminSecurityValidationError,
} from '../../modules/security/policy.js';
import {
  handleAdminSecurityValidation,
} from './helpers.js';

function parseAuditFilters(
  query,
  {
    limitDefault = 200,
    limitMax = 500,
  } = {},
) {
  const limit =
    query.limit === undefined
      ? limitDefault
      : Number(query.limit);

  const offset =
    query.offset === undefined
      ? 0
      : Number(query.offset);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > limitMax ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 1000000
  ) {
    throw new AdminSecurityValidationError(
      `limit must be 1..${limitMax} and offset must be a non-negative integer`,
    );
  }

  const filters = {
    limit,
    offset,
  };

  for (
    const key of [
      'eventType',
      'operationType',
      'status',
      'username',
      'ipAddress',
    ]
  ) {
    if (
      query[key] !== undefined &&
      String(query[key]).trim()
    ) {
      filters[key] =
        String(query[key]).trim();
    }
  }

  for (
    const key of ['from', 'to']
  ) {
    if (
      query[key] === undefined ||
      !String(query[key]).trim()
    ) {
      continue;
    }

    const date =
      new Date(String(query[key]));

    if (
      !Number.isFinite(
        date.valueOf(),
      )
    ) {
      throw new AdminSecurityValidationError(
        `${key} must be a valid date/time`,
      );
    }

    filters[key] =
      date.toISOString();
  }

  return filters;
}

function csvCell(value) {
  const text =
    value === null ||
    value === undefined
      ? ''
      : String(value);

  return /[",\r\n]/.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

export function registerAdminAuditRoutes(
  router,
  {
    securityService,
    adminAuth,
  },
) {
  router.get(
    '/admin/security/audit/facets',
    adminAuth.requireAudit,
    async (
      _request,
      response,
      next,
    ) => {
      try {
        response.json(
          await securityService
            .auditFacets(),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/security/audit',
    adminAuth.requireAudit,
    async (request, response, next) => {
      try {
        const filters =
          parseAuditFilters(
            request.query,
          );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            entries:
              await securityService
                .listAudit(filters),
            limit: filters.limit,
            offset: filters.offset,
          });
      } catch (error) {
        if (
          handleAdminSecurityValidation(
            response,
            error,
          )
        ) {
          return;
        }

        next(error);
      }
    },
  );

  router.get(
    '/admin/security/audit/export.csv',
    adminAuth.requireAudit,
    async (request, response, next) => {
      try {
        const filters =
          parseAuditFilters(
            request.query,
            {
              limitDefault: 5000,
              limitMax: 5000,
            },
          );

        const entries =
          await securityService
            .listAudit(filters);

        const lines = [[
          'createdAt',
          'username',
          'ipAddress',
          'eventType',
          'operationType',
          'status',
          'durationMs',
          'details',
        ]];

        for (const entry of entries) {
          lines.push([
            entry.createdAt,
            entry.username,
            entry.ipAddress,
            entry.eventType,
            entry.operationType,
            entry.status,
            entry.durationMs,
            JSON.stringify(
              entry.details ?? {},
            ),
          ]);
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .set(
            'Content-Disposition',
            'attachment; filename="admin-audit.csv"',
          )
          .type('text/csv')
          .send(
            `${lines
              .map(
                (row) =>
                  row
                    .map(csvCell)
                    .join(','),
              )
              .join('\r\n')}\r\n`,
          );
      } catch (error) {
        if (
          handleAdminSecurityValidation(
            response,
            error,
          )
        ) {
          return;
        }

        next(error);
      }
    },
  );
}
