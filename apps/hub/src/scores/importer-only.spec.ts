import { readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopesFor } from './scope';

/**
 * The boundary ADR 0008 draws around AlphaTab, asserted rather than assumed.
 *
 * AlphaTab's **importer** runs under Node with no DOM. Its **renderer** does
 * not. Everything the hub does with a score — what a version touched, what a
 * branch touched, and eventually whether one can land — is importing, and the
 * hub draws no notes at all.
 *
 * Nothing stopped that from drifting. `history.spec.ts` and `branches.spec.ts`
 * parse real files under Node and would fail loudly the day a DOM were
 * required — but the fix somebody reaches for when they see
 * `document is not defined` is a jsdom environment or a global shim, and both
 * of those make the suite pass while putting a notation engine in a server
 * process. This is the test that fails instead.
 */

const HUB_SRC = path.join(import.meta.dirname, '..');
/** Vendored build output of the web client. Not the hub's own code. */
const NOT_OURS = new Set(['assets']);

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return NOT_OURS.has(entry.name) ? [] : sources(full);
      // Specs only. What ships is what matters here — a fixture built with
      // the exporter runs in CI and never in the server image.
      const shipped = entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts');
      return shipped ? [full] : [];
    })
  );

  return files.flat();
}

describe('the hub and AlphaTab', () => {
  it('reaches the importer and nothing else', async () => {
    const files = await sources(HUB_SRC);
    expect(files.length).toBeGreaterThan(10);

    const namespaces = new Set<string>();

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      for (const match of source.matchAll(
        /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@coderline\/alphatab[^']*'/g
      )) {
        for (const name of match[2].split(',')) {
          const cleaned = name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
          if (cleaned) namespaces.add(`${file.slice(HUB_SRC.length + 1)}: ${cleaned}`);
        }
      }

      // A bare or default import pulls the whole library in under one name and
      // makes the check above blind, which is the one way to smuggle the
      // renderer past it.
      expect(source).not.toMatch(/import\s+(\w+|\*\s+as\s+\w+)\s+from\s+'@coderline\/alphatab/);
    }

    // One namespace, and it is the one the ADR authorises. The day
    // `rendering`, `platform` or `synth` appears here, a renderer, a canvas or
    // a synthesiser has been given a server process to run in.
    expect([...namespaces].filter((entry) => !entry.endsWith(': importer'))).toEqual([]);
    expect(namespaces.size).toBeGreaterThan(0);
  });

  it('parses a real score in a process that has no DOM at all', async () => {
    // Not a precondition being checked — the assertion itself. The suite runs
    // under `environment: 'node'` and the day somebody changes that to make a
    // renderer import work, this is what says no.
    // Not `navigator`, which Node defines itself and which says nothing about
    // whether a DOM is present.
    for (const global of ['window', 'document', 'HTMLElement', 'CanvasRenderingContext2D']) {
      expect(global in globalThis, `${global} should not exist in the hub`).toBe(false);
    }

    // `scopesFor` is the hub's whole use of AlphaTab. Called against a git root
    // that holds nothing, it still loads the module graph that a real parse
    // uses, and reaching a DOM at import time would throw here.
    await expect(scopesFor(null as never, '/nowhere', 'nobody', 'nothing', [])).resolves.toEqual(
      new Map()
    );
  });

  it('has no DOM shim among its dependencies', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(HUB_SRC, '..', 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    // The three things somebody installs to make a renderer run headlessly.
    // Each is a sign the boundary moved, and none of them belongs in an image
    // whose job is to serve git.
    expect(declared.filter((name) => /^(jsdom|canvas|happy-dom)$/.test(name))).toEqual([]);
  });
});
