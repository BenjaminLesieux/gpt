/**
 * The link the inviter pastes into a chat thread.
 *
 *   https://hub.example.com/join/<code>
 *
 * `/join` and not `/invites`: the hub reserves `/invites` for the JSON API
 * (`API_PREFIXES` in the hub's `app/plugins/web.ts`), so a client route under
 * that prefix would be answered with a JSON 404 instead of the app — an
 * invite that is dead on arrival for everybody it is sent to.
 *
 * The origin comes from the page rather than from configuration: the hub is
 * self-hosted, and the only origin we can be sure reaches it is the one the
 * inviter is already on.
 */
export const JOIN_PATH = '/join';

export function inviteLink(origin: string, code: string): string {
  return `${origin}${JOIN_PATH}/${encodeURIComponent(code)}`;
}
