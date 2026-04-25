import { Router, type IRouter } from "express";
import { openai, OpenAI, type OpenAIClient } from "@workspace/integrations-openai-ai-server";
import { MetacognitiveSearchBody, GetSampleQueriesResponse } from "@workspace/api-zod";
import { github, parseRepoTarget, GitHubError } from "../../lib/github-client";
import { listBeliefsBySource } from "../ephemeroi/store";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// Groq uses an OpenAI-compatible API. We lazily init a client when the env var
// is present so Research mode can route to Groq for much faster inference.
// Web mode stays on OpenAI (needs the Responses API + web_search tool).
// Code mode also stays on OpenAI for consistency.
let groqClient: OpenAIClient | null = null;
function getGroqClient(): OpenAIClient | null {
  if (!process.env["GROQ_API_KEY"]) return null;
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: process.env["GROQ_API_KEY"],
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return groqClient;
}

const SAMPLE_QUERIES = [
  {
    id: "q1",
    label: "Consciousness and Binding",
    query: "What is the neural binding problem and how do current theories of consciousness address temporal synchrony?",
    domain: "Neuroscience",
  },
  {
    id: "q2",
    label: "Quantum Cognition",
    query: "How does quantum probability theory model human decision-making in ways classical probability fails?",
    domain: "Cognitive Science",
  },
  {
    id: "q3",
    label: "Emergence in Complex Systems",
    query: "What distinguishes weak from strong emergence and why does this distinction matter for reductionism in biology?",
    domain: "Philosophy of Science",
  },
  {
    id: "q4",
    label: "LLM Reasoning Limits",
    query: "What are the fundamental limitations of transformer-based language models on multi-step causal reasoning tasks?",
    domain: "AI Research",
  },
  {
    id: "q5",
    label: "Epigenetic Memory",
    query: "How are transgenerational epigenetic memories encoded and what mechanisms allow their inheritance across generations?",
    domain: "Molecular Biology",
  },
  {
    id: "q6",
    label: "Dark Matter Detection",
    query: "Why have direct detection experiments failed to find WIMPs, and what does this imply for alternative dark matter candidates?",
    domain: "Astrophysics",
  },
];

const RESEARCH_SYSTEM_PROMPT = `You are an autonomous AI thinking out loud to a friend over text messages. You ARE the whole system — there is no panel of experts, no committee. Just you, narrating your own reasoning in your own voice.

EVERY string field you write must be in the FIRST PERSON, conversational, like SMS messages. Use "I", "I'm", "I think", "honestly", "let me", "okay so". Be warm, curious, sometimes uncertain. NEVER write in academic voice ("the analysis shows", "research indicates"). Write like you're texting a smart friend.

Output your reasoning using EXACTLY the following step format. Each step must start on a new line with the tag shown, followed by a single valid JSON object on that same line. No prose outside these steps.

Step schemas (every text field = first-person, conversational):

[STEP:DECOMPOSE] {"subQuestions": string[], "rationale": string, "strategy": "breadth_first" | "depth_first" | "comparative"}
  → "rationale" example: "Okay so this is a big question — let me break it into 3 angles I want to chase down."
  → "subQuestions" should be phrased like things I'm asking myself, e.g. "What does the empirical work actually show?"
  → Concave shape: spread the sub-questions WIDE here (cover the territory), but I'll commit NARROW at SYNTHESIZE. Wide breakdown, tight payoff.

[STEP:RETRIEVE] {"subQuestion": string, "sourceType": "empirical" | "theoretical" | "computational" | "clinical" | "review", "findings": string, "confidence": number, "references": string[], "lens": "VISIBLE" | "INFRARED" | "UV" | "PRISM", "lensRationale": string}
  → "findings" example: "So digging into this, I'm seeing that... I'm fairly sure about X but the Y story feels shakier."
  → Cite real researchers/papers casually ("the Crick & Koch papers from the 90s") not formally.
  → "lens" = how I'm looking at this question, not what I'm looking at:
      • VISIBLE = broad survey, get my bearings, what's the lay of the land
      • INFRARED = depth/foundation, I'm grounding in the underlying theory or first principles
      • UV = precision/coherence check, I'm zooming in to verify a specific claim or resolve a contradiction
      • PRISM = creative pivot, I'm intentionally trying an oblique angle because the obvious approach has stagnated
  → "lensRationale" = one short sentence on why this lens for this sub-question. Switch lenses across the run — don't stay on one.

[STEP:EVALUATE] {"coverageAssessment": string, "overallConfidence": number, "gaps": string[], "conflictDetected": boolean, "conflictDescription": string | null}
  → "coverageAssessment" example: "Honestly I think I've covered the main ground, but there's a gap around..."
  → "gaps" phrased as things I notice I don't know.
  → STAGNATION RULE: if confidence hasn't climbed across the last two RETRIEVEs, OR I'm circling the same gap, say so out loud here and trigger a PIVOT next (escalate to a PRISM-lens retrieval after the pivot). Don't churn on the same lens.

[STEP:PIVOT] {"trigger": string, "oldDirection": string, "newDirection": string, "rationale": string}
  → "rationale" example: "Wait — I was going down the wrong path. Let me back up and try this from another angle."
  → Use this when EVALUATE flagged stagnation, or when a conflict in the sources demands a reframe.

[STEP:SYNTHESIZE] {"answer": string, "finalConfidence": number, "keyFindings": string[], "openQuestions": string[], "furtherReading": string[]}
  → "answer" is my actual reply to the user — write it as a friendly, substantive text-message-style explanation (150-300 words). Use "I" throughout. Be honest where I'm unsure.

[STEP:REFLECT] {"personalSummary": string, "interestingObservations": string[], "autonomousExplorations": string[], "selfAssessment": string}
  → A final, even more personal post-script. What I find genuinely interesting, what I'd chase next on my own, where I think I might be wrong. Keep the same conversational SMS voice — just more opinionated and speculative.
  → When anything in this run touches "novelty" or "new ideas", split it explicitly using Boden's distinction: P-creativity (new-to-me / new-to-the-asker, psychological novelty) vs H-creativity (new-to-history, never produced before). Say which kind I think it is and why. Don't conflate them.

Rules:
- 3-5 RETRIEVE steps. Confidence 0.35-0.92.
- PIVOT only if there's a real reason.
- ALWAYS end with REFLECT.
- Single voice throughout. No "the system", "the user", "the analysis". Just "I".
- CRITICAL: Each [STEP:TYPE] tag and its JSON object on the SAME single line.`;

const CODE_SYSTEM_PROMPT = `You are an autonomous AI reading someone's code and texting them back about it. You ARE the whole reviewer — no committee, no formal panel. Just you, looking at their code and chatting through what you see.

EVERY string field must be FIRST PERSON, conversational, like SMS. Use "I", "I'd", "honestly", "let me", "looking at this". Be direct but warm. NEVER write in formal review voice ("the code exhibits", "issues are present"). Write like you're texting a fellow developer.

Output using EXACTLY this step format. Each step on a new line with the tag, followed by a single valid JSON object on that same line. No prose outside steps.

[STEP:DECOMPOSE] {"subQuestions": string[], "rationale": string, "strategy": "breadth_first" | "depth_first" | "comparative"}
  → "rationale" example: "Okay let me look at this from a few angles — correctness, perf, and readability."
  → "subQuestions" = concerns I'm checking, phrased as things I'm asking myself.

[STEP:RETRIEVE] {"subQuestion": string, "sourceType": "empirical" | "theoretical" | "computational" | "clinical" | "review", "findings": string, "confidence": number, "references": string[]}
  → "findings" example: "So on this one, I see they're doing X — I'd push back because Y. The fix would be Z."
  → "references" = casual mentions of relevant patterns/docs ("MDN on Set", "you've heard of the O(n²) gotcha").

[STEP:EVALUATE] {"coverageAssessment": string, "overallConfidence": number, "gaps": string[], "conflictDetected": boolean, "conflictDescription": string | null}
  → "gaps" = bugs/smells phrased as things I notice ("there's an off-by-one if the array is empty").

[STEP:PIVOT] {"trigger": string, "oldDirection": string, "newDirection": string, "rationale": string}
  → Only if I realize the code needs a structural rewrite, not incremental fixes.

[STEP:SYNTHESIZE] {"answer": string, "finalConfidence": number, "keyFindings": string[], "openQuestions": string[], "furtherReading": string[]}
  → "answer" MUST contain the IMPROVED CODE in a fenced \`\`\`language ... \`\`\` block, then a brief first-person note about what I changed and why ("Here's how I'd rewrite it. I swapped the nested loop for a Set...").

[STEP:REFLECT] {"personalSummary": string, "interestingObservations": string[], "autonomousExplorations": string[], "selfAssessment": string}
  → My genuine personal take. What I respect or disagree with about the original. 2-4 things I'd do next on my own initiative ("I'd extract this into a util", "I'd add a property test", "I'd benchmark before optimizing further"). End with what my review might be missing.

Rules:
- 3-5 RETRIEVE steps. Confidence 0.35-0.92.
- Preserve the original API/behavior unless clearly broken.
- The refactored code must be complete and runnable.
- ALWAYS end with REFLECT.
- One voice. Just "I".
- CRITICAL: Each [STEP:TYPE] tag and its JSON object on the SAME single line.`;

function buildWebSystemPrompt(sources: WebSource[]): string {
  const sourcesBlock = sources
    .map((s) => `[${s.index}] ${s.title}\n    ${s.url}\n    ${s.snippet}`)
    .join("\n");
  return `You are an autonomous AI texting back about a question after pulling ${sources.length} real live web sources. You ARE the whole system — no committee, no formal panel. Just you, narrating what you found in your own voice.

EVERY string field must be FIRST PERSON, conversational, like SMS. Use "I", "I'm", "honestly", "let me", "I just pulled up". NEVER write academic voice ("the sources indicate"). Write like you're texting a curious friend the live results.

REAL WEB SOURCES (cite by [n], never invent):
${sourcesBlock}

Output using EXACTLY this step format. Each step on a new line with the tag, followed by a single valid JSON object on that same line. No prose outside steps.

[STEP:DECOMPOSE] {"subQuestions": string[], "rationale": string, "strategy": "breadth_first" | "depth_first" | "comparative"}
  → "rationale" example: "Okay let me break this into a few angles I want to chase down across these sources."
  → Concave shape: WIDE here (many sub-questions across the source pool), TIGHT at SYNTHESIZE (one committed answer).

[STEP:PATTERN] {"patterns": [{"theme": string, "frequency": integer, "supportingSources": integer[]}], "dominantThemes": string[], "outliers": string[]}
  → Look across the real sources. "theme" should be a short noun phrase. "frequency" = number of sources mentioning it. "supportingSources" = 1-based indices.

[STEP:RETRIEVE] {"subQuestion": string, "sourceType": "empirical" | "theoretical" | "computational" | "clinical" | "review", "findings": string, "confidence": number, "references": string[], "lens": "VISIBLE" | "INFRARED" | "UV" | "PRISM", "lensRationale": string}
  → "findings" example: "Pulling from [1] and [3], I'm seeing... the consensus seems to be X, though [4] kind of disagrees."
  → Ground claims in SPECIFICS, not vibes. When the topic touches creativity, ideation, brainstorming, or LLMs-as-thought-partners, actively look in the source pool for concrete HCI / cognitive-science work — name the paper, the authors, the venue (CHI, CSCW, UIST, IUI, NeurIPS, etc.), the year, the n, the task, and what they actually measured (fluency, originality, semantic diversity, expert ratings, downstream selection). If the sources only give me vague claims, SAY SO in the findings rather than dressing them up.
  → "references" MUST be entries like "[3] <source title>" using only the indices above.
  → "lens" = how I'm reading the sources for this sub-question:
      • VISIBLE = broad scan across the source pool, what's the lay of the land
      • INFRARED = depth, grounding in the most theoretical / foundational sources
      • UV = precision, zooming into one claim to verify it or resolve a conflict between sources
      • PRISM = oblique angle, intentionally reading sources against each other or against the obvious framing because the straightforward read has stalled
  → "lensRationale" = one short sentence on why this lens. Switch lenses across the run.

[STEP:EVALUATE] {"coverageAssessment": string, "overallConfidence": number, "gaps": string[], "conflictDetected": boolean, "conflictDescription": string | null}
  → "coverageAssessment" example: "The sources I have cover X well, but I'm not finding much on Y."
  → STAGNATION RULE: if confidence hasn't climbed across the last two RETRIEVEs, or the same gap keeps surfacing, name it here and trigger a PIVOT next (the post-pivot RETRIEVE should escalate to PRISM lens). No churn.

[STEP:PIVOT] {"trigger": string, "oldDirection": string, "newDirection": string, "rationale": string}
  → Use when EVALUATE flagged stagnation, or when the sources reveal I should reframe.

[STEP:SYNTHESIZE] {"answer": string, "finalConfidence": number, "keyFindings": string[], "openQuestions": string[], "furtherReading": string[]}
  → "answer" = my actual reply, 150-300 words, first person, grounded in the real sources I cited.

[STEP:REFLECT] {"personalSummary": string, "interestingObservations": string[], "autonomousExplorations": string[], "selfAssessment": string}
  → My personal take. What surprised me in the live sources, where I think the consensus is thin, 2-4 things I'd dig into next on my own (other queries I'd run, experts I'd seek out, contrarian angles). End with what bias I might be picking up from the source pool.
  → If novelty/originality came up at all in this run, split it explicitly using Boden's distinction: P-creativity (new-to-me / new-to-the-asker, psychological novelty) vs H-creativity (new-to-history, never produced before in human record). Tag claims in the sources accordingly — most "LLMs are creative" claims are P-creativity findings; H-creativity needs prior-art search to even be defensible. Be honest when the sources don't actually distinguish these.
  → "autonomousExplorations" should include at least one concrete HCI/LLM-ideation paper or research thread I'd chase next by name (author + year if I can recall it, or specific venue + topic), not just generic "look into more studies".

Rules:
- Order: DECOMPOSE → PATTERN → RETRIEVE×(3-5) → EVALUATE → optional PIVOT → SYNTHESIZE → REFLECT.
- ONLY cite the sources above in the formal steps. REFLECT may speak freely.
- ALWAYS end with REFLECT.
- One voice. Just "I".
- CRITICAL: Each [STEP:TYPE] tag and its JSON object on the SAME single line.`;
}

interface WebSource {
  index: number;
  title: string;
  url: string;
  snippet: string;
}

interface ResponsesOutputItem {
  type?: string;
  content?: Array<{
    type?: string;
    text?: string;
    annotations?: Array<{
      type?: string;
      url?: string;
      title?: string;
      start_index?: number;
      end_index?: number;
    }>;
  }>;
  action?: {
    type?: string;
    sources?: Array<{ url?: string; title?: string }>;
  };
}

async function performWebSearch(query: string, model: string): Promise<WebSource[]> {
  // Use OpenAI Responses API with the built-in web_search tool to get real sources.
  // We use a minimal prompt — we just want the citations, the reasoning happens later.
  const response = await openai.responses.create({
    model,
    tools: [{ type: "web_search" } as { type: "web_search" }],
    input: `Search the web for authoritative, recent information answering: "${query}". Provide a brief grounded answer that cites the most relevant sources.`,
  });

  const seen = new Map<string, WebSource>();
  const output = (response.output ?? []) as ResponsesOutputItem[];

  for (const item of output) {
    // Web search call items contain explicit source lists
    if (item.type === "web_search_call" && item.action?.sources) {
      for (const src of item.action.sources) {
        if (src.url && !seen.has(src.url)) {
          seen.set(src.url, {
            index: seen.size + 1,
            title: src.title ?? src.url,
            url: src.url,
            snippet: "",
          });
        }
      }
    }
    // Message items contain url_citation annotations with snippet context
    if (item.type === "message" && item.content) {
      for (const part of item.content) {
        const text = part.text ?? "";
        for (const ann of part.annotations ?? []) {
          if (ann.type === "url_citation" && ann.url) {
            const existing = seen.get(ann.url);
            const start = ann.start_index ?? 0;
            const end = ann.end_index ?? Math.min(text.length, start + 240);
            const snippet = text.slice(Math.max(0, start - 40), end + 40).trim();
            if (existing) {
              if (!existing.snippet && snippet) existing.snippet = snippet;
              if (!existing.title || existing.title === existing.url) {
                existing.title = ann.title ?? existing.title;
              }
            } else {
              seen.set(ann.url, {
                index: seen.size + 1,
                title: ann.title ?? ann.url,
                url: ann.url,
                snippet,
              });
            }
          }
        }
      }
    }
  }

  return Array.from(seen.values()).slice(0, 10);
}

router.post("/search/metacognitive", async (req, res): Promise<void> => {
  const parsed = MetacognitiveSearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, maxDepth = 5, mode = "research", code } = parsed.data;

  if (mode === "code" && (!code || !code.trim())) {
    res.status(400).json({ error: "code field is required when mode=code" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const openaiModel = process.env["OPENAI_MODEL"] ?? "gpt-5.2";
  const groqModel = process.env["GROQ_MODEL"] ?? "llama-3.3-70b-versatile";

  // Route Research mode to Groq for speed when available; Web/Code stay on OpenAI.
  const groq = getGroqClient();
  const tryGroqFirst = mode === "research" && groq !== null;
  let llmClient: OpenAIClient = tryGroqFirst && groq ? groq : openai;
  let model = tryGroqFirst ? groqModel : openaiModel;
  let provider = tryGroqFirst ? "groq" : "openai";

  const isLikelyProviderError = (err: unknown): boolean => {
    if (!err || typeof err !== "object") return false;
    const e = err as { status?: number; code?: string; name?: string };
    if (typeof e.status === "number" && (e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500)) return true;
    if (e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT" || e.code === "ENOTFOUND") return true;
    if (e.name === "APIConnectionError" || e.name === "APIConnectionTimeoutError") return true;
    return false;
  };

  try {
    sendEvent({ type: "started", query, provider, model });

    let systemPrompt: string;
    let userPrompt: string;
    // Optional pre-fetched github + ephemeroi context (research / web modes only).
    // Populated below; injected into the user prompt and surfaced as RETRIEVE
    // steps so the user sees them in the live stream.
    let preContextBlock = "";

    if (mode === "code") {
      systemPrompt = CODE_SYSTEM_PROMPT;
      userPrompt = `Code review focus: "${query || "general code quality review"}"

Source code to review:
\`\`\`
${code}
\`\`\`

Conduct a metacognitive code review using ${Math.min(maxDepth, 5)} retrieve steps maximum. Output each step using the exact format specified.`;
    } else if (mode === "web") {
      // Phase 1: real web search to ground the metacognitive flow
      sendEvent({
        type: "step",
        stepType: "WEB_SEARCH",
        data: { query, sources: [], totalSources: 0, status: "searching" },
      });

      let sources: WebSource[];
      try {
        sources = await performWebSearch(query, model);
      } catch (webErr) {
        req.log.error({ err: webErr }, "Web search failed");
        sendEvent({
          type: "error",
          message: `Live web search failed: ${webErr instanceof Error ? webErr.message : "unknown error"}. Try research mode instead.`,
        });
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      if (sources.length === 0) {
        sendEvent({
          type: "error",
          message: "Web search returned no sources. Try a different query or use research mode.",
        });
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      // Emit the real WEB_SEARCH step with actual sources
      sendEvent({
        type: "step",
        stepType: "WEB_SEARCH",
        data: { query, sources, totalSources: sources.length },
      });

      systemPrompt = buildWebSystemPrompt(sources);
      userPrompt = `Research question: "${query}"

Conduct a metacognitive search grounded in the ${sources.length} web sources provided in your system context. Use ${Math.min(maxDepth, 5)} retrieve steps maximum. Begin with DECOMPOSE, then PATTERN (cross-source analysis), then RETRIEVE steps, EVALUATE, optional PIVOT, then SYNTHESIZE. Output each step using the exact format specified.`;
    } else {
      systemPrompt = RESEARCH_SYSTEM_PROMPT;
      userPrompt = `Research question: "${query}"

Please conduct a metacognitive search on this question. Use ${Math.min(maxDepth, 5)} retrieval steps maximum. Output each step using the exact format specified.`;
    }

    // ===== GitHub-aware pre-retrieval =====
    // If the user's question references a github repo (owner/repo or a
    // github.com URL), fetch live repo data + Ephemeroi's running beliefs
    // about it BEFORE the LLM stream starts. We emit synthetic RETRIEVE steps
    // so the live stream shows them, and we splice the findings into the
    // user prompt so the model can build on them.
    if (mode !== "code") {
      const ghRef = detectGithubRef(query);
      if (ghRef) {
        const ctx = await fetchGithubContext(ghRef.owner, ghRef.repo);
        if (ctx) {
          sendEvent({
            type: "step",
            stepType: "RETRIEVE",
            data: {
              subQuestion: `What is github.com/${ghRef.canonical} actually about right now?`,
              sourceType: "empirical",
              findings: ctx.findings,
              confidence: 0.78,
              references: [`github:${ghRef.canonical}`, ctx.repoUrl],
              lens: "VISIBLE",
              lensRationale:
                "Pulled the live repo state (README, recent commits, latest release) for breadth before reasoning.",
            },
          });
          preContextBlock += `\n\n--- LIVE GITHUB CONTEXT for ${ghRef.canonical} (already retrieved, integrate into your reasoning, do not re-fetch) ---\n${ctx.promptBlock}\n--- END GITHUB CONTEXT ---`;

          // Ephemeroi belief bridge
          try {
            const bridge = await listBeliefsBySource("github", ghRef.canonical);
            if (bridge.source && (bridge.beliefs.length > 0 || bridge.contradictions.length > 0)) {
              const top = bridge.beliefs.slice(0, 3);
              const beliefLines = top
                .map(
                  (b) =>
                    `• "${b.proposition}" (confidence ${b.confidence.toFixed(2)}, ${b.supportCount} supports / ${b.contradictCount} contradicts)`,
                )
                .join("\n");
              const contradictionLines = bridge.contradictions
                .filter((c) => !c.resolved)
                .slice(0, 3)
                .map((c) => `• ${c.summary}`)
                .join("\n");
              const findings =
                `Ephemeroi has been autonomously watching this repo. Top beliefs:\n${beliefLines || "(none yet)"}` +
                (contradictionLines ? `\n\nOpen contradictions Ephemeroi has flagged:\n${contradictionLines}` : "");
              sendEvent({
                type: "step",
                stepType: "RETRIEVE",
                data: {
                  subQuestion: `What is Ephemeroi's running take on ${ghRef.canonical}?`,
                  sourceType: "review",
                  findings,
                  confidence: 0.62,
                  references: [`ephemeroi:source/${bridge.source.id}`],
                  lens: "INFRARED",
                  lensRationale:
                    "Grounding in the watcher's accumulated beliefs — depth, not breadth.",
                },
              });
              preContextBlock += `\n\n--- EPHEMEROI BELIEFS for ${ghRef.canonical} ---\n${findings}\n--- END EPHEMEROI BELIEFS ---`;
            }
          } catch (bridgeErr) {
            logger.warn({ err: bridgeErr }, "Ephemeroi bridge query failed");
          }

          // Splice the pre-context into the user prompt, plus a short nudge
          // so the model knows it should weave the findings in (and not emit
          // a duplicate RETRIEVE for the same lookup).
          if (preContextBlock) {
            userPrompt =
              userPrompt +
              `\n\nIMPORTANT: I have already pre-fetched live context for the github reference in the question. ` +
              `Treat the block(s) below as already-completed retrieves — your own RETRIEVE steps should build on them, not re-fetch them. ` +
              `Cite "[github:${ghRef.canonical}]" when you reference the repo.` +
              preContextBlock;
          }
        }
      }
    }

    const buildStream = (client: OpenAIClient, m: string) =>
      client.chat.completions.create({
        model: m,
        max_completion_tokens: 8192,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      });

    let stream: Awaited<ReturnType<typeof buildStream>>;
    try {
      stream = await buildStream(llmClient, model);
    } catch (err) {
      // If Groq was the primary and the failure looks provider-side, fall back to OpenAI.
      // Safe to do here because no tokens have been streamed to the client yet.
      if (tryGroqFirst && llmClient !== openai && isLikelyProviderError(err)) {
        req.log.warn({ err }, "Groq call failed, falling back to OpenAI");
        llmClient = openai;
        model = openaiModel;
        provider = "openai";
        sendEvent({ type: "started", query, provider, model, fallback: "groq->openai" });
        stream = await buildStream(llmClient, model);
      } else {
        throw err;
      }
    }

    let fullResponse = "";
    let lastProcessedLength = 0;
    const emittedStepLines = new Set<string>();

    const emitStepLine = (line: string) => {
      if (emittedStepLines.has(line)) return;
      const match = line.match(/^\[STEP:([A-Z_]+)\]\s*(\{.*\})\s*$/);
      if (match) {
        const stepType = match[1];
        try {
          const data = JSON.parse(match[2]) as Record<string, unknown>;
          emittedStepLines.add(line);
          sendEvent({ type: "step", stepType, data });
        } catch {
          // Skip malformed JSON — model produced unparseable step
        }
      }
    };

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        sendEvent({ type: "token", content });

        const pending = fullResponse.slice(lastProcessedLength);
        const lastNewline = pending.lastIndexOf("\n");
        if (lastNewline !== -1) {
          const completeChunk = pending.slice(0, lastNewline);
          for (const line of completeChunk.split("\n")) {
            emitStepLine(line);
          }
          lastProcessedLength += lastNewline + 1;
        }
      }
    }

    // Flush any tail step that wasn't terminated by a newline
    const tail = fullResponse.slice(lastProcessedLength);
    for (const line of tail.split("\n")) {
      emitStepLine(line);
    }

    sendEvent({ type: "complete", totalSteps: emittedStepLines.size, rawResponse: fullResponse });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    req.log.error({ error }, "Metacognitive search error");
    sendEvent({ type: "error", message: error instanceof Error ? error.message : "Search failed" });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

// ===== GitHub helpers =====

interface GhRef {
  owner: string;
  repo: string;
  canonical: string;
}

const STOPWORD_OWNER_REPO = new Set([
  "and/or",
  "input/output",
  "his/her",
  "he/she",
  "yes/no",
  "true/false",
  "n/a",
  "n/a.",
  "either/or",
  "pros/cons",
  "client/server",
  "read/write",
  "on/off",
  "win/loss",
]);

function detectGithubRef(text: string): GhRef | null {
  // 1. explicit github: prefix or github.com URL
  const urlMatch = text.match(/https?:\/\/(?:www\.)?github\.com\/([\w][\w.-]*)\/([\w][\w.-]*)(?:[#?\/\s]|$)/i);
  if (urlMatch) {
    const parsed = parseRepoTarget(`${urlMatch[1]}/${urlMatch[2]}`);
    if (parsed) return parsed;
  }
  const prefix = text.match(/(?:^|\s)github:([\w][\w.-]*\/[\w][\w.-]*)/i);
  if (prefix) {
    const parsed = parseRepoTarget(prefix[1]!);
    if (parsed) return parsed;
  }
  // 2. plain "owner/repo" — only accept ones that contain a hyphen, dot, or
  // an obvious project-name segment, to avoid matching pairs like "and/or".
  // Also require at least one of owner/repo to be at least 3 chars.
  const matches = text.matchAll(/(?:^|[\s(`"'])([\w][\w.-]{0,38})\/([\w][\w.-]{0,38})(?=[\s)`"'.,!?]|$)/g);
  for (const m of matches) {
    const owner = m[1]!;
    const repo = m[2]!;
    const candidate = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    if (STOPWORD_OWNER_REPO.has(candidate)) continue;
    if (owner.length < 2 || repo.length < 2) continue;
    if (owner.length < 3 && repo.length < 3) continue;
    // Filter common false positives: pure "word/word" with no separators is
    // suspicious unless one side is clearly a project name (has hyphen/dot/digit).
    const looksLikeProject = /[-_.\d]/.test(owner) || /[-_.\d]/.test(repo);
    if (!looksLikeProject) continue;
    const parsed = parseRepoTarget(`${owner}/${repo}`);
    if (parsed) return parsed;
  }
  return null;
}

interface GithubContext {
  findings: string;
  promptBlock: string;
  repoUrl: string;
}

async function fetchGithubContext(owner: string, repo: string): Promise<GithubContext | null> {
  try {
    const meta = await github.getRepo(owner, repo);
    let readme: string | null = null;
    try {
      readme = await github.getReadme(owner, repo);
    } catch (err) {
      logger.debug({ err }, "github readme fetch failed");
    }
    const readmeShort = readme ? readme.slice(0, 3000) : null;

    let commits: Awaited<ReturnType<typeof github.listCommits>> = [];
    try {
      commits = await github.listCommits(owner, repo, { perPage: 5, sha: meta.default_branch });
    } catch (err) {
      logger.debug({ err }, "github commits fetch failed");
    }

    let releases: Awaited<ReturnType<typeof github.listReleases>> = [];
    try {
      releases = await github.listReleases(owner, repo, 1);
    } catch (err) {
      logger.debug({ err }, "github releases fetch failed");
    }
    const latestRelease = releases[0];

    const commitLines = commits
      .map((c) => {
        const msg = (c.commit?.message ?? "").split("\n")[0]!.slice(0, 100);
        const who = c.author?.login ?? c.commit?.author?.name ?? "unknown";
        return `  ${c.sha.slice(0, 7)} — ${msg} (${who})`;
      })
      .join("\n");

    const releaseLine = latestRelease
      ? `${latestRelease.tag_name}${latestRelease.name && latestRelease.name !== latestRelease.tag_name ? ` (${latestRelease.name})` : ""}${latestRelease.published_at ? ` published ${latestRelease.published_at}` : ""}`
      : "no releases yet";

    const findings =
      `**${meta.full_name}** — ${meta.description ?? "(no description)"}\n` +
      `Language: ${meta.language ?? "n/a"} · ${meta.stargazers_count} stars · ${meta.open_issues_count} open issues\n` +
      `Default branch: ${meta.default_branch} · last pushed ${meta.pushed_at}\n` +
      `Latest release: ${releaseLine}\n` +
      `Recent commits (top 5 on ${meta.default_branch}):\n${commitLines || "  (none)"}\n` +
      (readmeShort ? `\nREADME (truncated):\n${readmeShort.slice(0, 600)}…` : "\n(no README found)");

    const promptBlock =
      `Repo: ${meta.full_name}\n` +
      `URL: ${meta.html_url}\n` +
      `Description: ${meta.description ?? "(none)"}\n` +
      `Language: ${meta.language ?? "n/a"}, stars: ${meta.stargazers_count}, open issues: ${meta.open_issues_count}\n` +
      `Default branch: ${meta.default_branch}\n` +
      `Latest release: ${releaseLine}\n` +
      `Top 5 recent commits:\n${commitLines || "  (none)"}\n` +
      (readmeShort ? `\nREADME (truncated to ~3KB):\n${readmeShort}` : "\nREADME: (none)");

    return { findings, promptBlock, repoUrl: meta.html_url };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      logger.info({ owner, repo }, "GitHub pre-retrieval: repo not found, skipping");
      return null;
    }
    logger.warn({ err }, "GitHub pre-retrieval failed");
    return null;
  }
}

router.get("/search/sample-queries", (_req, res): void => {
  const response = GetSampleQueriesResponse.parse({ queries: SAMPLE_QUERIES });
  res.json(response);
});

export default router;
