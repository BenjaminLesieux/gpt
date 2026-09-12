/**
 * The hub's JSON API. Every failure it returns carries the same shape, so
 * callers branch on `code` and show `message` — the server already writes
 * these for a musician to read, and re-wording them here would mean two
 * places to keep honest.
 */
export interface Account {
  id: string;
  email: string;
}

/** The one response that ever carries a token value. */
export interface CreatedScore {
  id: string;
  name: string;
  url: string;
  username: string;
  token: string;
  tokenName: string;
}

export interface Score {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  /** Null when minting failed: the score exists, its sign-in details do not. */
  token: { id: string; name: string } | null;
}

export class HubError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'HubError';
  }

  /** The session is gone, whatever the server called it. */
  get isSignedOut(): boolean {
    return (
      this.status === 401 ||
      this.code === 'no_session' ||
      this.code === 'session_expired' ||
      this.code === 'invalid_session'
    );
  }

  /**
   * The hub could not finish because something behind it did not answer.
   * A network failure reaches us the same way and means the same thing to
   * the person reading it, so both land here.
   */
  get isUpstreamDown(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      // Same origin in production; the dev server proxies. Either way the
      // session cookie has to ride along or every call is a 401.
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new HubError('network', 'Could not reach the hub. Check your connection.', 0);
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new HubError(
      error?.code ?? 'unknown',
      error?.message ?? 'Something went wrong. Try again.',
      response.status
    );
  }

  return body as T;
}

export const api = {
  signup: (email: string, password: string) =>
    request<Account>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<Account>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  me: () => request<Account>('/auth/me'),

  listScores: () => request<Score[]>('/scores'),

  createScore: (name: string) =>
    request<CreatedScore>('/scores', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  /** Mints the token for a score whose first attempt did not get one. */
  finishSetup: (id: string) =>
    request<CreatedScore>(`/scores/${encodeURIComponent(id)}/token`, { method: 'POST' }),
};
