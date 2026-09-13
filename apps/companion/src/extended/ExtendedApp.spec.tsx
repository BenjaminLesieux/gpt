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
  pickAndAdoptRemote: vi.fn(),
  peekClaim: vi.fn(),
  adoptClaim: vi.fn(),
  onFileSaved: vi.fn(() => Promise.resolve(() => {})),
  onTrackedFilesChanged: vi.fn(() => Promise.resolve(() => {})),
  onPushStatusChanged: vi.fn(() => Promise.resolve(() => {})),
  onClaimArrived: vi.fn(() => Promise.resolve(() => {})),
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

  it('brings in a score that only exists on a remote', async () => {
    ipc.pickAndAdoptRemote.mockResolvedValue({
      id: 'b2',
      path: '/Users/ben/Songs/Lasagna.gp',
      name: 'Lasagna',
      addedAt: NOW,
      remote: { url: 'https://hub.example.com/git/lasagna.git', auth: { kind: 'token', username: 'ben' } },
    });
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: 'Blackbird' }));
    await user.click(await screen.findByRole('menuitem', { name: /Bring in a score/ }));

    await user.type(
      await screen.findByLabelText('Repository URL'),
      'https://hub.example.com/git/lasagna.git',
    );
    await user.type(screen.getByLabelText('Username'), 'ben');
    await user.type(screen.getByLabelText('Access token'), 'gp_tok_123');
    await user.click(screen.getByRole('button', { name: /Choose where to save/ }));

    // The path is the host's to ask for: this side only sends the triple.
    expect(ipc.pickAndAdoptRemote).toHaveBeenCalledWith(
      'https://hub.example.com/git/lasagna.git',
      { kind: 'token', username: 'ben' },
      'gp_tok_123',
    );
    // The notice, not the a11y tree: an open dialog hides the rest of the
    // page from `getByRole`, and this one closes as it lands.
    expect(await screen.findByText(/is on disk and tracked/)).toBeTruthy();
  });

  it('keeps the pasted remote when the save dialog is cancelled', async () => {
    ipc.pickAndAdoptRemote.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: 'Blackbird' }));
    await user.click(await screen.findByRole('menuitem', { name: /Bring in a score/ }));
    const url = (await screen.findByLabelText('Repository URL')) as HTMLInputElement;
    await user.type(url, 'https://hub.example.com/git/lasagna.git');
    await user.click(screen.getByRole('button', { name: /Choose where to save/ }));

    expect(url.value).toBe('https://hub.example.com/git/lasagna.git');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reports a refused adoption without closing the dialog', async () => {
    ipc.pickAndAdoptRemote.mockRejectedValue(
      new Error('a file already exists at /Users/ben/Songs/Lasagna.gp'),
    );
    const user = userEvent.setup();
    render(<ExtendedApp />);
    await screen.findByText('score:v2');

    await user.click(screen.getByRole('button', { name: 'Blackbird' }));
    await user.click(await screen.findByRole('menuitem', { name: /Bring in a score/ }));
    await user.type(
      await screen.findByLabelText('Repository URL'),
      'https://hub.example.com/git/lasagna.git',
    );
    await user.click(screen.getByRole('button', { name: /Choose where to save/ }));

    expect(await screen.findByText(/already exists/)).toBeTruthy();
    // Still open, so the triple can be corrected rather than retyped.
    expect(screen.getByLabelText('Repository URL')).toBeTruthy();
  });

  it('offers adoption as well as the file picker when nothing is tracked', async () => {
    ipc.listTrackedFiles.mockResolvedValue([]);
    ipc.getActiveFile.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ExtendedApp />);

    await user.click(await screen.findByRole('button', { name: /Bring in a score/ }));

    expect(await screen.findByLabelText('Repository URL')).toBeTruthy();
  });

  /**
   * The clone path. A `gitarpro://` link reaches the host, which raises this
   * window and emits what arrived; everything the dialog says about it is
   * read back from the hub rather than taken from the link.
   */
  describe('a score arriving on a gitarpro:// link', () => {
    const LINK = { hub: 'https://hub.example.com', claim: 'abc123' };

    /** Fires the event the host emits when a link lands. */
    function arrive(link = LINK) {
      const handler = ipc.onClaimArrived.mock.calls[0][0];
      return handler(link);
    }

    const lasagna: TrackedFile = {
      id: 'b2',
      path: '/Users/ben/Songs/Lasagna.gp',
      name: 'Lasagna',
      addedAt: NOW,
      remote: {
        url: 'https://hub.example.com/git/ben/k7m2x.git',
        auth: { kind: 'token', username: 'ben' },
      },
    };

    it('names the score from the hub and shows the origin it came from', async () => {
      ipc.peekClaim.mockResolvedValue({ scoreName: 'Lasagna', hubName: 'hub.example.com' });
      render(<ExtendedApp />);
      await screen.findByText('score:v2');

      await arrive();

      expect(await screen.findByText(/Add “Lasagna” to this computer/)).toBeTruthy();
      // The origin as it arrived, because that is the value being trusted.
      expect(screen.getByText('https://hub.example.com')).toBeTruthy();
      expect(ipc.peekClaim).toHaveBeenCalledWith('https://hub.example.com', 'abc123');
    });

    it('adopts on confirmation and says the score is on disk', async () => {
      ipc.peekClaim.mockResolvedValue({ scoreName: 'Lasagna', hubName: 'hub.example.com' });
      ipc.adoptClaim.mockResolvedValue(lasagna);
      const user = userEvent.setup();
      render(<ExtendedApp />);
      await screen.findByText('score:v2');
      await arrive();
      await screen.findByText(/Add “Lasagna”/);

      await user.click(screen.getByRole('button', { name: /Choose where to save/ }));

      expect(ipc.adoptClaim).toHaveBeenCalledWith('https://hub.example.com', 'abc123');
      expect(await screen.findByText(/is on disk and tracked/)).toBeTruthy();
    });

    /**
     * The save dialog comes before the redemption, so a cancel spends
     * nothing — the dialog stays up and the same link still works.
     */
    it('stays open when the save dialog is cancelled', async () => {
      ipc.peekClaim.mockResolvedValue({ scoreName: 'Lasagna', hubName: 'hub.example.com' });
      ipc.adoptClaim.mockResolvedValue(null);
      const user = userEvent.setup();
      render(<ExtendedApp />);
      await screen.findByText('score:v2');
      await arrive();
      await screen.findByText(/Add “Lasagna”/);

      await user.click(screen.getByRole('button', { name: /Choose where to save/ }));

      expect(screen.getByText(/Add “Lasagna”/)).toBeTruthy();
    });

    it('says why a link that no longer works does not, without offering to try it', async () => {
      ipc.peekClaim.mockRejectedValue(
        new Error('That link has already been used. Press Clone again for a new one.'),
      );
      render(<ExtendedApp />);
      await screen.findByText('score:v2');

      await arrive();

      expect(await screen.findByText(/already been used/)).toBeTruthy();
      // Nothing to press: the claim is spent, and the retry is on the website.
      expect(
        screen.getByRole('button', { name: /Choose where to save/ }).hasAttribute('disabled')
      ).toBe(true);
    });

    it('refuses a link pointing at a plain-http hub before asking it anything', async () => {
      ipc.peekClaim.mockRejectedValue(
        new Error('http://hub.example.com/ is not an https address'),
      );
      render(<ExtendedApp />);
      await screen.findByText('score:v2');

      await arrive({ hub: 'http://hub.example.com', claim: 'abc123' });

      expect(await screen.findByText(/not an https address/)).toBeTruthy();
      expect(ipc.adoptClaim).not.toHaveBeenCalled();
    });
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
