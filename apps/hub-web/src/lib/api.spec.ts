import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, HubError } from './api';

function respond(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe('HubError.isSignedOut', () => {
  it('reads a 401 as a lost session whatever the server called it', () => {
    expect(new HubError('nonsense', '', 401).isSignedOut).toBe(true);
  });

  it('reads the session codes as lost sessions whatever the status', () => {
    for (const code of ['no_session', 'session_expired', 'invalid_session']) {
      expect(new HubError(code, '', 403).isSignedOut).toBe(true);
    }
  });

  it('leaves other refusals alone', () => {
    // A 403 from the git routes means the token is for another score. Signing
    // the user out over it would be the wrong recovery entirely.
    expect(new HubError('wrong_repository', '', 403).isSignedOut).toBe(false);
    expect(new HubError('already_set_up', '', 409).isSignedOut).toBe(false);
  });
});

describe('HubError.isUpstreamDown', () => {
  it('counts a network failure and a 5xx as the same outage', () => {
    expect(new HubError('network', '', 0).isUpstreamDown).toBe(true);
    expect(new HubError('internal', '', 500).isUpstreamDown).toBe(true);
    expect(new HubError('internal', '', 503).isUpstreamDown).toBe(true);
  });

  it('does not blame the hub for the caller having asked wrongly', () => {
    expect(new HubError('invalid_body', '', 400).isUpstreamDown).toBe(false);
    expect(new HubError('not_found', '', 404).isUpstreamDown).toBe(false);
    expect(new HubError('rate_limited', '', 429).isUpstreamDown).toBe(false);
  });
});

describe('request', () => {
  it('surfaces the code and message the server wrote', async () => {
    fetchMock.mockResolvedValue(
      respond(404, { error: { code: 'no_such_score', message: 'No score with that id.' } })
    );

    await expect(api.mintToken('abc')).rejects.toMatchObject({
      code: 'no_such_score',
      message: 'No score with that id.',
      status: 404,
    });
  });

  it('still fails usefully when the error body is not the shape we expect', async () => {
    fetchMock.mockResolvedValue(respond(502, null));

    const error = await api.listScores().catch((e: HubError) => e);
    expect(error).toBeInstanceOf(HubError);
    expect((error as HubError).code).toBe('unknown');
    expect((error as HubError).message).not.toBe('');
    expect((error as HubError).isUpstreamDown).toBe(true);
  });

  it('turns an unreachable hub into an outage rather than a rejected promise', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await api.me().catch((e: HubError) => e);
    expect(error).toBeInstanceOf(HubError);
    expect((error as HubError).status).toBe(0);
    expect((error as HubError).isUpstreamDown).toBe(true);
  });

  it('does not try to parse a 204', async () => {
    const json = vi.fn();
    fetchMock.mockResolvedValue({ ok: true, status: 204, json } as unknown as Response);

    await expect(api.logout()).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('sends the session cookie on every call', async () => {
    fetchMock.mockResolvedValue(respond(200, []));
    await api.listScores();

    expect(fetchMock).toHaveBeenCalledWith('/scores',
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });

  it('declares JSON only when it is actually sending some', async () => {
    fetchMock.mockResolvedValue(respond(200, {}));

    await api.login('a@b.c', 'hunter2hunter2');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'content-type': 'application/json' });

    await api.me();
    expect(fetchMock.mock.calls[1][1].headers).toBeUndefined();
  });

  it('sends an imported file as bytes, not as json', async () => {
    fetchMock.mockResolvedValue(respond(201, { id: 'abc', name: 'Riff', version: 'c0ffee', message: 'Imported' }));
    const file = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]);

    await api.importScore('abc', file);

    // The hub commits exactly what arrives, so the body is the file itself —
    // no multipart envelope, no base64.
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/scores/abc/import');
    expect(init.body).toBe(file);
    expect(init.headers).toEqual({ 'content-type': 'application/octet-stream' });
  });

  it('reports a refused import with the code the hub wrote', async () => {
    fetchMock.mockResolvedValue(
      respond(409, {
        error: { code: 'already_has_versions', message: 'This score already has a version.' },
      })
    );

    const error = await api.importScore('abc', new Blob(['x'])).catch((e: HubError) => e);
    expect(error).toBeInstanceOf(HubError);
    expect((error as HubError).code).toBe('already_has_versions');
    // Not an outage: the caller asked for something that cannot be done.
    expect((error as HubError).isUpstreamDown).toBe(false);
  });

  it('escapes the score id rather than pasting it into the path', async () => {
    fetchMock.mockResolvedValue(respond(200, {}));
    await api.mintToken('../auth/me');

    expect(fetchMock.mock.calls[0][0]).toBe('/scores/..%2Fauth%2Fme/token');
  });
});
