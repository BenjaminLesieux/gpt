import { describe, expect, it, vi } from 'vitest';
import { ForgejoClient, ForgejoError } from './client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(fetchImpl: typeof globalThis.fetch, baseUrl = 'https://forgejo.example') {
  return new ForgejoClient({ baseUrl, adminToken: 'admin-pat', fetch: fetchImpl });
}

describe('ForgejoClient', () => {
  it('should authenticate with the token scheme when it calls the admin API', async () => {
    // Given
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1, login: 'gpabc', email: 'a@b.c' }));

    // When
    await clientWith(fetchImpl).createUser({
      username: 'gpabc',
      email: 'a@b.c',
      password: 'x',
      must_change_password: false,
    });

    // Then — Forgejo uses `token <pat>`, not Bearer.
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe('token admin-pat');
  });

  it('should send must_change_password false when it creates a user', async () => {
    // Given
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1, login: 'gpabc', email: 'a@b.c' }));

    // When
    await clientWith(fetchImpl).createUser({
      username: 'gpabc',
      email: 'a@b.c',
      password: 'generated',
      must_change_password: false,
    });

    // Then — the server default is true, which would gate web sign-in.
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://forgejo.example/api/v1/admin/users');
    expect(JSON.parse(init.body)).toMatchObject({ must_change_password: false });
  });

  it('should scope a minted token to a single repository', async () => {
    // Given
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 7, name: 'score-1', sha1: 'secret', scopes: ['write:repository'] }));

    // When
    const token = await clientWith(fetchImpl).createToken('gpabc', {
      name: 'score-1',
      scopes: ['write:repository'],
      repositories: [{ owner: 'gpabc', name: 'sxyz' }],
    });

    // Then
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://forgejo.example/api/v1/admin/users/gpabc/tokens');
    expect(JSON.parse(init.body)).toEqual({
      name: 'score-1',
      scopes: ['write:repository'],
      repositories: [{ owner: 'gpabc', name: 'sxyz' }],
    });
    expect(token.sha1).toBe('secret');
  });

  it('should strip a trailing slash from the base url', async () => {
    // Given a base url as an operator would paste it
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1, login: 'g', email: 'a@b.c' }));

    // When
    await clientWith(fetchImpl, 'https://forgejo.example/').createUser({
      username: 'g',
      email: 'a@b.c',
      password: 'x',
      must_change_password: false,
    });

    // Then — `//api/v1/...` would 404.
    expect(fetchImpl.mock.calls[0][0]).toBe('https://forgejo.example/api/v1/admin/users');
  });

  it('should escape a username when it builds the repo path', async () => {
    // Given
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1, name: 's', full_name: 'a/s', clone_url: 'u', owner: {} }));

    // When
    await clientWith(fetchImpl).createRepo('odd name', { name: 'sxyz', private: true, auto_init: true });

    // Then
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://forgejo.example/api/v1/admin/users/odd%20name/repos'
    );
  });

  it('should raise a conflict-flagged error when the name is already taken', async () => {
    // Given a 409, which is what a provisioning retry hits
    const fetchImpl = vi.fn().mockResolvedValue(new Response('user already exists', { status: 409 }));

    // When
    const failure = await clientWith(fetchImpl)
      .createUser({ username: 'gpabc', email: 'a@b.c', password: 'x', must_change_password: false })
      .catch((error: unknown) => error);

    // Then
    expect(failure).toBeInstanceOf(ForgejoError);
    expect((failure as ForgejoError).status).toBe(409);
    expect((failure as ForgejoError).isConflict).toBe(true);
  });

  it('should not flag a 422 as a conflict', async () => {
    // Given
    const fetchImpl = vi.fn().mockResolvedValue(new Response('password too weak', { status: 422 }));

    // When
    const failure = await clientWith(fetchImpl)
      .createUser({ username: 'gpabc', email: 'a@b.c', password: 'x', must_change_password: false })
      .catch((error: unknown) => error);

    // Then — only 409 is safe to treat as already-done.
    expect((failure as ForgejoError).isConflict).toBe(false);
    expect((failure as ForgejoError).message).toContain('password too weak');
  });
});
