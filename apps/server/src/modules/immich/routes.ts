import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { disconnectImmich, getImmichPhotos, getImmichStatus, getImmichThumbnail, refreshImmichPhotos, saveImmichAlbums, saveImmichConfig, testImmichConnection } from './service.js';

const errorResponse = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } as const;
const album = { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, assetCount: { type: 'integer' }, selected: { type: 'boolean' } }, required: ['id', 'name', 'assetCount', 'selected'] } as const;
const status = { type: 'object', properties: { configured: { type: 'boolean' }, connected: { type: 'boolean' }, serverUrl: { type: 'string' }, apiKeyHint: { anyOf: [{ type: 'string' }, { type: 'null' }] }, albums: { type: 'array', items: album }, selectedAlbumIds: { type: 'array', items: { type: 'string' } }, photoCount: { type: 'integer' }, refreshedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] }, lastError: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['configured', 'connected', 'serverUrl', 'apiKeyHint', 'albums', 'selectedAlbumIds', 'photoCount', 'refreshedAt', 'lastError'] } as const;
const photos = { type: 'object', properties: { photos: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, fileName: { type: 'string' }, date: { anyOf: [{ type: 'string' }, { type: 'null' }] }, albumName: { type: 'string' } }, required: ['id', 'fileName', 'date', 'albumName'] } }, refreshedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] } }, required: ['photos', 'refreshedAt'] } as const;

export async function registerImmichRoutes(server: FastifyInstance) {
  server.get('/api/v1/integrations/immich/status', { schema: { tags: ['Immich Photos'], summary: 'Get Immich setup and sync status', response: { 200: status } } }, getImmichStatus);
  server.put('/api/v1/integrations/immich/config', { schema: { tags: ['Immich Photos'], summary: 'Save Immich server settings', description: 'Saves the Immich server URL and encrypts the API key at rest. The secret is never returned.', body: { type: 'object', properties: { serverUrl: { type: 'string', format: 'uri', maxLength: 500 }, apiKey: { type: 'string', maxLength: 1000 } }, required: ['serverUrl'] }, response: { 200: status, 400: errorResponse, 502: errorResponse } } }, async (request, reply) => {
    const parsed = z.object({ serverUrl: z.string().trim().url().max(500), apiKey: z.string().trim().max(1000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid Immich server URL and API key.' });
    try { return await saveImmichConfig(parsed.data); } catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : 'Could not connect to Immich.' }); }
  });
  server.post('/api/v1/integrations/immich/test', { schema: { tags: ['Immich Photos'], summary: 'Test the saved Immich connection', description: 'Checks API access using the saved server URL and API key, then refreshes selected album photos.', response: { 200: status, 502: errorResponse } } }, async (_request, reply) => {
    try { return await testImmichConnection(); } catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : 'Could not connect to Immich.' }); }
  });
  server.get('/api/v1/integrations/immich/albums', { schema: { tags: ['Immich Photos'], summary: 'List Immich albums', response: { 200: { type: 'array', items: album } } } }, async () => (await getImmichStatus()).albums);
  server.put('/api/v1/integrations/immich/albums', { schema: { tags: ['Immich Photos'], summary: 'Select slideshow albums', body: { type: 'object', properties: { albumIds: { type: 'array', uniqueItems: true, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 100 } } }, required: ['albumIds'] }, response: { 200: status, 400: errorResponse } } }, async (request, reply) => {
    const parsed = z.object({ albumIds: z.array(z.string().min(1).max(100)).max(100) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Choose up to 100 valid albums.' });
    try { return await saveImmichAlbums(parsed.data.albumIds); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not save album selection.' }); }
  });
  server.post('/api/v1/integrations/immich/refresh', { schema: { tags: ['Immich Photos'], summary: 'Refresh selected Immich photos', response: { 200: photos } } }, async () => { await refreshImmichPhotos(); return getImmichPhotos(); });
  server.delete('/api/v1/integrations/immich/connection', { schema: { tags: ['Immich Photos'], summary: 'Disconnect Immich and remove saved settings', response: { 200: status } } }, disconnectImmich);
  server.get('/api/v1/photos/slideshow', { schema: { tags: ['Immich Photos'], summary: 'Get selected slideshow photos', response: { 200: photos } } }, getImmichPhotos);
  server.get<{ Params: { id: string } }>('/api/v1/photos/:id/image', { schema: { tags: ['Immich Photos'], summary: 'Get an authorized Immich photo thumbnail', params: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['id'] }, response: { 200: { description: 'Immich thumbnail image.' }, 404: errorResponse, 502: errorResponse } } }, async (request, reply) => {
    if (!(await getImmichPhotos()).photos.some((photo) => photo.id === request.params.id)) return reply.code(404).send({ error: 'Photo is not part of a selected Immich album.' });
    try {
      const upstream = await getImmichThumbnail(request.params.id);
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      reply.header('content-type', contentType).header('cache-control', 'private, max-age=300').header('x-content-type-options', 'nosniff');
      return reply.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : 'Could not load photo from Immich.' }); }
  });
}
