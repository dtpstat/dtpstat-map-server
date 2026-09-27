import express from 'express';

export function jsonBody(limit, type) {
  return express.json({
    limit,
    strict: true,
    inflate: true,
    type,
  });
}
