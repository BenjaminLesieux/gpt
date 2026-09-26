import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScorePlayer, type ScorePlayerLabels } from './player';

// alphaTab needs a real browser to render anything; what this spec is about is
// what the player puts on screen for each state the score can be in.
vi.mock('@gpt/alphatab-react', () => {
  const useScore = vi.fn();
  return {
    AlphaTab: {
      Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Stage: ({ failed }: { failed?: (error: Error) => React.ReactNode }) => {
        const { error } = useScore();
        return (
          <div>
            <div data-testid="viewport" />
            {error && failed?.(error)}
          </div>
        );
      },
    },
    useScore,
    usePlayback: vi.fn(),
    usePlayerPosition: () => ({ currentTime: 0, endTime: 0 }),
    usePlayerControls: () => ({
      playbackSpeed: 1,
      setPlaybackSpeed: vi.fn(),
      isLooping: false,
      setIsLooping: vi.fn(),
    }),
    useSeek: () => ({
      value: 0,
      onValueChange: vi.fn(),
      onValueCommitted: vi.fn(),
      disabled: true,
    }),
    darkTheme: {},
  };
});

const { useScore, usePlayback } = vi.mocked(await import('@gpt/alphatab-react'));

const labels: ScorePlayerLabels = {
  play: 'Play',
  pause: 'Pause',
  stop: 'Stop',
  position: 'Playback position',
  loop: 'Loop',
  speed: 'Playback speed',
  allTracks: 'All tracks',
  failed: 'This version could not be read.',
  loadingSounds: 'Loading the sounds',
};

const score = { tracks: [{ name: 'Distortion Guitar' }] } as never;

function playback(isReadyForPlayback: boolean) {
  return {
    state: 'idle' as const,
    currentBeat: null,
    isReadyForPlayback,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    playPause: vi.fn(),
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useScore.mockReturnValue({ score, isLoading: false, error: null });
  usePlayback.mockReturnValue(playback(true));
});

describe('ScorePlayer', () => {
  it('shows the tracks and the transport once the score has parsed', () => {
    render(<ScorePlayer src="/v1.gp" identity="v1" labels={labels} />);

    expect(screen.getByText('All tracks')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Playback speed' })).toBeTruthy();
    expect(screen.queryByText(labels.failed)).toBeNull();
  });

  it('shows the track it is given when the caller holds the choice', () => {
    useScore.mockReturnValue({
      score: { tracks: [{ name: 'Distortion Guitar' }, { name: 'Bass' }] } as never,
      isLoading: false,
      error: null,
    });

    render(<ScorePlayer src="/v1.gp" identity="v1" labels={labels} track={1} onTrackChange={vi.fn()} />);

    expect(screen.getByText('Bass')).toBeTruthy();
    expect(screen.queryByText('All tracks')).toBeNull();
  });

  it('says so, instead of a blank stage, when alphaTab cannot read the version', () => {
    useScore.mockReturnValue({
      score: null,
      isLoading: false,
      error: new Error('No compatible importer found for file'),
    });

    render(<ScorePlayer src={new Uint8Array([1, 2, 3])} identity="v2" labels={labels} />);

    expect(screen.getByText(labels.failed)).toBeTruthy();
    // A transport that can never start is worse than none.
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.queryByText('All tracks')).toBeNull();
    // The viewport stays: unmounting it would tear alphaTab down and retry.
    expect(screen.getByTestId('viewport')).toBeTruthy();
  });

  it('says the sounds are still coming when the score is up before the soundfont', () => {
    usePlayback.mockReturnValue(playback(false));

    render(<ScorePlayer src="/v1.gp" identity="v1" labels={labels} />);

    expect(screen.getByText('Loading the sounds').getAttribute('role')).toBe('status');
  });
});
