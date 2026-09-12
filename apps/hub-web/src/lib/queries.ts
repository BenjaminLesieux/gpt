import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, HubError, type CreatedScore } from './api';

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

export function useFinishSetup(onFinished: (score: CreatedScore) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.finishSetup(id),
    onSuccess: async (score) => {
      await queryClient.invalidateQueries({ queryKey: scoresQuery.queryKey });
      onFinished(score);
    },
  });
}
