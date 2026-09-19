import { describe, expect, it, vi } from "vitest";

import { HelmAppVersionResolver } from "../src/helm.js";

const source = { repository: "https://charts.gitlab.io", chart: "gitlab" };

function index(entries: unknown): string {
  return JSON.stringify({ apiVersion: "v1", entries });
}

describe("HelmAppVersionResolver", () => {
  it("uses exact chart metadata and shares an in-flight index across charts and versions", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        index({
          gitlab: [
            { version: "10.3.2", appVersion: "19.3.2" },
            { version: "10.3.1", appVersion: "19.3.1" },
            { version: "10.3.1", appVersion: "19.3.1" },
          ],
          runner: [{ version: "0.84.0", appVersion: "19.3.0" }],
        }),
      ),
    );
    const resolver = new HelmAppVersionResolver(fetchImplementation);
    await expect(
      Promise.all([
        resolver.resolve(source, "10.3.1"),
        resolver.resolve(
          { ...source, repository: `${source.repository}/` },
          "10.3.2",
        ),
        resolver.resolve({ ...source, chart: "runner" }, "0.84.0"),
      ]),
    ).resolves.toEqual(["19.3.1", "19.3.2", "19.3.0"]);
    await expect(resolver.resolve(source, "10.3.1")).resolves.toBe("19.3.1");
    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(
      "https://charts.gitlab.io/index.yaml",
      expect.objectContaining({
        redirect: "error",
      }),
    );
    expect(fetchImplementation.mock.calls[0]![1]?.signal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it.each(["10", "10.3", "^10.3.0", ">=10.3.0", "latest", "10.3.*"])(
    "rejects non-exact chart selection %s before fetching",
    async (version) => {
      const fetchImplementation = vi.fn<typeof fetch>();
      await expect(
        new HelmAppVersionResolver(fetchImplementation).resolve(
          source,
          version,
        ),
      ).rejects.toThrow("requires an exact chart version");
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{}, "no entries for chart"],
    [
      { gitlab: [{ version: "10.3.1", appVersion: "19.3.1" }] },
      "was not found",
    ],
    [{ gitlab: [{ version: "10.3.2" }] }, "no non-empty appVersion"],
    [
      { gitlab: [{ version: "10.3.2", appVersion: " " }] },
      "no non-empty appVersion",
    ],
    [
      { gitlab: [{ version: "10.3.2", appVersion: 19 }] },
      "no non-empty appVersion",
    ],
    [
      {
        gitlab: [
          { version: "10.3.2", appVersion: "19.3.2" },
          { version: "10.3.2" },
        ],
      },
      "no non-empty appVersion",
    ],
    [
      {
        gitlab: [
          { version: "10.3.2", appVersion: "19.3.2" },
          { version: "10.3.2", appVersion: "19.3.1" },
        ],
      },
      "conflicting appVersion",
    ],
  ])(
    "fails closed for missing or ambiguous metadata %#",
    async (entries, message) => {
      const resolver = new HelmAppVersionResolver(
        vi.fn<typeof fetch>().mockResolvedValue(new Response(index(entries))),
      );
      await expect(resolver.resolve(source, "10.3.2")).rejects.toThrow(message);
    },
  );

  it.each([
    ["entries: [", "invalid YAML"],
    ["apiVersion: v1\nentries: {}\nentries: {}", "invalid YAML"],
    ["apiVersion: v1\nentries: []", "entries mapping"],
    ["apiVersion: v2\nentries: {}", "apiVersion v1"],
    [
      "apiVersion: v1\na: &a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\nentries: {gitlab: [*c, *c]}",
      "Excessive alias count",
    ],
  ])("rejects malformed or unsafe YAML %#", async (body, message) => {
    const resolver = new HelmAppVersionResolver(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
    );
    await expect(resolver.resolve(source, "10.3.2")).rejects.toThrow(message);
  });

  it("cancels an oversized index before reading it", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "Content-Length": String(32 * 1024 * 1024 + 1) },
    });
    const resolver = new HelmAppVersionResolver(
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    await expect(resolver.resolve(source, "10.3.2")).rejects.toThrow(
      "exceeded 33554432 bytes",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reports HTTP errors without accepting an error page as metadata", async () => {
    const resolver = new HelmAppVersionResolver(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    await expect(resolver.resolve(source, "10.3.2")).rejects.toThrow(
      "HTTP 503",
    );
  });

  it("propagates request timeouts and caches the failure for the run", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    const resolver = new HelmAppVersionResolver(fetchImplementation);
    await expect(resolver.resolve(source, "10.3.2")).rejects.toThrow(
      "Timed out",
    );
    await expect(resolver.resolve(source, "10.3.1")).rejects.toThrow(
      "Timed out",
    );
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
