import { Request, Response, NextFunction } from 'express';

/**
 * Rejects NoSQL-operator injection (`?category[$ne]=x`, `{"login": {"$gt": ""}}`) at the door.
 * No legitimate request to this API contains an object key starting with `$` or containing `.`,
 * so a blanket refusal is safe and covers routes that forget to validate a field's type.
 */
function hasOperatorKey(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object' || Buffer.isBuffer(value)) return false;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$') || key.includes('.')) return true;
    if (hasOperatorKey(inner, depth + 1)) return true;
  }
  return false;
}

export function rejectOperatorInjection(req: Request, res: Response, next: NextFunction) {
  if (hasOperatorKey(req.query) || hasOperatorKey(req.body) || hasOperatorKey(req.params)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  next();
}
