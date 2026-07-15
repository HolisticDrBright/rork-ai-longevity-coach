// Feature flags for incrementally shipped modules. Flags default ON and can be
// disabled per-build via env (set the var to 'false') so incomplete follow-on
// phases can ship dark.

function flag(envValue: string | undefined, defaultOn = true): boolean {
  if (envValue === undefined || envValue === '') return defaultOn;
  return envValue !== 'false' && envValue !== '0';
}

export const featureFlags = {
  /** Phase 1: unified timeline, hypotheses, snapshots, practitioner review queue. */
  clinicalReasoning: flag(process.env.EXPO_PUBLIC_FLAG_CLINICAL_REASONING),
  /** Phase 2: Adaptive Health Twin Layers 1–2 (current state + systems model). */
  adaptiveHealthTwin: flag(process.env.EXPO_PUBLIC_FLAG_HEALTH_TWIN),
  /** Phase 3+: reserved; ships dark until implemented. */
  nOf1Lab: flag(process.env.EXPO_PUBLIC_FLAG_N_OF_1, false),
  supplementIntelligence: flag(process.env.EXPO_PUBLIC_FLAG_SUPPLEMENT_INTELLIGENCE, false),
  quantumMind: flag(process.env.EXPO_PUBLIC_FLAG_QUANTUM_MIND, false),
} as const;

export type FeatureFlagKey = keyof typeof featureFlags;
