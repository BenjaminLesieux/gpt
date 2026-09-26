import i18n from './i18n';

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
  /**
   * ISO, or null when this credential has never authenticated anything.
   *
   * Creating a score mints a token in the same breath as the row, so a token
   * on its own has never meant a machine holds the score — it means one was
   * issued. This is the field that tells those apart, and the reason the score
   * list stopped rendering `tokens` as though it were a list of computers.
   */
  lastUsedAt: string | null;
  /** ISO of the last push, or null. Connecting is not working on something. */
  lastPushedAt: string | null;
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

/**
 * What a version touched, derived by the hub from the files themselves.
 * Null when the score would not parse — the row still lists, it just has
 * nothing to say about what changed, which is the truth rather than a zero.
 */
export interface VersionScope {
  /** Only the tracks whose bars changed, in the score's own order. */
  tracks: { name: string; bars: number }[];
  bars: number;
  /** How many tracks the score has, for the *5 tracks · 0 bars* form. */
  trackCount: number;
  /** Tempo, title or a time signature moved. */
  meta: boolean;
}

/** One version. `id` is the full sha; the screen shows seven characters. */
export interface Version {
  id: string;
  /** The musician's own words. Empty is ordinary and is never rewritten. */
  message: string;
  authorEmail: string;
  /** ISO, with the author's own offset. */
  at: string;
  /** One normally, two for a landing, none for the first version. */
  parents: string[];
  scope: VersionScope | null;
}

/** A named line of work. `ahead` is 0 once it has landed. */
export interface Branch {
  name: string;
  tip: string;
  ahead: number;
}

export interface History {
  /** The main line's tip, or null when nothing has been pushed yet. */
  head: string | null;
  /** Across every branch, not just the page loaded. */
  total: number;
  branches: Branch[];
  /** Newest first, topologically ordered. */
  versions: Version[];
}

/**
 * Someone on the score, or a link held out to someone who has not arrived.
 *
 * The union is the point. An invited person has no membership row at all, so
 * a list of members alone draws them as absent — and the inviter reads the
 * gap as a link that never sent. `id` is what the square is keyed by: the
 * account for someone who is here, the invite for someone who is not.
 *
 * No display names yet — an email is all a person is called. An invite is
 * called nothing at all, because there is no mailer and so nobody was
 * addressed; `invitedBy` is the member who held the link out.
 */
export type Member =
  | { status: 'joined'; id: string; email: string; role: 'owner' | 'member' }
  | { status: 'invited'; id: string; invitedBy: string; expiresAt: string };

/** The link that puts a second person on a score. The code is the whole of
 * it; the URL it goes in is the client's, and `invite-link.ts` builds it. */
export interface ScoreInvite {
  code: string;
  /** ISO, days out. The dialog says so: a link pasted into a chat thread
   * outlives the conversation that explained it. */
  expiresAt: string;
  scoreName: string;
}

/** What the accept screen may say before anyone agrees to anything. */
export interface InvitePeek {
  scoreName: string;
  /** The member who held the link out — half of what is being agreed to. */
  invitedBy: string;
}

/** One score and its band, which the list route does not carry. */
export interface ScoreDetail {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  role: 'owner' | 'member';
  members: Member[];
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
    throw new HubError('network', i18n.t('common.unreachable'), 0);
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new HubError(
      error?.code ?? 'unknown',
      error?.message ?? i18n.t('common.genericError'),
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
   * The score and its band. Not `GET /scores/:id` — that path is the score's
   * own page in the browser, and the hub serves the app shell there.
   */
  readScore: (id: string) =>
    request<ScoreDetail>(`/scores/${encodeURIComponent(id)}/members`),

  /**
   * A page of the history. `skip` rather than a cursor because the walk is
   * topological and *Load 40 more* means the next forty of the same walk.
   */
  readHistory: (id: string, skip = 0) =>
    request<History>(`/scores/${encodeURIComponent(id)}/history?skip=${skip}`),

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

  /** Mints the link that puts a second person on a score. */
  createInvite: (id: string) =>
    request<ScoreInvite>(`/scores/${encodeURIComponent(id)}/invites`, { method: 'POST' }),

  /**
   * What the link names, without spending it. The one call in this client
   * that works signed out — being asked to sign up before being told what
   * for is how an invite gets ignored.
   */
  peekInvite: (code: string) => request<InvitePeek>(`/invites/${encodeURIComponent(code)}`),

  /** Spends it. Needs a session: it puts an *account* on a score. */
  acceptInvite: (code: string) =>
    request<{ id: string; name: string; role: 'member' }>(
      `/invites/${encodeURIComponent(code)}`,
      { method: 'POST' }
    ),
};

/**
 * Where a version's Guitar Pro file lives. A URL rather than a fetch: alphaTab
 * takes one and streams it itself, and the response is immutable — a sha names
 * one tree forever — so the browser cache does the paging for free.
 */
export function versionScoreUrl(scoreId: string, commit: string): string {
  return `/scores/${encodeURIComponent(scoreId)}/versions/${encodeURIComponent(commit)}/score.gp`;
}
