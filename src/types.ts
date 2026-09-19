export type CompatibilityStatus = "compatible" | "incompatible" | "unknown";
export type CompatibilityBasis =
  "supported" | "tested" | "recommended" | "bundled";
export type ConfidenceLevel = "low" | "medium" | "high";
export type CompatibilityUnknownReason =
  | "project-not-found"
  | "project-version-not-found"
  | "dependency-not-found"
  | "dependency-version-not-covered"
  | "recommendation-only"
  | "bundle-only"
  | "explicitly-unknown";
export type GatePolicy = "allow" | "warn" | "block";
export type CommitState = "error" | "failure" | "pending" | "success";
export type DecisionState = Exclude<CommitState, "pending"> | "warning";

export interface CompatibilitySource {
  title: string;
  url: string;
  accessedAt?: string;
}

export interface CompatibilityCheckResponse {
  project: string;
  version: string;
  dependency: string;
  dependencyVersion: string;
  compatible: CompatibilityStatus;
  reason?: CompatibilityUnknownReason | null;
  matchedRange: string | null;
  matchedConstraint?: "same-version" | null;
  basis?: CompatibilityBasis | null;
  relationship: string | null;
  confidence: ConfidenceLevel;
  lastVerified: string | null;
  notes: string[];
  sources: CompatibilitySource[];
}

export interface HelmChartSource {
  repository: string;
  chart: string;
}

export interface ValueSelector {
  files: string[];
  document?: Record<string, string | number | boolean>;
  value: string;
  extract?: string;
  helm?: HelmChartSource;
}

export interface GatePolicyConfig {
  unknown: GatePolicy;
  apiError: GatePolicy;
  minimumConfidence: ConfidenceLevel;
  maximumEvidenceAgeDays?: number;
}

export interface GateDefinition {
  id: string;
  project: {
    id: string;
    version: ValueSelector;
  };
  dependency: {
    id: string;
    versions: ValueSelector;
  };
  policy: GatePolicyConfig;
}

export interface GateConfiguration {
  version: 1;
  api: {
    url: string;
    timeoutMs: number;
    retries: number;
  };
  gates: GateDefinition[];
}

export interface RepositoryReader {
  listFiles(ref: string): Promise<string[]>;
  readFile(ref: string, path: string): Promise<string>;
}

export interface CheckDecision {
  state: DecisionState;
  gateId: string;
  project: string;
  projectVersion: string;
  dependency: string;
  dependencyVersion: string;
  message: string;
  response?: CompatibilityCheckResponse;
}

export interface GateEvaluation {
  gateId: string;
  applicable: boolean;
  decisions: CheckDecision[];
  message: string;
}

export interface BranchEvaluation {
  branch: string;
  sha: string;
  state: DecisionState;
  description: string;
  gates: GateEvaluation[];
}

export interface RepositoryBranch {
  name: string;
  sha: string;
}
