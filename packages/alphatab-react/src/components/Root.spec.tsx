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

    load(data: unknown) {
      FakeApi.onLoad?.(this, data);
      return true;
    }
    destroy() {}
    updateSettings() {}
    render() {}
    renderTracks() {}
  }

  return {
    AlphaTabApi: FakeApi,
    Settings: class Settings {},
    LogLevel: { None: 0 },
    LayoutMode: { Page: 0, Horizontal: 1 },
  };
});

const alphaTab = await import("@coderline/alphatab");
const FakeApi = alphaTab.AlphaTabApi as unknown as {
  instances: { error: { fire(arg: unknown): void } }[];
  onLoad: ((api: unknown, data: unknown) => void) | null;
};

beforeEach(() => {
  FakeApi.instances.length = 0;
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
});
