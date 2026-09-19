import { describe, expect, it, vi } from "vitest";

import { HelmAppVersionResolver } from "../src/helm.js";
import { resolveSelector } from "../src/selectors.js";
import { cluster, MemoryRepository } from "./helpers.js";

describe("resolveSelector", () => {
  it("selects matching YAML documents and extracts image versions", async () => {
    const reader = new MemoryRepository({
      head: {
        "clusters/one.yaml": `${cluster("18.4")}---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ignored\n`,
        "clusters/two.yaml": cluster("17.10"),
        "other.yaml": cluster("16.7"),
      },
    });

    await expect(
      resolveSelector(reader, "head", {
        files: ["clusters/*.yaml"],
        document: {
          apiVersion: "postgresql.cnpg.io/v1",
          kind: "Cluster",
        },
        value: "spec.imageName",
        extract: ":(?<version>[^@]+)$",
      }),
    ).resolves.toEqual(["18.4", "17.10"]);
  });

  it("deduplicates identical selected versions", async () => {
    const reader = new MemoryRepository({
      head: {
        "clusters/one.yaml": cluster("18.4"),
        "clusters/two.yaml": cluster("18.4"),
      },
    });

    await expect(
      resolveSelector(reader, "head", {
        files: ["clusters/**"],
        value: "spec.imageName",
        extract: ":(.*)$",
      }),
    ).resolves.toEqual(["18.4"]);
  });

  it("fails when an extract expression matches without capturing a version", async () => {
    const reader = new MemoryRepository({
      head: { "cluster.yaml": cluster("18.4") },
    });

    await expect(
      resolveSelector(reader, "head", {
        files: ["cluster.yaml"],
        value: "spec.imageName",
        extract: "18\\.4$",
      }),
    ).rejects.toThrow("must provide a named version group or capture");
  });

  it.each(["toString", "constructor", "__proto__"])(
    "selects only an explicit document property named %s",
    async (property) => {
      const reader = new MemoryRepository({
        head: { "versions.yaml": `{}\n---\n${property}: 1.2.3\n` },
      });
      await expect(
        resolveSelector(reader, "head", {
          files: ["versions.yaml"],
          value: property,
        }),
      ).resolves.toEqual(["1.2.3"]);
    },
  );
  it("resolves extracted base and head chart versions through a shared Helm index", async () => {
    const reader = new MemoryRepository({
      base: { "release.yaml": "chart: chart-10.3.1" },
      head: { "release.yaml": "chart: chart-10.3.2\n---\nchart: chart-10.3.3" },
    });
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          apiVersion: "v1",
          entries: {
            gitlab: [
              { version: "10.3.1", appVersion: "19.3.1" },
              { version: "10.3.2", appVersion: "19.3.2" },
              { version: "10.3.3", appVersion: "19.3.2" },
            ],
          },
        }),
      ),
    );
    const resolver = new HelmAppVersionResolver(fetchImplementation);
    const selector = {
      files: ["release.yaml"],
      value: "chart",
      extract: "^chart-(?<version>.*)$",
      helm: { repository: "https://charts.gitlab.io", chart: "gitlab" },
    };
    await expect(
      Promise.all([
        resolveSelector(reader, "base", selector, resolver),
        resolveSelector(reader, "head", selector, resolver),
      ]),
    ).resolves.toEqual([["19.3.1"], ["19.3.2"]]);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
