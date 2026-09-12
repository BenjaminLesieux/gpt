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
      respond(409, { error: { code: 'already_set_up', message: 'That score is connected.' } })
    );

    await expect(api.finishSetup('abc')).rejects.toMatchObject({
      code: 'already_set_up',
      message: 'That score is connected.',
      status: 409,
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

  it('escapes the score id rather than pasting it into the path', async () => {
    fetchMock.mockResolvedValue(respond(200, {}));
    await api.finishSetup('../auth/me');

    expect(fetchMock.mock.calls[0][0]).toBe('/scores/..%2Fauth%2Fme/token');
  });
});
