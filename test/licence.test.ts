import { describe, expect, it } from 'vitest';
import { isLicenceBlocked } from '../src/services/licence';

// Shapes follow Atlassian's Forge licensing docs: `context.license.active`.
describe('licence gate', () => {
  it('never blocks the free edition or non-production environments (no licence object)', () => {
    expect(isLicenceBlocked(undefined)).toBe(false);
    expect(isLicenceBlocked(null)).toBe(false);
  });

  it('allows an active licence', () => {
    expect(isLicenceBlocked({ active: true })).toBe(false);
  });

  it('blocks a licence that is not active', () => {
    expect(isLicenceBlocked({ active: false })).toBe(true);
    expect(isLicenceBlocked({})).toBe(true);
  });

  it('does not treat the wrong property name as active', () => {
    expect(isLicenceBlocked({ isActive: true } as never)).toBe(true);
  });
});
