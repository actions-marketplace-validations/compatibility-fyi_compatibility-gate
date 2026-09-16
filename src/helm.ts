import { parseDocument } from "yaml";

import { readLimitedText } from "./http.js";
import type { HelmChartSource } from "./types.js";

const maximumIndexBytes = 32 * 1024 * 1024;
const exactChartVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export class HelmAppVersionResolver {
  private readonly indexes = new Map<
    string,
    Promise<Record<string, unknown>>
  >();

  constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  async resolve(
    source: HelmChartSource,
    chartVersion: string,
  ): Promise<string> {
    if (!exactChartVersion.test(chartVersion)) {
      throw new Error(
        `Helm chart ${source.chart} requires an exact chart version, received ${JSON.stringify(chartVersion)}`,
      );
    }
    const indexUrl = `${source.repository.replace(/\/+$/, "")}/index.yaml`;
    let index = this.indexes.get(indexUrl);
    if (!index) {
      index = this.loadIndex(indexUrl);
      this.indexes.set(indexUrl, index);
    }
    const entries = await index;
    const chart = Object.hasOwn(entries, source.chart)
      ? entries[source.chart]
      : undefined;
    if (!Array.isArray(chart)) {
      throw new Error(`Helm index has no entries for chart ${source.chart}`);
    }

    const applicationVersions = new Set<string>();
    for (const entry of chart) {
      if (!isRecord(entry) || typeof entry.version !== "string") {
        throw new Error(
          `Helm index contains an invalid version entry for ${source.chart}`,
        );
      }
      if (entry.version !== chartVersion) {
        continue;
      }
      if (typeof entry.appVersion !== "string" || !entry.appVersion.trim()) {
        throw new Error(
          `Helm chart ${source.chart} ${chartVersion} has no non-empty appVersion`,
        );
      }
      applicationVersions.add(entry.appVersion.trim());
    }
    if (applicationVersions.size === 0) {
      throw new Error(
        `Helm chart ${source.chart} ${chartVersion} was not found in ${indexUrl}`,
      );
    }
    if (applicationVersions.size !== 1) {
      throw new Error(
        `Helm chart ${source.chart} ${chartVersion} has conflicting appVersion metadata`,
      );
    }
    return [...applicationVersions][0]!;
  }

  private async loadIndex(url: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImplementation(url, {
      headers: {
        Accept: "application/yaml, text/yaml, text/plain",
        "User-Agent": "compatibility-fyi-gate",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readLimitedText(
      response,
      maximumIndexBytes,
      "Helm index",
    );
    if (!response.ok) {
      throw new Error(`Helm index returned HTTP ${response.status}`);
    }
    const document = parseDocument(body, { prettyErrors: false });
    if (document.errors.length > 0) {
      throw new Error("Helm index contains invalid YAML");
    }
    const index: unknown = document.toJS({ maxAliasCount: 100 });
    if (
      !isRecord(index) ||
      index.apiVersion !== "v1" ||
      !isRecord(index.entries)
    ) {
      throw new Error(
        "Helm index must contain apiVersion v1 and an entries mapping",
      );
    }
    return index.entries;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
