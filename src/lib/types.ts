// ─── Ox Alpha shared types (safe for client import — type-only usage) ───

export type Complexity = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ModelInfo = { id: string; name?: string };

/** Token counts from an OpenAI-compatible completion response. */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ProviderConfigDTO = {
  id: string;
  name: string | null;
  baseUrl: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  apiKeyHint: string | null;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Per-agent resolution preview shown in UI */
export type ResolvedPreview = {
  baseUrl: string | null;
  model: string | null;
  keySource: "custom" | "linked" | "default" | "none";
  complete: boolean;
};

export type AgentDTO = {
  id: string;
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
  providerConfigId: string | null;
  customBaseUrl: string | null;
  customModel: string | null;
  customApiKeyHint: string | null;
  hasCustomApiKey: boolean;
  hasCustomSettings: boolean;
  resolved: ResolvedPreview;
  createdAt: string;
  updatedAt: string;
};

/** A curated model the user made available for the orchestrator to assign per agent. */
export type AvailableModelDTO = {
  id: string;
  label: string;
  model: string;
  providerConfigId: string | null;
  providerLabel: string;
  usesDefaultProvider: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Orchestrator's per-agent model recommendation with a reason. */
export type ModelSelection = {
  slug: string;
  modelId: string;
  reason: string;
};

/** A specialist agent the orchestrator wants but that does not exist yet. */
export type ProposedAgent = {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
};

export type OrchestratorAnalysis = {
  topic: string;
  goal: string;
  complexity: Complexity;
  riskLevel: RiskLevel;
  missingInfo: string[];
  selectedAgents: { slug: string; reason: string }[];
  executionOrder: string[];
  /** Agents the orchestrator suggests creating because none fit the question. */
  proposedAgents: ProposedAgent[];
  /** Per-agent model recommendation (from the curated available models), with reasons. */
  modelSelections: ModelSelection[];
};

export type SpecialistOutput = {
  analysis: string;
  recommendations: string[];
  risks: string[];
  confidence: number;
};

export type ConsolidatedRisk = {
  risk: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
};

export type ActionItem = {
  step: string;
  detail: string;
  priority: "high" | "medium" | "low";
};

export type JudgeOutput = {
  summary: string;
  finalAnswer: string;
  consolidatedRisks: ConsolidatedRisk[];
  actionItems: ActionItem[];
  notes: string;
};

export type DecisionStatus =
  | "pending"
  | "orchestrating"
  | "executing"
  | "judging"
  | "completed"
  | "failed";

export type StepStatus = "pending" | "running" | "retrying" | "completed" | "failed";

export type DecisionStepDTO = {
  id: string;
  agentSlug: string;
  agentName: string;
  orderIndex: number;
  status: StepStatus;
  output: SpecialistOutput | null;
  error: string | null;
  durationMs: number | null;
  usage: TokenUsage | null;
};

export type DecisionListItem = {
  id: string;
  title: string | null;
  question: string;
  status: DecisionStatus;
  createdAt: string;
  stepsCount: number;
};

export type DecisionDetailDTO = {
  id: string;
  title: string | null;
  question: string;
  status: DecisionStatus;
  orchestratorAnalysis: OrchestratorAnalysis | null;
  steps: DecisionStepDTO[];
  judge: JudgeOutput | null;
  finalAnswer: string | null;
  error: string | null;
  failedStage: string | null;
  modelUsed: string | null;
  usage: TokenUsage | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
};
