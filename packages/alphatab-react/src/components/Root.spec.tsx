import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { Root } from "./Root";
import { Viewport } from "./Viewport";

vi.mock("@coderline/alphatab", () => {
  class Emitter {
    listeners = new Set<(arg: unknown) => void>();
    on(listener: (arg: unknown) => void) {
      this.listeners.add(listener);
    }
    off(listener: (arg: unknown) => void) {
      this.listeners.delete(listener);
    }
    fire(arg?: unknown) {
      for (const listener of [...this.listeners]) listener(arg);
    }
  }

  /** Every event the wrapper subscribes to, conjured on first access. */
  class FakeApi {
    static instances: FakeApi[] = [];
    /** Set by a test to decide what `load()` does. */
    static onLoad: ((api: FakeApi, data: unknown) => void) | null = null;

    settings: { display: { scale: number } };

    constructor(_el: HTMLElement, settings: { display?: { scale: number } }) {
      this.settings = { display: { scale: 1, ...settings?.display } };
      const events = new Map<string, Emitter>();
      const proxy = new Proxy(this, {
        get(target, prop, receiver) {
          if (prop in target || typeof prop !== "string") {
            return Reflect.get(target, prop, receiver);
          }
          if (!events.has(prop)) events.set(prop, new Emitter());
          return events.get(prop);
        },
      });
      FakeApi.instances.push(proxy);
      return proxy;
    }

    /** Every renderTracks call, in order — how a live track switch is judged. */
    static rendered: unknown[][] = [];
    /** The track indexes each load asked for — how the first render is judged. */
    static loadedTracks: (number[] | undefined)[] = [];

    load(data: unknown, trackIndexes?: number[]) {
      FakeApi.loadedTracks.push(trackIndexes);
      FakeApi.onLoad?.(this, data);
      return true;
    }
    destroy() {}
    updateSettings() {}
    render() {}
    renderTracks(tracks: unknown[]) {
      FakeApi.rendered.push(tracks);
    }
  }

  return {
    AlphaTabApi: FakeApi,
    Settings: class Settings {},
    LogLevel: { None: 0 },
    LayoutMode: { Page: 0, Horizontal: 1 },
    SystemsLayoutMode: { Automatic: 0, UseModelLayout: 1 },
  };
});

const alphaTab = await import("@coderline/alphatab");
const FakeApi = alphaTab.AlphaTabApi as unknown as {
  instances: {
    error: { fire(arg: unknown): void };
    scoreLoaded: { fire(arg: unknown): void };
    settings: { display: { systemsLayoutMode?: number } };
  }[];
  onLoad: ((api: unknown, data: unknown) => void) | null;
  rendered: unknown[][];
  loadedTracks: (number[] | undefined)[];
};

beforeEach(() => {
  FakeApi.instances.length = 0;
  FakeApi.rendered.length = 0;
  FakeApi.loadedTracks.length = 0;
  FakeApi.onLoad = null;
});

describe("Root", () => {
  it("should report the error when the importer rejects the bytes during load", async () => {
    // Given a file alphaTab cannot parse: the failure is raised inside `load()`.
    const failure = new Error("No compatible importer found for file");
    FakeApi.onLoad = (api) => (api as { error: { fire(arg: unknown): void } }).error.fire(failure);
    const onError = vi.fn();

    // When it is handed to the wrapper.
    render(
      <Root src={new Uint8Array([1, 2, 3])} onError={onError}>
        <Viewport />
      </Root>,
    );

    // Then the consumer hears about it.
    await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  });

  it("should report an error raised after mount exactly once", async () => {
    const onError = vi.fn();
    render(
      <Root src={new Uint8Array([1, 2, 3])} onError={onError}>
        <Viewport />
      </Root>,
    );
    await waitFor(() => expect(FakeApi.instances.length).toBeGreaterThan(0));

    const failure = new Error("rendering failed");
    act(() => FakeApi.instances[FakeApi.instances.length - 1].error.fire(failure));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  describe("track filtering", () => {
    const score = { tracks: [{ name: "Guitar" }, { name: "Bass" }, { name: "Drums" }] };

    async function loadScore(tracks?: number[]) {
      const view = render(
        <Root src={new Uint8Array([1, 2, 3])} tracks={tracks}>
          <Viewport />
        </Root>,
      );
      await waitFor(() => expect(FakeApi.instances.length).toBeGreaterThan(0));
      act(() => FakeApi.instances[FakeApi.instances.length - 1].scoreLoaded.fire(score));
      return view;
    }

    it("should render only the requested track", async () => {
      await loadScore([1]);

      // The filter goes in with the load: laying the score out a second time
      // to drop a track leaves the first pass on screen underneath.
      expect(FakeApi.loadedTracks).toEqual([[1]]);
      expect(FakeApi.rendered).toEqual([]);
    });

    it("should render every track when none is requested", async () => {
      await loadScore();

      // alphaTab's sentinel for all of them; an omitted list means track 0.
      expect(FakeApi.loadedTracks).toEqual([[-1]]);
      expect(FakeApi.rendered).toEqual([]);
    });

    it("should switch tracks without reloading the score", async () => {
      const { rerender } = await loadScore([1]);
      const apiCount = FakeApi.instances.length;

      rerender(
        <Root src={new Uint8Array([1, 2, 3])} tracks={[2]}>
          <Viewport />
        </Root>,
      );

      await waitFor(() =>
        expect(FakeApi.rendered[FakeApi.rendered.length - 1]).toEqual([score.tracks[2]]),
      );
      // A new api instance would mean the pane was torn down and re-parsed.
      expect(FakeApi.instances.length).toBe(apiCount);
    });
  });

  describe("row layout", () => {
    const score = () => ({
      tracks: [{ name: "Guitar", systemsLayout: [] as number[] }],
      systemsLayout: [] as number[],
    });

    async function loadWith(systemsLayout?: number[]) {
      const loaded = score();
      render(
        <Root src={new Uint8Array([1, 2, 3])} systemsLayout={systemsLayout}>
          <Viewport />
        </Root>,
      );
      await waitFor(() => expect(FakeApi.instances.length).toBeGreaterThan(0));
      const api = FakeApi.instances[FakeApi.instances.length - 1];
      // The layout has to be on the model by the end of this event — alphaTab
      // renders the moment it returns.
      act(() => api.scoreLoaded.fire(loaded));
      return { api, loaded };
    }

    it("should hand the row breaks to the score and to every track", async () => {
      // Given a caller that has decided where the rows break
      const { loaded } = await loadWith([4, 5, 3]);

      // Then both places alphaTab reads them from carry the plan — it consults
      // the track when one track is shown and the score when several are.
      expect(loaded.systemsLayout).toEqual([4, 5, 3]);
      expect(loaded.tracks[0].systemsLayout).toEqual([4, 5, 3]);
    });

    it("should put alphaTab on the model layout so the breaks are read at all", async () => {
      const { api } = await loadWith([4, 4]);

      expect(api.settings.display.systemsLayoutMode).toBe(
        alphaTab.SystemsLayoutMode.UseModelLayout,
      );
    });

    it("should leave the score alone when no layout is given", async () => {
      const { api, loaded } = await loadWith(undefined);

      expect(loaded.systemsLayout).toEqual([]);
      expect(api.settings.display.systemsLayoutMode).toBeUndefined();
    });
  });
});
