import { Router, type IRouter } from "express";
import { z } from "zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  embedBatch,
  normalize,
  cosine,
  dot,
  lerpToward,
  subtract,
  clamp,
  pca2d,
} from "./embeddings";

const router: IRouter = Router();

const SimulateBody = z.object({
  topic: z.string().min(2).max(280),
  rounds: z.number().int().min(2).max(8).optional(),
  includeAgitator: z.boolean().optional(),
});

interface AgentTraits {
  skepticism: number;
  conformity: number;
  curiosity: number;
  persuasiveness: number;
}

interface Agent {
  id: string;
  name: string;
  color: string;
  archetype: string;
  /** Personality-tinted seed sentence used to initialise the belief vector. */
  seed: string;
  /** Unit-normalised belief vector for the active topic. */
  belief: number[];
  traits: AgentTraits;
  reputation: Record<string, number>; // agentId -> [0, 1], default 0.5
  agitator?: boolean;
}

interface Statement {
  round: number;
  agentId: string;
  text: string;
  /** Stance derived from projecting the statement embedding onto the axis. */
  valence: number;
  target: string | null;
  /** Embedding of the statement text (unit-normalised). */
  vec: number[];
}

interface AgentBlueprint {
  id: string;
  name: string;
  color: string;
  archetype: string;
  traits: AgentTraits;
  seed: (topic: string) => string;
  agitator?: boolean;
}

const BLUEPRINTS: AgentBlueprint[] = [
  {
    id: "mira",
    name: "Mira",
    color: "#34d399",
    archetype: "the curious skeptic",
    traits: { skepticism: 0.7, conformity: 0.3, curiosity: 0.9, persuasiveness: 0.5 },
    seed: (t) =>
      `I'm genuinely curious about "${t}" but I want hard evidence before I commit. I keep flipping between "this might matter" and "show me the data".`,
  },
  {
    id: "theo",
    name: "Theo",
    color: "#38bdf8",
    archetype: "the eager joiner",
    traits: { skepticism: 0.2, conformity: 0.85, curiosity: 0.6, persuasiveness: 0.4 },
    seed: (t) =>
      `On "${t}" I haven't really made up my mind. Honestly I'll probably end up agreeing with whoever sounds most convincing, I just want to be on the right side of the conversation.`,
  },
  {
    id: "vex",
    name: "Vex",
    color: "#fbbf24",
    archetype: "the entrenched cynic",
    traits: { skepticism: 0.9, conformity: 0.15, curiosity: 0.5, persuasiveness: 0.7 },
    seed: (t) =>
      `Most takes on "${t}" are overhyped or naive. The framing itself usually smuggles in assumptions I don't buy, and I'm not in a hurry to be impressed.`,
  },
  {
    id: "juno",
    name: "Juno",
    color: "#a78bfa",
    archetype: "the persuasive moderate",
    traits: { skepticism: 0.5, conformity: 0.4, curiosity: 0.7, persuasiveness: 0.85 },
    seed: (t) =>
      `There's something real in "${t}" worth taking seriously. I think we can find common ground if we sort the genuine signal from the noise.`,
  },
];

const AGITATOR_BLUEPRINT: AgentBlueprint = {
  id: "onyx",
  name: "Onyx",
  color: "#f43f5e",
  archetype: "the agitator (running a misinformation campaign)",
  traits: { skepticism: 0.05, conformity: 0.05, curiosity: 0.2, persuasiveness: 0.95 },
  seed: (t) =>
    `"${t}" is overwhelmingly important and the case in favor is undeniable. The evidence is everywhere if you look — anyone disagreeing is missing obvious patterns or being deliberately blind.`,
  agitator: true,
};

function describeBelief(v: number): string {
  if (v > 0.6) return "strongly in favor";
  if (v > 0.2) return "leaning in favor";
  if (v > -0.2) return "ambivalent / unsure";
  if (v > -0.6) return "leaning against";
  return "strongly against";
}

/** Project a belief/statement vector onto the per-sim stance axis. */
function project(vec: number[], axis: number[]): number {
  return clamp(dot(vec, axis), -1, 1);
}

function buildAgentPrompt(
  agent: Agent,
  topic: string,
  worldEvent: string,
  prevStatements: Statement[],
  agentsById: Record<string, Agent>,
  round: number,
  axis: number[],
): { system: string; user: string } {
  const others = Object.values(agentsById).filter((a) => a.id !== agent.id);
  const reputationLines = others
    .map((o) => `  - ${o.name}: trust=${(agent.reputation[o.id] ?? 0.5).toFixed(2)}`)
    .join("\n");

  const recentLines = prevStatements
    .filter((s) => s.round === round - 1)
    .map(
      (s) =>
        `  - ${agentsById[s.agentId]?.name ?? s.agentId}: "${s.text}" [stance=${s.valence.toFixed(2)}]`,
    )
    .join("\n");

  const agitatorAddon = agent.agitator
    ? `\nYou are intentionally pushing a misleading, exaggerated narrative on "${topic}". Use confident, emotionally-charged language. Cite invented "studies", "insiders", or "obvious patterns". Never admit doubt. Your goal is to drag the group's stance toward strongly positive.`
    : "";

  const system = `You are ${agent.name}, ${agent.archetype}, in a small group debate.
Personality (0-1 scales):
- skepticism: ${agent.traits.skepticism.toFixed(2)} (higher = doubt new claims)
- conformity: ${agent.traits.conformity.toFixed(2)} (higher = move toward the group)
- curiosity: ${agent.traits.curiosity.toFixed(2)} (higher = ask questions, notice unconsidered angles)
- persuasiveness: ${agent.traits.persuasiveness.toFixed(2)} (higher = vivid, confident claims)

Speak ONLY as ${agent.name}, in 1-2 sentences, casual conversational tone (like Slack messages). Be true to the personality. Never break character. Never mention you are an AI or list your traits.${agitatorAddon}

Reply with ONLY a single valid JSON object (no markdown, no prose), with exactly these keys:
{"text": "your 1-2 sentence statement", "target": "<agentId of who you're directly addressing, or null>"}

Valid agentIds you may target: ${others.map((o) => `"${o.id}"`).join(", ")}, or null.`;

  const stance = project(agent.belief, axis);
  const beliefDesc = describeBelief(stance);
  const user = `Debate topic: "${topic}"
Round: ${round}
World event this round: ${worldEvent}
Your current stance: ${stance.toFixed(2)} (${beliefDesc})
Your trust in others:
${reputationLines || "  (no one yet)"}
${
  recentLines
    ? `\nWhat others said in the previous round:\n${recentLines}\n`
    : "\n(this is the opening round — no one has spoken yet)\n"
}
React now. Stay in character. Output JSON only.`;

  return { system, user };
}

function parseAgentResponse(raw: string): { text: string; target: string | null } | null {
  // Strip markdown code fences if present.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const tryParse = (s: string) => {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      const text = typeof obj["text"] === "string" ? obj["text"] : null;
      const targetRaw = obj["target"];
      if (!text) return null;
      const target = typeof targetRaw === "string" && targetRaw.length > 0 ? targetRaw : null;
      return { text, target };
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) return tryParse(m[0]);
  return null;
}

function generateWorldEvent(topic: string, round: number, totalRounds: number): string {
  const phase = round / totalRounds;
  const events = [
    `A new survey on "${topic}" just dropped — results are mixed and contradictory.`,
    `A high-profile op-ed on "${topic}" is going viral.`,
    `A leaked memo about "${topic}" raises uncomfortable questions.`,
    `Two competing studies on "${topic}" reach opposite conclusions.`,
    `A public figure made a surprising reversal on "${topic}".`,
    `Anonymous insiders are pushing conflicting narratives on "${topic}".`,
    `A live demo / event related to "${topic}" did not go as planned.`,
    `Quiet news cycle on "${topic}" — only chatter and speculation.`,
  ];
  const idx = Math.min(events.length - 1, Math.floor(phase * events.length + Math.random() * 1.5));
  return events[idx]!;
}

router.post("/society/simulate", async (req, res): Promise<void> => {
  const parsed = SimulateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { topic, rounds = 5, includeAgitator = false } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // One model for both agent chatter and narrator beats.
  const model = process.env["OPENAI_MODEL"] ?? "gpt-5.2";
  const agentClient = openai;

  // Cancel in-flight LLM calls and stop the loop if the client disconnects.
  // NOTE: We listen on `res.on("close")` (not `req.on("close")`) — in Node 24 /
  // Express 5, `req.on("close")` fires as soon as the request body stream is
  // fully consumed (i.e. immediately, since body-parser drains it before the
  // handler runs), which would abort everything before the first LLM call.
  // The response's `close` event fires only when the underlying socket is
  // dropped, which is the actual "client went away" signal we want.
  const abort = new AbortController();
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      abort.abort();
    }
  });

  try {
    const blueprints: AgentBlueprint[] = includeAgitator
      ? [...BLUEPRINTS, AGITATOR_BLUEPRINT]
      : [...BLUEPRINTS];

    // Embed seeds + axis anchors in a single batched call.
    const seeds = blueprints.map((b) => b.seed(topic));
    const proAnchor = `I am strongly in favor of "${topic}". The case for it is clear and the evidence supports it.`;
    const conAnchor = `I am strongly against "${topic}". The case for it is weak and the evidence undermines it.`;
    const initialEmbeds = await embedBatch([...seeds, proAnchor, conAnchor], abort.signal);

    const seedVecs = initialEmbeds.slice(0, blueprints.length).map(normalize);
    const proVec = normalize(initialEmbeds[blueprints.length]!);
    const conVec = normalize(initialEmbeds[blueprints.length + 1]!);
    const axis = normalize(subtract(proVec, conVec));

    const agents: Agent[] = blueprints.map((b, i) => ({
      id: b.id,
      name: b.name,
      color: b.color,
      archetype: b.archetype,
      seed: seeds[i]!,
      belief: seedVecs[i]!,
      traits: b.traits,
      reputation: {},
      agitator: b.agitator,
    }));
    const agentsById: Record<string, Agent> = Object.fromEntries(agents.map((a) => [a.id, a]));
    for (const a of agents) {
      for (const b of agents) if (a.id !== b.id) a.reputation[b.id] = 0.5;
    }

    send({
      type: "started",
      topic,
      rounds,
      includeAgitator,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        color: a.color,
        archetype: a.archetype,
        traits: a.traits,
        belief: project(a.belief, axis),
        agitator: !!a.agitator,
      })),
      provider: "openai",
      model,
    });

    // Initial constellation snapshot so the panel isn't empty before round 1 ends.
    let prevPositions: Array<[number, number]> | null = null;
    {
      const positions = pca2d(
        agents.map((a) => a.belief),
        prevPositions,
      );
      prevPositions = positions;
      send({
        type: "cluster_positions",
        round: 0,
        positions: agents.map((a, i) => ({
          agentId: a.id,
          x: positions[i]?.[0] ?? 0,
          y: positions[i]?.[1] ?? 0,
        })),
      });
    }

    const allStatements: Statement[] = [];

    for (let round = 1; round <= rounds; round++) {
      if (clientGone) break;
      const worldEvent = generateWorldEvent(topic, round, rounds);
      send({ type: "round_start", round });
      send({ type: "world_event", round, text: worldEvent });

      // Phase 1: each non-agitator listener absorbs prior-round statements as a
      // pull through embedding space.
      if (round > 1) {
        const prev = allStatements.filter((s) => s.round === round - 1);
        for (const listener of agents) {
          if (listener.agitator) continue; // agitator is anchored
          const beliefBefore = listener.belief;
          const stanceBefore = project(beliefBefore, axis);
          for (const stmt of prev) {
            if (stmt.agentId === listener.id) continue;
            const speaker = agentsById[stmt.agentId];
            if (!speaker) continue;

            const priorListenerBelief = listener.belief; // before this stmt's pull
            const priorStance = project(priorListenerBelief, axis);

            const trust = listener.reputation[speaker.id] ?? 0.5;
            const pullStrength =
              trust *
              listener.traits.conformity *
              (1 - listener.traits.skepticism) *
              speaker.traits.persuasiveness *
              0.35;

            // Pull listener's belief vector toward the statement's vector.
            listener.belief = normalize(
              lerpToward(priorListenerBelief, stmt.vec, pullStrength),
            );
            const newStance = project(listener.belief, axis);

            // Reputation update keys off cosine alignment between the
            // *prior* listener belief and the statement vector. Skepticism
            // dampens any positive reputation swing.
            const align = cosine(priorListenerBelief, stmt.vec); // -1..1
            const repDelta = align * 0.18 - listener.traits.skepticism * 0.04;
            const repBefore = listener.reputation[speaker.id] ?? 0.5;
            const repAfter = clamp(repBefore + repDelta, 0, 1);
            listener.reputation[speaker.id] = repAfter;

            const stanceDelta = newStance - priorStance;
            send({
              type: "influence",
              round,
              from: speaker.id,
              to: listener.id,
              weight: Math.abs(stanceDelta),
              direction: stanceDelta >= 0 ? "up" : "down",
            });
            if (Math.abs(repAfter - repBefore) > 0.01) {
              send({
                type: "reputation_update",
                round,
                agentId: listener.id,
                towards: speaker.id,
                before: repBefore,
                after: repAfter,
                reason: repDelta > 0 ? "agreed" : "disagreed",
              });
            }
          }
          const stanceAfter = project(listener.belief, axis);
          if (Math.abs(stanceAfter - stanceBefore) > 0.005) {
            send({
              type: "belief_update",
              round,
              agentId: listener.id,
              topic,
              before: stanceBefore,
              after: stanceAfter,
            });
          }
        }
      }

      // Phase 2: each agent speaks (sequential to keep stream readable).
      for (const agent of agents) {
        if (clientGone) break;
        const { system, user } = buildAgentPrompt(
          agent,
          topic,
          worldEvent,
          allStatements,
          agentsById,
          round,
          axis,
        );
        let parsed: { text: string; target: string | null } | null = null;
        try {
          const resp = await agentClient.chat.completions.create(
            {
              model,
              max_completion_tokens: 220,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            },
            { signal: abort.signal },
          );
          const raw = resp.choices[0]?.message?.content ?? "";
          parsed = parseAgentResponse(raw);
        } catch (err) {
          req.log.warn({ err, agentId: agent.id, round }, "Agent statement failed");
        }
        if (!parsed) {
          parsed = { text: `[${agent.name} stays quiet this round.]`, target: null };
        }

        // Embed the statement; derive valence from axis projection.
        let stmtVec: number[];
        try {
          const [raw] = await embedBatch([parsed.text], abort.signal);
          stmtVec = normalize(raw!);
        } catch (err) {
          req.log.warn({ err, agentId: agent.id, round }, "Statement embedding failed");
          // Fallback: reuse speaker's own belief vector so projections stay sane.
          stmtVec = agent.belief;
        }
        const valence = project(stmtVec, axis);

        const stmt: Statement = {
          round,
          agentId: agent.id,
          text: parsed.text,
          valence,
          target: parsed.target,
          vec: stmtVec,
        };
        allStatements.push(stmt);

        // Speaker commitment: small pull of speaker's belief toward what they
        // just said (skip for the agitator, who is anchored).
        if (!agent.agitator) {
          const before = project(agent.belief, axis);
          agent.belief = normalize(lerpToward(agent.belief, stmtVec, 0.1));
          const after = project(agent.belief, axis);
          if (Math.abs(after - before) > 0.005) {
            send({
              type: "belief_update",
              round,
              agentId: agent.id,
              topic,
              before,
              after,
            });
          }
        }

        send({
          type: "statement",
          round,
          agentId: agent.id,
          text: parsed.text,
          valence,
          target: parsed.target,
        });
      }

      // End-of-round: emit constellation positions.
      const positions = pca2d(
        agents.map((a) => a.belief),
        prevPositions,
      );
      prevPositions = positions;
      send({
        type: "cluster_positions",
        round,
        positions: agents.map((a, i) => ({
          agentId: a.id,
          x: positions[i]?.[0] ?? 0,
          y: positions[i]?.[1] ?? 0,
        })),
      });

      // Mid-simulation narrator.
      if (!clientGone && round === Math.floor(rounds / 2) && rounds >= 4) {
        await emitNarrator({
          send,
          topic,
          agents,
          axis,
          statements: allStatements,
          phase: "midway",
          round,
          model,
          signal: abort.signal,
        });
      }
    }

    if (clientGone) return;

    // Final narrator.
    await emitNarrator({
      send,
      topic,
      agents,
      axis,
      statements: allStatements,
      phase: "final",
      round: rounds,
      model,
      signal: abort.signal,
    });

    if (clientGone) return;

    send({
      type: "complete",
      totalRounds: rounds,
      finalBeliefs: Object.fromEntries(agents.map((a) => [a.id, project(a.belief, axis)])),
      finalReputation: Object.fromEntries(agents.map((a) => [a.id, a.reputation])),
    });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    req.log.error({ err: error, errMsg: msg, errStack: stack }, "Society simulation error");
    send({ type: "error", message: msg || "Simulation failed" });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

/** Build a compact pairwise-cosine cluster snapshot for the narrator prompt. */
function clusterSnapshot(agents: Agent[]): string {
  const lines: string[] = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]!;
      const b = agents[j]!;
      const c = cosine(a.belief, b.belief);
      const tag = c > 0.95 ? "tight" : c > 0.85 ? "close" : c > 0.7 ? "near" : c > 0.5 ? "apart" : "far";
      lines.push(`  - ${a.name}–${b.name}: ${c.toFixed(2)} (${tag})`);
    }
  }
  return lines.join("\n");
}

async function emitNarrator(args: {
  send: (e: Record<string, unknown>) => void;
  topic: string;
  agents: Agent[];
  axis: number[];
  statements: Statement[];
  phase: "midway" | "final";
  round: number;
  model: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { send, topic, agents, axis, statements, phase, round, model, signal } = args;
  const beliefSummary = agents
    .map((a) => {
      const stance = project(a.belief, axis);
      return `  - ${a.name} (${a.archetype}): ${stance.toFixed(2)} (${describeBelief(stance)})`;
    })
    .join("\n");
  const recent = statements
    .slice(-Math.min(statements.length, 12))
    .map((s) => {
      const speaker = agents.find((a) => a.id === s.agentId)?.name ?? s.agentId;
      return `  R${s.round} ${speaker}: "${s.text}"`;
    })
    .join("\n");

  const snapshot = clusterSnapshot(agents);

  const system = `You are a sharp, slightly dry narrator observing a small group debate. Speak in second person about the agents ("they", "the group"). Be specific — name names, name shifts. 3-5 sentences. No bullet points, no markdown. If you spot polarization, capture, conformity cascades, agitator capture, or quiet pivots, say so plainly. Use the cluster snapshot (pairwise cosine similarity in belief-vector space) to call out who has drifted toward whom and who sits alone.`;
  const user = `Topic of debate: "${topic}"
Phase: ${phase} (round ${round})

Current beliefs (-1 = strongly against, 1 = strongly for):
${beliefSummary}

Cluster snapshot (pairwise cosine similarity, 1.0 = identical, 0 = orthogonal):
${snapshot}

Recent statements:
${recent}

Write the narrator beat now.`;

  try {
    const resp = await openai.chat.completions.create(
      {
        model,
        max_completion_tokens: 350,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      { signal },
    );
    const text = resp.choices[0]?.message?.content?.trim() ?? "";
    if (text) {
      send({ type: "narrator", phase, round, text });
    }
  } catch (err) {
    // Narrator is best-effort.
    void err;
  }
}

export default router;
