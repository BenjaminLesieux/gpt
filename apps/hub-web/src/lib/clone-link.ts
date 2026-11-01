/**
 * The link that reaches the companion.
 *
 *   gitarpro://adopt?hub=<origin>&claim=<code>
 *
 * Not `?url=&username=&token=`. A custom-scheme URL is handed to the OS,
 * which routes it to whichever installed app registered the scheme and which
 * a browser may or may not write to history — a token there is a token in a
 * place we do not control. The claim buys one score, once, for five minutes,
 * and the token it buys is minted on the far side, so the browser never holds
 * it at all.
 *
 * The origin travels because the hub is self-hosted and the app cannot know
 * where to redeem unless told. That makes it attacker-controllable, which is
 * why the companion refuses anything but https and shows the origin in its
 * confirmation dialog.
 */
export const CLONE_SCHEME = 'gitarpro';

export function cloneLink(hubOrigin: string, code: string): string {
  const query = new URLSearchParams({ hub: hubOrigin, claim: code });
  return `${CLONE_SCHEME}://adopt?${query.toString()}`;
}

/** Puts the app on one score's branch. Names it and nothing else — no credential. */
export function openLink(hubOrigin: string, scoreId: string, branch: string): string {
  const query = new URLSearchParams({ hub: hubOrigin, score: scoreId, branch });
  return `${CLONE_SCHEME}://open?${query.toString()}`;
}

/**
 * The answer to `/connect`: `gitarpro://signed-in?hub=<origin>&code=<code>&state=<state>`.
 * The code is useless without the verifier the companion kept, and `state` is
 * handed back untouched so the companion can refuse a link it did not ask for.
 */
export function signedInLink(hubOrigin: string, code: string, state: string): string {
  const query = new URLSearchParams({ hub: hubOrigin, code, state });
  return `${CLONE_SCHEME}://signed-in?${query.toString()}`;
}

/** What the companion puts on `/connect`. Every value came from the address bar. */
export interface ConnectSearch {
  challenge?: string;
  state?: string;
  device?: string;
}

export function connectSearch(search: Record<string, unknown>): ConnectSearch {
  const pick = (key: keyof ConnectSearch) =>
    typeof search[key] === 'string' ? { [key]: search[key] } : {};
  return { ...pick('challenge'), ...pick('state'), ...pick('device') };
}

/** A S256 challenge is a base64url sha256; the state is an opaque nonce. */
export function isConnectable(
  search: ConnectSearch
): search is ConnectSearch & { challenge: string; state: string } {
  return (
    /^[A-Za-z0-9_-]{43}$/.test(search.challenge ?? '') &&
    /^[A-Za-z0-9._~-]{16,128}$/.test(search.state ?? '')
  );
}

/**
 * Where to get the app when the link reached nothing. Releases rather than a
 * page of our own: the hub is self-hosted and every operator's copy would
 * otherwise point somewhere different.
 */
export const DOWNLOAD_URL = 'https://github.com/BenjaminLesieux/gpt/releases/latest';

/**
 * Hands the link to the OS. There is no success to observe — a scheme with no
 * app behind it fails silently — so this returns nothing and the dialog it is
 * called from stays up offering the two ways out.
 */
export function openCloneLink(link: string): void {
  window.location.href = link;
}
