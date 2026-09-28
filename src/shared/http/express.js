import express from 'express';
import {
  adminJsonBodySecurityGuard,
} from '../../http/admin-request-security.js';
import {
  verifyNoDuplicateJsonKeys,
} from '../../http/json-duplicate-key-guard.js';

export function jsonBody(
  limit,
  type,
) {
  return [
    express.json({
      limit,
      strict: true,
      inflate: true,
      type,
      verify:
        verifyNoDuplicateJsonKeys,
    }),
    adminJsonBodySecurityGuard,
  ];
}
