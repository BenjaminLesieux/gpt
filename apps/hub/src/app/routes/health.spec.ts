import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import health from './health';

describe('health route', () => {
  it('should report ok when the server is up', async () => {
    // Given a server with only the health route registered — autoload walks
    // __dirname, which vitest's ESM transform does not define.
    const fastify = Fastify();
    fastify.register(health);

    // When
    const response = await fastify.inject({ method: 'GET', url: '/health' });

    // Then
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
