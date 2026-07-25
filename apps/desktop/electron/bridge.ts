import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

/**
 * Supervises the `gpt serve` process that the renderer talks to over HTTP.
 *
 * The bundled production app will ship the `gpt` binary alongside the Electron
 * executable; in dev we invoke it through pnpm/nx so hot-reloaded CLI changes
 * are picked up without a rebuild.
 *
 * Lifecycle:
 *   1. `start()` — spawns the process and resolves once the listen banner is
 *      seen on stdout, or rejects on early exit / timeout.
 *   2. `stop()`  — sends SIGTERM, with a SIGKILL fallback after `stopTimeoutMs`.
 *
 * The serve process is **singleton per Electron main process**. Calling
 * `start()` twice is a no-op.
 */
export interface ServeSupervisorOptions {
  /** Port the server should listen on. Default: 7337. */
  port?: number;
  /** "dev" runs via `pnpm nx run`, "prod" runs the bundled `gpt` binary. */
  mode?: "dev" | "prod";
  /** Working directory override (mostly for tests). */
  cwd?: string;
  /** How long to wait for the listen banner before rejecting. Default: 10 s. */
  readyTimeoutMs?: number;
  /** How long to wait for graceful shutdown before SIGKILL. Default: 5 s. */
  stopTimeoutMs?: number;
  /** Optional logger; defaults to `console`. */
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export class ServeSupervisor {
  private child: ChildProcess | null = null;
  private readonly port: number;
  private readonly mode: "dev" | "prod";
  private readonly cwd: string;
  private readonly readyTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly logger: Pick<Console, "log" | "warn" | "error">;

  constructor(options: ServeSupervisorOptions = {}) {
    this.port = options.port ?? 7337;
    this.mode = options.mode ?? (process.env["NODE_ENV"] === "development" ? "dev" : "prod");
    this.cwd = options.cwd ?? process.cwd();
    this.readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
    this.logger = options.logger ?? console;
  }

  get isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  start(): Promise<void> {
    if (this.isRunning) return Promise.resolve();

    const { command, args, env } = this.resolveCommand();
    const child = spawn(command, args, {
      cwd: this.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env, FORCE_COLOR: "0" },
    });
    this.child = child;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`gpt serve did not start within ${this.readyTimeoutMs}ms`));
      }, this.readyTimeoutMs);

      const onData = (buf: Buffer) => {
        const line = buf.toString();
        this.logger.log(`[gpt serve] ${line.trimEnd()}`);
        if (line.includes("listening on")) {
          cleanup();
          resolve();
        }
      };
      const onStderr = (buf: Buffer) => {
        this.logger.error(`[gpt serve] ${buf.toString().trimEnd()}`);
      };
      const onExit = (code: number | null) => {
        cleanup();
        this.child = null;
        reject(new Error(`gpt serve exited before ready (code ${code})`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onStderr);
        child.off("exit", onExit);
      };

      child.stdout?.on("data", onData);
      child.stderr?.on("data", onStderr);
      child.once("exit", onExit);
    });
  }

  stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = null;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const kill = setTimeout(() => {
        this.logger.warn("[gpt serve] forcing SIGKILL");
        child.kill("SIGKILL");
      }, this.stopTimeoutMs);

      child.once("exit", () => {
        clearTimeout(kill);
        this.child = null;
        resolve();
      });

      child.kill("SIGTERM");
    });
  }

  private resolveCommand(): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
    if (this.mode === "dev") {
      return {
        command: "pnpm",
        args: ["nx", "run", "@gpt/cli:serve"],
      };
    }
    // Production: the CLI ships as a single self-contained CJS bundle in the
    // app's resources (Resources/bin/gpt.cjs). It is *not* a native binary, so
    // we run it with Electron's own embedded Node via ELECTRON_RUN_AS_NODE — no
    // separate Node install is required on the user's machine.
    const script = join(process.resourcesPath ?? ".", "bin", "gpt.cjs");
    return {
      command: process.execPath,
      args: [script, "serve", "--port", String(this.port)],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }
}
