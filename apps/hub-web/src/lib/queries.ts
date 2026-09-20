import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api, HubError, type CreatedScore } from './api';

/**
 * The import leg failed after the score was already made. It carries the
 * score so a retry can go to the one that exists rather than making a second,
 * and so the credentials it minted are not lost with the error — they were
 * shown nowhere yet, and the server keeps no copy.
 */
export class ImportFailed extends Error {
  constructor(
    readonly score: CreatedScore,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : 'The file could not be imported.', { cause });
    this.name = 'ImportFailed';
  }
}

export const accountQuery = queryOptions({
  queryKey: ['account'],
  queryFn: api.me,
  // A 401 here is the answer, not a fault: it means "signed out". Retrying
  // it just delays the redirect by three round trips.
  retry: false,
  staleTime: Infinity,
});

export const scoresQuery = queryOptions({
  queryKey: ['scores'],
  queryFn: api.listScores,
  retry: (attempt, error) => !(error instanceof HubError && error.isSignedOut) && attempt < 2,
});

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.login(email, password),
    onSuccess: (account) => queryClient.setQueryData(accountQuery.queryKey, account),
  });
}

export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.signup(email, password),
    onSuccess: (account) => queryClient.setQueryData(accountQuery.queryKey, account),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    // Everything cached was scoped to the account that just left.
    onSettled: () => queryClient.clear(),
  });
}

export function useCreateScore(onCreated: (score: CreatedScore) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createScore(name),
    onSuccess: async (score) => {
      await queryClient.invalidateQueries({ queryKey: scoresQuery.queryKey });
      onCreated(score);
    },
  });
}

/**
 * Importing is two calls, and the seam between them is real: the score can
 * exist with no version in it. That is not a broken state — it is exactly
 * what `Create score` produces on its own — so the recovery is to send the
 * file again at the score already made, never to make another.
 */
export function useImportScore(onImported: (score: CreatedScore) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, file }: { name: string; file: File }) => {
      const created = await api.createScore(name);
      try {
        await api.importScore(created.id, file);
      } catch (cause) {
        throw new ImportFailed(created, cause);
      }
      return created;
    },
    onSuccess: async (score) => {
      await queryClient.invalidateQueries({ queryKey: scoresQuery.queryKey });
      onImported(score);
    },
    // A failed import still left a score behind, so the list is stale either
    // way — the row is there whether or not the music reached it.
    onError: () => queryClient.invalidateQueries({ queryKey: scoresQuery.queryKey }),
  });
}

/** The retry, once a score exists and only its file is missing. */
export function useRetryImport(onImported: (score: CreatedScore) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ score, file }: { score: CreatedScore; file: File }) => {
      await api.importScore(score.id, file);
      return score;
    },
    onSuccess: async (score) => {
      await queryClient.invalidateQueries({ queryKey: scoresQuery.queryKey });
      onImported(score);
    },
  });
}

/**
 * Clone is a dialog rather than a bare link, so the claim is minted when the
 * dialog opens and the link fires from the answer. Nothing is cached: a claim
 * works once, and a second Clone has to be a second claim.
 */
export function useCloneClaim() {
  return useMutation({ mutationFn: (id: string) => api.createCloneClaim(id) });
}

/**
 * Mints a token for a score that already exists, and shows it. Two buttons
 * call this — *Finish setup* on a score whose creation half-failed, and
 * *Show the values instead* when the `gitarpro://` link reached nothing —
 * which is why the page holds two instances of it: one pending spinner each.
 */
export function useMintToken(onMinted: (score: CreatedScore) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.mintToken(id),
    onSuccess: async (score) => {
      await queryClient.invalidateQueries({ queryKey: scoresQuery.queryKey });
      onMinted(score);
    },
  });
}

export function scoreQuery(id: string) {
  return queryOptions({
    queryKey: ['score', id],
    queryFn: () => api.readScore(id),
    retry: (attempt, error) => !(error instanceof HubError && error.isSignedOut) && attempt < 2,
  });
}

/**
 * The history, a page at a time.
 *
 * Infinite rather than a growing `limit`: *Load 40 more* means the next forty
 * of the same walk, and re-asking for a longer page would re-derive every
 * scope already on screen. Pages accumulate in order, so the list is
 * `pages.flatMap(…)` and the lane layout sees one continuous history.
 */
export function historyQuery(id: string) {
  return infiniteQueryOptions({
    queryKey: ['history', id],
    queryFn: ({ pageParam }) => api.readHistory(id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.versions.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    retry: (attempt, error) => !(error instanceof HubError && error.isSignedOut) && attempt < 2,
  });
}
