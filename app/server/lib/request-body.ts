/**
 * Typed reads of a JSON request body.
 *
 * Express types `req.body` as `any`. These helpers read one field as `unknown`,
 * or as a trimmed string, so a handler must check what it received before using
 * it. A missing body, or a non-string value, reads as an empty string.
 */
export function bodyValue(req: { body?: unknown }, key: string): unknown {
  const body = req.body as Record<string, unknown> | null | undefined;
  return body?.[key];
}

export function bodyString(req: { body?: unknown }, key: string): string {
  const value = bodyValue(req, key);
  return typeof value === 'string' ? value.trim() : '';
}
