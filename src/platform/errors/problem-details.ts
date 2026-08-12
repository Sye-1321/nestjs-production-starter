import { PROBLEM_CATALOGUE, type ProblemCode } from './problem-catalogue.js';

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: ProblemCode;
  readonly requestId: string;
}

export function createProblemDetails(
  code: ProblemCode,
  requestId: string,
): ProblemDetails {
  const definition = PROBLEM_CATALOGUE[code];

  return {
    type: definition.type,
    title: definition.title,
    status: definition.status,
    detail: definition.detail,
    code,
    requestId,
  };
}
