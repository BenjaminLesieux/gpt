import { useEffect, useMemo, useState } from 'react';
import { diffScores, type ScoreDiff } from '@gpt/gpt-core';
import { getVersionBlob } from '@/lib/ipc';
import { parseScore } from '@/lib/score';

/**
 * Scores run to hundreds of KB and the timeline invites hopping back and
 * forth, so blobs are kept around — bounded, because the window can stay open
 * for a whole session.
 */
const CACHE_LIMIT = 8;
const cache = new Map<string, Uint8Array>();

async function loadBlob(fileId: string, rev: string): Promise<Uint8Array> {
  const key = `${fileId}:${rev}`;
  const cached = cache.get(key);
  if (cached) {
    // Re-insert: Map iterates in insertion order, which is what makes the
    // eviction below least-recently-used rather than first-loaded.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const bytes = await getVersionBlob(fileId, rev);
  cache.set(key, bytes);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return bytes;
}

export interface VersionBytes {
  bytes: Uint8Array | null;
  loading: boolean;
  error: string | null;
}

export function useVersionBytes(fileId: string | null, rev: string | null): VersionBytes {
  const [state, setState] = useState<VersionBytes>({
    bytes: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!fileId || !rev) {
      setState({ bytes: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ bytes: null, loading: true, error: null });
    void loadBlob(fileId, rev)
      .then((bytes) => !cancelled && setState({ bytes, loading: false, error: null }))
      .catch(
        (cause) => !cancelled && setState({ bytes: null, loading: false, error: String(cause) }),
      );
    return () => {
      cancelled = true;
    };
  }, [fileId, rev]);

  return state;
}

export interface VersionDiff {
  diff: ScoreDiff | null;
  baseBytes: Uint8Array | null;
  headBytes: Uint8Array | null;
  loading: boolean;
  error: string | null;
}

/**
 * Two versions of one file, parsed and diffed.
 *
 * Parsing is the expensive half and happens once per pair; `TabDiff` renders
 * from the raw bytes and only reads the diff for its overlays.
 */
export function useVersionDiff(
  fileId: string | null,
  baseRev: string | null,
  headRev: string | null,
): VersionDiff {
  const base = useVersionBytes(fileId, baseRev);
  const head = useVersionBytes(fileId, headRev);

  const { diff, parseError } = useMemo(() => {
    if (!base.bytes || !head.bytes) return { diff: null, parseError: null };
    try {
      return { diff: diffScores(parseScore(base.bytes), parseScore(head.bytes)), parseError: null };
    } catch (cause) {
      return { diff: null, parseError: String(cause) };
    }
  }, [base.bytes, head.bytes]);

  return {
    diff,
    baseBytes: base.bytes,
    headBytes: head.bytes,
    loading: base.loading || head.loading,
    error: base.error ?? head.error ?? parseError,
  };
}
