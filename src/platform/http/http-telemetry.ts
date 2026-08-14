import type { Request } from 'express';

export const UNMATCHED_ROUTE = 'UNMATCHED';
export const OTHER_HTTP_METHOD = 'OTHER';
export const OTHER_HTTP_STATUS = 'OTHER';

export type BoundedHttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | typeof OTHER_HTTP_METHOD;

export function normalizeHttpMethod(method: string): BoundedHttpMethod {
  switch (method) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
    case 'HEAD':
    case 'OPTIONS':
      return method;
    default:
      return OTHER_HTTP_METHOD;
  }
}

export function matchedHttpRoute(request: Request): string {
  const route = request.route as { readonly path?: unknown } | undefined;
  return typeof route?.path === 'string' ? route.path : UNMATCHED_ROUTE;
}

export function normalizeHttpStatus(statusCode: number): string {
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? String(statusCode)
    : OTHER_HTTP_STATUS;
}
