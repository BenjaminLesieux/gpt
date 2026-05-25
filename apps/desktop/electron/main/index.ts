import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import * as fs from "node:fs/promises";
import { ServeSupervisor } from "../bridge.js";
import { RepoWatcher } from "./watcher.js";

// All repo data flows over HTTP to `gpt serve`, NOT IPC — keeps TanStack Query's
// caching and retry logic working without duplicating it in the main process.

// In dev, __dirname = out/main/ which is 4 levels deep from the workspace root.
// pnpm nx must run from the workspace root so it can find tsconfig.base.json.
const cwd =
  process.env["NODE_ENV"] === "development"
    ? join(__dirname, "../../../..")
    : undefined;

const serve = new ServeSupervisor({ cwd });
const watcher = new RepoWatcher();
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0c0c0c",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env["NODE_ENV"] === "development") {
    mainWindow.loadURL("http://localhost:4200");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // __dirname = out/main/ at runtime, so ../renderer/ = out/renderer/
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  try {
    await serve.start();
  } catch (err) {
    console.error("Failed to start gpt serve:", err);
    dialog.showErrorBox(
      "gpt serve failed to start",
      err instanceof Error ? err.message : String(err),
    );
    app.quit();
    return;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  watcher.stop();
  await serve.stop();
  if (process.platform !== "darwin") app.quit();
});

// Make sure we never leak the child when the app is force-quit.
app.on("before-quit", async (event) => {
  if (!serve.isRunning) return;
  event.preventDefault();
  await serve.stop();
  app.exit(0);
});

ipcMain.handle("dialog:openRepo", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open gpt repository",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Open",
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("serve:baseUrl", () => serve.baseUrl);

ipcMain.handle("repo:watch", (_event, repoPath: string | null) => {
  if (!repoPath) {
    watcher.stop();
    return;
  }
  watcher.start(repoPath, (file) => {
    mainWindow?.webContents.send("repo:file-changed", file);
  });
});

ipcMain.handle("shell:open-path", (_event, filePath: string) =>
  shell.openPath(filePath),
);

// ── Recent repositories ────────────────────────────────────────────────────────

const MAX_RECENT = 5;

function recentReposPath(): string {
  return join(app.getPath("userData"), "recent-repos.json");
}

async function readRecentRepos(): Promise<string[]> {
  try {
    const raw = await fs.readFile(recentReposPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function writeRecentRepos(repos: string[]): Promise<void> {
  await fs.writeFile(recentReposPath(), JSON.stringify(repos), "utf8");
}

ipcMain.handle("repos:getRecent", () => readRecentRepos());

ipcMain.handle("repos:addRecent", async (_event, repoPath: string) => {
  const repos = await readRecentRepos();
  const filtered = repos.filter((r) => r !== repoPath);
  const updated = [repoPath, ...filtered].slice(0, MAX_RECENT);
  await writeRecentRepos(updated);
  return updated;
});
