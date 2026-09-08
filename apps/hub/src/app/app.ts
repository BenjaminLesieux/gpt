import * as path from 'path';
import type { FastifyInstance } from 'fastify';
import AutoLoad from '@fastify/autoload';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppOptions {}

export async function app(fastify: FastifyInstance, opts: AppOptions) {
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'plugins'),
    options: { ...opts },
  });

  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'routes'),
    options: { ...opts },
  });
}
