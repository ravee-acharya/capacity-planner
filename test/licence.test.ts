import { describe, expect, it } from 'vitest';
import { isLicenceBlocked } from '../src/services/licence';

describe('licence gate', () => {
  it('never blocks the free edition (Jira sends no licence)', () => {
    expect(isLicenceBlocked(undefined)).toBe(false);
    expect(isLicenceBlocked(null)).toBe(false);
  });

  it('allows an active licence or one Jira has not reported yet', () => {
    expect(isLicenceBlocked({ isActive: true })).toBe(false);
    expect(isLicenceBlocked({})).toBe(false);
  });

  it('blocks only an explicitly inactive licence', () => {
    expect(isLicenceBlocked({ isActive: false })).toBe(true);
  });
});
