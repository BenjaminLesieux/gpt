import Fastify from 'fastify';
import { app } from './app/app';
import { loadEnv } from './env';

const env = loadEnv();

const server = Fastify({
  logger: true,
});

server.register(app);

server.listen({ port: env.PORT, host: env.HOST }, (err) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  } else {
    console.log(`[ ready ] http://${env.HOST}:${env.PORT}`);
  }
});
