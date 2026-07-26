import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TrackedFile, Version } from '@/lib/ipc';
import i18n from '@/lib/i18n';
import { PanelApp } from './PanelApp';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged: () => Promise.resolve(() => {}) }),
}));

vi.mock('@/lib/ipc', () => ({
  hidePanel: vi.fn().mockResolvedValue(undefined),
  openExtendedWindow: vi.fn().mockResolvedValue(undefined),
  listTrackedFiles: vi.fn(),
  getActiveFile: vi.fn(),
  setActiveFile: vi.fn(),
  pickAndTrackFile: vi.fn(),
  listVersions: vi.fn(),
  listSnapshots: vi.fn(),
  commitNamed: vi.fn(),
  onFileSaved: vi.fn(() => Promise.resolve(() => {})),
  onTrackedFilesChanged: vi.fn(() => Promise.resolve(() => {})),
}));

const ipc = vi.mocked(await import('@/lib/ipc'));

const NOW = Math.round(Date.now() / 1000);

const blackbird: TrackedFile = {
  id: 'a1',
  path: '/Users/ben/Songs/Blackbird.gp',
  name: 'Blackbird',
  addedAt: NOW - 9000,
};

const riff: TrackedFile = {
  id: 'b2',
  path: '/Users/ben/Demos/Riff.gp',
  name: 'Riff',
  addedAt: NOW - 500,
};

const intro: Version = { id: 'v1', message: 'Intro reworked', timestamp: NOW - 300, kind: 'named' };

beforeAll(() => {
  // Base UI's scroll area and cmdk both reach for browser APIs jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  // Base UI's scroll area polls this from a timeout that outlives the test.
  Element.prototype.getAnimations ??= () => [];
  return i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  ipc.listTrackedFiles.mockResolvedValue([blackbird, riff]);
  ipc.getActiveFile.mockResolvedValue(blackbird);
  ipc.listVersions.mockResolvedValue([intro]);
  ipc.listSnapshots.mockResolvedValue([
    { id: 's1', message: '', timestamp: NOW - 60, kind: 'snapshot' },
    { id: 's2', message: '', timestamp: NOW - 400, kind: 'snapshot' },
  ]);
  ipc.commitNamed.mockResolvedValue({
    id: 'v2',
    message: 'Bridge take 3',
    timestamp: NOW,
    kind: 'named',
  });
});

describe('PanelApp', () => {
  it('opens on the active file, its history and what is still unnamed', async () => {
    render(<PanelApp />);

    expect(await screen.findByText('Blackbird')).toBeTruthy();
    expect(await screen.findByText('Intro reworked')).toBeTruthy();
    // One of the two snapshots predates the newest named version.
    expect(await screen.findByText(/1 unnamed save/)).toBeTruthy();
  });

  it('commits on Enter and dismisses itself', async () => {
    const user = userEvent.setup();
    render(<PanelApp />);

    const message = await screen.findByLabelText('Version name');
    await user.type(message, 'Bridge take 3{Enter}');

    expect(ipc.commitNamed).toHaveBeenCalledWith('a1', 'Bridge take 3');
    await waitFor(() => expect(ipc.hidePanel).toHaveBeenCalled());
  });

  it('refuses to commit a blank message', async () => {
    const user = userEvent.setup();
    render(<PanelApp />);

    const message = await screen.findByLabelText('Version name');
    await user.type(message, '   {Enter}');

    expect(ipc.commitNamed).not.toHaveBeenCalled();
    expect(ipc.hidePanel).not.toHaveBeenCalled();
  });

  it('surfaces a failed commit instead of dismissing', async () => {
    ipc.commitNamed.mockRejectedValue(new Error('repository is locked'));
    const user = userEvent.setup();
    render(<PanelApp />);

    const message = await screen.findByLabelText('Version name');
    await user.type(message, 'Bridge take 3{Enter}');

    expect((await screen.findByRole('alert')).textContent).toMatch(/repository is locked/);
    expect(ipc.hidePanel).not.toHaveBeenCalled();
  });

  it('escapes out of the switcher first, and only then out of the panel', async () => {
    const user = userEvent.setup();
    render(<PanelApp />);
    await screen.findByText('Blackbird');

    await user.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByPlaceholderText(/Search tracked files/)).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(await screen.findByLabelText('Version name')).toBeTruthy();
    expect(ipc.hidePanel).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(ipc.hidePanel).toHaveBeenCalled();
  });

  it('switches the file the panel commits', async () => {
    ipc.setActiveFile.mockResolvedValue(riff);
    const user = userEvent.setup();
    render(<PanelApp />);
    await screen.findByText('Blackbird');

    await user.click(screen.getByRole('button', { name: 'Switch file' }));
    await user.click(await screen.findByText('Riff'));

    expect(ipc.setActiveFile).toHaveBeenCalledWith('b2');
    expect(await screen.findByText('Riff')).toBeTruthy();
  });

  it('offers to track a first file when nothing is tracked yet', async () => {
    ipc.listTrackedFiles.mockResolvedValue([]);
    ipc.getActiveFile.mockResolvedValue(null);
    ipc.pickAndTrackFile.mockResolvedValue(blackbird);
    const user = userEvent.setup();
    render(<PanelApp />);

    await user.click(await screen.findByRole('button', { name: /Choose a file/ }));

    expect(ipc.pickAndTrackFile).toHaveBeenCalled();
    expect(await screen.findByLabelText('Version name')).toBeTruthy();
  });
});
