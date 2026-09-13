import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
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

export function useFinishSetup(onFinished: (score: CreatedScore) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.mintToken(id),
    onSuccess: async (score) => {
      await queryClient.invalidateQueries({ queryKey: scoresQuery.queryKey });
      onFinished(score);
    },
  });
}
