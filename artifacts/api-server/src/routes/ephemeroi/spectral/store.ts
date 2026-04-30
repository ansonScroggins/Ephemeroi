/**
 * Persistence helpers for spectral operator invocations.
 */
import {
  db,
  ephemeroiSpectralInvocationsTable,
} from "@workspace/db";
import { desc } from "drizzle-orm";
import type {
  InvocationRecord,
  PersonaWeights,
  PhaseState,
  SpectralPhase,
} from "./types";

interface InsertInput {
  operator: string;
  signature: SpectralPhase[];
  planet: SpectralPhase;
  personaWeights: PersonaWeights;
  selectionReason: string | null;
  phaseStateBefore: PhaseState;
  phaseStateAfter: PhaseState | null;
  effect: Record<string, unknown>;
  narration: string;
  success: boolean;
  error: string | null;
}

export async function insertInvocation(
  input: InsertInput,
): Promise<InvocationRecord> {
  const inserted = await db
    .insert(ephemeroiSpectralInvocationsTable)
    .values({
      operator: input.operator,
      signature: input.signature,
      planet: input.planet,
      personaWeights: input.personaWeights,
      selectionReason: input.selectionReason,
      phaseStateBefore: input.phaseStateBefore,
      phaseStateAfter: input.phaseStateAfter,
      effect: input.effect,
      narration: input.narration,
      success: input.success,
      error: input.error,
    })
    .returning();
  return rowToRecord(inserted[0]!);
}

export async function listInvocations(
  limit: number,
): Promise<InvocationRecord[]> {
  const rows = await db
    .select()
    .from(ephemeroiSpectralInvocationsTable)
    .orderBy(desc(ephemeroiSpectralInvocationsTable.invokedAt))
    .limit(Math.max(1, Math.min(200, limit)));
  return rows.map(rowToRecord);
}

function rowToRecord(
  r: typeof ephemeroiSpectralInvocationsTable.$inferSelect,
): InvocationRecord {
  return {
    id: r.id,
    operator: r.operator,
    signature: (r.signature as SpectralPhase[]) ?? [],
    planet: r.planet as SpectralPhase,
    personaWeights: r.personaWeights as PersonaWeights,
    selectionReason: r.selectionReason ?? null,
    phaseStateBefore: r.phaseStateBefore as PhaseState,
    phaseStateAfter: (r.phaseStateAfter as PhaseState | null) ?? null,
    effect: (r.effect as Record<string, unknown>) ?? {},
    narration: r.narration,
    success: r.success,
    error: r.error ?? null,
    invokedAt: r.invokedAt,
  };
}
