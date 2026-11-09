import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  calendarEventsSnapshotSchema,
  googleCalendarStatusSchema,
} from '@techshan/contracts/dashboard';
import {
  beginGoogleCalendarConnection,
  disconnectGoogleCalendar,
  finishGoogleCalendarConnection,
  getCalendarEvents,
  getGoogleCalendarReturnUrl,
  getGoogleCalendarStatus,
  refreshGoogleCalendar,
  saveGoogleOAuthSettings,
  saveSelectedGoogleCalendars,
} from './service.js';

const calendarStatusResponse = {
  type: 'object',
  properties: {
    configured: { type: 'boolean' },
    connected: { type: 'boolean' },
    clientIdHint: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    redirectUri: { type: 'string', format: 'uri' },
    returnUrl: { type: 'string', format: 'uri' },
    calendars: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
          primary: { type: 'boolean' },
          selected: { type: 'boolean' },
        },
        required: ['id', 'summary', 'primary', 'selected'],
      },
    },
    selectedCalendarIds: { type: 'array', items: { type: 'string' } },
    lastSyncedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    lastError: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['configured', 'connected', 'clientIdHint', 'redirectUri', 'returnUrl', 'calendars', 'selectedCalendarIds', 'lastSyncedAt', 'lastError'],
} as const;

const eventsResponse = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['not-configured', 'disconnected', 'connected', 'stale', 'unavailable'] },
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          calendarId: { type: 'string' },
          calendarName: { type: 'string' },
          summary: { type: 'string' },
          start: { type: 'string' },
          end: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          allDay: { type: 'boolean' },
        },
        required: ['id', 'calendarId', 'calendarName', 'summary', 'start', 'end', 'allDay'],
      },
    },
    lastSyncedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  },
  required: ['state', 'events', 'lastSyncedAt'],
} as const;

const errorResponse = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } as const;

export async function registerGoogleCalendarRoutes(server: FastifyInstance) {
  await server.register(cookie);

  server.get('/api/v1/integrations/google/config', {
    schema: {
      tags: ['Google Calendar'],
      summary: 'Read Google OAuth setup state',
      description: 'Returns the configured client ID hint and redirect URLs. The client secret is never returned.',
      response: { 200: calendarStatusResponse },
    },
  }, async () => googleCalendarStatusSchema.parse(await getGoogleCalendarStatus()));

  server.put('/api/v1/integrations/google/config', {
    schema: {
      tags: ['Google Calendar'],
      summary: 'Save Google OAuth client settings',
      description: 'Encrypts the OAuth client ID, client secret, redirect URI, and dashboard return URL on the server. The secret is accepted only in the request body and is never returned.',
      body: {
        type: 'object',
        properties: {
          clientId: { type: 'string', minLength: 1, maxLength: 300 },
          clientSecret: { type: 'string', minLength: 1, maxLength: 300 },
          redirectUri: { type: 'string', format: 'uri', maxLength: 500 },
          returnUrl: { type: 'string', format: 'uri', maxLength: 500 },
        },
        required: ['redirectUri', 'returnUrl'],
      },
      response: {
        200: calendarStatusResponse,
        400: { description: 'Invalid OAuth client settings.', ...errorResponse },
        409: { description: 'Disconnect the existing Google account before changing its OAuth client.', ...errorResponse },
      },
    },
  }, async (request, reply) => {
    const parsed = z.object({
      clientId: z.string().trim().min(1).max(300).optional(),
      clientSecret: z.string().trim().min(1).max(300).optional(),
      redirectUri: z.string().trim().url().max(500),
      returnUrl: z.string().trim().url().max(500),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid client ID, client secret, redirect URI, and dashboard URL.' });
    try {
      return googleCalendarStatusSchema.parse(await saveGoogleOAuthSettings(parsed.data));
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Could not save Google OAuth settings.' });
    }
  });

  server.post('/api/v1/integrations/google/connect', {
    schema: {
      tags: ['Google Calendar'],
      summary: 'Start Google Calendar authorization',
      description: 'Creates a one-time OAuth state, binds it to a short-lived HttpOnly cookie, and returns the Google authorization URL. Requires OAuth client details saved in Settings.',
      response: {
        200: {
          type: 'object',
          properties: { authorizationUrl: { type: 'string', format: 'uri' } },
          required: ['authorizationUrl'],
        },
        503: { description: 'Google OAuth configuration is missing.', ...errorResponse },
      },
    },
  }, async (_request, reply) => {
    try {
      const { state, authorizationUrl } = await beginGoogleCalendarConnection();
      const configuredRedirect = (await getGoogleCalendarStatus()).redirectUri;
      reply.setCookie('gcal_oauth_state', state, {
        path: '/auth/google/callback',
        httpOnly: true,
        sameSite: 'lax',
        secure: configuredRedirect.startsWith('https://'),
        maxAge: 600,
      });
      return { authorizationUrl };
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : 'Google Calendar is not configured.' });
    }
  });

  server.get('/auth/google/callback', {
    schema: {
      tags: ['Google Calendar'],
      summary: 'Complete Google Calendar authorization',
      description: 'Validates the OAuth state cookie, exchanges the authorization code, encrypts returned credentials, and redirects to the dashboard. No OAuth token is returned to the browser.',
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          state: { type: 'string' },
          error: { type: 'string' },
        },
      },
      response: { 303: { description: 'Redirects to the dashboard after success or failure.' } },
    },
  }, async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const stateCookie = request.cookies.gcal_oauth_state;
    reply.clearCookie('gcal_oauth_state', { path: '/auth/google/callback' });
    if (query.error) return reply.redirect(`${await getGoogleCalendarReturnUrl()}?calendar=denied`, 303);
    if (!query.code || !query.state || !stateCookie || query.state !== stateCookie) {
      return reply.redirect(`${await getGoogleCalendarReturnUrl()}?calendar=state-error`, 303);
    }
    try {
      await finishGoogleCalendarConnection({ code: query.code, state: query.state });
      return reply.redirect(`${await getGoogleCalendarReturnUrl()}?calendar=connected`, 303);
    } catch {
      request.log.error({ requestId: request.id }, 'Google Calendar authorization failed');
      return reply.redirect(`${await getGoogleCalendarReturnUrl()}?calendar=error`, 303);
    }
  });

  server.get('/api/v1/integrations/google/status', {
    schema: {
      tags: ['Google Calendar'],
      summary: 'Get Google Calendar connection and selection status',
      description: 'Returns OAuth readiness, connection state, available calendars, selected calendar IDs, and sync status without exposing secrets or event contents.',
      response: { 200: calendarStatusResponse },
    },
  }, async () => googleCalendarStatusSchema.parse(await getGoogleCalendarStatus()));

  server.put('/api/v1/integrations/google/calendars', {
    schema: {
      tags: ['Google Calendar'],
      summary: 'Choose calendars for the shared dashboard',
      description: 'Stores the selected calendar IDs and immediately refreshes the shared event cache.',
      body: {
        type: 'object',
        properties: { calendarIds: { type: 'array', uniqueItems: true, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 512 } } },
        required: ['calendarIds'],
      },
      response: {
        200: { description: 'Refreshed event snapshot.', ...eventsResponse },
        400: { description: 'Invalid calendar selection.', ...errorResponse },
        409: { description: 'Google Calendar is not connected or selection contains an unavailable calendar.', ...errorResponse },
      },
    },
  }, async (request, reply) => {
    const parsed = z.object({ calendarIds: z.array(z.string().min(1).max(512)).max(50) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Choose up to 50 valid calendars.' });
    try {
      return calendarEventsSnapshotSchema.parse(await saveSelectedGoogleCalendars(parsed.data.calendarIds));
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Could not save calendar selection.' });
    }
  });

  server.get('/api/v1/calendar/events', {
    schema: {
      tags: ['Google Calendar'],
      summary: 'Get cached upcoming events',
      description: 'Returns sanitized events from selected calendars over the next 14 days. Event descriptions and locations are not included.',
      response: { 200: eventsResponse },
    },
  }, async () => calendarEventsSnapshotSchema.parse(await getCalendarEvents()));

  server.post('/api/v1/integrations/google/refresh', {
    schema: {
      tags: ['Google Calendar'],
      summary: 'Refresh Google Calendar events now',
      description: 'Requests an immediate server-side calendar and event refresh. Scheduled syncs run every five minutes.',
      response: { 200: eventsResponse },
    },
  }, async () => calendarEventsSnapshotSchema.parse(await refreshGoogleCalendar()));

  server.delete('/api/v1/integrations/google/connection', {
    schema: {
      tags: ['Google Calendar'],
      summary: 'Disconnect Google Calendar',
      description: 'Revokes the saved Google refresh token where possible and deletes local encrypted credentials, selected calendars, and cached events.',
      response: { 200: calendarStatusResponse },
    },
  }, async () => {
    await disconnectGoogleCalendar();
    return googleCalendarStatusSchema.parse(await getGoogleCalendarStatus());
  });
}
