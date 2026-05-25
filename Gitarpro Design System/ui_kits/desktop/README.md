# Gitarpro Desktop UI Kit

High-fidelity interactive prototype for the **gpt desktop** Electron app.

## Screens

| Screen | Description |
|---|---|
| **Open Repo** | Welcome / empty state — open a folder |
| **History** | Commit log browser + tab score viewer placeholder |
| **Status & Commit** | Staged/unstaged files panel + commit message composer |
| **Diff View** | Two-commit bar-grid diff comparison |

## Structure

```
ui_kits/desktop/
  index.html       — Main entry point (interactive prototype)
  Sidebar.jsx      — Left sidebar, navigation, branch selector
  Views.jsx        — All main view components
```

## Usage

Open `index.html` in a browser. Click nav items to switch between views. The prototype uses fake/demo data throughout — it does not connect to any real `gpt` CLI process.

## Design notes

- Layout: 220px fixed sidebar + fluid main pane
- Row height: 36px for list items
- All typography from Space Grotesk / Space Mono
- No tab viewer rendering (AlphaTab requires a real DOM + binary) — placeholder shown
