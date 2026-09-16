import { afterEach, describe, expect, it, vi } from "vitest";

import { CompatibilityApiClient } from "../src/api.js";

const request = {
  project: "cloudnativepg",
  version: "1.30",
  dependency: "postgresql",
  dependencyVersion: "18.4",
};
const evidence = {
  ...request,
  compatible: "compatible",
  basis: "supported",
  matchedRange: ">=14.0.0 <19.0.0",
  matchedConstraint: null,
  relationship: "operand",
  confidence: "high",
  lastVerified: "2026-09-11",
  notes: [],
  sources: [
    {
      title: "Release notes",
      url: "https://cloudnative-pg.io/",
      accessedAt: "2026-09-11",
    },
  ],
};
const client = new CompatibilityApiClient(
  "https://compatibility.fyi/api/v1/check",
  1000,
  1,
);

describe("CompatibilityApiClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["supported", "tested", undefined])(
    "preserves %s evidence and request identity",
    async (basis) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(Response.json({ ...evidence, basis }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(client.check(request)).resolves.toMatchObject({
        ...evidence,
        basis: basis ?? null,
      });
      expect(
        new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get(
          "dependencyVersion",
        ),
      ).toBe("18.4");
    },
  );

  it("preserves exact-version matches without requiring a range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...evidence,
          matchedRange: null,
          matchedConstraint: "same-version",
        }),
      ),
    );
    await expect(client.check(request)).resolves.toMatchObject({
      matchedRange: null,
      matchedConstraint: "same-version",
    });
  });

  it.each(["recommended", "bundled"])(
    "preserves unknown %s evidence despite a range match",
    async (basis) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ ...evidence, basis, compatible: "unknown" }),
          ),
      );
      await expect(client.check(request)).resolves.toMatchObject({
        basis,
        compatible: "unknown",
        matchedRange: evidence.matchedRange,
      });
    },
  );

  it.each([
    [{ reason: "anything" }, "reason must identify"],
    [{ reason: "project-not-found" }, "only valid for unknown"],
    [{ compatible: "maybe" }, "compatible must be"],
    [{ version: "1.29" }, "did not match"],
    [{ basis: "default" }, "basis must be"],
    [{ basis: "bundled" }, "recommendations or bundles"],
    [{ basis: "recommended" }, "recommendations or bundles"],
    [{ matchedConstraint: "same-major" }, "matchedConstraint must be"],
    [{ matchedRange: null }, "matched constraint"],
    [{ lastVerified: "2026-02-30" }, "valid ISO date"],
    [{ lastVerified: null }, "verification date"],
    [{ sources: [] }, "include sources"],
    [
      { sources: [{ ...evidence.sources[0], accessedAt: "2026-13-01" }] },
      "valid ISO date",
    ],
  ])(
    "rejects malformed evidence %j without retrying",
    async (overrides, message) => {
      const fetchMock = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(Response.json({ ...evidence, ...overrides })),
        );
      vi.stubGlobal("fetch", fetchMock);
      await expect(client.check(request)).rejects.toThrow(message);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    "project-not-found",
    "project-version-not-found",
    "dependency-not-found",
    "dependency-version-not-covered",
    "recommendation-only",
    "bundle-only",
    "explicitly-unknown",
  ])("preserves the unknown diagnostic %s", async (reason) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...evidence,
          compatible: "unknown",
          reason,
        }),
      ),
    );
    await expect(client.check(request)).resolves.toMatchObject({
      compatible: "unknown",
      reason,
    });
  });

  it("retries transient server failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(Response.json(evidence));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client.check(request)).resolves.toMatchObject({
      compatible: "compatible",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent HTTP failures or expose response bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("private upstream detail", { status: 400 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(client.check(request)).rejects.toThrow(
      /^compatibility.fyi returned HTTP 400$/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
