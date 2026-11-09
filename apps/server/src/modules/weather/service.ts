import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWeatherApi } from 'openmeteo';
import { z } from 'zod';
import {
  weatherSettingsSchema,
  weatherSnapshotSchema,
  type WeatherSettings,
  type WeatherSnapshot,
} from '@techshan/contracts/dashboard';

const geocodingResultSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string().optional(),
  admin1: z.string().optional(),
  country: z.string().optional(),
});

const geocodingResponseSchema = z.object({ results: z.array(geocodingResultSchema).optional() });
const jmaAreaSchema = z.object({
  offices: z.record(z.string(), z.object({ parent: z.string().optional() }).passthrough()),
  class10s: z.record(z.string(), z.object({ parent: z.string().optional() }).passthrough()),
  class15s: z.record(z.string(), z.object({ name: z.string(), enName: z.string().optional(), parent: z.string().optional() }).passthrough()),
  class20s: z.record(z.string(), z.object({ name: z.string(), enName: z.string().optional(), parent: z.string().optional() }).passthrough()),
});
const jmaForecastSchema = z.array(z.object({
  reportDatetime: z.string(),
  timeSeries: z.array(z.object({
    timeDefines: z.array(z.string()),
    areas: z.array(z.object({
      area: z.object({ code: z.string() }),
      weatherCodes: z.array(z.string()).optional(),
      weathers: z.array(z.string()).optional(),
      pops: z.array(z.string()).optional(),
    }).passthrough()),
  }).passthrough()),
}).passthrough());

type JmaObservation = {
  temperature: number;
  humidity: number | null;
  precipitationLastHour: number | null;
  station: string;
  observedAt: string;
  isRaining: boolean;
};
type JmaForecast = {
  currentWeatherCode: number | null;
  hourly: Array<{ weatherCode: number | null; precipitationProbability: number | null }>;
};

const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..', 'data');
const settingsFile = path.join(dataDirectory, 'weather-settings.json');
const cacheFile = path.join(dataDirectory, 'weather-cache.json');

let settingsCache: WeatherSettings | null | undefined;
let snapshot: WeatherSnapshot = {
  state: 'not-configured',
  location: null,
  temperatureUnit: 'celsius',
  timezone: null,
  current: null,
  hourly: [],
  updatedAt: null,
};
let refreshInProgress: Promise<WeatherSnapshot> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let jmaAreasPromise: Promise<z.infer<typeof jmaAreaSchema>> | null = null;
let jmaStationsPromise: Promise<Record<string, { lat: [number, number]; lon: [number, number]; enName?: string; kjName?: string }>> | null = null;

function asNullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function getJmaAreas() {
  if (!jmaAreasPromise) {
    jmaAreasPromise = fetch('https://www.jma.go.jp/bosai/common/const/area.json', { signal: AbortSignal.timeout(8000) })
      .then(async (response) => {
        if (!response.ok) throw new Error(`JMA area lookup returned HTTP ${response.status}`);
        return jmaAreaSchema.parse(await response.json());
      });
  }
  return jmaAreasPromise;
}

async function getJmaStations() {
  if (!jmaStationsPromise) {
    jmaStationsPromise = fetch('https://www.jma.go.jp/bosai/amedas/const/amedastable.json', { signal: AbortSignal.timeout(8000) })
      .then(async (response) => {
        if (!response.ok) throw new Error(`JMA station lookup returned HTTP ${response.status}`);
        const data = await response.json() as Record<string, { lat?: [number, number]; lon?: [number, number]; enName?: string; kjName?: string }>;
        return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, { lat: [number, number]; lon: [number, number]; enName?: string; kjName?: string }] =>
          Array.isArray(entry[1].lat) && Array.isArray(entry[1].lon)));
      });
  }
  return jmaStationsPromise;
}

export function normalizedPlaceName(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+(city|town|village)$/i, '').trim();
}

async function getJmaForecastArea(location: WeatherSettings['location']) {
  const areas = await getJmaAreas();
  const tokens = location.label.split(',').map((token) => normalizedPlaceName(token));
  const city = tokens[0];
  const entry = Object.entries(areas.class20s).find(([, value]) =>
    [value.name, value.enName].filter(Boolean).some((name) => normalizedPlaceName(name!).includes(city) || city.includes(normalizedPlaceName(name!))));
  if (!entry?.[1].parent) return null;
  const class15 = areas.class15s[entry[1].parent];
  const class10 = class15?.parent ? areas.class10s[class15.parent] : null;
  const officeCode = class10?.parent;
  if (!class15?.parent || !officeCode || !areas.offices[officeCode]) return null;
  return { areaCode: class15.parent, officeCode };
}

export function jmaCodeToWmo(code: string | undefined, description: string | undefined): number | null {
  const text = description ?? '';
  if (/雪|みぞれ/.test(text) || code?.startsWith('4')) return 71;
  if (/雨|雷/.test(text) || code?.startsWith('3')) return /雷/.test(text) ? 95 : 61;
  if (/晴/.test(text) || code?.startsWith('1')) return /くもり/.test(text) ? 2 : 1;
  if (/くもり|曇/.test(text) || code?.startsWith('2')) return 3;
  return null;
}

function numericObservation(value: unknown): number | null {
  return Array.isArray(value) && typeof value[0] === 'number' && Number.isFinite(value[0]) ? value[0] : null;
}

async function fetchJmaObservation(location: WeatherSettings['location']): Promise<JmaObservation | null> {
  const stations = await getJmaStations();
  const stampResponse = await fetch('https://www.jma.go.jp/bosai/amedas/data/latest_time.txt', { signal: AbortSignal.timeout(8000) });
  if (!stampResponse.ok) throw new Error(`JMA latest observation returned HTTP ${stampResponse.status}`);
  const observedAt = (await stampResponse.text()).trim();
  const stamp = observedAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}/);
  if (!stamp) throw new Error('JMA returned an invalid observation timestamp.');
  const mapUrl = `https://www.jma.go.jp/bosai/amedas/data/map/${stamp[1]}${stamp[2]}${stamp[3]}${stamp[4]}${stamp[5]}00.json`;
  const mapResponse = await fetch(mapUrl, { signal: AbortSignal.timeout(8000) });
  if (!mapResponse.ok) throw new Error(`JMA observation data returned HTTP ${mapResponse.status}`);
  const readings = await mapResponse.json() as Record<string, Record<string, unknown>>;

  let nearest: { distance: number; station: string; reading: Record<string, unknown> } | null = null;
  for (const [stationId, station] of Object.entries(stations)) {
    const reading = readings[stationId];
    const temperature = numericObservation(reading?.temp);
    if (temperature === null) continue;
    const latitude = station.lat[0] + station.lat[1] / 60;
    const longitude = station.lon[0] + station.lon[1] / 60;
    const latitudeDelta = (latitude - location.latitude) * 111.32;
    const longitudeDelta = (longitude - location.longitude) * 111.32 * Math.cos(location.latitude * Math.PI / 180);
    const distance = Math.hypot(latitudeDelta, longitudeDelta);
    if (!nearest || distance < nearest.distance) {
      nearest = { distance, station: station.enName || station.kjName || stationId, reading };
    }
  }
  if (!nearest || nearest.distance > 40) return null;
  const precipitationLastHour = numericObservation(nearest.reading.precipitation1h);
  return {
    temperature: numericObservation(nearest.reading.temp)!,
    humidity: numericObservation(nearest.reading.humidity),
    precipitationLastHour,
    station: nearest.station,
    observedAt,
    isRaining: precipitationLastHour !== null && precipitationLastHour > 0,
  };
}

async function fetchJmaForecast(location: WeatherSettings['location']): Promise<JmaForecast | null> {
  const region = await getJmaForecastArea(location);
  if (!region) return null;
  const response = await fetch(`https://www.jma.go.jp/bosai/forecast/data/forecast/${region.officeCode}.json`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`JMA forecast returned HTTP ${response.status}`);
  const result = jmaForecastSchema.parse(await response.json());
  const weatherSeries = result[0]?.timeSeries[0];
  const probabilitySeries = result[0]?.timeSeries.find((series) => series.areas.some((area) => area.pops));
  const weatherArea = weatherSeries?.areas.find((area) => area.area.code === region.areaCode);
  const probabilityArea = probabilitySeries?.areas.find((area) => area.area.code === region.areaCode);
  if (!weatherSeries || !weatherArea) return null;

  const now = Date.now();
  const periodWeather = (date: number) => {
    let index = 0;
    for (let i = 0; i < weatherSeries.timeDefines.length; i += 1) {
      if (Date.parse(weatherSeries.timeDefines[i]!) <= date) index = i;
    }
    return jmaCodeToWmo(weatherArea.weatherCodes?.[index], weatherArea.weathers?.[index]);
  };
  const periodProbability = (date: number) => {
    if (!probabilitySeries || !probabilityArea?.pops) return null;
    let index = 0;
    for (let i = 0; i < probabilitySeries.timeDefines.length; i += 1) {
      if (Date.parse(probabilitySeries.timeDefines[i]!) <= date) index = i;
    }
    const value = Number(probabilityArea.pops[index]);
    return Number.isFinite(value) ? value : null;
  };

  return {
    currentWeatherCode: periodWeather(now),
    hourly: Array.from({ length: 6 }, (_, index) => {
      const time = Math.floor(now / 3_600_000) * 3_600_000 + index * 3_600_000;
      return { weatherCode: periodWeather(time), precipitationProbability: periodProbability(time) };
    }),
  };
}

async function readSettings(): Promise<WeatherSettings | null> {
  if (settingsCache !== undefined) return settingsCache;
  try {
    const text = await readFile(settingsFile, 'utf8');
    settingsCache = weatherSettingsSchema.parse(JSON.parse(text));
  } catch {
    // A missing or damaged settings file behaves like unconfigured weather so
    // the endpoints keep responding. The next save rewrites the file.
    settingsCache = null;
  }
  return settingsCache;
}

export async function getWeatherSettings(): Promise<WeatherSettings | null> {
  return readSettings();
}

export async function searchWeatherLocations(query: string) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query.trim());
  url.searchParams.set('count', '8');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Location search returned HTTP ${response.status}`);
  const result = geocodingResponseSchema.parse(await response.json());

  return (result.results ?? []).map((place) => ({
    label: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone,
  }));
}

async function writeSettings(settings: WeatherSettings) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${settingsFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(settings, null, 2), 'utf8');
  await rename(temporaryFile, settingsFile);
  settingsCache = settings;
}

async function writeSnapshotCache(value: WeatherSnapshot) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${cacheFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(value), 'utf8');
  await rename(temporaryFile, cacheFile);
}

export async function getWeatherSnapshot(): Promise<WeatherSnapshot> {
  const settings = await readSettings();
  if (!settings) return snapshot;
  if (snapshot.state === 'not-configured') {
    snapshot = { ...snapshot, state: 'loading', location: settings.location, temperatureUnit: settings.temperatureUnit };
  }
  return weatherSnapshotSchema.parse(snapshot);
}

export async function refreshWeather(): Promise<WeatherSnapshot> {
  if (refreshInProgress) return refreshInProgress;

  refreshInProgress = (async () => {
    const settings = await readSettings();
    if (!settings) {
      snapshot = { ...snapshot, state: 'not-configured', location: null };
      return snapshot;
    }

    if (!snapshot.current) {
      snapshot = { ...snapshot, state: 'loading', location: settings.location, temperatureUnit: settings.temperatureUnit };
    }

    try {
      const responses = await fetchWeatherApi('https://api.open-meteo.com/v1/forecast', {
        latitude: settings.location.latitude,
        longitude: settings.location.longitude,
        current: ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'is_day', 'weather_code'],
        hourly: ['temperature_2m', 'precipitation_probability', 'weather_code'],
        forecast_hours: 12,
        temperature_unit: settings.temperatureUnit,
        timezone: 'auto',
      }, 3, 0.2, 2, { signal: AbortSignal.timeout(15_000) });
      const response = responses[0];
      const current = response?.current();
      const hourly = response?.hourly();
      if (!response || !current || !hourly) throw new Error('The weather provider returned incomplete forecast data.');

      const hourlyTemperatures = hourly.variables(0)?.valuesArray();
      const hourlyPrecipitation = hourly.variables(1)?.valuesArray();
      const hourlyCodes = hourly.variables(2)?.valuesArray();
      const startTime = Number(hourly.time());
      const interval = hourly.interval() || 3600;
      // Emit true UTC timestamps. Clients format them with the forecast
      // location's IANA timezone instead of decoding local time hidden behind
      // a Z suffix.
      const isoTime = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();
      let jmaObservation: JmaObservation | null = null;
      let jmaForecast: JmaForecast | null = null;
      if (settings.location.timezone === 'Asia/Tokyo' || /,\s*Japan$/i.test(settings.location.label)) {
        [jmaObservation, jmaForecast] = await Promise.all([
          fetchJmaObservation(settings.location).catch(() => null),
          fetchJmaForecast(settings.location).catch(() => null),
        ]);
      }
      const location = {
        ...settings.location,
        latitude: response.latitude(),
        longitude: response.longitude(),
      };

      snapshot = weatherSnapshotSchema.parse({
        state: 'ready',
        location,
        temperatureUnit: settings.temperatureUnit,
        timezone: response.timezone() ?? settings.location.timezone ?? null,
        current: {
          temperature: jmaObservation?.temperature ?? asNullableNumber(current.variables(0)?.value()),
          feelsLike: jmaObservation ? null : asNullableNumber(current.variables(1)?.value()),
          humidity: jmaObservation?.humidity ?? asNullableNumber(current.variables(2)?.value()),
          isDay: asNullableNumber(current.variables(3)?.value()) === null ? null : current.variables(3)!.value() === 1,
          weatherCode: jmaObservation?.isRaining
            ? 61
            : jmaForecast?.currentWeatherCode ?? asNullableNumber(current.variables(4)?.value()),
          observedAt: jmaObservation?.observedAt ?? null,
          observationStation: jmaObservation?.station ?? null,
          precipitationLastHour: jmaObservation?.precipitationLastHour ?? null,
        },
        hourly: Array.from({ length: Math.min(6, hourlyTemperatures?.length ?? 0) }, (_, index) => ({
          time: isoTime(startTime + interval * index),
          temperature: asNullableNumber(hourlyTemperatures?.[index]),
          precipitationProbability: jmaForecast?.hourly[index]?.precipitationProbability
            ?? asNullableNumber(hourlyPrecipitation?.[index]),
          weatherCode: jmaForecast?.hourly[index]?.weatherCode ?? asNullableNumber(hourlyCodes?.[index]),
        })),
        updatedAt: new Date().toISOString(),
      });
      await writeSnapshotCache(snapshot);
    } catch {
      snapshot = {
        ...snapshot,
        state: snapshot.current ? 'stale' : 'unavailable',
        location: settings.location,
        temperatureUnit: settings.temperatureUnit,
      };
    }

    return snapshot;
  })();

  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
}

export async function saveWeatherSettings(input: unknown): Promise<WeatherSnapshot> {
  const settings = weatherSettingsSchema.parse(input);
  await writeSettings(settings);
  snapshot = { ...snapshot, state: 'loading', location: settings.location, temperatureUnit: settings.temperatureUnit };
  return refreshWeather();
}

export async function startWeatherRefreshLoop(onError: (error: unknown) => void = () => {}) {
  if (refreshTimer) return;
  try {
    const cached = weatherSnapshotSchema.parse(JSON.parse(await readFile(cacheFile, 'utf8')));
    snapshot = cached.state === 'ready' ? { ...cached, state: 'stale' } : cached;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onError(error);
  }
  void refreshWeather().catch(onError);
  refreshTimer = setInterval(() => { void refreshWeather().catch(onError); }, 10 * 60 * 1000);
  refreshTimer.unref?.();
}

export function stopWeatherRefreshLoop() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}
