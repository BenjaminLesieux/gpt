let electron = require("electron");
//#region electron/preload/index.ts
electron.contextBridge.exposeInMainWorld("gptNative", {
	openRepoDialog: () => electron.ipcRenderer.invoke("dialog:openRepo"),
	getServeBaseUrl: () => electron.ipcRenderer.invoke("serve:baseUrl"),
	watchRepo: (repoPath) => electron.ipcRenderer.invoke("repo:watch", repoPath),
	onFileChanged: (cb) => {
		const handler = (_, file) => cb(file);
		electron.ipcRenderer.on("repo:file-changed", handler);
		return () => electron.ipcRenderer.off("repo:file-changed", handler);
	},
	openPath: (filePath) => electron.ipcRenderer.invoke("shell:open-path", filePath),
	getRecentRepos: () => electron.ipcRenderer.invoke("repos:getRecent"),
	addRecentRepo: (repoPath) => electron.ipcRenderer.invoke("repos:addRecent", repoPath)
});
//#endregion
