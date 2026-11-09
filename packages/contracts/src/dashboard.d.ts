import type { z } from 'zod';

export type IntegrationState = 'connected' | 'not-configured' | 'unavailable';
export type DashboardStatus = {
  weather: IntegrationState;
  calendar: IntegrationState;
  photos: IntegrationState;
};
export type WeatherLocation = {
  label: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};
export type WeatherSettings = {
  location: WeatherLocation;
  temperatureUnit: 'celsius' | 'fahrenheit';
};
export type WeatherSnapshot = {
  state: 'not-configured' | 'loading' | 'ready' | 'stale' | 'unavailable';
  location: WeatherLocation | null;
  temperatureUnit: 'celsius' | 'fahrenheit';
  timezone: string | null;
  current: {
    temperature: number | null;
    feelsLike: number | null;
    humidity: number | null;
    weatherCode: number | null;
    isDay: boolean | null;
    observedAt: string | null;
    observationStation: string | null;
    precipitationLastHour: number | null;
  } | null;
  hourly: Array<{
    time: string;
    temperature: number | null;
    precipitationProbability: number | null;
    weatherCode: number | null;
  }>;
  updatedAt: string | null;
};

export type GoogleCalendarItem = {
  id: string;
  summary: string;
  primary: boolean;
  selected: boolean;
};
export type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  clientIdHint: string | null;
  redirectUri: string;
  returnUrl: string;
  calendars: GoogleCalendarItem[];
  selectedCalendarIds: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
};
export type CalendarEvent = {
  id: string;
  calendarId: string;
  calendarName: string;
  summary: string;
  start: string;
  end: string | null;
  allDay: boolean;
};
export type CalendarEventsSnapshot = {
  state: 'not-configured' | 'disconnected' | 'connected' | 'stale' | 'unavailable';
  events: CalendarEvent[];
  lastSyncedAt: string | null;
};

export declare const integrationStateSchema: z.ZodType<IntegrationState>;
export declare const dashboardStatusSchema: z.ZodType<DashboardStatus>;
export declare const weatherLocationSchema: z.ZodType<WeatherLocation>;
export declare const weatherSettingsSchema: z.ZodType<WeatherSettings>;
export declare const weatherSnapshotSchema: z.ZodType<WeatherSnapshot>;
export declare const googleCalendarItemSchema: z.ZodType<GoogleCalendarItem>;
export declare const googleCalendarStatusSchema: z.ZodType<GoogleCalendarStatus>;
export declare const calendarEventSchema: z.ZodType<CalendarEvent>;
export declare const calendarEventsSnapshotSchema: z.ZodType<CalendarEventsSnapshot>;
