export const PROBLEM_CATALOGUE = {
  VALIDATION_ERROR: {
    type: 'urn:nestjs-production-starter:problem:validation',
    title: 'Validation failed',
    status: 400,
    detail: 'The request contains invalid fields.',
  },
  MALFORMED_JSON: {
    type: 'urn:nestjs-production-starter:problem:malformed-json',
    title: 'Malformed JSON',
    status: 400,
    detail: 'The request body contains malformed JSON.',
  },
  TASK_NOT_FOUND: {
    type: 'urn:nestjs-production-starter:problem:not-found',
    title: 'Resource not found',
    status: 404,
    detail: 'The requested resource was not found.',
  },
  PAYLOAD_TOO_LARGE: {
    type: 'urn:nestjs-production-starter:problem:payload-too-large',
    title: 'Payload too large',
    status: 413,
    detail: 'The request body exceeds the maximum allowed size.',
  },
  UNSUPPORTED_MEDIA_TYPE: {
    type: 'urn:nestjs-production-starter:problem:unsupported-media-type',
    title: 'Unsupported media type',
    status: 415,
    detail: 'The request must use application/json.',
  },
  DEPENDENCY_UNAVAILABLE: {
    type: 'urn:nestjs-production-starter:problem:dependency-unavailable',
    title: 'Service temporarily unavailable',
    status: 503,
    detail: 'The service is temporarily unavailable.',
  },
  INTERNAL_ERROR: {
    type: 'urn:nestjs-production-starter:problem:internal-error',
    title: 'Internal server error',
    status: 500,
    detail: 'An internal server error occurred.',
  },
} as const;

export type ProblemCode = keyof typeof PROBLEM_CATALOGUE;
