import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { brandingConfigSchema, type BrandingConfig } from '@techshan/contracts/dashboard';

const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..', 'data');
const settingsFile = path.join(dataDirectory, 'branding-settings.json');
const logoFile = path.join(dataDirectory, 'branding-logo.bin');

export const defaultBrandName = 'TECHSHAN-HOME';

type StoredBranding = {
  name: string | null;
  logoContentType: string | null;
  logoUpdatedAt: string | null;
};

const storedBrandingSchema = z.object({
  name: z.string().min(1).max(40).nullable(),
  logoContentType: z.string().nullable(),
  logoUpdatedAt: z.string().nullable(),
});

let cache: StoredBranding | undefined;

function emptyBranding(): StoredBranding {
  return { name: null, logoContentType: null, logoUpdatedAt: null };
}

async function readBranding(): Promise<StoredBranding> {
  if (cache !== undefined) return cache;
  let loaded: StoredBranding;
  try {
    loaded = storedBrandingSchema.parse(JSON.parse(await readFile(settingsFile, 'utf8')));
  } catch {
    loaded = emptyBranding();
  }
  cache = loaded;
  return loaded;
}

async function writeBranding(next: StoredBranding): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${settingsFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(next, null, 2), 'utf8');
  await rename(temporaryFile, settingsFile);
  cache = next;
}

export async function getBrandingConfig(): Promise<BrandingConfig> {
  const stored = await readBranding();
  return brandingConfigSchema.parse({
    name: stored.name,
    customLogo: stored.logoUpdatedAt !== null,
    logoUpdatedAt: stored.logoUpdatedAt,
  });
}

export async function saveBrandingName(name: string | null): Promise<BrandingConfig> {
  const stored = await readBranding();
  await writeBranding({ ...stored, name: name === null || name === '' ? null : name });
  return getBrandingConfig();
}

// Logo uploads are sniffed from magic bytes so the browser cannot claim a
// type it is not actually sending.
const logoSignatures: Array<{ contentType: string; test: (bytes: Buffer) => boolean }> = [
  { contentType: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { contentType: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { contentType: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export function detectLogoContentType(bytes: Buffer): string | null {
  return logoSignatures.find((signature) => signature.test(bytes))?.contentType ?? null;
}

export async function saveBrandingLogo(bytes: Buffer, updatedAt = new Date().toISOString()): Promise<BrandingConfig> {
  const contentType = detectLogoContentType(bytes);
  if (!contentType) throw new Error('Use a PNG, JPEG, or WebP image for the logo.');
  const stored = await readBranding();
  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${logoFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, bytes);
  await rename(temporaryFile, logoFile);
  await writeBranding({ ...stored, logoContentType: contentType, logoUpdatedAt: updatedAt });
  return getBrandingConfig();
}

export async function getBrandingLogo(): Promise<{ bytes: Buffer; contentType: string; updatedAt: string } | null> {
  const stored = await readBranding();
  if (stored.logoUpdatedAt === null || stored.logoContentType === null) return null;
  try {
    return { bytes: await readFile(logoFile), contentType: stored.logoContentType, updatedAt: stored.logoUpdatedAt };
  } catch {
    // The settings say a logo exists but the file is gone; treat as unset so
    // the dashboard falls back to the default mark instead of erroring.
    await writeBranding({ ...stored, logoContentType: null, logoUpdatedAt: null });
    return null;
  }
}

export async function removeBrandingLogo(): Promise<BrandingConfig> {
  const stored = await readBranding();
  await writeBranding({ ...stored, logoContentType: null, logoUpdatedAt: null });
  try {
    await unlink(logoFile);
  } catch {
    // The logo file is already absent; nothing else to clean up.
  }
  return getBrandingConfig();
}
