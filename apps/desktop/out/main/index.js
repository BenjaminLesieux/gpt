//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let electron = require("electron");
let node_path = require("node:path");
let node_fs_promises = require("node:fs/promises");
node_fs_promises = __toESM(node_fs_promises);
let node_child_process = require("node:child_process");
let chokidar = require("chokidar");
//#region electron/bridge.ts
var ServeSupervisor = class {
	child = null;
	port;
	mode;
	cwd;
	readyTimeoutMs;
	stopTimeoutMs;
	logger;
	constructor(options = {}) {
		this.port = options.port ?? 7337;
		this.mode = options.mode ?? (process.env.NODE_ENV === "development" ? "dev" : "prod");
		this.cwd = options.cwd ?? process.cwd();
		this.readyTimeoutMs = options.readyTimeoutMs ?? 3e4;
		this.stopTimeoutMs = options.stopTimeoutMs ?? 5e3;
		this.logger = options.logger ?? console;
	}
	get isRunning() {
		return this.child !== null && this.child.exitCode === null;
	}
	get baseUrl() {
		return `http://127.0.0.1:${this.port}`;
	}
	start() {
		if (this.isRunning) return Promise.resolve();
		const { command, args } = this.resolveCommand();
		const child = (0, node_child_process.spawn)(command, args, {
			cwd: this.cwd,
			shell: false,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			env: {
				...process.env,
				FORCE_COLOR: "0"
			}
		});
		this.child = child;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				cleanup();
				reject(/* @__PURE__ */ new Error(`gpt serve did not start within ${this.readyTimeoutMs}ms`));
			}, this.readyTimeoutMs);
			const onData = (buf) => {
				const line = buf.toString();
				this.logger.log(`[gpt serve] ${line.trimEnd()}`);
				if (line.includes("listening on")) {
					cleanup();
					resolve();
				}
			};
			const onStderr = (buf) => {
				this.logger.error(`[gpt serve] ${buf.toString().trimEnd()}`);
			};
			const onExit = (code) => {
				cleanup();
				this.child = null;
				reject(/* @__PURE__ */ new Error(`gpt serve exited before ready (code ${code})`));
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
	stop() {
		const child = this.child;
		if (!child || child.exitCode !== null) {
			this.child = null;
			return Promise.resolve();
		}
		return new Promise((resolve) => {
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
	resolveCommand() {
		if (this.mode === "dev") return {
			command: "pnpm",
			args: [
				"nx",
				"run",
				"@gpt/cli:serve"
			]
		};
		const bin = process.platform === "win32" ? "gpt.exe" : "gpt";
		return {
			command: (0, node_path.join)(process.resourcesPath ?? ".", "bin", bin),
			args: [
				"serve",
				"--port",
				String(this.port)
			]
		};
	}
};
//#endregion
//#region electron/main/watcher.ts
var GP_FILE_RE = /\.gp[34567x]?$/i;
/**
* Watches a repo directory for Guitar Pro file changes and fires a callback
* with the changed filename. Debounced via chokidar's awaitWriteFinish to
* handle GP's atomic-write pattern (temp-write → rename) on all platforms.
*/
var RepoWatcher = class {
	watcher = null;
	start(repoPath, onChanged) {
		this.stop();
		this.watcher = (0, chokidar.watch)(repoPath, {
			ignored: [
				/(^|[/\\])\.git([/\\]|$)/,
				/(^|[/\\])\.gpt-conflict([/\\]|$)/,
				/(^|[/\\])node_modules([/\\]|$)/
			],
			persistent: true,
			ignoreInitial: true,
			depth: 1,
			awaitWriteFinish: {
				stabilityThreshold: 300,
				pollInterval: 100
			}
		});
		const emit = (filePath) => {
			if (GP_FILE_RE.test(filePath)) onChanged((0, node_path.basename)(filePath));
		};
		this.watcher.on("add", emit).on("change", emit);
	}
	stop() {
		this.watcher?.close();
		this.watcher = null;
	}
};
//#endregion
//#region electron/main/index.ts
var serve = new ServeSupervisor({ cwd: process.env.NODE_ENV === "development" ? (0, node_path.join)(__dirname, "../../../..") : void 0 });
var watcher = new RepoWatcher();
var mainWindow = null;
function createWindow() {
	mainWindow = new electron.BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		titleBarStyle: "hiddenInset",
		backgroundColor: "#0c0c0c",
		webPreferences: {
			preload: (0, node_path.join)(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	if (process.env.NODE_ENV === "development") {
		mainWindow.loadURL("http://localhost:4200");
		mainWindow.webContents.openDevTools({ mode: "detach" });
	} else mainWindow.loadFile((0, node_path.join)(__dirname, "../renderer/index.html"));
}
electron.app.whenReady().then(async () => {
	try {
		await serve.start();
	} catch (err) {
		console.error("Failed to start gpt serve:", err);
		electron.dialog.showErrorBox("gpt serve failed to start", err instanceof Error ? err.message : String(err));
		electron.app.quit();
		return;
	}
	createWindow();
	electron.app.on("activate", () => {
		if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
electron.app.on("window-all-closed", async () => {
	watcher.stop();
	await serve.stop();
	if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", async (event) => {
	if (!serve.isRunning) return;
	event.preventDefault();
	await serve.stop();
	electron.app.exit(0);
});
electron.ipcMain.handle("dialog:openRepo", async () => {
	if (!mainWindow) return null;
	const result = await electron.dialog.showOpenDialog(mainWindow, {
		title: "Open gpt repository",
		properties: ["openDirectory", "createDirectory"],
		buttonLabel: "Open"
	});
	return result.canceled ? null : result.filePaths[0] ?? null;
});
electron.ipcMain.handle("serve:baseUrl", () => serve.baseUrl);
electron.ipcMain.handle("repo:watch", (_event, repoPath) => {
	if (!repoPath) {
		watcher.stop();
		return;
	}
	watcher.start(repoPath, (file) => {
		mainWindow?.webContents.send("repo:file-changed", file);
	});
});
electron.ipcMain.handle("shell:open-path", (_event, filePath) => electron.shell.openPath(filePath));
var MAX_RECENT = 5;
function recentReposPath() {
	return (0, node_path.join)(electron.app.getPath("userData"), "recent-repos.json");
}
async function readRecentRepos() {
	try {
		const raw = await node_fs_promises.readFile(recentReposPath(), "utf8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
async function writeRecentRepos(repos) {
	await node_fs_promises.writeFile(recentReposPath(), JSON.stringify(repos), "utf8");
}
electron.ipcMain.handle("repos:getRecent", () => readRecentRepos());
electron.ipcMain.handle("repos:addRecent", async (_event, repoPath) => {
	const updated = [repoPath, ...(await readRecentRepos()).filter((r) => r !== repoPath)].slice(0, MAX_RECENT);
	await writeRecentRepos(updated);
	return updated;
});
//#endregion
