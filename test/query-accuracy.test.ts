import {describe, expect, it} from 'bun:test';
import {
  isPartialScan,
  queryWithAccuracy,
  SAMPLING_MODE,
  type SamplingMode,
} from '../lib/query-accuracy.ts';

describe('SAMPLING_MODE', () => {
  it('maps to the API values', () => {
    expect(SAMPLING_MODE.NORMAL).toBe('NORMAL');
    expect(SAMPLING_MODE.HIGH_ACCURACY).toBe('HIGHEST_ACCURACY');
  });
});

describe('isPartialScan', () => {
  it('detects partial on the raw SDK result shape ({ data: { meta } })', () => {
    expect(isPartialScan({data: {meta: {dataScanned: 'partial'}}})).toBe(true);
  });
  it('detects partial on an unwrapped shape ({ meta })', () => {
    expect(isPartialScan({meta: {dataScanned: 'partial'}})).toBe(true);
  });
  it('is false for a full scan', () => {
    expect(isPartialScan({data: {meta: {dataScanned: 'full'}}})).toBe(false);
  });
  it('is false when meta is absent', () => {
    expect(isPartialScan({data: {}})).toBe(false);
  });
});

describe('queryWithAccuracy', () => {
  it('returns the NORMAL result and does not escalate on a full scan', async () => {
    const modes: SamplingMode[] = [];
    const result = await queryWithAccuracy(async (sampling) => {
      modes.push(sampling);
      return {data: {meta: {dataScanned: 'full'}, data: [{id: '1'}]}};
    });
    expect(modes).toEqual([SAMPLING_MODE.NORMAL]);
    expect(result.data.data).toHaveLength(1);
  });

  it('escalates to HIGHEST_ACCURACY on a partial scan (default predicate)', async () => {
    const modes: SamplingMode[] = [];
    const result = await queryWithAccuracy(async (sampling) => {
      modes.push(sampling);
      return sampling === SAMPLING_MODE.NORMAL
        ? {data: {meta: {dataScanned: 'partial'}, data: []}}
        : {data: {meta: {dataScanned: 'full'}, data: [{id: '42'}]}};
    });
    expect(modes).toEqual([SAMPLING_MODE.NORMAL, SAMPLING_MODE.HIGH_ACCURACY]);
    expect(result.data.data).toEqual([{id: '42'}]);
  });

  it('honors a custom shouldEscalate (partial AND empty)', async () => {
    const partialEmpty = (r: {data: {meta: {dataScanned: string}; data: unknown[]}}) =>
      isPartialScan(r) && r.data.data.length === 0;

    const nonEmptyModes: SamplingMode[] = [];
    await queryWithAccuracy(
      async (sampling) => {
        nonEmptyModes.push(sampling);
        // partial but NON-empty: custom predicate should NOT escalate
        return {data: {meta: {dataScanned: 'partial'}, data: [{id: '1'}]}};
      },
      {shouldEscalate: partialEmpty},
    );
    expect(nonEmptyModes).toEqual([SAMPLING_MODE.NORMAL]);
  });

  it('passes the sampling mode to the query function', async () => {
    const result = await queryWithAccuracy(
      async (sampling) => ({sampling}),
      {shouldEscalate: () => false},
    );
    expect(result.sampling).toBe(SAMPLING_MODE.NORMAL);
  });
});
