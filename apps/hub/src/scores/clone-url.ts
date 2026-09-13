/**
 * The url companion writes into a `.git/config`. Built from the public origin
 * rather than the listen address, and from opaque ids rather than names — the
 * song title never reaches a URL or an access log.
 *
 * Its own file because two routes hand it out: the score list, and the claim
 * a second machine redeems.
 */
export function cloneUrl(publicUrl: string, accountId: string, scoreId: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/git/${accountId}/${scoreId}.git`;
}
