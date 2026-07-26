import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Version } from '@/lib/ipc';
import i18n from '@/lib/i18n';
import { ScoreStage } from './ScoreStage';

// alphaTab needs a real browser to render anything; what this spec is about is
// what the stage puts on screen once the score state says the bytes failed.
vi.mock('@gpt/alphatab-react', () => ({
  AlphaTab: {
    Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Viewport: () => <div data-testid="viewport" />,
  },
  useScore: vi.fn(),
  darkTheme: {},
}));

vi.mock('./PlaybackBar', () => ({ PlaybackBar: () => <div data-testid="transport" /> }));
vi.mock('./TrackSelector', () => ({ TrackSelector: () => <div data-testid="tracks" /> }));
vi.mock('./useVersionBytes', () => ({ useVersionBytes: vi.fn() }));

const { useScore } = vi.mocked(await import('@gpt/alphatab-react'));
const { useVersionBytes } = vi.mocked(await import('./useVersionBytes'));

const version: Version = {
  id: 'v2',
  message: 'Bridge take 3',
  timestamp: Math.round(Date.now() / 1000),
  kind: 'named',
};

const score = { tracks: [{ name: 'Distortion Guitar' }] } as never;

beforeAll(() => i18n.changeLanguage('en'));

beforeEach(() => {
  vi.clearAllMocks();
  useVersionBytes.mockReturnValue({ bytes: new Uint8Array([1, 2, 3]), loading: false, error: null });
  useScore.mockReturnValue({ score, isLoading: false, error: null });
});

describe('ScoreStage', () => {
  it('plays the version once it has parsed', () => {
    render(<ScoreStage fileId="a1" version={version} />);

    expect(screen.getByTestId('transport')).toBeTruthy();
    expect(screen.getByTestId('viewport')).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it('says so, instead of a blank stage, when alphaTab cannot read the version', () => {
    useScore.mockReturnValue({
      score: null,
      isLoading: false,
      error: new Error('No compatible importer found for file'),
    });

    render(<ScoreStage fileId="a1" version={version} />);

    expect(screen.getByText(/could not be read/)).toBeTruthy();
    // A transport that can never start is worse than none.
    expect(screen.queryByTestId('transport')).toBeNull();
    // The viewport stays: unmounting it would tear alphaTab down and retry.
    expect(screen.getByTestId('viewport')).toBeTruthy();
  });

  it('says so when the version bytes cannot be fetched', () => {
    useVersionBytes.mockReturnValue({ bytes: null, loading: false, error: 'io error: no such blob' });

    render(<ScoreStage fileId="a1" version={version} />);

    expect(screen.getByText(/io error/)).toBeTruthy();
  });
});
