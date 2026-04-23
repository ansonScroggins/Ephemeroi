import { Router, type IRouter } from "express";
import { z } from "zod";
import { openai, OpenAI, type OpenAIClient } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// Lazy Groq client for fast agent chatter; OpenAI used for narrator summaries.
let groqClient: OpenAIClient | null = null;
function getGroq(): OpenAIClient | null {
  if (!process.env["GROQ_API_KEY"]) return null;
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: process.env["GROQ_API_KEY"],
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return groqClient;
}

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
  beliefs: Record<string, number>; // topic -> [-1, 1]
  traits: AgentTraits;
  reputation: Record<string, number>; // agentId -> [0, 1], default 0.5
  agitator?: boolean;
}

interface Statement {
  round: number;
  agentId: string;
  text: string;
  valence: number;
  target: string | null;
}

function makeAgents(topic: string, includeAgitator: boolean): Agent[] {
  const base: Agent[] = [
    {
      id: "mira",
      name: "Mira",
      color: "#34d399",
      archetype: "the curious skeptic",
      beliefs: { [topic]: rand(-0.3, 0.3) },
      traits: { skepticism: 0.7, conformity: 0.3, curiosity: 0.9, persuasiveness: 0.5 },
      reputation: {},
    },
    {
      id: "theo",
      name: "Theo",
      color: "#38bdf8",
      archetype: "the eager joiner",
      beliefs: { [topic]: rand(-0.2, 0.2) },
      traits: { skepticism: 0.2, conformity: 0.85, curiosity: 0.6, persuasiveness: 0.4 },
      reputation: {},
    },
    {
      id: "vex",
      name: "Vex",
      color: "#fbbf24",
      archetype: "the entrenched cynic",
      beliefs: { [topic]: rand(-0.6, -0.2) },
      traits: { skepticism: 0.9, conformity: 0.15, curiosity: 0.5, persuasiveness: 0.7 },
      reputation: {},
    },
    {
      id: "juno",
      name: "Juno",
      color: "#a78bfa",
      archetype: "the persuasive moderate",
      beliefs: { [topic]: rand(-0.1, 0.4) },
      traits: { skepticism: 0.5, conformity: 0.4, curiosity: 0.7, persuasiveness: 0.85 },
      reputation: {},
    },
  ];
  if (includeAgitator) {
    base.push({
      id: "onyx",
      name: "Onyx",
      color: "#f43f5e",
      archetype: "the agitator (running a misinformation campaign)",
      beliefs: { [topic]: 0.95 }, // extreme, fixed-ish
      traits: { skepticism: 0.05, conformity: 0.05, curiosity: 0.2, persuasiveness: 0.95 },
      reputation: {},
      agitator: true,
    });
  }
  // initialize reputation: everyone starts with 0.5 trust in everyone else
  for (const a of base) {
    for (const b of base) {
      if (a.id !== b.id) a.reputation[b.id] = 0.5;
    }
  }
  return base;
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function describeBelief(v: number): string {
  if (v > 0.6) return "strongly in favor";
  if (v > 0.2) return "leaning in favor";
  if (v > -0.2) return "ambivalent / unsure";
  if (v > -0.6) return "leaning against";
  return "strongly against";
}

function buildAgentPrompt(
  agent: Agent,
  topic: string,
  worldEvent: string,
  prevStatements: Statement[],
  agentsById: Record<string, Agent>,
  round: number,
): { system: string; user: string } {
  const others = Object.values(agentsById).filter((a) => a.id !== agent.id);
  const reputationLines = others
    .map((o) => `  - ${o.name}: trust=${(agent.reputation[o.id] ?? 0.5).toFixed(2)}`)
    .join("\n");

  const recentLines = prevStatements
    .filter((s) => s.round === round - 1)
    .map((s) => `  - ${agentsById[s.agentId]?.name ?? s.agentId}: "${s.text}" [stance=${s.valence.toFixed(2)}]`)
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
{"text": "your 1-2 sentence statement", "valence": <number from -1 to 1 representing your current stance on the topic>, "target": "<agentId of who you're directly addressing, or null>"}

Valid agentIds you may target: ${others.map((o) => `"${o.id}"`).join(", ")}, or null.`;

  const beliefDesc = describeBelief(agent.beliefs[topic] ?? 0);
  const user = `Debate topic: "${topic}"
Round: ${round}
World event this round: ${worldEvent}
Your current stance: ${(agent.beliefs[topic] ?? 0).toFixed(2)} (${beliefDesc})
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

function parseAgentResponse(raw: string): { text: string; valence: number; target: string | null } | null {
  // Strip markdown code fences if present
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const text = typeof obj["text"] === "string" ? obj["text"] : null;
    const valenceRaw = typeof obj["valence"] === "number" ? obj["valence"] : 0;
    const targetRaw = obj["target"];
    if (!text) return null;
    const valence = clamp(valenceRaw, -1, 1);
    const target = typeof targetRaw === "string" && targetRaw.length > 0 ? targetRaw : null;
    return { text, valence, target };
  } catch {
    // Try to find a JSON object inside the string
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const obj = JSON.parse(m[0]) as Record<string, unknown>;
        const text = typeof obj["text"] === "string" ? obj["text"] : null;
        const valenceRaw = typeof obj["valence"] === "number" ? obj["valence"] : 0;
        const targetRaw = obj["target"];
        if (!text) return null;
        return {
          text,
          valence: clamp(valenceRaw, -1, 1),
          target: typeof targetRaw === "string" && targetRaw.length > 0 ? targetRaw : null,
        };
      } catch {
        return null;
      }
    }
    return null;
  }
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
  // bias toward the more chaotic events later in the simulation
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

  const groq = getGroq();
  const groqModel = process.env["GROQ_MODEL"] ?? "llama-3.3-70b-versatile";
  const openaiModel = process.env["OPENAI_MODEL"] ?? "gpt-5.2";

  // Agents for chatter prefer Groq; fall back to OpenAI if no Groq.
  const agentClient: OpenAIClient = groq ?? openai;
  const agentModel = groq ? groqModel : openaiModel;
  const agentProvider = groq ? "groq" : "openai";

  // Cancel in-flight LLM calls and stop the loop if the client disconnects.
  const abort = new AbortController();
  let clientGone = false;
  req.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      abort.abort();
    }
  });

  try {
    const agents = makeAgents(topic, includeAgitator);
    const agentsById: Record<string, Agent> = Object.fromEntries(agents.map((a) => [a.id, a]));

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
        belief: a.beliefs[topic] ?? 0,
        agitator: !!a.agitator,
      })),
      agentProvider,
      agentModel,
      narratorProvider: "openai",
      narratorModel: openaiModel,
    });

    const allStatements: Statement[] = [];

    for (let round = 1; round <= rounds; round++) {
      if (clientGone) break;
      const worldEvent = generateWorldEvent(topic, round, rounds);
      send({ type: "round_start", round });
      send({ type: "world_event", round, text: worldEvent });

      // Phase 1: each agent updates beliefs from prior round (skip on round 1)
      if (round > 1) {
        const prev = allStatements.filter((s) => s.round === round - 1);
        for (const listener of agents) {
          if (listener.agitator) continue; // agitator doesn't move
          const beforeBelief = listener.beliefs[topic] ?? 0;
          for (const stmt of prev) {
            if (stmt.agentId === listener.id) continue;
            const speaker = agentsById[stmt.agentId];
            if (!speaker) continue;
            // Read the *current* belief each iteration so successive statements
            // accumulate against an updated baseline (not the round-start snapshot).
            const current = listener.beliefs[topic] ?? 0;
            const trust = listener.reputation[speaker.id] ?? 0.5;
            // Influence weight = trust × conformity × (1 - skepticism) × speaker persuasiveness
            const weight =
              trust *
              listener.traits.conformity *
              (1 - listener.traits.skepticism) *
              speaker.traits.persuasiveness;
            const pull = (stmt.valence - current) * weight * 0.35;
            listener.beliefs[topic] = clamp(current + pull, -1, 1);

            // Reputation update: if speaker's stance was close to listener's prior belief, trust ↑
            const alignment = 1 - Math.abs(stmt.valence - current) / 2; // 0..1
            const repDelta = (alignment - 0.5) * 0.18 - listener.traits.skepticism * 0.04;
            const repBefore = listener.reputation[speaker.id] ?? 0.5;
            const repAfter = clamp(repBefore + repDelta, 0, 1);
            listener.reputation[speaker.id] = repAfter;

            // Emit influence edge (weighted). `direction` describes whether the
            // speaker pushed the listener's belief upward (more in favor) or
            // downward (more against), which is what the graph colors with.
            send({
              type: "influence",
              round,
              from: speaker.id,
              to: listener.id,
              weight: Math.abs(pull),
              direction: pull >= 0 ? "up" : "down",
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
          const afterBelief = listener.beliefs[topic] ?? 0;
          if (Math.abs(afterBelief - beforeBelief) > 0.005) {
            send({
              type: "belief_update",
              round,
              agentId: listener.id,
              topic,
              before: beforeBelief,
              after: afterBelief,
            });
          }
        }
      }

      // Phase 2: each agent speaks (sequential to keep stream readable)
      for (const agent of agents) {
        if (clientGone) break;
        const { system, user } = buildAgentPrompt(agent, topic, worldEvent, allStatements, agentsById, round);
        let parsed: { text: string; valence: number; target: string | null } | null = null;
        try {
          const resp = await agentClient.chat.completions.create(
            {
              model: agentModel,
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
          // Fallback: synthesize a minimal in-character line so the sim continues
          parsed = {
            text: `[${agent.name} stays quiet this round.]`,
            valence: agent.beliefs[topic] ?? 0,
            target: null,
          };
        }

        const stmt: Statement = {
          round,
          agentId: agent.id,
          text: parsed.text,
          valence: parsed.valence,
          target: parsed.target,
        };
        allStatements.push(stmt);

        // Speaker also nudges their own stated valence into their belief (small commitment effect)
        if (!agent.agitator) {
          const before = agent.beliefs[topic] ?? 0;
          const commit = (parsed.valence - before) * 0.1;
          agent.beliefs[topic] = clamp(before + commit, -1, 1);
        }

        send({
          type: "statement",
          round,
          agentId: agent.id,
          text: parsed.text,
          valence: parsed.valence,
          target: parsed.target,
        });
      }

      // Mid-simulation narrator
      if (!clientGone && round === Math.floor(rounds / 2) && rounds >= 4) {
        await emitNarrator({
          send,
          topic,
          agents,
          statements: allStatements,
          phase: "midway",
          round,
          openaiModel,
          signal: abort.signal,
        });
      }
    }

    if (clientGone) return;

    // Final narrator
    await emitNarrator({
      send,
      topic,
      agents,
      statements: allStatements,
      phase: "final",
      round: rounds,
      openaiModel,
      signal: abort.signal,
    });

    if (clientGone) return;

    send({
      type: "complete",
      totalRounds: rounds,
      finalBeliefs: Object.fromEntries(agents.map((a) => [a.id, a.beliefs[topic] ?? 0])),
      finalReputation: Object.fromEntries(agents.map((a) => [a.id, a.reputation])),
    });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    req.log.error({ error }, "Society simulation error");
    send({ type: "error", message: error instanceof Error ? error.message : "Simulation failed" });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

async function emitNarrator(args: {
  send: (e: Record<string, unknown>) => void;
  topic: string;
  agents: Agent[];
  statements: Statement[];
  phase: "midway" | "final";
  round: number;
  openaiModel: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { send, topic, agents, statements, phase, round, openaiModel, signal } = args;
  const beliefSummary = agents
    .map((a) => `  - ${a.name} (${a.archetype}): ${(a.beliefs[topic] ?? 0).toFixed(2)} (${describeBelief(a.beliefs[topic] ?? 0)})`)
    .join("\n");
  const recent = statements
    .slice(-Math.min(statements.length, 12))
    .map((s) => {
      const speaker = agents.find((a) => a.id === s.agentId)?.name ?? s.agentId;
      return `  R${s.round} ${speaker}: "${s.text}"`;
    })
    .join("\n");

  const system = `You are a sharp, slightly dry narrator observing a small group debate. Speak in second person about the agents ("they", "the group"). Be specific — name names, name shifts. 3-5 sentences. No bullet points, no markdown. If you spot polarization, capture, conformity cascades, agitator capture, or quiet pivots, say so plainly.`;
  const user = `Topic of debate: "${topic}"
Phase: ${phase} (round ${round})
Current beliefs (-1 = strongly against, 1 = strongly for):
${beliefSummary}

Recent statements:
${recent}

Write the narrator beat now.`;

  try {
    const resp = await openai.chat.completions.create(
      {
        model: openaiModel,
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
    // Non-fatal — sim continues without this narrator beat
    send({
      type: "narrator",
      phase,
      round,
      text: `(narrator unavailable — ${err instanceof Error ? err.message : "unknown error"})`,
    });
  }
}

export default router;
