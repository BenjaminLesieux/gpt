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
  onFileSaved: vi.fn(() => Promise.resolve(() => {})),
  onTrackedFilesChanged: vi.fn(() => Promise.resolve(() => {})),
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
});

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
