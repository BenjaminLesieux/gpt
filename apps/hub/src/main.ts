import Fastify from 'fastify';
import { app } from './app/app';
import { loadEnv } from './env';
import type { Env } from './env';

/**
 * A bad .env is an operator error, not a crash. Printing the stack buries the
 * one line that says which variable is wrong under twenty frames of module
 * loader, which is the opposite of failing loudly.
 */
function readEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('\nSee apps/hub/.env.example for what each value means.');
    process.exit(1);
  }
}

const env = readEnvOrExit();

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
