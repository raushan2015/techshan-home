import { describe, expect, it } from 'vitest';
import { validateAllowedUrl } from '../src/modules/calendar/service';

describe('validateAllowedUrl', () => {
  it('accepts HTTPS URLs', () => {
    expect(validateAllowedUrl('https://dashboard.example.com/', 'Return URL')).toBe('https://dashboard.example.com/');
  });

  it('accepts HTTP only for loopback development hosts', () => {
    expect(validateAllowedUrl('http://127.0.0.1:5173/', 'Return URL')).toBe('http://127.0.0.1:5173/');
    expect(validateAllowedUrl('http://localhost:5173/', 'Return URL')).toBe('http://localhost:5173/');
    expect(() => validateAllowedUrl('http://dashboard.example.com/', 'Return URL')).toThrow(/HTTPS/);
  });

  it('rejects malformed URLs, credentials, and fragments', () => {
    expect(() => validateAllowedUrl('not-a-url', 'Return URL')).toThrow(/complete URL/);
    expect(() => validateAllowedUrl('https://user:pass@example.com/', 'Return URL')).toThrow(/credentials/);
    expect(() => validateAllowedUrl('https://example.com/#section', 'Return URL')).toThrow(/fragment/);
  });

  it('accepts IPv6 loopback and normalizes the value', () => {
    expect(validateAllowedUrl('http://[::1]:5173', 'Return URL')).toBe('http://[::1]:5173/');
  });
});
