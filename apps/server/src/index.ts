import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDashboardRoutes } from './modules/system/routes.js';
import { registerWeatherRoutes } from './modules/weather/routes.js';
import { registerGoogleCalendarRoutes } from './modules/calendar/routes.js';
import { startWeatherRefreshLoop, stopWeatherRefreshLoop } from './modules/weather/service.js';
import { startCalendarRefreshLoop, stopCalendarRefreshLoop } from './modules/calendar/service.js';
import { registerImmichRoutes } from './modules/immich/routes.js';
import { startImmichRefreshLoop, stopImmichRefreshLoop } from './modules/immich/service.js';
import { registerBrandingRoutes } from './modules/branding/routes.js';

const server = Fastify({ logger: true, trustProxy: false });
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webBuildDirectory = path.resolve(currentDirectory, '../../web/dist');

await server.register(swagger, {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'TECHSHAN-HOME API',
      description: 'Same-origin API for the private TECHSHAN-HOME dashboard.',
      version: '0.1.0',
    },
    servers: [{ url: '/', description: 'Current TECHSHAN-HOME origin' }],
    tags: [
      { name: 'System', description: 'Service health and dashboard integration state.' },
      { name: 'Weather', description: 'Open-Meteo forecasts, JMA observations in Japan, and shared weather settings.' },
      { name: 'Google Calendar', description: 'OAuth connection, selected calendars, and shared read-only events.' },
      { name: 'Immich Photos', description: 'Immich server connection, selected albums, and authorized slideshow photos.' },
      { name: 'Branding', description: 'Shared brand name and logo for every dashboard screen.' },
    ],
  },
});

await server.register(swaggerUi, {
  routePrefix: '/api/docs',
  staticCSP: true,
  uiConfig: {
    deepLinking: true,
    docExpansion: 'list',
    displayRequestDuration: true,
  },
});

await server.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      styleSrc: ["'self'", ...server.swaggerCSP.style],
      scriptSrc: ["'self'", ...server.swaggerCSP.script],
      connectSrc: ["'self'", 'https://api.bigdatacloud.net'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  hsts: false,
});
// Headroom for several dashboard screens polling the shared cache and
// streaming slideshow thumbnails at the same time.
await server.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await registerDashboardRoutes(server);
await registerWeatherRoutes(server);
await registerGoogleCalendarRoutes(server);
await registerImmichRoutes(server);
await registerBrandingRoutes(server);
server.addHook('onClose', async () => {
  stopWeatherRefreshLoop();
  stopCalendarRefreshLoop();
  stopImmichRefreshLoop();
});
await startWeatherRefreshLoop((error) => server.log.error({ err: error }, 'Weather service failed'));
await startCalendarRefreshLoop((error) => server.log.error({ err: error }, 'Google Calendar service failed'));
await startImmichRefreshLoop((error) => server.log.error({ err: error }, 'Immich photo service failed'));

if (existsSync(webBuildDirectory)) {
  await server.register(staticFiles, { root: webBuildDirectory, prefix: '/' });
  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

try {
  await server.listen({ port, host });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
