export const READINESS_PROBE = Symbol('READINESS_PROBE');

export interface ReadinessProbe {
  isReady(): Promise<boolean>;
}
