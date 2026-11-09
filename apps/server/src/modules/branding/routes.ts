import type { FastifyInstance } from 'fastify';
import { brandingConfigSchema } from '@techshan/contracts/dashboard';
import { getBrandingConfig, getBrandingLogo, removeBrandingLogo, saveBrandingLogo, saveBrandingName } from './service.js';

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

const brandingResponse = {
  type: 'object',
  properties: {
    name: { anyOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
    customLogo: { type: 'boolean' },
    logoUpdatedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  },
  required: ['name', 'customLogo', 'logoUpdatedAt'],
} as const;

export async function registerBrandingRoutes(server: FastifyInstance) {
  // Logo uploads arrive as raw image bytes; cap them at 2 MiB.
  server.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_request, body, done) => done(null, body));

  server.get('/api/v1/settings/branding', {
    schema: {
      tags: ['Branding'],
      summary: 'Get the shared brand name and logo state',
      response: { 200: brandingResponse },
    },
  }, async () => brandingConfigSchema.parse(await getBrandingConfig()));

  server.put('/api/v1/settings/branding', {
    schema: {
      tags: ['Branding'],
      summary: 'Set the shared brand name',
      description: 'Send null to show the default TECHSHAN-HOME name again.',
      body: {
        type: 'object',
        properties: { name: { anyOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] } },
        required: ['name'],
      },
      response: { 200: brandingResponse, 400: errorResponse },
    },
  }, async (request, reply) => {
    const raw = (request.body as { name: string | null }).name;
    const name = typeof raw === 'string' ? raw.trim() : raw;
    if (name !== null && (name.length < 1 || name.length > 40)) {
      return reply.code(400).send({ error: 'The brand name must be 1-40 characters.' });
    }
    return brandingConfigSchema.parse(await saveBrandingName(name));
  });

  server.put('/api/v1/settings/branding/logo', {
    schema: {
      tags: ['Branding'],
      summary: 'Upload a shared brand logo',
      description: 'Accepts PNG, JPEG, or WebP bytes (up to 2 MiB) and uses them as the top-bar brand mark on every dashboard screen.',
      response: { 200: brandingResponse, 400: errorResponse, 413: errorResponse },
    },
  }, async (request, reply) => {
    const bytes = request.body as Buffer;
    if (!bytes || bytes.length === 0) return reply.code(400).send({ error: 'Choose an image file to upload.' });
    try {
      return brandingConfigSchema.parse(await saveBrandingLogo(bytes));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not use this image as the logo.' });
    }
  });

  server.get('/api/v1/settings/branding/logo', {
    schema: {
      tags: ['Branding'],
      summary: 'Get the uploaded brand logo image',
      response: { 200: { description: 'The uploaded logo image.' }, 404: errorResponse },
    },
  }, async (_request, reply) => {
    const logo = await getBrandingLogo();
    if (!logo) return reply.code(404).send({ error: 'No custom logo has been uploaded.' });
    reply.header('content-type', logo.contentType).header('cache-control', 'private, max-age=60').header('x-content-type-options', 'nosniff');
    return reply.send(logo.bytes);
  });

  server.delete('/api/v1/settings/branding/logo', {
    schema: {
      tags: ['Branding'],
      summary: 'Remove the uploaded brand logo',
      description: 'Restores the default built-in brand mark.',
      response: { 200: brandingResponse },
    },
  }, async () => brandingConfigSchema.parse(await removeBrandingLogo()));
}
