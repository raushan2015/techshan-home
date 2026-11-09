import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from '../src/modules/immich/service';

describe('normalizeServerUrl', () => {
  it('accepts HTTP and HTTPS URLs and strips the trailing slash', () => {
    expect(normalizeServerUrl('http://immich.local:2283')).toBe('http://immich.local:2283');
    expect(normalizeServerUrl('https://photos.example.com/')).toBe('https://photos.example.com');
    expect(normalizeServerUrl('  https://immich.internal:2283/  ')).toBe('https://immich.internal:2283');
  });

  it('rejects malformed or unsafe URLs', () => {
    expect(() => normalizeServerUrl('not-a-url')).toThrow(/complete/);
    expect(() => normalizeServerUrl('ftp://immich.local')).toThrow(/HTTP or HTTPS/);
    expect(() => normalizeServerUrl('https://user:pass@immich.local')).toThrow(/credentials/);
    expect(() => normalizeServerUrl('https://immich.local/?x=1')).toThrow(/query/);
    expect(() => normalizeServerUrl('https://immich.local/#top')).toThrow(/fragment/);
  });
});
