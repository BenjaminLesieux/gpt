import type {
  CreateRepoOptions,
  CreateTokenOptions,
  CreateUserOptions,
  ForgejoRepo,
  ForgejoToken,
  ForgejoUser,
} from './types';

/**
 * A non-2xx from Forgejo. Carries the status so callers can tell an
 * already-exists 409 — which provisioning treats as success on retry — from a
 * failure that should stop the run.
 */
export class ForgejoError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string
  ) {
    super(`Forgejo ${method} ${path} failed with ${status}: ${body}`);
    this.name = 'ForgejoError';
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

export interface ForgejoClientOptions {
  baseUrl: string;
  /** Site-admin PAT with the `write:admin` scope. */
  adminToken: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * The three admin calls that turn a platform account into a pushable remote.
 *
 * Every call authenticates as the site admin: there is no point at which the
 * hub holds a user's own credentials, and the per-score token this mints is
 * handed to the caller once and never stored.
 */
export class ForgejoClient {
  private readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ForgejoClientOptions) {
    // A trailing slash here produces `//api/v1/...`, which Forgejo 404s.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.adminToken = options.adminToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async createUser(options: CreateUserOptions): Promise<ForgejoUser> {
    return this.post<ForgejoUser>('/api/v1/admin/users', options);
  }

  async createRepo(
    username: string,
    options: CreateRepoOptions
  ): Promise<ForgejoRepo> {
    return this.post<ForgejoRepo>(
      `/api/v1/admin/users/${encodeURIComponent(username)}/repos`,
      options
    );
  }

  async createToken(
    username: string,
    options: CreateTokenOptions
  ): Promise<ForgejoToken> {
    return this.post<ForgejoToken>(
      `/api/v1/admin/users/${encodeURIComponent(username)}/tokens`,
      options
    );
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        // Forgejo's own scheme, not Bearer.
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new ForgejoError(
        response.status,
        'POST',
        path,
        await response.text()
      );
    }

    return (await response.json()) as T;
  }
}
