import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google, type Auth } from 'googleapis';
import {
  calendarEventsSnapshotSchema,
  googleCalendarStatusSchema,
  type CalendarEvent,
  type CalendarEventsSnapshot,
  type GoogleCalendarItem,
  type GoogleCalendarStatus,
} from '@techshan/contracts/dashboard';

const calendarScope = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];
const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..', 'data');
const masterKeyFile = path.join(dataDirectory, 'google-calendar-master.key');
const oauthConfigFile = path.join(dataDirectory, 'google-calendar-config.enc');
const tokenFile = path.join(dataDirectory, 'google-calendar-token.enc');
const settingsFile = path.join(dataDirectory, 'google-calendar-settings.json');
const eventsFile = path.join(dataDirectory, 'google-calendar-cache.json');
const oauthStates = new Map<string, number>();

type GoogleCredentials = Auth.Credentials;
type StoredSettings = { selectedCalendarIds: string[] };
type StoredOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; returnUrl: string };
const defaultRedirectUri = 'http://127.0.0.1:3000/auth/google/callback';
const defaultReturnUrl = 'http://127.0.0.1:5173/';

let settingsCache: StoredSettings | undefined;
let credentialsCache: GoogleCredentials | null | undefined;
let oauthConfigCache: StoredOAuthConfig | null | undefined;
let masterKeyPromise: Promise<Buffer> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let calendarStatus: GoogleCalendarStatus = {
  configured: false,
  connected: false,
  clientIdHint: null,
  redirectUri: defaultRedirectUri,
  returnUrl: defaultReturnUrl,
  calendars: [],
  selectedCalendarIds: [],
  lastSyncedAt: null,
  lastError: null,
};
let eventSnapshot: CalendarEventsSnapshot = { state: 'not-configured', events: [], lastSyncedAt: null };
let syncInProgress: Promise<CalendarEventsSnapshot> | null = null;

async function getMasterKey(): Promise<Buffer> {
  if (!masterKeyPromise) {
    masterKeyPromise = (async () => {
      await mkdir(dataDirectory, { recursive: true });
      try {
        const storedKey = await readFile(masterKeyFile);
        if (storedKey.length !== 32) throw new Error('The local Google Calendar encryption key is invalid.');
        return storedKey;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const newKey = randomBytes(32);
        try {
          await writeFile(masterKeyFile, newKey, { flag: 'wx', mode: 0o600 });
          return newKey;
        } catch (writeError) {
          if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
          return readFile(masterKeyFile);
        }
      }
    })();
  }
  return masterKeyPromise;
}

async function readEncrypted<T>(file: string): Promise<T | null> {
  try {
    const stored = JSON.parse(await readFile(file, 'utf8')) as { iv: string; tag: string; data: string };
    const decipher = createDecipheriv('aes-256-gcm', await getMasterKey(), Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeEncrypted(file: string, value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  await writeJson(file, { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
}

async function readOAuthConfig(): Promise<StoredOAuthConfig | null> {
  if (oauthConfigCache !== undefined) return oauthConfigCache;
  try {
    oauthConfigCache = await readEncrypted<StoredOAuthConfig>(oauthConfigFile);
  } catch {
    // Surface damaged storage through the status instead of crashing every
    // endpoint that reads configuration. Saving new settings overwrites the
    // damaged file.
    calendarStatus = { ...calendarStatus, lastError: 'Saved Google OAuth settings could not be decrypted. The local encryption key may be missing or damaged.' };
    oauthConfigCache = null;
  }
  return oauthConfigCache;
}

async function isConfigured() {
  const config = await readOAuthConfig();
  return Boolean(config?.clientId && config.clientSecret && config.redirectUri && config.returnUrl);
}

async function oauthClient() {
  const config = await readOAuthConfig();
  if (!config) throw new Error('Google OAuth settings are not configured. Add them in Settings.');
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export function validateAllowedUrl(value: string, fieldName: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${fieldName} must be a complete URL.`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`${fieldName} must use HTTPS, except for localhost development URLs.`);
  }
  if (url.username || url.password || url.hash) throw new Error(`${fieldName} cannot contain credentials or a URL fragment.`);
  return url.toString();
}

async function readSettings(): Promise<StoredSettings> {
  if (settingsCache) return settingsCache;
  try {
    const parsed = JSON.parse(await readFile(settingsFile, 'utf8')) as Partial<StoredSettings>;
    settingsCache = { selectedCalendarIds: Array.isArray(parsed.selectedCalendarIds) ? parsed.selectedCalendarIds.filter((id): id is string => typeof id === 'string') : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    settingsCache = { selectedCalendarIds: [] };
  }
  return settingsCache;
}

async function writeJson(file: string, value: unknown) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${file}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporaryFile, file);
}

async function readCredentials(): Promise<GoogleCredentials | null> {
  if (credentialsCache !== undefined) return credentialsCache;
  try {
    credentialsCache = await readEncrypted<GoogleCredentials>(tokenFile);
  } catch {
    // Report damaged credential storage through the status instead of
    // throwing, so status and dashboard endpoints keep responding.
    calendarStatus = { ...calendarStatus, connected: false, lastError: 'Saved Google credentials could not be decrypted. The local encryption key may be missing or damaged.' };
    credentialsCache = null;
  }
  return credentialsCache;
}

async function writeCredentials(credentials: GoogleCredentials) {
  await writeEncrypted(tokenFile, credentials);
  credentialsCache = credentials;
}

async function newGoogleClient(credentials: GoogleCredentials) {
  const client = await oauthClient();
  client.setCredentials(credentials);
  client.on('tokens', (tokens) => {
    const next = { ...credentials, ...tokens };
    void writeCredentials(next).catch((error) => {
      calendarStatus = { ...calendarStatus, lastError: error instanceof Error ? error.message : 'Could not save refreshed Google credentials.' };
    });
  });
  return client;
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  const [config, credentials, settings] = await Promise.all([readOAuthConfig(), readCredentials(), readSettings()]);
  const configured = await isConfigured();
  const hasCredentials = Boolean(credentials?.refresh_token || credentials?.access_token);
  const authorizationExpired = Boolean(calendarStatus.lastError && /invalid_grant|unauthorized|revoked/i.test(calendarStatus.lastError));
  const connected = hasCredentials && !authorizationExpired;
  return googleCalendarStatusSchema.parse({
    ...calendarStatus,
    configured,
    connected,
    clientIdHint: config?.clientId ? `${config.clientId.slice(0, 8)}...` : null,
    redirectUri: config?.redirectUri ?? defaultRedirectUri,
    returnUrl: config?.returnUrl ?? defaultReturnUrl,
    selectedCalendarIds: settings.selectedCalendarIds,
    calendars: calendarStatus.calendars.map((calendar) => ({ ...calendar, selected: settings.selectedCalendarIds.includes(calendar.id) })),
    lastError: calendarStatus.lastError,
  });
}

export async function saveGoogleOAuthSettings(input: { clientId?: string; clientSecret?: string; redirectUri: string; returnUrl: string }) {
  const savedCredentials = await readCredentials();
  if (savedCredentials?.refresh_token || savedCredentials?.access_token) {
    throw new Error('Disconnect Google Calendar before changing its OAuth client settings.');
  }
  const existing = await readOAuthConfig();
  const clientId = input.clientId?.trim() || existing?.clientId;
  const clientSecret = input.clientSecret?.trim() || existing?.clientSecret;
  if (!clientId || !clientSecret) throw new Error('Enter both the Google OAuth client ID and client secret.');
  const config: StoredOAuthConfig = {
    clientId,
    clientSecret,
    redirectUri: validateAllowedUrl(input.redirectUri.trim(), 'Authorized redirect URI'),
    returnUrl: validateAllowedUrl(input.returnUrl.trim(), 'Dashboard return URL'),
  };
  if (!config.redirectUri.endsWith('/auth/google/callback')) {
    throw new Error('Authorized redirect URI must end with /auth/google/callback.');
  }
  await writeEncrypted(oauthConfigFile, config);
  oauthConfigCache = config;
  calendarStatus = { ...calendarStatus, configured: true, clientIdHint: `${clientId.slice(0, 8)}...`, redirectUri: config.redirectUri, returnUrl: config.returnUrl, lastError: null };
  return getGoogleCalendarStatus();
}

export async function beginGoogleCalendarConnection() {
  if (!(await isConfigured())) throw new Error('Google Calendar is not configured. Add the OAuth client details in Settings first.');
  const state = randomBytes(32).toString('base64url');
  const now = Date.now();
  for (const [oldState, expiresAt] of oauthStates) if (expiresAt <= now) oauthStates.delete(oldState);
  oauthStates.set(state, now + 10 * 60 * 1000);
  const authorizationUrl = (await oauthClient()).generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: true,
    prompt: 'consent',
    scope: calendarScope,
    state,
  });
  return { state, authorizationUrl };
}

export async function finishGoogleCalendarConnection(input: { code: string; state: string }) {
  const expiresAt = oauthStates.get(input.state);
  oauthStates.delete(input.state);
  if (!expiresAt || expiresAt < Date.now()) throw new Error('Google authorization state is missing, expired, or already used. Start the connection again.');
  const { tokens } = await (await oauthClient()).getToken(input.code);
  const previous = await readCredentials();
  const credentials = { ...previous, ...tokens };
  if (!credentials.refresh_token && !previous?.refresh_token) {
    throw new Error('Google did not return a refresh token. Disconnect the app in Google Account permissions, then connect again.');
  }
  await writeCredentials(credentials);
  calendarStatus = { ...calendarStatus, configured: true, connected: true, lastError: null };
  await refreshGoogleCalendar();
}

async function getAuthorizedClient() {
  const credentials = await readCredentials();
  if (!credentials?.refresh_token && !credentials?.access_token) return null;
  return newGoogleClient(credentials);
}

async function loadCalendarList(auth: InstanceType<typeof google.auth.OAuth2>) {
  const calendarApi = google.calendar({ version: 'v3', auth });
  const response = await calendarApi.calendarList.list({ maxResults: 250 });
  const calendars: GoogleCalendarItem[] = (response.data.items ?? []).flatMap((calendar) => {
    if (!calendar.id) return [];
    return [{
      id: calendar.id,
      summary: calendar.summary || calendar.id,
      primary: calendar.primary === true,
      selected: false,
    }];
  });
  return { calendarApi, calendars };
}

export async function saveSelectedGoogleCalendars(calendarIds: string[]) {
  const status = await getGoogleCalendarStatus();
  if (!status.connected) throw new Error('Connect Google Calendar before choosing calendars.');
  const availableIds = new Set(status.calendars.map((calendar) => calendar.id));
  if (calendarIds.some((id) => !availableIds.has(id))) throw new Error('One or more selected calendars are not available to this Google account.');
  const settings = { selectedCalendarIds: [...new Set(calendarIds)] };
  await writeJson(settingsFile, settings);
  settingsCache = settings;
  return refreshGoogleCalendar();
}

export async function refreshGoogleCalendar(): Promise<CalendarEventsSnapshot> {
  if (syncInProgress) return syncInProgress;
  syncInProgress = (async () => {
    if (!(await isConfigured())) {
      eventSnapshot = { state: 'not-configured', events: [], lastSyncedAt: null };
      calendarStatus = { ...calendarStatus, configured: false, connected: false, calendars: [], lastError: null };
      return eventSnapshot;
    }
    const auth = await getAuthorizedClient();
    if (!auth) {
      eventSnapshot = { ...eventSnapshot, state: 'disconnected' };
      // Keep any existing lastError (for example an undecryptable credential
      // file) so the status explains why the account is not connected.
      calendarStatus = { ...calendarStatus, configured: true, connected: false, calendars: [] };
      return eventSnapshot;
    }

    try {
      const { calendarApi, calendars } = await loadCalendarList(auth);
      const settings = await readSettings();
      let selectedCalendarIds = settings.selectedCalendarIds.filter((id) => calendars.some((calendar) => calendar.id === id));
      if (selectedCalendarIds.length === 0 && settings.selectedCalendarIds.length === 0) {
        const primary = calendars.find((calendar) => calendar.primary) ?? calendars[0];
        if (primary) selectedCalendarIds = [primary.id];
        settingsCache = { selectedCalendarIds };
        await writeJson(settingsFile, settingsCache);
      } else if (selectedCalendarIds.length !== settings.selectedCalendarIds.length) {
        settingsCache = { selectedCalendarIds };
        await writeJson(settingsFile, settingsCache);
      }

      const now = new Date();
      const timeMin = now.toISOString();
      const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const selectedCalendars = calendars.filter((calendar) => selectedCalendarIds.includes(calendar.id));
      const eventGroups = await Promise.all(selectedCalendars.map(async (calendar) => {
        const response = await calendarApi.events.list({
          calendarId: calendar.id,
          timeMin,
          timeMax,
          maxResults: 50,
          singleEvents: true,
          orderBy: 'startTime',
        });
        return (response.data.items ?? []).flatMap((event): CalendarEvent[] => {
          const start = event.start?.dateTime || event.start?.date;
          if (!event.id || !start) return [];
          return [{
            id: `${calendar.id}:${event.id}`,
            calendarId: calendar.id,
            calendarName: calendar.summary,
            summary: event.summary || 'Untitled event',
            start,
            end: event.end?.dateTime || event.end?.date || null,
            allDay: Boolean(event.start?.date),
          }];
        });
      }));
      const events = eventGroups.flat().sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
      const syncedAt = new Date().toISOString();
      const oauthSettings = await readOAuthConfig();
      eventSnapshot = calendarEventsSnapshotSchema.parse({ state: 'connected', events, lastSyncedAt: syncedAt });
      calendarStatus = {
        configured: true,
        connected: true,
        clientIdHint: oauthSettings?.clientId ? `${oauthSettings.clientId.slice(0, 8)}...` : null,
        redirectUri: oauthSettings?.redirectUri ?? defaultRedirectUri,
        returnUrl: oauthSettings?.returnUrl ?? defaultReturnUrl,
        calendars: calendars.map((calendar) => ({ ...calendar, selected: selectedCalendarIds.includes(calendar.id) })),
        selectedCalendarIds,
        lastSyncedAt: syncedAt,
        lastError: null,
      };
      await Promise.all([writeJson(eventsFile, eventSnapshot), writeJson(settingsFile, { selectedCalendarIds })]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google Calendar could not be refreshed.';
      const stale = eventSnapshot.events.length > 0;
      eventSnapshot = { ...eventSnapshot, state: stale ? 'stale' : 'unavailable' };
      calendarStatus = { ...calendarStatus, configured: true, connected: !/invalid_grant|unauthorized|revoked/i.test(message), lastError: message };
    }
    return eventSnapshot;
  })();
  try {
    return await syncInProgress;
  } finally {
    syncInProgress = null;
  }
}

export async function getCalendarEvents(): Promise<CalendarEventsSnapshot> {
  return calendarEventsSnapshotSchema.parse(eventSnapshot);
}

export async function disconnectGoogleCalendar() {
  const credentials = await readCredentials();
  if (credentials?.refresh_token) {
    try {
      await (await oauthClient()).revokeToken(credentials.refresh_token);
    } catch {
      // Remove local credentials even if Google has already revoked them.
    }
  }
  credentialsCache = null;
  settingsCache = { selectedCalendarIds: [] };
  const configured = await isConfigured();
  eventSnapshot = { state: configured ? 'disconnected' : 'not-configured', events: [], lastSyncedAt: null };
  calendarStatus = {
    ...calendarStatus,
    configured,
    connected: false,
    calendars: [],
    selectedCalendarIds: [],
    lastSyncedAt: null,
    lastError: null,
  };
  await Promise.all([tokenFile, settingsFile, eventsFile].map((file) => unlink(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  })));
  await readSettings();
}

export async function getCalendarIntegrationState(): Promise<'connected' | 'not-configured' | 'unavailable'> {
  const status = await getGoogleCalendarStatus();
  if (!status.configured) return 'not-configured';
  if (status.connected && eventSnapshot.state !== 'unavailable') return 'connected';
  if (status.lastError || eventSnapshot.state === 'unavailable') return 'unavailable';
  return 'not-configured';
}

export async function startCalendarRefreshLoop(onError: (error: unknown) => void = () => {}) {
  if (refreshTimer) return;
  try {
    eventSnapshot = calendarEventsSnapshotSchema.parse(JSON.parse(await readFile(eventsFile, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onError(error);
  }
  try {
    await readSettings();
  } catch (error) {
    onError(error);
  }
  void refreshGoogleCalendar().catch(onError);
  refreshTimer = setInterval(() => { void refreshGoogleCalendar().catch(onError); }, 5 * 60 * 1000);
  refreshTimer.unref?.();
}

export function stopCalendarRefreshLoop() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

export async function getGoogleCalendarReturnUrl() {
  const config = await readOAuthConfig();
  return config?.returnUrl ?? defaultReturnUrl;
}
