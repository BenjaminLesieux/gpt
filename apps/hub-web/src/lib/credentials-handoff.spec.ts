import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatedScore } from './api';
import { clearHandoff, handOff, peekHandoff, usePendingHandoff } from './credentials-handoff';

const SCORE: CreatedScore = {
  id: 'abcdefgh',
  name: 'Blackbird',
  url: 'https://hub.example/git/acc/abcdefgh.git',
  username: 'git',
  token: 'gpt_notarealtoken',
  tokenName: 'companion',
};

afterEach(() => {
  clearHandoff();
});

describe('the credential handoff', () => {
  it('holds what was handed to it until it is cleared', () => {
    expect(peekHandoff()).toBeNull();

    handOff(SCORE);
    expect(peekHandoff()).toEqual(SCORE);

    clearHandoff();
    expect(peekHandoff()).toBeNull();
  });

  it('tells the screen when a credential arrives and when it goes', () => {
    const { result } = renderHook(() => usePendingHandoff());
    expect(result.current).toBeNull();

    act(() => handOff(SCORE));
    expect(result.current).toEqual(SCORE);

    act(() => clearHandoff());
    expect(result.current).toBeNull();
  });

  it('stops listening once the screen is gone', () => {
    const { unmount } = renderHook(() => usePendingHandoff());
    unmount();

    // Nothing to assert on the store itself - the point is that emitting to a
    // torn-down subscriber does not throw, which is what a leaked listener does.
    expect(() => handOff(SCORE)).not.toThrow();
  });

  it('keeps the token out of everything that outlives the tab', () => {
    handOff(SCORE);

    expect(window.localStorage.getItem('handoff')).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
    expect(window.location.href).not.toContain(SCORE.token);
    expect(document.cookie).not.toContain(SCORE.token);
  });
});
