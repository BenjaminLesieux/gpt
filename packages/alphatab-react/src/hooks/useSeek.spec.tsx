import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { Root } from "../components/Root";
import { Viewport } from "../components/Viewport";
import { useSeek, type UseSeekResult } from "./useSeek";

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
    settings = { display: { scale: 1 } };
    timePosition = 0;

    constructor() {
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

    load() {
      return true;
    }
    destroy() {}
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
    timePosition: number;
    playerReady: { fire(arg?: unknown): void };
    playerPositionChanged: { fire(arg: unknown): void };
  }[];
};

beforeEach(() => {
  FakeApi.instances.length = 0;
});

async function renderSeek() {
  const seek: { current: UseSeekResult | null } = { current: null };
  function Probe() {
    seek.current = useSeek();
    return null;
  }
  render(
    <Root src={new Uint8Array([1, 2, 3])}>
      <Viewport />
      <Probe />
    </Root>,
  );
  await waitFor(() => expect(FakeApi.instances.length).toBeGreaterThan(0));
  const api = FakeApi.instances[FakeApi.instances.length - 1];
  const moveTo = (currentTime: number) =>
    act(() =>
      api.playerPositionChanged.fire({
        currentTime,
        endTime: 2000,
        currentTick: 0,
        endTick: 0,
        isSeek: false,
      }),
    );
  return { seek: seek as { current: UseSeekResult }, api, moveTo };
}

describe("useSeek", () => {
  it("should follow the player when nobody is dragging", async () => {
    const { seek, moveTo } = await renderSeek();

    moveTo(500);

    expect(seek.current.value).toBe(25);
  });

  it("should follow the pointer when the thumb is dragged while playing", async () => {
    // Given a player a quarter of the way through
    const { seek, moveTo } = await renderSeek();
    moveTo(500);

    // When the thumb is dragged and the player keeps moving
    act(() => seek.current.onValueChange([60]));
    moveTo(600);

    // Then the thumb stays under the pointer
    expect(seek.current.value).toBe(60);
  });

  it("should move the player when the drag is committed", async () => {
    const { seek, api, moveTo } = await renderSeek();
    moveTo(500);
    act(() => seek.current.onValueChange(50));

    act(() => seek.current.onValueCommitted(50));

    // The player is told to go there, and the thumb follows it again
    expect(api.timePosition).toBe(1000);
    moveTo(1000);
    expect(seek.current.value).toBe(50);
  });

  it("should be disabled when the player is not ready", async () => {
    const { seek, moveTo } = await renderSeek();
    moveTo(0);

    expect(seek.current.disabled).toBe(true);
  });

  it("should be enabled when the player is ready and the song has a length", async () => {
    const { seek, api, moveTo } = await renderSeek();

    act(() => api.playerReady.fire());
    expect(seek.current.disabled).toBe(true);
    moveTo(0);

    expect(seek.current.disabled).toBe(false);
  });
});
