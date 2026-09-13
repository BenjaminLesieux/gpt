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
