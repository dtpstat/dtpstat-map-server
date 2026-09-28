import express from 'express';
import {
  adminJsonBodySecurityGuard,
} from '../../http/admin-request-security.js';

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
    }),
    adminJsonBodySecurityGuard,
  ];
}
