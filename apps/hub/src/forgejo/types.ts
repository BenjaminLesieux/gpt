/**
 * The subset of Forgejo's admin API the hub uses. Field names are Forgejo's,
 * not ours — snake_case throughout.
 *
 * These shapes are transcribed from the plan and have NOT yet been checked
 * against a live instance's /swagger. M1 is what confirms them; neither
 * Forgejo's nor Gitea's published spec is trustworthy on this surface.
 */

export interface CreateUserOptions {
  username: string;
  email: string;
  password: string;
  /**
   * Defaults to true server-side, which would gate the web sign-in chain.
   * It affects neither the API nor git push, but an account nobody can log
   * into is a surprise worth not shipping.
   */
  must_change_password: boolean;
}

export interface ForgejoUser {
  id: number;
  login: string;
  email: string;
}

export interface CreateRepoOptions {
  name: string;
  private: boolean;
  /** Without a first commit there is nothing for companion to push onto. */
  auto_init: boolean;
}

export interface ForgejoRepo {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  owner: ForgejoUser;
}

/** A repo a token is allowed to touch, as `{owner, name}`. */
export interface TokenRepository {
  owner: string;
  name: string;
}

export interface CreateTokenOptions {
  name: string;
  /** `write:repository` — not `write:repo`. An empty array is a 400. */
  scopes: string[];
  /** Absent or empty means account-wide, which defeats decision 3. */
  repositories: TokenRepository[];
}

export interface ForgejoToken {
  id: number;
  name: string;
  /** Returned exactly once, at creation. Never persisted by the hub. */
  sha1: string;
  scopes: string[];
}
