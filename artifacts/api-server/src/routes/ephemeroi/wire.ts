import type {
  ObservationRow,
  BeliefRow,
  ContradictionRow,
  ReportRow,
  SourceRow,
  SettingsRow,
} from "./store";

export interface ObservationWire {
  id: number;
  sourceId: number | null;
  sourceKind: "rss" | "url" | "search" | "github" | "github_user";
  sourceLabel: string;
  title: string;
  snippet: string;
  url: string | null;
  novelty: number;
  importance: number;
  observedAt: string;
  reflectedAt: string | null;
}

export function observationToWire(o: ObservationRow): ObservationWire {
  return {
    id: o.id,
    sourceId: o.sourceId,
    sourceKind: o.sourceKind,
    sourceLabel: o.sourceLabel,
    title: o.title,
    snippet: o.snippet,
    url: o.url,
    novelty: o.novelty,
    importance: o.importance,
    observedAt: o.observedAt.toISOString(),
    reflectedAt: o.reflectedAt ? o.reflectedAt.toISOString() : null,
  };
}

export interface BeliefWire {
  id: number;
  proposition: string;
  confidence: number;
  supportCount: number;
  contradictCount: number;
  firstSeenAt: string;
  lastUpdatedAt: string;
}

export function beliefToWire(b: BeliefRow): BeliefWire {
  return {
    id: b.id,
    proposition: b.proposition,
    confidence: b.confidence,
    supportCount: b.supportCount,
    contradictCount: b.contradictCount,
    firstSeenAt: b.firstSeenAt.toISOString(),
    lastUpdatedAt: b.lastUpdatedAt.toISOString(),
  };
}

export interface ContradictionWire {
  id: number;
  beliefId: number | null;
  beliefProposition: string | null;
  observationId: number | null;
  summary: string;
  resolved: boolean;
  detectedAt: string;
}

export function contradictionToWire(c: ContradictionRow): ContradictionWire {
  return {
    id: c.id,
    beliefId: c.beliefId,
    beliefProposition: c.beliefProposition,
    observationId: c.observationId,
    summary: c.summary,
    resolved: c.resolved,
    detectedAt: c.detectedAt.toISOString(),
  };
}

export interface ReportWire {
  id: number;
  importance: number;
  headline: string;
  body: string;
  observationIds: number[];
  delivered: boolean;
  deliveredAt: string | null;
  createdAt: string;
}

export function reportToWire(r: ReportRow): ReportWire {
  return {
    id: r.id,
    importance: r.importance,
    headline: r.headline,
    body: r.body,
    observationIds: r.observationIds,
    delivered: r.delivered,
    deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface SourceWire {
  id: number;
  kind: "rss" | "url" | "search" | "github" | "github_user";
  label: string;
  target: string;
  active: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export function sourceToWire(s: SourceRow): SourceWire {
  return {
    id: s.id,
    kind: s.kind,
    label: s.label,
    target: s.target,
    active: s.active,
    lastPolledAt: s.lastPolledAt ? s.lastPolledAt.toISOString() : null,
    lastError: s.lastError,
    createdAt: s.createdAt.toISOString(),
  };
}

export interface SettingsWire {
  intervalSeconds: number;
  importanceThreshold: number;
  paused: boolean;
  telegramEnabled: boolean;
  novelty: { weight: number; decay: number };
}

export function settingsToWire(s: SettingsRow): SettingsWire {
  return {
    intervalSeconds: s.intervalSeconds,
    importanceThreshold: s.importanceThreshold,
    paused: s.paused,
    telegramEnabled: s.telegramEnabled,
    novelty: { weight: s.noveltyWeight, decay: s.noveltyDecay },
  };
}
