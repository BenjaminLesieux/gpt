import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store/index";
import { router } from "../router";
import { gptClient, GptApiError, type RepoValidation } from "../api/client";
import { OpenRepoHeader } from "@/features/open-repo/OpenRepoHeader";
import { OpenRepoFooter } from "@/features/open-repo/OpenRepoFooter";
import { IdleScreen } from "@/features/open-repo/IdleScreen";
import { BusyScreen } from "@/features/open-repo/BusyScreen";
import { NeedsInitScreen } from "@/features/open-repo/NeedsInitScreen";
import { OpenRepoErrorScreen } from "@/features/open-repo/OpenRepoErrorScreen";

// Flow: open dialog → validate → needsInit branch → init → store.setRepoPath

type Screen =
  | { kind: "idle" }
  | { kind: "validating"; path: string }
  | { kind: "needsInit"; validation: RepoValidation }
  | { kind: "initializing"; path: string }
  | { kind: "error"; message: string };

export function OpenRepoView() {
  const setRepoPath = useAppStore((s) => s.setRepoPath);
  const [screen, setScreen] = useState<Screen>({ kind: "idle" });
  const [recentRepos, setRecentRepos] = useState<string[]>([]);

  useEffect(() => {
    window.gptNative?.getRecentRepos?.().then(setRecentRepos).catch(() => {});
  }, []);

  const selectRepo = useCallback(async () => {
    const native = window.gptNative;
    if (!native) {
      setScreen({
        kind: "error",
        message: "Native bridge unavailable — are you running inside Electron?",
      });
      return;
    }

    const path = await native.openRepoDialog();
    if (!path) return;

    setScreen({ kind: "validating", path });
    try {
      const validation = await gptClient.validateRepo(path);
      if (validation.isGptRepo) {
        await native.addRecentRepo?.(path);
        setRepoPath(path);
        router.navigate({ to: '/repo/changes' });
        return;
      }
      setScreen({ kind: "needsInit", validation });
    } catch (err) {
      setScreen({ kind: "error", message: errorMessage(err) });
    }
  }, [setRepoPath]);

  const confirmInit = useCallback(
    async (path: string) => {
      setScreen({ kind: "initializing", path });
      try {
        await gptClient.init(path);
        await window.gptNative?.addRecentRepo?.(path);
        setRepoPath(path);
        router.navigate({ to: '/repo/changes' });
      } catch (err) {
        setScreen({ kind: "error", message: errorMessage(err) });
      }
    },
    [setRepoPath],
  );

  const openRecent = useCallback(
    async (path: string) => {
      setScreen({ kind: "validating", path });
      const native = window.gptNative;
      try {
        const validation = await gptClient.validateRepo(path);
        if (validation.isGptRepo) {
          await native?.addRecentRepo?.(path);
          setRepoPath(path);
          router.navigate({ to: '/repo/changes' });
          return;
        }
        setScreen({ kind: "needsInit", validation });
      } catch (err) {
        setScreen({ kind: "error", message: errorMessage(err) });
      }
    },
    [setRepoPath],
  );

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-auto bg-background px-6 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-fg-1) 1px, transparent 1px), linear-gradient(to bottom, var(--color-fg-1) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[540px] w-[540px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.15] blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--color-accent), transparent)" }}
      />

      <div className="relative z-10 flex w-full max-w-[520px] flex-col gap-12">
        <OpenRepoHeader />

        <section className="min-h-[180px]">
          {screen.kind === "idle" && (
            <IdleScreen
              onOpen={selectRepo}
              recentRepos={recentRepos}
              onOpenRecent={openRecent}
            />
          )}
          {screen.kind === "validating" && <BusyScreen label="Reading folder" path={screen.path} />}
          {screen.kind === "initializing" && (
            <BusyScreen label="Initializing repository" path={screen.path} />
          )}
          {screen.kind === "needsInit" && (
            <NeedsInitScreen
              validation={screen.validation}
              onConfirm={() => confirmInit(screen.validation.dir)}
              onCancel={() => setScreen({ kind: "idle" })}
            />
          )}
          {screen.kind === "error" && (
            <OpenRepoErrorScreen
              message={screen.message}
              onRetry={() => setScreen({ kind: "idle" })}
            />
          )}
        </section>

        <OpenRepoFooter />
      </div>
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof GptApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
