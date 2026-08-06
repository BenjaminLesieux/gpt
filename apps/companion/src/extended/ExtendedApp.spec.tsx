import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TrackedFile, Version } from '@/lib/ipc';
import i18n from '@/lib/i18n';
import { ExtendedApp } from './ExtendedApp';

vi.mock('@/lib/ipc', () => ({
  listTrackedFiles: vi.fn(),
  getActiveFile: vi.fn(),
  pickAndTrackFile: vi.fn(),
  listVersions: vi.fn(),
  listSnapshots: vi.fn(),
  restoreVersion: vi.fn(),
  setRemote: vi.fn(),
  syncState: vi.fn(),
  fetchRemote: vi.fn(),
  pullRemote: vi.fn(),
  onFileSaved: vi.fn(() => Promise.resolve(() => {})),
  onTrackedFilesChanged: vi.fn(() => Promise.resolve(() => {})),
  onPushStatusChanged: vi.fn(() => Promise.resolve(() => {})),
}));

// The stages own alphaTab, which needs a real browser to render anything.
// What this spec is about is which stage gets asked for, and with what.
vi.mock('./ScoreStage', () => ({
  ScoreStage: ({ version }: { version: Version }) => <div>score:{version.id}</div>,
  StageMessage: ({ message }: { message: string }) => <p>{message}</p>,
  StageSpinner: ({ label }: { label: string }) => <p>{label}</p>,
}));

vi.mock('./DiffStage', () => ({
  DiffStage: ({ base, head }: { base: Version; head: Version }) => (
    <div>
      diff:{base.id}→{head.id}
    </div>
  ),
}));

const ipc = vi.mocked(await import('@/lib/ipc'));

const NOW = Math.round(Date.now() / 1000);

const blackbird: TrackedFile = {
  id: 'a1',
  path: '/Users/ben/Songs/Blackbird.gp',
  name: 'Blackbird',
  addedAt: NOW - 9000,
};

const bridge: Version = { id: 'v2', message: 'Bridge take 3', timestamp: NOW - 90, kind: 'named' };
const intro: Version = { id: 'v1', message: 'Intro reworked', timestamp: NOW - 300, kind: 'named' };
const snapshot: Version = { id: 's1', message: '', timestamp: NOW - 40, kind: 'snapshot' };

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.getAnimations ??= () => [];
  return i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  ipc.listTrackedFiles.mockResolvedValue([blackbird]);
  ipc.getActiveFile.mockResolvedValue(blackbird);
  ipc.listVersions.mockResolvedValue([bridge, intro]);
  ipc.listSnapshots.mockResolvedValue([snapshot]);
  ipc.restoreVersion.mockResolvedValue(null);
  ipc.setRemote.mockResolvedValue(undefined);
  ipc.syncState.mockResolvedValue({ kind: 'unconfigured' });
});

/** The same file, but pointed at a server. */
const synced: TrackedFile = {
  ...blackbird,
  remote: {
    url: 'https://git.example.com/ben/blackbird.git',
    auth: { kind: 'token', username: 'ben' },
  },
};

describe('ExtendedApp', () => {
  it('opens on the newest named version of the active file', async () => {
    render(<ExtendedApp />);

    expect(await screen.findByText('score:v2')).toBeTruthy();
    expect(screen.getByText('Intro reworked')).toBeTruthy();
  });

  it('keeps auto-snapshots out of the way until recovery is opened', async () => {
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    expect(screen.queryByText('Automatic save')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Recovery/ }));
    expect(await screen.findByText('Automatic save')).toBeTruthy();
  });

  it('diffs the pinned version against the selected one', async () => {
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    const introRow = screen.getByText('Intro reworked').closest('li');
    await user.click(within(introRow as HTMLElement).getByRole('button', { name: /Compare from/ }));

    expect(await screen.findByText('diff:v1→v2')).toBeTruthy();
  });

  it('compares a version with the one before it in a single click', async () => {
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: /Compare with previous/ }));

    expect(await screen.findByText('diff:v1→v2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Exit compare/ }));
    expect(await screen.findByText('score:v2')).toBeTruthy();
  });

  it('restores only after confirmation, and says a safety snapshot was taken', async () => {
    ipc.restoreVersion.mockResolvedValue({
      id: 's2',
      message: '',
      timestamp: NOW,
      kind: 'snapshot',
    });
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: /^Restore/ }));
    expect(ipc.restoreVersion).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Restore' }));

    expect(ipc.restoreVersion).toHaveBeenCalledWith('a1', 'v2');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/safety|snapshot/i),
    );
  });

  it('leaves compare mode when the pinned base is selected as the version to show', async () => {
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: /Compare with previous/ }));
    await screen.findByText('diff:v1→v2');

    // The base is also named in the stage header — this is the timeline row.
    const introRow = screen
      .getAllByRole('listitem')
      .find((row) => row.textContent?.includes('Intro reworked')) as HTMLElement;
    await user.click(within(introRow).getByRole('button', { name: /Intro reworked/ }));

    expect(await screen.findByText('score:v1')).toBeTruthy();
  });

  it('lets a history failure be dismissed', async () => {
    ipc.listVersions.mockRejectedValue(new Error('io error: repository is locked'));
    const user = userEvent.setup();
    render(<ExtendedApp />);

    const strip = await screen.findByRole('alert');
    expect(strip.textContent).toMatch(/repository is locked/);

    await user.click(within(strip).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('points a score at a remote, sending the token separately from the url', async () => {
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: /Set up sync/ }));
    await user.type(
      await screen.findByLabelText('Repository URL'),
      'https://git.example.com/ben/blackbird.git',
    );
    await user.type(screen.getByLabelText('Username'), 'ben');
    await user.type(screen.getByLabelText('Access token'), 'gp_tok_123');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(ipc.setRemote).toHaveBeenCalledWith(
      'a1',
      'https://git.example.com/ben/blackbird.git',
      { kind: 'token', username: 'ben' },
      'gp_tok_123',
    );
  });

  it('warns when a token would travel over plain http', async () => {
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: /Set up sync/ }));
    await user.type(await screen.findByLabelText('Repository URL'), 'http://git.example.com/x.git');

    expect(screen.queryByText(/not https/i)).toBeNull();

    await user.type(screen.getByLabelText('Access token'), 'gp_tok_123');

    expect(await screen.findByText(/not https/i)).toBeTruthy();
  });

  it('sends no auth for a remote that asks for none', async () => {
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: /Set up sync/ }));
    await user.type(await screen.findByLabelText('Repository URL'), '/Volumes/backup/blackbird');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(ipc.setRemote).toHaveBeenCalledWith(
      'a1',
      '/Volumes/backup/blackbird',
      { kind: 'none' },
      undefined,
    );
  });

  it('offers to keep a stored token rather than showing it back', async () => {
    ipc.listTrackedFiles.mockResolvedValue([synced]);
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: /Sync/ }));

    const tokenField = (await screen.findByLabelText('Access token')) as HTMLInputElement;
    expect(tokenField.value).toBe('');
    expect(tokenField.placeholder).toMatch(/leave empty to keep/i);

    // Saving without retyping must not clear the stored secret.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(ipc.setRemote).toHaveBeenCalledWith(
      'a1',
      'https://git.example.com/ben/blackbird.git',
      { kind: 'token', username: 'ben' },
      undefined,
    );
  });

  it('brings in versions published elsewhere, and says what was kept', async () => {
    ipc.listTrackedFiles.mockResolvedValue([synced]);
    ipc.syncState.mockResolvedValue({ kind: 'behind', versions: 2 });
    ipc.pullRemote.mockResolvedValue({
      state: { kind: 'upToDate' },
      version: { id: 'v3', message: 'Outro', timestamp: NOW, kind: 'named' },
      safety: { id: 's9', message: '', timestamp: NOW, kind: 'snapshot' },
    });
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    expect(await screen.findByText(/2 versions waiting/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Bring them in/ }));

    expect(ipc.pullRemote).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Outro/));
    expect(screen.getByRole('status').textContent).toMatch(/snapshot/i);
  });

  it('offers nothing to click when the score is only ahead', async () => {
    ipc.listTrackedFiles.mockResolvedValue([synced]);
    ipc.syncState.mockResolvedValue({ kind: 'ahead', versions: 1 });
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    // Sending happens on its own; a button would imply otherwise.
    expect(await screen.findByText(/1 version to send/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Bring them in/ })).toBeNull();
  });

  it('says a score changed in two places instead of offering to combine them', async () => {
    ipc.listTrackedFiles.mockResolvedValue([synced]);
    ipc.syncState.mockResolvedValue({ kind: 'diverged', ahead: 1, behind: 2 });
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    expect(await screen.findByText(/changed in two places/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Bring them in/ })).toBeNull();
  });

  it('surfaces a refused pull without touching the timeline', async () => {
    ipc.listTrackedFiles.mockResolvedValue([synced]);
    ipc.syncState.mockResolvedValue({ kind: 'behind', versions: 1 });
    ipc.pullRemote.mockRejectedValue(
      new Error('Blackbird changed here and on the remote (1 version(s) here, 2 there)'),
    );
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(await screen.findByRole('button', { name: /Bring them in/ }));

    const strip = await screen.findByRole('alert');
    expect(strip.textContent).toMatch(/changed here and on the remote/);
  });

  it('asks the remote only when told to', async () => {
    ipc.listTrackedFiles.mockResolvedValue([synced]);
    ipc.syncState.mockResolvedValue({ kind: 'upToDate' });
    ipc.fetchRemote.mockResolvedValue({ kind: 'behind', versions: 1 });
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    expect(ipc.fetchRemote).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Check the remote/ }));

    expect(ipc.fetchRemote).toHaveBeenCalledWith('a1');
    expect(await screen.findByRole('button', { name: /Bring them in/ })).toBeTruthy();
  });

  it('sends the user to the file picker when nothing is tracked', async () => {
    ipc.listTrackedFiles.mockResolvedValue([]);
    ipc.getActiveFile.mockResolvedValue(null);
    ipc.pickAndTrackFile.mockResolvedValue(blackbird);
    const user = userEvent.setup();
    render(<ExtendedApp />);

    await user.click(await screen.findByRole('button', { name: /Choose a file/ }));

    expect(ipc.pickAndTrackFile).toHaveBeenCalled();
  });
});
