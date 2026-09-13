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

/** What an import leaves behind: the score's first and only version. */
export interface ImportedScore {
  id: string;
  name: string;
  /** The commit the version landed on. */
  version: string;
  message: string;
}

/**
 * One credential, named after the machine that holds it. A score reached from
 * two computers has two — cloning to a second machine mints its own rather
 * than re-sending the first, which the hub could not do if it wanted to.
 */
export interface ScoreToken {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * A capability to take one score onto one more machine. The code goes in a
 * `gitarpro://` link and nothing else does — see `clone-link.ts`.
 */
export interface CloneClaim {
  code: string;
  /** ISO. Five minutes out; the dialog says so rather than letting it lapse
   * silently. */
  expiresAt: string;
  scoreName: string;
}

export interface Score {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  /** Empty when minting failed: the score exists, its sign-in details do not. */
  tokens: ScoreToken[];
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

async function request<T>(
  path: string,
  init?: RequestInit,
  /** For a body that is not JSON. Declared only when there is a body. */
  contentType = 'application/json'
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      // Same origin in production; the dev server proxies. Either way the
      // session cookie has to ride along or every call is a 401.
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': contentType } : undefined,
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

  /**
   * Writes a score's first version from a file. The body is the bytes
   * themselves rather than a multipart or base64 envelope: the hub commits
   * exactly what arrives, and every wrapper is a chance for the bytes that
   * land to differ from the bytes that were picked.
   *
   * Only ever starts a history — a score that already has one is refused.
   */
  importScore: (id: string, file: Blob) =>
    request<ImportedScore>(
      `/scores/${encodeURIComponent(id)}/import`,
      { method: 'POST', body: file },
      'application/octet-stream'
    ),

  /**
   * Mints the claim behind the Clone button. The response carries no
   * credential: what it buys is minted on redemption, on the machine the
   * score is arriving at.
   */
  createCloneClaim: (id: string) =>
    request<CloneClaim>(`/scores/${encodeURIComponent(id)}/clone-claims`, { method: 'POST' }),

  /**
   * Mints a token for a score that already exists — the retry after a
   * half-finished setup, and the way a second machine gets its own
   * credential. `name` is what the token is called in the score list.
   */
  mintToken: (id: string, name?: string) =>
    request<CreatedScore>(`/scores/${encodeURIComponent(id)}/token`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
};
