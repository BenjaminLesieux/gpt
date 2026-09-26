import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Root } from "./Root";
import { Stage } from "./Stage";

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
    error: { fire(arg: unknown): void };
    scoreLoaded: { fire(arg: unknown): void };
  }[];
};

beforeEach(() => {
  FakeApi.instances.length = 0;
});

function renderStage(props: Parameters<typeof Stage>[0] = {}) {
  return render(
    <Root src={new Uint8Array([1, 2, 3])}>
      <Stage {...props} />
    </Root>,
  );
}

async function currentApi() {
  await waitFor(() => expect(FakeApi.instances.length).toBeGreaterThan(0));
  return FakeApi.instances[FakeApi.instances.length - 1];
}

describe("Stage", () => {
  it("should show the loading content over the viewport when the score is parsing", async () => {
    // Given a score that has not parsed yet
    renderStage({ loading: <p>parsing</p> });
    await currentApi();

    // Then the loading content is on screen
    expect(await screen.findByText("parsing")).toBeTruthy();
  });

  it("should take the loading content away when the score has parsed", async () => {
    renderStage({ loading: <p>parsing</p> });
    const api = await currentApi();
    await screen.findByText("parsing");

    act(() => api.scoreLoaded.fire({ tracks: [] }));

    await waitFor(() => expect(screen.queryByText("parsing")).toBeNull());
  });

  it("should show the failure with its error when the score will not load", async () => {
    // Given a stage that says what went wrong
    renderStage({ failed: (error) => <p>{error.message}</p> });
    const api = await currentApi();

    // When alphaTab rejects the file
    act(() => api.error.fire(new Error("No compatible importer found for file")));

    // Then the reason is on screen
    expect(await screen.findByText("No compatible importer found for file")).toBeTruthy();
  });

  it("should keep the same viewport when the score goes from loading to failed", async () => {
    // Given a stage showing its loading content
    const { container } = renderStage({
      loading: <p>parsing</p>,
      failed: () => <p>broken</p>,
    });
    const api = await currentApi();
    await screen.findByText("parsing");
    const viewport = container.firstElementChild?.firstElementChild;

    // When the load fails
    act(() => api.error.fire(new Error("broken")));
    await screen.findByText("broken");

    // Then the viewport was never unmounted, so the api was never rebuilt
    expect(container.firstElementChild?.firstElementChild).toBe(viewport);
    expect(FakeApi.instances.length).toBe(1);
  });

  it("should lay nothing over the viewport when no content is given", async () => {
    const { container } = renderStage();
    const api = await currentApi();

    act(() => api.error.fire(new Error("broken")));

    await waitFor(() => expect(container.firstElementChild?.childElementCount).toBe(1));
  });

  it("should contain alphaTab's cursor when a class is given too", () => {
    // Given a consumer that styles the stage
    const { container } = renderStage({ className: "stage" });
    const stage = container.firstElementChild as HTMLElement;

    // Then the stacking context is there regardless
    expect(stage.className).toBe("stage");
    expect(stage.style.position).toBe("relative");
    expect(stage.style.isolation).toBe("isolate");
  });

  it("should hand the cursor classes to the viewport when they are given", () => {
    const { container } = renderStage({ cursorClassNames: { highlightColor: "red" } });
    const viewport = container.firstElementChild?.firstElementChild as HTMLElement;

    expect(viewport.style.getPropertyValue("--at-highlight-color")).toBe("red");
  });
});
