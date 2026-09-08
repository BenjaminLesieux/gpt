import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const complete = {
  FORGEJO_URL: 'https://forgejo.example',
  FORGEJO_ADMIN_TOKEN: 'admin-pat',
};

describe('loadEnv', () => {
  it('should apply defaults when only the required values are set', () => {
    // Given / When
    const env = loadEnv(complete);

    // Then
    expect(env.NODE_ENV).toBe('development');
    expect(env.HOST).toBe('localhost');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_PATH).toBe('./hub.sqlite');
  });

  it('should coerce PORT to a number when it arrives as a string', () => {
    // Given / When
    const env = loadEnv({ ...complete, PORT: '8080' });

    // Then
    expect(env.PORT).toBe(8080);
  });

  it('should throw naming the variable when the admin token is missing', () => {
    // Given
    const { FORGEJO_ADMIN_TOKEN: _omitted, ...withoutToken } = complete;

    // When / Then
    expect(() => loadEnv(withoutToken)).toThrow(/FORGEJO_ADMIN_TOKEN/);
  });


  it('should reject an empty admin token, not treat it as absent', () => {
    // Given .env.example copied verbatim, which leaves the token blank
    // When / Then
    expect(() => loadEnv({ ...complete, FORGEJO_ADMIN_TOKEN: '' })).toThrow(
      /FORGEJO_ADMIN_TOKEN/
    );
  });

  it('should reject a Forgejo URL that is not a URL', () => {
    // Given / When / Then
    expect(() => loadEnv({ ...complete, FORGEJO_URL: 'not-a-url' })).toThrow(
      /FORGEJO_URL/
    );
  });
});
