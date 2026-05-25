import { describe, it, expect, vi } from "vitest";
import { GptClient, GptApiError } from "./client";

/**
 * Builds a mock `fetch` that returns pre-scripted responses, while recording
 * every call. Keyed by `URL + method` so each test can assert exactly what was
 * sent and which response was consumed.
 */
function mockFetch(
  handlers: Array<{
    match: (url: string, init?: RequestInit) => boolean;
    respond: () => Response;
  }>,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const handler = handlers.find((h) => h.match(url, init));
    if (!handler) throw new Error(`No mock handler for ${init?.method ?? "GET"} ${url}`);
    return handler.respond();
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const jsonOk = (data: unknown) =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const jsonErr = (error: string, status = 500) =>
  new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("GptClient", () => {
  describe("URL building", () => {
    it("uses the default base URL when none is supplied", async () => {
      const fetch = mockFetch([
        { match: (u) => u.startsWith("http://127.0.0.1:7337/log"), respond: () => jsonOk([]) },
      ]);
      const client = new GptClient({ fetch: fetch.fn });

      await client.log("/my/repo");

      expect(fetch.calls[0].url).toBe("http://127.0.0.1:7337/log?dir=%2Fmy%2Frepo");
    });

    it("strips trailing slashes from the base URL", async () => {
      const fetch = mockFetch([
        { match: (u) => u.startsWith("http://localhost:9000/log"), respond: () => jsonOk([]) },
      ]);
      const client = new GptClient({ baseUrl: "http://localhost:9000/", fetch: fetch.fn });

      await client.log("/r");

      expect(fetch.calls[0].url).toBe("http://localhost:9000/log?dir=%2Fr");
    });

    it("encodes commit hashes and file paths in show URLs", async () => {
      const fetch = mockFetch([
        { match: (u) => u.includes("/show/"), respond: () => jsonOk({ commit: null, files: [] }) },
      ]);
      const client = new GptClient({ fetch: fetch.fn });

      await client.show("/r", "abc123");

      expect(fetch.calls[0].url).toContain("/show/abc123?dir=%2Fr");
    });
  });

  describe("envelope unwrapping", () => {
    it("returns `data` on ok responses", async () => {
      const commits = [{ hash: "abc", shortHash: "abc", message: "init", author: null, parentHashes: [] }];
      const fetch = mockFetch([{ match: () => true, respond: () => jsonOk(commits) }]);
      const client = new GptClient({ fetch: fetch.fn });

      const result = await client.log("/r");

      expect(result).toEqual(commits);
    });

    it("throws GptApiError with the server message on { ok: false } payloads", async () => {
      const fetch = mockFetch([{ match: () => true, respond: () => jsonErr("not a git repo", 500) }]);
      const client = new GptClient({ fetch: fetch.fn });

      await expect(client.status("/r")).rejects.toBeInstanceOf(GptApiError);
      await expect(client.status("/r")).rejects.toThrow("not a git repo");
    });

    it("throws GptApiError when the body isn't JSON", async () => {
      const fetch = mockFetch([
        { match: () => true, respond: () => new Response("oops", { status: 502 }) },
      ]);
      const client = new GptClient({ fetch: fetch.fn });

      await expect(client.log("/r")).rejects.toBeInstanceOf(GptApiError);
    });
  });

  describe("write operations", () => {
    it("POST /init sends { } body with dir in the query", async () => {
      const fetch = mockFetch([
        {
          match: (u, init) => u.includes("/init") && init?.method === "POST",
          respond: () => jsonOk({ dir: "/r", status: "created" }),
        },
      ]);
      const client = new GptClient({ fetch: fetch.fn });

      const result = await client.init("/r");

      expect(result).toEqual({ dir: "/r", status: "created" });
      const call = fetch.calls[0];
      expect(call.url).toContain("dir=%2Fr");
      expect(call.init?.method).toBe("POST");
      expect(call.init?.body).toBe("{}");
    });

    it("POST /commit sends message in the body", async () => {
      const fetch = mockFetch([
        {
          match: (u, init) => u.includes("/commit") && init?.method === "POST",
          respond: () => jsonOk({ hash: "deadbeef", shortHash: "deadbee", message: "add riff" }),
        },
      ]);
      const client = new GptClient({ fetch: fetch.fn });

      await client.commit("/r", "add riff");

      const call = fetch.calls[0];
      expect(JSON.parse(call.init?.body as string)).toEqual({ message: "add riff" });
    });

    it("POST /add sends file in the body", async () => {
      const fetch = mockFetch([
        {
          match: (u, init) => u.includes("/add") && init?.method === "POST",
          respond: () => jsonOk({ file: "song.gp" }),
        },
      ]);
      const client = new GptClient({ fetch: fetch.fn });

      await client.addFile("/r", "song.gp");

      const call = fetch.calls[0];
      expect(JSON.parse(call.init?.body as string)).toEqual({ file: "song.gp" });
    });
  });

  describe("binary file download", () => {
    it("returns raw bytes from /show/:hash/file/:filename", async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const fetch = mockFetch([
        {
          match: (u) => u.includes("/show/abc/file/song.gp"),
          respond: () =>
            new Response(bytes, {
              status: 200,
              headers: { "Content-Type": "application/octet-stream" },
            }),
        },
      ]);
      const client = new GptClient({ fetch: fetch.fn });

      const result = await client.showFile("/r", "abc", "song.gp");

      expect(Array.from(result)).toEqual([1, 2, 3, 4]);
    });

    it("throws GptApiError when the binary endpoint responds with a non-2xx", async () => {
      const fetch = mockFetch([
        { match: () => true, respond: () => new Response("no such file", { status: 404 }) },
      ]);
      const client = new GptClient({ fetch: fetch.fn });

      await expect(client.showFile("/r", "abc", "missing.gp")).rejects.toBeInstanceOf(GptApiError);
    });
  });

  describe("repo validation", () => {
    it("returns the full RepoValidation shape", async () => {
      const fetch = mockFetch([
        {
          match: (u) => u.includes("/repo/validate"),
          respond: () => jsonOk({ dir: "/r", exists: true, isGitRepo: true, isGptRepo: false }),
        },
      ]);
      const client = new GptClient({ fetch: fetch.fn });

      const result = await client.validateRepo("/r");

      expect(result).toEqual({ dir: "/r", exists: true, isGitRepo: true, isGptRepo: false });
    });
  });
});
