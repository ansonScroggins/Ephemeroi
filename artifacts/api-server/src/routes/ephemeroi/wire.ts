import type {
  ObservationRow,
  BeliefRow,
  ContradictionRow,
  ReportRow,
  SourceRow,
  SourceStateRow,
  SettingsRow,
  TopicBeliefRow,
} from "./store";

export interface ObservationWire {
  id: number;
  sourceId: number | null;
  sourceKind: "rss" | "url" | "search" | "github" | "github_user" | "gh_archive" | "stream";
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
  kind: "rss" | "url" | "search" | "github" | "github_user" | "gh_archive" | "stream";
  label: string;
  target: string;
  active: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  autoAdded: boolean;
  autoAddedReason: string | null;
  autoAddedAt: string | null;
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
    autoAdded: s.autoAdded,
    autoAddedReason: s.autoAddedReason,
    autoAddedAt: s.autoAddedAt ? s.autoAddedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * Per-source 4D state vector (Capability / Integrity / Usability / Trust)
 * plus the most-recent delta vector and a one-line insight from the event
 * that produced it. The Sources page renders this as a 4-bar mini-display
 * with arrows showing direction of last move.
 */
export interface SourceStateWire {
  sourceId: number;
  vector: {
    capability: number;
    integrity: number;
    usability: number;
    trust: number;
  };
  lastDelta: {
    capability: number;
    integrity: number;
    usability: number;
    trust: number;
  };
  lastInsight: string | null;
  lastEventObservationId: number | null;
  lastEventAt: string | null;
  updatedAt: string;
}

export function sourceStateToWire(s: SourceStateRow): SourceStateWire {
  return {
    sourceId: s.sourceId,
    vector: {
      capability: s.capability,
      integrity: s.integrity,
      usability: s.usability,
      trust: s.trust,
    },
    lastDelta: {
      capability: s.lastDeltaCapability,
      integrity: s.lastDeltaIntegrity,
      usability: s.lastDeltaUsability,
      trust: s.lastDeltaTrust,
    },
    lastInsight: s.lastInsight,
    lastEventObservationId: s.lastEventObservationId,
    lastEventAt: s.lastEventAt ? s.lastEventAt.toISOString() : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export interface SettingsWire {
  intervalSeconds: number;
  importanceThreshold: number;
  paused: boolean;
  telegramEnabled: boolean;
  novelty: { weight: number; decay: number };
  autonomy: { enabled: boolean; maxSources: number };
}

export function settingsToWire(s: SettingsRow): SettingsWire {
  return {
    intervalSeconds: s.intervalSeconds,
    importanceThreshold: s.importanceThreshold,
    paused: s.paused,
    telegramEnabled: s.telegramEnabled,
    novelty: { weight: s.noveltyWeight, decay: s.noveltyDecay },
    autonomy: { enabled: s.autonomyEnabled, maxSources: s.autonomyMaxSources },
  };
}

export interface TopicBeliefHistoryWire {
  stance: string;
  confidence: number;
  evidence?: string;
  sourceKind?: string;
  at: string;
}

export interface TopicBeliefWire {
  id: number;
  subject: string;
  subjectKey: string;
  stance: string;
  confidence: number;
  evidenceCount: number;
  /**
   * Number of times this opinion has flipped to the opposite stance over
   * its lifetime. Surfaced because oscillating beliefs are interesting on
   * their own — the UI shows a small flip badge.
   */
  flipCount: number;
  lastEvidence: string | null;
  lastSourceKind: string | null;
  history: TopicBeliefHistoryWire[];
  firstSeenAt: string;
  lastUpdatedAt: string;
}

/**
 * Map a TopicBeliefRow to its wire representation.
 *
 * NOTE: `lastQuestion` is intentionally NOT serialized. It's stored in the DB
 * for debugging / future use but never returned over HTTP, because the
 * /ephemeroi/* surface is currently unauthenticated and the raw question
 * text from a Telegram message can contain personal content. The other
 * fields (subject, stance, confidence, capped evidence summary) are
 * deliberately distilled / model-rewritten and safe to expose. If/when the
 * surface gets auth, we can add `lastQuestion` back behind it.
 */
export function topicBeliefToWire(b: TopicBeliefRow): TopicBeliefWire {
  return {
    id: b.id,
    subject: b.subject,
    subjectKey: b.subjectKey,
    stance: b.stance,
    confidence: b.confidence,
    evidenceCount: b.evidenceCount,
    flipCount: b.flipCount,
    lastEvidence: b.lastEvidence,
    lastSourceKind: b.lastSourceKind,
    history: b.history.map((h) => ({
      stance: h.stance,
      confidence: h.confidence,
      ...(h.evidence ? { evidence: h.evidence } : {}),
      ...(h.sourceKind ? { sourceKind: h.sourceKind } : {}),
      at: h.at,
    })),
    firstSeenAt: b.firstSeenAt.toISOString(),
    lastUpdatedAt: b.lastUpdatedAt.toISOString(),
  };
}
