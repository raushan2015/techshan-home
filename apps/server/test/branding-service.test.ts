import { describe, expect, it } from 'vitest';
import { detectLogoContentType } from '../src/modules/branding/service';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const webpSignature = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x08, 0x00, 0x00]), Buffer.from('WEBP')]);

describe('detectLogoContentType', () => {
  it('detects PNG, JPEG, and WebP from magic bytes', () => {
    expect(detectLogoContentType(pngSignature)).toBe('image/png');
    expect(detectLogoContentType(jpegSignature)).toBe('image/jpeg');
    expect(detectLogoContentType(webpSignature)).toBe('image/webp');
  });

  it('rejects other content', () => {
    expect(detectLogoContentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectLogoContentType(Buffer.from('GIF89a...'))).toBeNull();
    expect(detectLogoContentType(Buffer.alloc(0))).toBeNull();
  });
});
