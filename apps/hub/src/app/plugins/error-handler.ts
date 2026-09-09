import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { errorBody } from '../errors';

export default fp(async function errorHandler(fastify: FastifyInstance) {
  fastify.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(errorBody('not_found', `No route for ${request.method} ${request.url}`));
  });

  fastify.setErrorHandler((error, request, reply) => {
    const status = error.statusCode ?? 500;

    if (status >= 500) {
      // Whatever went wrong is ours, and its message may quote a query, a
      // path or a token. It belongs in the log, not in the response.
      request.log.error({ err: error }, 'request failed');
      reply.code(status).send(errorBody('internal', 'Something went wrong.'));
      return;
    }

    reply.code(status).send(errorBody(error.code ?? 'request_failed', error.message));
  });
});
