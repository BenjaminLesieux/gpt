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
  guitarProBinding: vi.fn(),
  requestAccessibility: vi.fn().mockResolvedValue(undefined),
  pickAndTrackFile: vi.fn(),
  listVersions: vi.fn(),
  listSnapshots: vi.fn(),
  commitNamed: vi.fn(),
  hasPendingChange: vi.fn(),
  pushStatus: vi.fn(),
  onFileSaved: vi.fn(() => Promise.resolve(() => {})),
  onTrackedFilesChanged: vi.fn(() => Promise.resolve(() => {})),
  onPushStatusChanged: vi.fn(() => Promise.resolve(() => {})),
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
  ipc.guitarProBinding.mockResolvedValue({ kind: 'guitarPro' });
  ipc.hasPendingChange.mockResolvedValue(true);
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
  ipc.pushStatus.mockResolvedValue({ state: 'unconfigured', lastPushedAt: null, error: null });
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

  it('leaves the cursor in the message field after a failed commit', async () => {
    ipc.commitNamed.mockImplementation(async () => {
      // A browser drops focus when the field it sits in is disabled for the
      // save; jsdom keeps it, so the eviction has to be played out by hand.
      (document.activeElement as HTMLElement | null)?.blur();
      throw new Error('repository is locked');
    });
    const user = userEvent.setup();
    render(<PanelApp />);

    const message = await screen.findByLabelText('Version name');
    await user.type(message, 'Bridge take 3{Enter}');
    await screen.findByRole('alert');

    expect(document.activeElement).toBe(message);
    // And the retry is one keystroke away — the message is still there.
    await user.keyboard('!');
    expect((message as HTMLInputElement).value).toBe('Bridge take 3!');
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

  it('refuses to name a file that holds nothing the newest version does not', async () => {
    ipc.hasPendingChange.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<PanelApp />);

    expect(await screen.findByText(/nothing new to name/)).toBeTruthy();

    const message = await screen.findByLabelText('Version name');
    await user.type(message, 'Bridge take 3{Enter}');

    expect(ipc.commitNamed).not.toHaveBeenCalled();
    expect(ipc.hidePanel).not.toHaveBeenCalled();
  });

  it('says so when Guitar Pro has a score open that is not tracked', async () => {
    ipc.guitarProBinding.mockResolvedValue({ kind: 'unmatched', name: 'Lasagna' });
    const user = userEvent.setup();
    render(<PanelApp />);

    expect(await screen.findByText(/“Lasagna” open/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Track/ }));
    expect(ipc.pickAndTrackFile).toHaveBeenCalled();
  });

  it('offers to grant accessibility access when it cannot see Guitar Pro', async () => {
    ipc.guitarProBinding.mockResolvedValue({ kind: 'blind' });
    const user = userEvent.setup();
    render(<PanelApp />);

    await user.click(await screen.findByRole('button', { name: /Allow/ }));

    expect(ipc.requestAccessibility).toHaveBeenCalled();
  });

  it('stays quiet about the binding once it is pointed at the open score', async () => {
    render(<PanelApp />);
    await screen.findByText('Blackbird');

    expect(screen.queryByRole('button', { name: /Allow/ })).toBeNull();
    expect(screen.queryByText(/not tracked/)).toBeNull();
  });

  it('says nothing about pushing while it is working or has nowhere to push', async () => {
    render(<PanelApp />);
    await screen.findByText('Blackbird');

    expect(screen.queryByText(/Couldn't send/)).toBeNull();
    expect(screen.queryByText(/sending/)).toBeNull();

    // A push in flight is worth a word, but not an alarm.
    ipc.pushStatus.mockResolvedValue({ state: 'pending', lastPushedAt: null, error: null });
    render(<PanelApp />);

    expect(await screen.findByText(/sending/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't send/)).toBeNull();
  });

  it('speaks up only once the host has stopped retrying', async () => {
    ipc.pushStatus.mockResolvedValue({
      state: 'failed',
      lastPushedAt: NOW - 800,
      error: 'the remote refused refs/heads/main: the remote holds versions this score does not',
    });
    render(<PanelApp />);
    await screen.findByText('Blackbird');

    const notice = await screen.findByText(/Couldn't send/);
    expect(notice.title).toMatch(/refused/);
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
