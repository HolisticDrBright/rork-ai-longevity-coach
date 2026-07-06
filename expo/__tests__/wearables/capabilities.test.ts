process.env.TZ = 'UTC';

import { describe, test, expect } from 'vitest';
import {
  METRICS,
  ROUTED_JUNCTION_RESOURCES,
  computeMetricAvailability,
  computeGroupAvailability,
  capabilitiesForProvider,
  providersForMetric,
} from '@/constants/wearableCapabilities';
import { makeRecord } from './test-helpers';

describe('computeMetricAvailability', () => {
  test("glucose is 'live' when a recent record carries glucoseAvg", () => {
    const records = [makeRecord({ source: 'dexcom', glucoseAvg: 104 })];
    const availability = computeMetricAvailability(records, ['dexcom']);
    expect(availability.glucose).toBe('live');
  });

  test("glucose is 'expected' when Dexcom is connected but no data has arrived", () => {
    const availability = computeMetricAvailability([], ['dexcom']);
    expect(availability.glucose).toBe('expected');
  });

  test("glucose is 'locked' when no connected provider measures it", () => {
    const availability = computeMetricAvailability([], []);
    expect(availability.glucose).toBe('locked');

    // Omron only supplies blood pressure — glucose stays locked.
    const omronOnly = computeMetricAvailability([], ['omron']);
    expect(omronOnly.glucose).toBe('locked');
    expect(omronOnly.bloodPressure).toBe('expected');
  });
});

describe('computeGroupAvailability', () => {
  test("metabolic group rolls up to 'live' when glucose is live", () => {
    const records = [makeRecord({ source: 'dexcom', glucoseAvg: 98 })];
    const availability = computeMetricAvailability(records, ['dexcom']);
    const groups = computeGroupAvailability(availability);
    expect(groups.metabolic).toBe('live');
    // Nothing else is connected or has data.
    expect(groups.recovery).toBe('locked');
    expect(groups.sleep).toBe('locked');
    expect(groups.cardiovascular).toBe('locked');
  });

  test("group is 'expected' when a metric is expected but none are live", () => {
    const availability = computeMetricAvailability([], ['dexcom']);
    const groups = computeGroupAvailability(availability);
    expect(groups.metabolic).toBe('expected');
  });
});

describe('provider capability registry', () => {
  test("capabilitiesForProvider('dexcom') is exactly glucose", () => {
    const caps = capabilitiesForProvider('dexcom');
    expect(caps.map(m => m.key)).toEqual(['glucose']);
  });

  test("providersForMetric('bloodPressure') includes omron, withings, and apple_health", () => {
    const slugs = providersForMetric('bloodPressure').map(p => p.slug);
    expect(slugs).toContain('omron');
    expect(slugs).toContain('withings');
    expect(slugs).toContain('apple_health');
  });
});

describe('ingestion routing coverage', () => {
  // The edge functions (supabase/functions/junction-webhook +
  // rollup-biometrics) are Deno and cannot be imported here, so
  // ROUTED_JUNCTION_RESOURCES is the canonical contract: every metric's
  // primary Junction resource must be routed into daily_biometric_records.
  test("every metric's primary junctionResource is routed by the ingestion pipeline", () => {
    for (const metric of METRICS) {
      const primary = metric.junctionResources[0];
      expect(
        ROUTED_JUNCTION_RESOURCES,
        `metric '${metric.key}' primary resource '${primary}' is not routed`,
      ).toContain(primary);
    }
  });
});
