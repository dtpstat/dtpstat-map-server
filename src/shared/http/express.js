import express from 'express';
import {
  verifyNoDuplicateJsonKeys,
} from './json-duplicate-key-guard.js';

export function jsonBody(
  limit,
  type,
) {
  return express.json({
    limit,
    strict: true,
    inflate: true,
    type,
    verify:
      verifyNoDuplicateJsonKeys,
  });
}
