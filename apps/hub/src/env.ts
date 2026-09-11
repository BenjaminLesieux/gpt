import { config } from 'dotenv';
import { z } from 'zod';

config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('localhost'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** Where the SQLite file lives. Metadata only — git holds the scores. */
  DATABASE_PATH: z.string().min(1).default('./hub.sqlite'),

  /** Directory holding the bare repositories, one per score. */
  GIT_ROOT: z.string().min(1).default('./git-repos'),

  /**
   * The origin the outside world reaches this hub on. Clone URLs are built
   * from it and then pasted into a dialog and written into a `.git/config`,
   * so a wrong value is not a 500 anyone can see — it is a remote that
   * silently resolves nowhere.
   */
  PUBLIC_URL: z.url().default('http://localhost:3000'),

  /**
   * Whether to believe `X-Forwarded-For`. It decides what `request.ip` is,
   * and `request.ip` is what every rate limit is keyed on — so getting this
   * wrong fails silently in one direction and dangerously in the other.
   * Behind a proxy and off, all callers share one bucket and the sixth
   * signup ever made is rejected. Exposed directly and on, any caller picks
   * their own bucket by sending a header.
   */
  TRUST_PROXY: z.stringbool().default(false),
}).superRefine((env, ctx) => {
  // Defaulting PUBLIC_URL is what lets someone try the hub without reading
  // anything. Shipping that default is what would hand every one of their
  // users a clone url pointing at their own machine.
  if (env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/.test(env.PUBLIC_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['PUBLIC_URL'],
      message:
        'still points at this machine, which no other machine can reach. ' +
        'Set it to the origin your users will use.',
    });
  }

  // The hub speaks plain http and has no TLS of its own, so an https origin
  // means something is terminating TLS in front of it. That makes this a
  // sound inference rather than a guess, and worth refusing over: sharing
  // one rate-limit bucket across every user looks like a bug in the hub,
  // not like a line missing from a config file.
  if (env.PUBLIC_URL.startsWith('https://') && !env.TRUST_PROXY) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUST_PROXY'],
      message:
        'is off while PUBLIC_URL is https, so there is a proxy in front and ' +
        'every caller will look like it. Set TRUST_PROXY=true.',
    });
  }
});

export type Env = z.infer<typeof schema>;

/**
 * Reading the environment is a startup concern: a value the hub cannot work
 * with should stop the process, not surface as a 500 on the first signup.
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
