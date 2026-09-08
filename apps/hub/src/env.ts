import { config } from 'dotenv';
import { z } from 'zod';

config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('localhost'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** Where the SQLite file lives. Metadata only — git holds the scores. */
  DATABASE_PATH: z.string().min(1).default('./hub.sqlite'),

  /** Base URL of the Forgejo instance, no trailing slash. */
  FORGEJO_URL: z.url(),

  /**
   * Site-admin PAT with the `write:admin` scope. Nothing bootstraps this —
   * it is created by hand once, against a running instance.
   */
  FORGEJO_ADMIN_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

/**
 * Reading the environment is a startup concern: a missing admin token should
 * stop the process, not surface as a 500 on the first signup.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }

  return parsed.data;
}
