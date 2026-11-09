import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  weatherSettingsSchema,
  weatherSnapshotSchema,
} from '@techshan/contracts/dashboard';
import {
  getWeatherSettings,
  getWeatherSnapshot,
  refreshWeather,
  saveWeatherSettings,
  searchWeatherLocations,
} from './service.js';

const settingsResponse = {
  oneOf: [
    {
      type: 'object',
      properties: {
        location: { type: 'object', properties: { label: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' }, timezone: { type: 'string' } }, required: ['label', 'latitude', 'longitude'] },
        temperatureUnit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
      },
      required: ['location', 'temperatureUnit'],
    },
    { type: 'null' },
  ],
} as const;

const weatherLocationResponse = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    latitude: { type: 'number' },
    longitude: { type: 'number' },
    timezone: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['label', 'latitude', 'longitude'],
} as const;

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] } as const;
const weatherSnapshotResponse = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['not-configured', 'loading', 'ready', 'stale', 'unavailable'] },
    location: { anyOf: [weatherLocationResponse, { type: 'null' }] },
    temperatureUnit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    timezone: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    current: {
      anyOf: [
        {
          type: 'object',
          properties: {
            temperature: nullableNumber,
            feelsLike: nullableNumber,
            humidity: nullableNumber,
            isDay: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
            weatherCode: nullableNumber,
            observedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
            observationStation: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            precipitationLastHour: nullableNumber,
          },
          required: ['temperature', 'feelsLike', 'humidity', 'isDay', 'weatherCode', 'observedAt', 'observationStation', 'precipitationLastHour'],
        },
        { type: 'null' },
      ],
    },
    hourly: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          time: { type: 'string', format: 'date-time' },
          temperature: nullableNumber,
          precipitationProbability: nullableNumber,
          weatherCode: nullableNumber,
        },
        required: ['time', 'temperature', 'precipitationProbability', 'weatherCode'],
      },
    },
    updatedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  },
  required: ['state', 'location', 'temperatureUnit', 'timezone', 'current', 'hourly', 'updatedAt'],
} as const;

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

export async function registerWeatherRoutes(server: FastifyInstance) {
  server.get('/api/v1/weather', {
    schema: {
      tags: ['Weather'],
      summary: 'Get the cached weather forecast',
      description: 'Returns current conditions and the next six forecast entries. For Japanese locations, current temperature and rainfall use the nearest JMA AMeDAS station, with the JMA local forecast supplying weather conditions and precipitation probability. Other locations use Open-Meteo. Includes cache freshness and stale state.',
      response: { 200: { description: 'Weather forecast and cache state.', ...weatherSnapshotResponse } },
    },
  }, async () => getWeatherSnapshot());

  server.get('/api/v1/settings/weather', {
    schema: {
      tags: ['Weather'],
      summary: 'Get shared weather settings',
      description: 'Returns the shared forecast location and temperature unit, or null if weather has not been configured.',
      response: { 200: settingsResponse },
    },
  }, async () => getWeatherSettings());

  server.get('/api/v1/settings/weather/locations', {
    schema: {
      tags: ['Weather'],
      summary: 'Search for a weather location',
      description: 'Searches Open-Meteo geocoding for matching cities or postal codes. Results can be saved as the shared dashboard location.',
      querystring: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 2, maxLength: 80, description: 'City, region, or postal code. Add a country to disambiguate.' } },
        required: ['query'],
      },
      response: {
        200: { description: 'Matching locations, including label, coordinates, and timezone.', type: 'array', items: weatherLocationResponse },
        400: { description: 'The search query is missing or too short.', ...errorResponse },
        502: { description: 'The geocoding provider did not respond successfully.', ...errorResponse },
      },
    },
  }, async (request, reply) => {
    const parsed = z.string().trim().min(2).max(80).safeParse((request.query as { query?: unknown }).query);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a location with at least two characters.' });
    try {
      return await searchWeatherLocations(parsed.data);
    } catch {
      return reply.code(502).send({ error: 'Location search is temporarily unavailable.' });
    }
  });

  server.put('/api/v1/settings/weather', {
    schema: {
      tags: ['Weather'],
      summary: 'Save the shared weather location and units',
      description: 'Saves a selected city or current-device coordinates on the server, then requests a fresh forecast immediately.',
      body: {
        type: 'object',
        properties: {
          location: {
            type: 'object',
            properties: {
              label: { type: 'string', minLength: 2, maxLength: 120 },
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
              timezone: { type: 'string' },
            },
            required: ['label', 'latitude', 'longitude'],
          },
          temperatureUnit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['location', 'temperatureUnit'],
      },
      response: {
        200: { description: 'Saved settings and the most recent forecast state.', ...weatherSnapshotResponse },
        400: { description: 'Invalid location or temperature unit.', ...errorResponse },
      },
    },
  }, async (request, reply) => {
    const parsed = weatherSettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid weather settings.' });
    const result = await saveWeatherSettings(parsed.data);
    return weatherSnapshotSchema.parse(result);
  });

  server.post('/api/v1/weather/refresh', {
    schema: {
      tags: ['Weather'],
      summary: 'Request a weather refresh',
      description: 'Requests a server-side refresh now. Scheduled updates continue every ten minutes.',
      response: { 200: { description: 'Current forecast and freshness state.', ...weatherSnapshotResponse } },
    },
  }, async () => refreshWeather());
}
