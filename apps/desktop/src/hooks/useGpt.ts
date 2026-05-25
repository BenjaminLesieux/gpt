import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  gptClient,
  type BranchResult,
  type MergeStatus,
  type MergeOutcome,
  type RepoValidation,
  type ShowResult,
  type StatusResult,
} from "../api/client";
import type { Commit } from "@gpt/gpt-core";

// Keys are keyed by [resource, repoPath, ...params] so each repo gets an isolated cache entry.
export const keys = {
  validate: (dir: string | null) => ["validate", dir] as const,
  log: (dir: string | null) => ["log", dir] as const,
  status: (dir: string | null) => ["status", dir] as const,
  branches: (dir: string | null) => ["branches", dir] as const,
  show: (dir: string | null, hash: string | null) => ["show", dir, hash] as const,
  showFile: (dir: string | null, hash: string | null, file: string | null) =>
    ["show-file", dir, hash, file] as const,
  workdirFile: (dir: string | null, file: string | null) =>
    ["workdir-file", dir, file] as const,
  merge: (dir: string | null) => ["merge", dir] as const,
};

export function useValidateRepo(dir: string | null) {
  return useQuery<RepoValidation>({
    queryKey: keys.validate(dir),
    queryFn: () => gptClient.validateRepo(dir!),
    enabled: !!dir,
    staleTime: 0,
  });
}

export function useCommitLog(dir: string | null) {
  return useQuery<Commit[]>({
    queryKey: keys.log(dir),
    queryFn: () => gptClient.log(dir!),
    enabled: !!dir,
  });
}

export function useRepoStatus(dir: string | null) {
  return useQuery<StatusResult>({
    queryKey: keys.status(dir),
    queryFn: () => gptClient.status(dir!),
    enabled: !!dir,
  });
}

export function useInitRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dir: string) => gptClient.init(dir),
    onSuccess: (_, dir) => {
      qc.invalidateQueries({ queryKey: keys.validate(dir) });
    },
  });
}

export function useStageFile(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: string) => gptClient.addFile(dir!, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.status(dir) }),
  });
}

export function useUnstageFile(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: string) => gptClient.unstageFile(dir!, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.status(dir) }),
  });
}

export function useCommit(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => gptClient.commit(dir!, message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.log(dir) });
      qc.invalidateQueries({ queryKey: keys.status(dir) });
    },
  });
}

export function useShow(dir: string | null, hash: string | null) {
  return useQuery<ShowResult>({
    queryKey: keys.show(dir, hash),
    queryFn: () => gptClient.show(dir!, hash!),
    enabled: !!dir && !!hash,
  });
}

export function useShowFile(dir: string | null, hash: string | null, file: string | null) {
  return useQuery<Uint8Array>({
    queryKey: keys.showFile(dir, hash, file),
    queryFn: () => gptClient.showFile(dir!, hash!, file!),
    enabled: !!dir && !!hash && !!file,
    staleTime: Infinity,
  });
}

export function useWorkdirFile(dir: string | null, file: string | null) {
  return useQuery<Uint8Array>({
    queryKey: keys.workdirFile(dir, file),
    queryFn: () => gptClient.workdirFile(dir!, file!),
    enabled: !!dir && !!file,
    staleTime: 0,
  });
}

export function useBranches(dir: string | null) {
  return useQuery<BranchResult>({
    queryKey: keys.branches(dir),
    queryFn: () => gptClient.branches(dir!),
    enabled: !!dir,
  });
}

export function useCheckout(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: string) => gptClient.checkout(dir!, ref),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.log(dir) });
      qc.invalidateQueries({ queryKey: keys.status(dir) });
      qc.invalidateQueries({ queryKey: keys.branches(dir) });
    },
  });
}

export function useCreateBranch(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => gptClient.createBranch(dir!, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.branches(dir) });
    },
  });
}

// ─── Merge hooks ──────────────────────────────────────────────────────────────

export function useMergeStatus(dir: string | null) {
  return useQuery<MergeStatus>({
    queryKey: keys.merge(dir),
    queryFn: () => gptClient.mergeStatus(dir!),
    enabled: !!dir,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useStartMerge(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ branch, noCommit }: { branch: string; noCommit?: boolean }) =>
      gptClient.startMerge(dir!, branch, noCommit),
    onSuccess: (outcome: MergeOutcome) => {
      qc.invalidateQueries({ queryKey: keys.merge(dir) });
      if (outcome.type !== "conflicts") {
        qc.invalidateQueries({ queryKey: keys.log(dir) });
        qc.invalidateQueries({ queryKey: keys.status(dir) });
        qc.invalidateQueries({ queryKey: keys.branches(dir) });
      }
    },
  });
}

export function useResolveConflict(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      path,
      resolution,
    }: {
      file: string;
      path: string;
      resolution: "ours" | "theirs";
    }) => gptClient.resolveConflict(dir!, file, path, resolution),
    onMutate: async ({ file, path, resolution }) => {
      await qc.cancelQueries({ queryKey: keys.merge(dir) });
      const prev = qc.getQueryData<MergeStatus>(keys.merge(dir));
      qc.setQueryData<MergeStatus>(keys.merge(dir), (old) => {
        if (!old || !old.active) return old;
        const files = old.sidecar.files.map((f) => {
          if (f.path !== file) return f;
          const resolutions = { ...f.resolutions, [path]: resolution };
          return { ...f, resolutions };
        });
        const unresolved = files.reduce(
          (n, f) => n + f.conflictCount - Object.keys(f.resolutions).length,
          0,
        );
        return { ...old, sidecar: { ...old.sidecar, files }, unresolved };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.merge(dir), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.merge(dir) });
    },
  });
}

export function useFinalizeMerge(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message?: string) => gptClient.finalizeMerge(dir!, message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.merge(dir) });
      qc.invalidateQueries({ queryKey: keys.log(dir) });
      qc.invalidateQueries({ queryKey: keys.status(dir) });
      qc.invalidateQueries({ queryKey: keys.branches(dir) });
    },
  });
}

export function useRestoreWorkdir(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, file }: { hash: string; file: string }) =>
      gptClient.restoreWorkdir(dir!, hash, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.status(dir) });
    },
  });
}

export function useAbortMerge(dir: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => gptClient.abortMerge(dir!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.merge(dir) });
    },
  });
}
