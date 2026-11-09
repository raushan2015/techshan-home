import { describe, expect, it } from 'vitest';
import {
  calendarEventsSnapshotSchema,
  dashboardStatusSchema,
  weatherSnapshotSchema,
} from '@techshan/contracts/dashboard';

const weatherSnapshot = {
  state: 'ready',
  location: { label: 'Tokyo, Japan', latitude: 35.68, longitude: 139.69, timezone: 'Asia/Tokyo' },
  temperatureUnit: 'celsius',
  timezone: 'Asia/Tokyo',
  current: {
    temperature: 18.4,
    feelsLike: 17.9,
    humidity: 62,
    weatherCode: 2,
    isDay: true,
    observedAt: '2025-01-01T12:00:00+09:00',
    observationStation: 'Tokyo',
    precipitationLastHour: 0.5,
  },
  hourly: [{ time: '2025-01-01T03:00:00.000Z', temperature: 18, precipitationProbability: 10, weatherCode: 2 }],
  updatedAt: '2025-01-01T03:00:00.000Z',
};

describe('shared contracts', () => {
  it('parses a complete weather snapshot', () => {
    expect(weatherSnapshotSchema.parse(weatherSnapshot)).toMatchObject({ state: 'ready' });
  });

  it('rejects invalid weather snapshots', () => {
    expect(weatherSnapshotSchema.safeParse({ ...weatherSnapshot, state: 'fine' }).success).toBe(false);
    expect(
      weatherSnapshotSchema.safeParse({ ...weatherSnapshot, location: { ...weatherSnapshot.location, latitude: 120 } }).success,
    ).toBe(false);
  });

  it('parses dashboard status and calendar snapshots', () => {
    expect(
      dashboardStatusSchema.parse({ weather: 'connected', calendar: 'not-configured', photos: 'unavailable' }),
    ).toMatchObject({ weather: 'connected' });
    expect(
      calendarEventsSnapshotSchema.parse({ state: 'connected', events: [], lastSyncedAt: null }),
    ).toMatchObject({ state: 'connected' });
  });
});
