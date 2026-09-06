import { describe, expect, test } from 'bun:test';
import { hoursAgo } from '../../src/output/time';

const now = new Date('2026-05-22T10:00:00Z');

describe('hoursAgo', () => {
  test('rounds to the nearest hour', () => {
    expect(hoursAgo(new Date('2026-05-22T09:31:00Z'), now)).toBe(0);
    expect(hoursAgo(new Date('2026-05-22T09:29:00Z'), now)).toBe(1);
  });
});
