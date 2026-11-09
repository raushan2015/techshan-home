import type { FastifyInstance } from 'fastify';
import { dashboardStatusSchema, type WeatherSnapshot } from '@techshan/contracts/dashboard';
import { getWeatherSnapshot } from '../weather/service.js';
import { getCalendarIntegrationState } from '../calendar/service.js';
import { getImmichStatus } from '../immich/service.js';

export function mapWeatherIntegrationState(state: WeatherSnapshot['state']): 'connected' | 'not-configured' | 'unavailable' {
  if (state === 'ready' || state === 'stale') return 'connected';
  if (state === 'not-configured') return 'not-configured';
  return 'unavailable';
}

export async function registerDashboardRoutes(server: FastifyInstance) {
  server.get('/api/v1/health', {
    schema: {
      tags: ['System'],
      summary: 'Check application health',
      description: 'Returns the application process health status. This endpoint does not expose integration credentials or private dashboard data.',
      response: {
        200: {
          description: 'The application process is healthy.',
          type: 'object',
          properties: { status: { type: 'string', enum: ['ok'] } },
          required: ['status'],
        },
      },
    },
  }, async () => ({ status: 'ok' }));

  server.get('/api/v1/dashboard/status', {
    schema: {
      tags: ['System'],
      summary: 'Get dashboard integration status',
      description: 'Returns whether each dashboard integration is connected, not configured, or temporarily unavailable. No credentials or personal content are returned.',
      response: {
        200: {
          description: 'Current integration availability for the shared dashboard.',
          type: 'object',
          properties: {
            weather: { type: 'string', enum: ['connected', 'not-configured', 'unavailable'] },
            calendar: { type: 'string', enum: ['connected', 'not-configured', 'unavailable'] },
            photos: { type: 'string', enum: ['connected', 'not-configured', 'unavailable'] },
          },
          required: ['weather', 'calendar', 'photos'],
        },
      },
    },
  }, async () => {
    try {
      const [weather, calendar, immich] = await Promise.all([getWeatherSnapshot(), getCalendarIntegrationState(), getImmichStatus()]);
      return dashboardStatusSchema.parse({
        weather: mapWeatherIntegrationState(weather.state),
        calendar,
        photos: immich.connected ? 'connected' : immich.configured ? 'unavailable' : 'not-configured',
      });
    } catch {
      // The status endpoint must stay up even when an integration module fails
      // unexpectedly; report every integration as unavailable instead of 500.
      return dashboardStatusSchema.parse({ weather: 'unavailable', calendar: 'unavailable', photos: 'unavailable' });
    }
  });
}
