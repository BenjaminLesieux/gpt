import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, HubError, type CreatedScore } from './api';
import { ImportFailed, useImportScore, useRetryImport } from './queries';

const created: CreatedScore = {
  id: 'sc1',
  name: 'Bridge rewrite',
  url: 'https://hub.example.com/git/acc/sc1.git',
  username: 'acc',
  token: 'gp_tok_123',
  tokenName: 'companion',
};

const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'bridge.gp');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useImportScore', () => {
  it('creates the score and then sends the file to it', async () => {
    // Given
    const create = vi.spyOn(api, 'createScore').mockResolvedValue(created);
    const upload = vi.spyOn(api, 'importScore').mockResolvedValue({
      id: created.id,
      name: created.name,
      version: 'c0ffee',
      message: 'Imported',
    });
    const onImported = vi.fn();

    // When
    const { result } = renderHook(() => useImportScore(onImported), { wrapper });
    result.current.mutate({ name: 'Bridge rewrite', file });

    // Then — one user-visible step, two calls, in that order.
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(created));
    expect(create).toHaveBeenCalledWith('Bridge rewrite');
    expect(upload).toHaveBeenCalledWith(created.id, file);
  });

  it('keeps hold of the score when only the file failed to land', async () => {
    // Given
    vi.spyOn(api, 'createScore').mockResolvedValue(created);
    vi.spyOn(api, 'importScore').mockRejectedValue(
      new HubError('internal', 'Something went wrong.', 500)
    );
    const onImported = vi.fn();

    // When
    const { result } = renderHook(() => useImportScore(onImported), { wrapper });
    result.current.mutate({ name: 'Bridge rewrite', file });

    // Then — the credentials were minted and shown nowhere, and the server
    // keeps no copy, so losing them with the error would lose them for good.
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ImportFailed));
    expect((result.current.error as ImportFailed).score).toEqual(created);
    expect(onImported).not.toHaveBeenCalled();
  });
});

describe('useRetryImport', () => {
  it('sends the file to the score that already exists rather than making another', async () => {
    // Given a first attempt that stranded a score
    const create = vi.spyOn(api, 'createScore').mockResolvedValue(created);
    const upload = vi.spyOn(api, 'importScore').mockResolvedValue({
      id: created.id,
      name: created.name,
      version: 'c0ffee',
      message: 'Imported',
    });
    const onImported = vi.fn();

    // When
    const { result } = renderHook(() => useRetryImport(onImported), { wrapper });
    result.current.mutate({ score: created, file });

    // Then — a musician who retries twice must not end up with three scores.
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(created));
    expect(create).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith(created.id, file);
  });
});
