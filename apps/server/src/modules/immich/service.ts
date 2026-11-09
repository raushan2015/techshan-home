import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..', 'data');
const keyFile = path.join(dataDirectory, 'immich-master.key');
const configFile = path.join(dataDirectory, 'immich-config.enc');
const settingsFile = path.join(dataDirectory, 'immich-settings.json');
const cacheFile = path.join(dataDirectory, 'immich-photos-cache.json');
type Config = { serverUrl: string; apiKey: string };
export type ImmichAlbum = { id: string; name: string; assetCount: number; selected: boolean };
export type ImmichPhoto = { id: string; fileName: string; date: string | null; albumName: string };
type StoredSettings = { selectedAlbumIds: string[] };
let keyPromise: Promise<Buffer> | undefined;
let configCache: Config | null | undefined;
let settingsCache: StoredSettings | undefined;
let albumsCache: ImmichAlbum[] = [];
let photosCache: ImmichPhoto[] = [];
let refreshedAt: string | null = null;
let lastError: string | null = null;

async function key() {
  keyPromise ??= (async () => {
    await mkdir(dataDirectory, { recursive: true });
    try { const existing = await readFile(keyFile); if (existing.length !== 32) throw new Error('Immich encryption key is invalid.'); return existing; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const generated = randomBytes(32);
      try { await writeFile(keyFile, generated, { flag: 'wx', mode: 0o600 }); return generated; }
      catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError; return readFile(keyFile); }
    }
  })();
  return keyPromise;
}
async function writeJson(file: string, value: unknown) {
  await mkdir(dataDirectory, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await rename(temp, file);
}
async function readConfig(): Promise<Config | null> {
  if (configCache !== undefined) return configCache;
  try {
    const encrypted = JSON.parse(await readFile(configFile, 'utf8')) as { iv: string; tag: string; data: string };
    const decipher = createDecipheriv('aes-256-gcm', await key(), Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    configCache = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64')), decipher.final()]).toString('utf8')) as Config;
  } catch {
    // Damaged storage degrades to "not configured" instead of crashing status
    // and dashboard endpoints. Saving new settings overwrites the damaged file.
    lastError = 'Saved Immich settings could not be decrypted. Check the local encryption key.';
    configCache = null;
  }
  return configCache;
}
async function writeConfig(config: Config) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  await writeJson(configFile, { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
  configCache = config;
}
async function readSettings(): Promise<StoredSettings> {
  if (settingsCache) return settingsCache;
  try { const data = JSON.parse(await readFile(settingsFile, 'utf8')) as Partial<StoredSettings>; settingsCache = { selectedAlbumIds: Array.isArray(data.selectedAlbumIds) ? data.selectedAlbumIds.filter((id): id is string => typeof id === 'string') : [] }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; settingsCache = { selectedAlbumIds: [] }; }
  return settingsCache;
}
export function normalizeServerUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete Immich server URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP or HTTPS server URL without credentials, query, or fragment.');
  return url.toString().replace(/\/$/, '');
}
async function request(url: string, config: Config, init?: RequestInit) {
  const response = await fetch(url, { ...init, redirect: 'error', headers: { 'x-api-key': config.apiKey, accept: 'application/json', ...init?.headers }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Immich returned ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}. Check the server URL, API key, and key permissions.`);
  }
  return response;
}
async function getAlbums(config: Config) {
  const response = await request(`${config.serverUrl}/api/albums`, config);
  const data = await response.json() as Array<Record<string, unknown>>;
  return Array.isArray(data) ? data : [];
}
async function readCached() {
  try { const value = JSON.parse(await readFile(cacheFile, 'utf8')) as { photos?: ImmichPhoto[]; refreshedAt?: string }; photosCache = value.photos ?? []; refreshedAt = value.refreshedAt ?? null; }
  catch { /* A missing or damaged cache behaves like an empty cache; the next refresh rewrites it. */ photosCache = []; refreshedAt = null; }
}
export async function getImmichStatus() {
  await readCached();
  const config = await readConfig();
  const settings = await readSettings();
  return { configured: Boolean(config?.apiKey && config.serverUrl), connected: Boolean(config && refreshedAt && !lastError), serverUrl: config?.serverUrl ?? '', apiKeyHint: config?.apiKey ? `••••${config.apiKey.slice(-4)}` : null, albums: albumsCache.map((album) => ({ ...album, selected: settings.selectedAlbumIds.includes(album.id) })), selectedAlbumIds: settings.selectedAlbumIds, photoCount: photosCache.length, refreshedAt, lastError };
}
export async function saveImmichConfig(input: { serverUrl: string; apiKey?: string }) {
  const previous = await readConfig();
  const apiKey = input.apiKey?.trim() || previous?.apiKey;
  if (!apiKey) throw new Error('Enter an Immich API key.');
  const config = { serverUrl: normalizeServerUrl(input.serverUrl), apiKey };
  await writeConfig(config);
  lastError = null;
  return testImmichConnection();
}
export async function testImmichConnection() {
  const config = await readConfig();
  if (!config) throw new Error('Save an Immich server URL and API key first.');
  const rawAlbums = await getAlbums(config);
  const settings = await readSettings();
  albumsCache = rawAlbums.flatMap((album) => typeof album.id === 'string' ? [{ id: album.id, name: typeof album.albumName === 'string' ? album.albumName : typeof album.name === 'string' ? album.name : 'Untitled album', assetCount: Number(album.assetCount ?? (Array.isArray(album.assets) ? album.assets.length : 0)), selected: settings.selectedAlbumIds.includes(album.id) }] : []);
  lastError = null;
  await refreshImmichPhotos();
  if (lastError) throw new Error(lastError);
  return getImmichStatus();
}
export async function saveImmichAlbums(albumIds: string[]) {
  const ids = [...new Set(albumIds)];
  if (ids.some((id) => !albumsCache.some((album) => album.id === id))) throw new Error('One or more selected albums are not available in Immich. Test the connection and choose again.');
  settingsCache = { selectedAlbumIds: ids };
  await writeJson(settingsFile, settingsCache);
  await refreshImmichPhotos();
  return getImmichStatus();
}
export async function refreshImmichPhotos() {
  await readCached();
  const config = await readConfig();
  if (!config) return { photos: [], refreshedAt: null };
  try {
    const settings = await readSettings();
    const albums = await getAlbums(config);
    albumsCache = albums.flatMap((album) => typeof album.id === 'string' ? [{ id: album.id, name: String(album.albumName ?? album.name ?? 'Untitled album'), assetCount: Number(album.assetCount ?? (Array.isArray(album.assets) ? album.assets.length : 0)), selected: settings.selectedAlbumIds.includes(album.id) }] : []);
    const chosen = albums.filter((album) => typeof album.id === 'string' && settings.selectedAlbumIds.includes(album.id));
    const photos: ImmichPhoto[] = [];
    for (const album of chosen) {
      const albumId = String(album.id);
      let assets: Array<Record<string, unknown>> = [];
      try {
        const seenPages = new Set<string>();
        for (let page = 1; page <= 50; page += 1) {
          const response = await request(`${config.serverUrl}/api/search/metadata`, config, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ albumIds: [albumId], type: 'IMAGE', query: 'all', visibility: 'timeline', size: 1000, page }),
          });
          const result = await response.json() as { assets?: { items?: Array<Record<string, unknown>>; nextPage?: string | number | null } };
          const pageAssets = result.assets?.items ?? [];
          const pageSignature = pageAssets.map((asset) => asset.id).filter((id): id is string => typeof id === 'string').join(',');
          if (!pageAssets.length || (pageSignature && seenPages.has(pageSignature))) break;
          if (pageSignature) seenPages.add(pageSignature);
          assets.push(...pageAssets);
          if (!result.assets?.nextPage || pageAssets.length < 1000) break;
        }
      } catch {
        // Immich versions before album search may include assets in the album response.
        assets = Array.isArray(album.assets) ? album.assets as Array<Record<string, unknown>> : [];
      }
      const name = String(album.albumName ?? album.name ?? 'Immich album');
      for (const asset of assets) {
        if (typeof asset.id !== 'string' || (asset.type && asset.type !== 'IMAGE')) continue;
        photos.push({ id: asset.id, fileName: String(asset.originalFileName ?? asset.fileName ?? 'Photo'), date: typeof asset.localDateTime === 'string' ? asset.localDateTime : typeof asset.fileCreatedAt === 'string' ? asset.fileCreatedAt : null, albumName: name });
      }
    }
    photosCache = [...new Map(photos.map((photo) => [photo.id, photo])).values()];
    refreshedAt = new Date().toISOString();
    lastError = null;
    await writeJson(cacheFile, { photos: photosCache, refreshedAt });
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Could not refresh photos from Immich.';
  }
  return { photos: photosCache, refreshedAt };
}
export async function getImmichPhotos() { await readCached(); return { photos: photosCache, refreshedAt }; }
export async function getImmichThumbnail(assetId: string) {
  const allowed = (await getImmichPhotos()).photos.some((photo) => photo.id === assetId);
  if (!allowed) throw new Error('Photo is not part of a selected Immich album.');
  const config = await readConfig();
  if (!config) throw new Error('Immich is not configured.');
  return request(`${config.serverUrl}/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=preview`, config, { headers: { accept: 'image/*' } });
}
export async function disconnectImmich() {
  configCache = null; settingsCache = { selectedAlbumIds: [] }; photosCache = []; albumsCache = []; refreshedAt = null; lastError = null;
  await Promise.all([unlink(configFile).catch(() => undefined), writeJson(settingsFile, settingsCache), writeJson(cacheFile, { photos: [], refreshedAt: null })]);
  return getImmichStatus();
}
let timer: ReturnType<typeof setInterval> | undefined;
export async function startImmichRefreshLoop(onError: (error: unknown) => void) {
  if (timer) return;
  // Fire the first refresh without blocking server startup; requests read the
  // persisted cache until the refresh completes.
  void refreshImmichPhotos().catch(onError);
  timer = setInterval(() => { void refreshImmichPhotos().catch(onError); }, 10 * 60 * 1000);
  timer.unref?.();
}
export function stopImmichRefreshLoop() { if (timer) clearInterval(timer); timer = undefined; }
