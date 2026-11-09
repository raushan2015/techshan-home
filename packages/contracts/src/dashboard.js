import { z } from 'zod';

export const integrationStateSchema = z.enum(['connected', 'not-configured', 'unavailable']);

export const dashboardStatusSchema = z.object({
  weather: integrationStateSchema,
  calendar: integrationStateSchema,
  photos: integrationStateSchema,
});

export const weatherLocationSchema = z.object({
  label: z.string().min(2).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().max(80).optional(),
});

export const weatherSettingsSchema = z.object({
  location: weatherLocationSchema,
  temperatureUnit: z.enum(['celsius', 'fahrenheit']),
});

export const weatherSnapshotSchema = z.object({
  state: z.enum(['not-configured', 'loading', 'ready', 'stale', 'unavailable']),
  location: weatherLocationSchema.nullable(),
  temperatureUnit: z.enum(['celsius', 'fahrenheit']),
  timezone: z.string().nullable(),
  current: z.object({
    temperature: z.number().nullable(),
    feelsLike: z.number().nullable(),
    humidity: z.number().nullable(),
    weatherCode: z.number().nullable(),
    isDay: z.boolean().nullable(),
    observedAt: z.string().nullable(),
    observationStation: z.string().nullable(),
    precipitationLastHour: z.number().nullable(),
  }).nullable(),
  hourly: z.array(z.object({
    time: z.string(),
    temperature: z.number().nullable(),
    precipitationProbability: z.number().nullable(),
    weatherCode: z.number().nullable(),
  })),
  updatedAt: z.string().nullable(),
});

export const googleCalendarItemSchema = z.object({
  id: z.string(),
  summary: z.string(),
  primary: z.boolean(),
  selected: z.boolean(),
});

export const googleCalendarStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  clientIdHint: z.string().nullable(),
  redirectUri: z.string(),
  returnUrl: z.string(),
  calendars: z.array(googleCalendarItemSchema),
  selectedCalendarIds: z.array(z.string()),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

export const calendarEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  calendarName: z.string(),
  summary: z.string(),
  start: z.string(),
  end: z.string().nullable(),
  allDay: z.boolean(),
});

export const calendarEventsSnapshotSchema = z.object({
  state: z.enum(['not-configured', 'disconnected', 'connected', 'stale', 'unavailable']),
  events: z.array(calendarEventSchema),
  lastSyncedAt: z.string().nullable(),
});
