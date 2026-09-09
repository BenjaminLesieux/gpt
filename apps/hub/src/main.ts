import * as path from 'node:path';
import Fastify from 'fastify';
import { app } from './app/app';
import { purgeExpiredSessions } from './auth/sessions';
import { migrateToLatest, openDatabase } from './db/client';
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

const database = openDatabase(env.DATABASE_PATH);
// esbuild is not bundling, so dist mirrors the workspace tree and this
// file sits at dist/apps/hub/src/main.js. The migrations are copied as a
// build asset to the same mirrored path — dist/main.js is only a loader
// shim, so resolving from the dist root would miss them.
migrateToLatest(database.db, path.join(__dirname, 'db', 'migrations'));
purgeExpiredSessions(database.db);

const server = Fastify({
  logger: true,
});

server.register(app, {
  db: database.db,
  // Setting Secure over plain http would make the browser drop the cookie,
  // and dev is http://localhost by design.
  cookieSecure: env.NODE_ENV === 'production',
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    // Closing checkpoints the WAL, which otherwise leaves two sidecar files
    // beside the database until the next open.
    void server.close().then(() => {
      database.close();
      process.exit(0);
    });
  });
}

server.listen({ port: env.PORT, host: env.HOST }, (err) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  } else {
    console.log(`[ ready ] http://${env.HOST}:${env.PORT}`);
  }
});
