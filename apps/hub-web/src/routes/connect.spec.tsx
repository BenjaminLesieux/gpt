import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as cloneLink from '@/lib/clone-link';
import { openCloneLink } from '@/lib/clone-link';
import { createHubRouter } from '@/router';

vi.mock('@/lib/clone-link', async (importOriginal) => ({
  ...(await importOriginal<typeof cloneLink>()),
  openCloneLink: vi.fn(),
}));

// jsdom has no scrolling; the router restores scroll on every navigation.
window.scrollTo = vi.fn();

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const STATE = 'af0ifjsldkj_state-0123';
const DEVICE = "Ben's Mac & co";
const QUERY = `/connect?challenge=${CHALLENGE}&state=${STATE}&device=${encodeURIComponent(DEVICE)}`;
/** Not what the hub mints, but what an encoder has to cope with. */
const CODE = 'a/b+c&state=evil';

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function stubHub({ signedIn }: { signedIn: boolean }) {
  let session = signedIn;
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const route = `${init?.method ?? 'GET'} ${path}`;
    if (route === 'GET /auth/me')
      return session
        ? reply(200, { id: 'a', email: 'ben@example.com' })
        : reply(401, { error: { code: 'no_session', message: 'Sign in.' } });
    if (route === 'POST /auth/login') {
      session = true;
      return reply(200, { id: 'a', email: 'ben@example.com' });
    }
    if (route === 'POST /companion/codes')
      return reply(201, { code: CODE, expiresAt: new Date().toISOString() });
    return reply(404, { error: { code: 'not_found', message: route } });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function mount(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createHubRouter(queryClient, createMemoryHistory({ initialEntries: [url] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(openCloneLink).mockReset();
});

describe('/connect', () => {
  it('names the device and asks once when signed in', async () => {
    stubHub({ signedIn: true });
    mount(QUERY);

    expect(
      await screen.findByRole('heading', { name: `Connect Gitarpro on ${DEVICE}?` })
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(1);
  });

  it('posts the challenge and hands the code to the companion, encoded', async () => {
    const fetch = stubHub({ signedIn: true });
    mount(QUERY);

    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('heading', { name: 'You can close this tab' })).toBeTruthy();
    const post = fetch.mock.calls.find(([path]) => path === '/companion/codes');
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      challenge: CHALLENGE,
      challengeMethod: 'S256',
    });

    const link = vi.mocked(openCloneLink).mock.calls[0][0];
    expect(link).toBe(
      `gitarpro://signed-in?hub=${encodeURIComponent(window.location.origin)}` +
        `&code=${encodeURIComponent(CODE)}&state=${STATE}`
    );
    const parsed = new URL(link);
    expect([...parsed.searchParams.keys()]).toEqual(['hub', 'code', 'state']);
    expect(parsed.searchParams.get('code')).toBe(CODE);
  });

  it('signs in and comes back to the same question', async () => {
    stubHub({ signedIn: false });
    const router = mount(QUERY);

    await userEvent.type(await screen.findByLabelText('Email'), 'ben@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    expect(router.state.location.pathname).toBe('/login');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(
      await screen.findByRole('heading', { name: `Connect Gitarpro on ${DEVICE}?` })
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/connect');
    expect(router.state.location.search).toEqual({
      challenge: CHALLENGE,
      state: STATE,
      device: DEVICE,
    });
  });

  it.each([
    ['a missing state', `/connect?challenge=${CHALLENGE}`],
    ['a short challenge', `/connect?challenge=abc&state=${STATE}`],
    ['a challenge with a stray character', `/connect?challenge=${CHALLENGE.slice(1)}%3C&state=${STATE}`],
  ])('shows an error instead of the button for %s', async (_case, url) => {
    stubHub({ signedIn: true });
    mount(url);

    expect(await screen.findByRole('heading', { name: 'This link doesn’t work' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });
});
