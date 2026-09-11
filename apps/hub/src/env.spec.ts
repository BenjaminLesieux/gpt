import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('should boot from nothing at all', () => {
    // Given / When — every setting defaults, so the hub can be tried before
    // anything has been read.
    const env = loadEnv({});

    // Then
    expect(env.NODE_ENV).toBe('development');
    expect(env.HOST).toBe('localhost');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_PATH).toBe('./hub.sqlite');
    expect(env.GIT_ROOT).toBe('./git-repos');
    expect(env.PUBLIC_URL).toBe('http://localhost:3000');
  });

  it('should coerce PORT to a number when it arrives as a string', () => {
    // Given / When
    const env = loadEnv({ PORT: '8080' });

    // Then
    expect(env.PORT).toBe(8080);
  });

  it('should reject a public url that is not a url', () => {
    // Given / When / Then
    expect(() => loadEnv({ PUBLIC_URL: 'not-a-url' })).toThrow(/PUBLIC_URL/);
  });

  it('should refuse to run in production while the public url is the default', () => {
    // Given a hub deployed without the one setting that cannot be guessed
    // When / Then — otherwise every clone url it hands out points at the
    // server's own loopback, and nothing says so.
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/PUBLIC_URL/);
  });

  it('should refuse a loopback public url in production however it is written', () => {
    // Given / When / Then
    expect(() =>
      loadEnv({ NODE_ENV: 'production', PUBLIC_URL: 'http://127.0.0.1:3000' })
    ).toThrow(/PUBLIC_URL/);
  });

  it('should accept a real origin in production', () => {
    // Given / When
    const env = loadEnv({ NODE_ENV: 'production', PUBLIC_URL: 'https://hub.example.com' });

    // Then
    expect(env.PUBLIC_URL).toBe('https://hub.example.com');
  });

  it('should leave a localhost public url alone in development', () => {
    // Given / When / Then — development is where that value is correct.
    expect(loadEnv({ NODE_ENV: 'development' }).PUBLIC_URL).toBe('http://localhost:3000');
  });
});
