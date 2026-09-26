import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Version } from '@/lib/ipc';
import i18n from '@/lib/i18n';
import { ScoreStage } from './ScoreStage';

// What alphaTab does with the bytes is ScorePlayer's own spec; this one is
// about getting the bytes to it.
vi.mock('@gpt/ui/score/player', () => ({
  ScorePlayer: (props: {
    identity: string;
    labels: { play: string };
    track?: number | null;
    onTrackChange?(track: number | null): void;
  }) => (
    <div data-testid="player">
      {props.identity}:{props.labels.play}:{String(props.track)}
      <button onClick={() => props.onTrackChange?.(1)}>bass</button>
    </div>
  ),
}));
vi.mock('./useVersionBytes', () => ({ useVersionBytes: vi.fn() }));

const { useVersionBytes } = vi.mocked(await import('./useVersionBytes'));

const version: Version = {
  id: 'v2',
  message: 'Bridge take 3',
  at: new Date(),
  kind: 'named',
};

beforeAll(() => i18n.changeLanguage('en'));

beforeEach(() => {
  vi.clearAllMocks();
  useVersionBytes.mockReturnValue({ bytes: new Uint8Array([1, 2, 3]), loading: false, error: null });
});

describe('ScoreStage', () => {
  it('plays the version once its bytes are here', () => {
    render(<ScoreStage fileId="a1" version={version} />);

    expect(screen.getByTestId('player').textContent).toBe('v2:Play:nullbass');
  });

  it('keeps the chosen track when moving to another version', () => {
    // Given the bass picked on one version
    const { rerender } = render(<ScoreStage fileId="a1" version={version} />);
    fireEvent.click(screen.getByText('bass'));

    // When the next version's bytes load, unmounting the player meanwhile
    useVersionBytes.mockReturnValue({ bytes: null, loading: true, error: null });
    rerender(<ScoreStage fileId="a1" version={{ ...version, id: 'v3' }} />);
    useVersionBytes.mockReturnValue({ bytes: new Uint8Array([4]), loading: false, error: null });
    rerender(<ScoreStage fileId="a1" version={{ ...version, id: 'v3' }} />);

    // Then the bass is still what is on screen
    expect(screen.getByTestId('player').textContent).toBe('v3:Play:1bass');
  });

  it('says so while the bytes are on their way', () => {
    useVersionBytes.mockReturnValue({ bytes: null, loading: true, error: null });

    render(<ScoreStage fileId="a1" version={version} />);

    expect(screen.getByText('Loading version…')).toBeTruthy();
    expect(screen.queryByTestId('player')).toBeNull();
  });

  it('says so when the version bytes cannot be fetched', () => {
    useVersionBytes.mockReturnValue({ bytes: null, loading: false, error: 'io error: no such blob' });

    render(<ScoreStage fileId="a1" version={version} />);

    expect(screen.getByText(/io error/)).toBeTruthy();
    expect(screen.queryByTestId('player')).toBeNull();
  });
});
