import { describe, it, expect } from 'vitest';
import { generateId, escapeHtml, formatTime, formatCountdown, formatDateTime } from '../src/utils.js';

describe('generateId', () => {
  it('should return a non-empty string', () => {
    const id = generateId();
    expect(id).toBeTypeOf('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('escapeHtml', () => {
  it('should escape script tags', () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
  });

  it('should escape ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('should leave safe text unchanged in visual form', () => {
    const input = 'Hello World';
    expect(escapeHtml(input)).toBe('Hello World');
  });
});

describe('formatTime', () => {
  it('should format 0ms as 00:00:00', () => {
    expect(formatTime(0)).toBe('00:00:00');
  });

  it('should format 3661000ms as 01:01:01', () => {
    expect(formatTime(3661000)).toBe('01:01:01');
  });

  it('should format 7200000ms as 02:00:00', () => {
    expect(formatTime(7200000)).toBe('02:00:00');
  });
});

describe('formatCountdown', () => {
  it('should return "现在" for zero or negative values', () => {
    expect(formatCountdown(0)).toBe('现在');
    expect(formatCountdown(-1000)).toBe('现在');
  });

  it('should format minutes only', () => {
    const result = formatCountdown(5 * 60 * 1000);
    expect(result).toContain('分钟');
  });

  it('should format hours', () => {
    const result = formatCountdown(2 * 3600 * 1000);
    expect(result).toContain('小时');
  });

  it('should format days', () => {
    const result = formatCountdown(3 * 86400 * 1000);
    expect(result).toContain('天');
  });
});

describe('formatDateTime', () => {
  it('should return a string with date and time', () => {
    const date = new Date(2025, 0, 15, 9, 30).getTime();
    const result = formatDateTime(date);
    expect(result).toContain('2025');
    expect(result).toContain('01');
    expect(result).toContain('15');
    expect(result).toContain('09:30');
  });
});
