import type {
  CalendarEvent,
  CalendarEventsSnapshot,
  DashboardStatus,
  GoogleCalendarStatus,
  WeatherLocation,
  WeatherSettings,
  WeatherSnapshot,
} from '@techshan/contracts/dashboard';

export type { CalendarEvent, CalendarEventsSnapshot, DashboardStatus, GoogleCalendarStatus, WeatherLocation, WeatherSettings, WeatherSnapshot };
export type IntegrationState = DashboardStatus[keyof DashboardStatus];
export type ImmichAlbum = { id: string; name: string; assetCount: number; selected: boolean };
export type ImmichStatus = { configured: boolean; connected: boolean; serverUrl: string; apiKeyHint: string | null; albums: ImmichAlbum[]; selectedAlbumIds: string[]; photoCount: number; refreshedAt: string | null; lastError: string | null };
export type SlideshowPhoto = { id: string; fileName: string; date: string | null; albumName: string };
export type SlideshowSnapshot = { photos: SlideshowPhoto[]; refreshedAt: string | null };

async function immichRequest<T extends object>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: 'same-origin', headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
  const result = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error('error' in result ? result.error || 'Immich request failed.' : 'Immich request failed.');
  return result as T;
}

export function loadImmichStatus() { return immichRequest<ImmichStatus>('/api/v1/integrations/immich/status'); }
export function saveImmichSettings(input: { serverUrl: string; apiKey?: string }) { return immichRequest<ImmichStatus>('/api/v1/integrations/immich/config', { method: 'PUT', body: JSON.stringify(input) }); }
export function testImmichConnection() { return immichRequest<ImmichStatus>('/api/v1/integrations/immich/test', { method: 'POST' }); }
export function saveImmichAlbumSelection(albumIds: string[]) { return immichRequest<ImmichStatus>('/api/v1/integrations/immich/albums', { method: 'PUT', body: JSON.stringify({ albumIds }) }); }
export function disconnectImmich() { return immichRequest<ImmichStatus>('/api/v1/integrations/immich/connection', { method: 'DELETE' }); }
export function loadSlideshowPhotos() { return immichRequest<SlideshowSnapshot>('/api/v1/photos/slideshow'); }

const initialStatus: DashboardStatus = {
  weather: 'not-configured',
  calendar: 'not-configured',
  photos: 'not-configured',
};

export async function loadDashboardStatus(): Promise<DashboardStatus> {
  try {
    const response = await fetch('/api/v1/dashboard/status', { credentials: 'same-origin' });
    if (!response.ok) return initialStatus;
    return (await response.json()) as DashboardStatus;
  } catch {
    return initialStatus;
  }
}

export async function loadWeatherSnapshot(): Promise<WeatherSnapshot> {
  const fallback: WeatherSnapshot = {
    state: 'not-configured', location: null, temperatureUnit: 'celsius', timezone: null,
    current: null, hourly: [], updatedAt: null,
  };
  try {
    const response = await fetch('/api/v1/weather', { credentials: 'same-origin' });
    if (!response.ok) return fallback;
    return (await response.json()) as WeatherSnapshot;
  } catch {
    return fallback;
  }
}

export async function loadWeatherSettings(): Promise<WeatherSettings | null> {
  const response = await fetch('/api/v1/settings/weather', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load the shared weather settings.');
  return (await response.json()) as WeatherSettings | null;
}

export async function searchWeatherLocations(query: string): Promise<WeatherLocation[]> {
  const response = await fetch(`/api/v1/settings/weather/locations?query=${encodeURIComponent(query)}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Location search is temporarily unavailable.');
  return (await response.json()) as WeatherLocation[];
}

export async function saveWeatherSettings(settings: WeatherSettings): Promise<WeatherSnapshot> {
  const response = await fetch('/api/v1/settings/weather', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error('Could not save the weather settings.');
  return (await response.json()) as WeatherSnapshot;
}

export async function loadGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  const response = await fetch('/api/v1/integrations/google/status', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load Google Calendar status.');
  return (await response.json()) as GoogleCalendarStatus;
}

export async function saveGoogleOAuthSettings(input: {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  returnUrl: string;
}): Promise<GoogleCalendarStatus> {
  const response = await fetch('/api/v1/integrations/google/config', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const result = await response.json() as GoogleCalendarStatus | { error?: string };
  if (!response.ok) throw new Error('error' in result ? result.error || 'Could not save Google OAuth settings.' : 'Could not save Google OAuth settings.');
  return result as GoogleCalendarStatus;
}

export async function loadCalendarEvents(): Promise<CalendarEventsSnapshot> {
  const response = await fetch('/api/v1/calendar/events', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load calendar events.');
  return (await response.json()) as CalendarEventsSnapshot;
}

export async function beginGoogleCalendarConnection(): Promise<string> {
  const response = await fetch('/api/v1/integrations/google/connect', {
    method: 'POST', credentials: 'same-origin',
  });
  const result = await response.json() as { authorizationUrl?: string; error?: string };
  if (!response.ok || !result.authorizationUrl) throw new Error(result.error || 'Google Calendar is not configured.');
  return result.authorizationUrl;
}

export async function saveGoogleCalendarSelection(calendarIds: string[]): Promise<CalendarEventsSnapshot> {
  const response = await fetch('/api/v1/integrations/google/calendars', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ calendarIds }),
  });
  if (!response.ok) {
    const result = await response.json() as { error?: string };
    throw new Error(result.error || 'Could not save selected calendars.');
  }
  return (await response.json()) as CalendarEventsSnapshot;
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarStatus> {
  const response = await fetch('/api/v1/integrations/google/connection', {
    method: 'DELETE', credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Could not disconnect Google Calendar.');
  return (await response.json()) as GoogleCalendarStatus;
}

export async function refreshCalendarEvents(): Promise<CalendarEventsSnapshot> {
  const response = await fetch('/api/v1/integrations/google/refresh', {
    method: 'POST', credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Could not refresh Google Calendar.');
  return (await response.json()) as CalendarEventsSnapshot;
}
