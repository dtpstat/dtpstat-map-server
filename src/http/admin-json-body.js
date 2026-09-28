import {
  jsonBody as parseJsonBody,
} from '../shared/http/express.js';
import {
  adminJsonBodySecurityGuard,
} from './admin-request-security.js';

export function adminJsonBody(
  limit,
  type,
) {
  return [
    parseJsonBody(
      limit,
      type,
    ),
    adminJsonBodySecurityGuard,
  ];
}

export const jsonBody =
  adminJsonBody;
