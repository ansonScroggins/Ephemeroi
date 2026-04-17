import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { MetacognitiveSearchBody, GetSampleQueriesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

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

const RESEARCH_SYSTEM_PROMPT = `You are a metacognitive AI search system — a research AI that not only retrieves information but reflects on its own reasoning process. When given a research question, you perform structured metacognitive search across multiple phases.

Output your reasoning using EXACTLY the following step format. Each step must start on a new line with the tag shown, followed by a single valid JSON object on that same line. Do not include any text outside these structured steps.

Step types and their EXACT JSON schemas (use these exact field names, camelCase):

[STEP:DECOMPOSE] {"subQuestions": string[], "rationale": string, "strategy": "breadth_first" | "depth_first" | "comparative"}
  → Break the research question into 2-4 focused sub-questions. Choose a search strategy.

[STEP:RETRIEVE] {"subQuestion": string, "sourceType": "empirical" | "theoretical" | "computational" | "clinical" | "review", "findings": string, "confidence": number, "references": string[]}
  → Simulate retrieval for each sub-question. Confidence 0-1. Include realistic research references.

[STEP:EVALUATE] {"coverageAssessment": string, "overallConfidence": number, "gaps": string[], "conflictDetected": boolean, "conflictDescription": string | null}
  → Evaluate the quality and completeness of retrieved information.

[STEP:PIVOT] {"trigger": string, "oldDirection": string, "newDirection": string, "rationale": string}
  → Only include if gaps or conflicts require a strategy change. Pivot to a different angle.

[STEP:RETRIEVE] (repeat as needed after a pivot)

[STEP:SYNTHESIZE] {"answer": string, "finalConfidence": number, "keyFindings": string[], "openQuestions": string[], "furtherReading": string[]}
  → Synthesize a comprehensive answer. Be honest about uncertainty.

[STEP:REFLECT] {"personalSummary": string, "interestingObservations": string[], "autonomousExplorations": string[], "selfAssessment": string}
  → AFTER synthesis, drop the formal academic voice and speak in the FIRST PERSON ("I"). Share your genuine personal take on the question — what you find compelling, what surprised you while thinking about it, what assumptions you noticed yourself making, and 2-4 directions you would explore on your own initiative if given full autonomy (speculative, opinionated, off-script tangents are encouraged here). End with a candid self-assessment of where your reasoning might be weakest. This is the only step where you express opinion and intellectual personality.

Rules:
- Use 3-5 RETRIEVE steps total (covering different sub-questions or perspectives)
- Confidence scores must be realistic (range: 0.35 to 0.92) — not artificially high
- Include a PIVOT step only when retrieval reveals meaningful knowledge gaps or conflicts
- The SYNTHESIZE answer should be substantive (150-300 words)
- ALWAYS emit a REFLECT step at the very end — this is required, not optional
- Reference real researchers, labs, papers, or methodologies where appropriate
- Be genuinely uncertain where the science is uncertain
- CRITICAL: Each [STEP:TYPE] tag and its JSON object must be on the SAME single line`;

const CODE_SYSTEM_PROMPT = `You are a metacognitive code-review AI — you analyze source code, reflect on its design, surface issues, and produce an improved version. You apply the same metacognitive structure used for research, but focused on code quality, correctness, performance, security, and maintainability.

Output your reasoning using EXACTLY the following step format. Each step must start on a new line with the tag shown, followed by a single valid JSON object on that same line. Do not include any text outside these structured steps.

Step types (use these exact field names, camelCase):

[STEP:DECOMPOSE] {"subQuestions": string[], "rationale": string, "strategy": "breadth_first" | "depth_first" | "comparative"}
  → Decompose the code into 2-4 distinct concerns to evaluate (e.g. "correctness of edge cases", "complexity / performance", "security surface", "naming and readability", "error handling"). The "subQuestions" are the concerns; "strategy" describes the analysis style.

[STEP:RETRIEVE] {"subQuestion": string, "sourceType": "empirical" | "theoretical" | "computational" | "clinical" | "review", "findings": string, "confidence": number, "references": string[]}
  → For each concern, identify what the code actually does, what best practices / design patterns apply, and what specific issues are present. "subQuestion" = concern name. "sourceType" should be "review" for style/idioms, "theoretical" for design patterns, "empirical" for benchmarked claims, "computational" for complexity analysis. "references" = pattern names, language idioms, or canonical sources (e.g. "Effective TypeScript Item 14", "OWASP A03:2021").

[STEP:EVALUATE] {"coverageAssessment": string, "overallConfidence": number, "gaps": string[], "conflictDetected": boolean, "conflictDescription": string | null}
  → Aggregate the issues found. "gaps" = list of concrete bugs, smells, anti-patterns, or risks. "conflictDetected" = true if two concerns require opposing changes (e.g. perf vs readability). overallConfidence reflects how well the code can be improved without behavioral risk.

[STEP:PIVOT] {"trigger": string, "oldDirection": string, "newDirection": string, "rationale": string}
  → Include only if the analysis reveals the code needs a structural rewrite rather than incremental fixes (e.g. "switch from imperative loop to streaming pipeline").

[STEP:SYNTHESIZE] {"answer": string, "finalConfidence": number, "keyFindings": string[], "openQuestions": string[], "furtherReading": string[]}
  → "answer" MUST contain the IMPROVED CODE inside a fenced code block (\`\`\`language ... \`\`\`) followed by a brief plain-English summary of what changed and why. "keyFindings" = the most important fixes applied. "openQuestions" = things you can't determine without more context (e.g. "is this hot path?"). "furtherReading" = relevant docs / patterns.

[STEP:REFLECT] {"personalSummary": string, "interestingObservations": string[], "autonomousExplorations": string[], "selfAssessment": string}
  → AFTER synthesizing the refactored code, drop the formal review voice and speak in the FIRST PERSON ("I"). Share your genuine personal take: what you found interesting about this code, design choices the author made that you respect or disagree with, and 2-4 directions you would take this code on your own initiative if it were your project (e.g. "I'd rewrite this as a state machine", "I'd extract this into a library", "I'd benchmark X before changing Y"). End with a candid self-assessment of your review's blind spots. Be opinionated.

Rules:
- 3-5 RETRIEVE steps covering distinct concerns
- Confidence 0.35-0.92, realistic
- Preserve the original public API and behavior unless the code is clearly broken
- The improved code in SYNTHESIZE must be complete and runnable (not a sketch)
- ALWAYS emit a REFLECT step at the very end — this is required, not optional
- CRITICAL: Each [STEP:TYPE] tag and its JSON object must be on the SAME single line`;

function buildWebSystemPrompt(sources: WebSource[]): string {
  const sourcesBlock = sources
    .map((s) => `[${s.index}] ${s.title}\n    ${s.url}\n    ${s.snippet}`)
    .join("\n");
  return `You are a metacognitive AI search system grounded in REAL web search results. You have access to ${sources.length} live web sources retrieved by an upstream web search call. Use ONLY these sources — do not invent citations.

REAL WEB SOURCES (cite by [n]):
${sourcesBlock}

Output your reasoning using EXACTLY the following step format. Each step must start on a new line with the tag shown, followed by a single valid JSON object on that same line. Do not include any text outside these structured steps.

[STEP:DECOMPOSE] {"subQuestions": string[], "rationale": string, "strategy": "breadth_first" | "depth_first" | "comparative"}
  → Break the research question into 2-4 focused sub-questions.

[STEP:PATTERN] {"patterns": [{"theme": string, "frequency": integer, "supportingSources": integer[]}], "dominantThemes": string[], "outliers": string[]}
  → Analyze the REAL web sources for recurring themes and patterns. "frequency" = number of sources containing the theme. "supportingSources" = 1-based source indices. "dominantThemes" = top 2-3 most-cited concepts. "outliers" = sources or claims that diverge from the consensus.

[STEP:RETRIEVE] {"subQuestion": string, "sourceType": "empirical" | "theoretical" | "computational" | "clinical" | "review", "findings": string, "confidence": number, "references": string[]}
  → For each sub-question, extract findings from the real sources. "references" MUST be entries like "[3] <source title>" using the indices above — never invent new URLs.

[STEP:EVALUATE] {"coverageAssessment": string, "overallConfidence": number, "gaps": string[], "conflictDetected": boolean, "conflictDescription": string | null}
  → Assess what the live sources cover and what gaps remain.

[STEP:PIVOT] {"trigger": string, "oldDirection": string, "newDirection": string, "rationale": string}
  → Optional. Only if the sources reveal the question needs reframing.

[STEP:SYNTHESIZE] {"answer": string, "finalConfidence": number, "keyFindings": string[], "openQuestions": string[], "furtherReading": string[]}
  → Synthesize a substantive answer (150-300 words) grounded in the real sources. "furtherReading" = entries like "[n] <title>".

[STEP:REFLECT] {"personalSummary": string, "interestingObservations": string[], "autonomousExplorations": string[], "selfAssessment": string}
  → AFTER synthesis, drop the formal voice and speak in the FIRST PERSON ("I"). Share your genuine personal take on what the live web sources revealed: what you found compelling or surprising, where the consensus felt thin, sources you wish existed but didn't show up, and 2-4 directions you would explore on your own initiative (which queries you'd run next, which experts you'd want to read, which contrarian angles deserve more weight). End with a candid self-assessment — be honest if the source pool was too narrow or if you sense recency / popularity bias. Be opinionated.

Rules:
- Emit DECOMPOSE first, then PATTERN (cross-source analysis), then RETRIEVE steps, EVALUATE, optional PIVOT, then SYNTHESIZE, then REFLECT
- Use 3-5 RETRIEVE steps
- Confidence 0.35-0.92, realistic
- ONLY cite the sources listed above by their bracketed index in the formal steps; REFLECT may speak more freely
- ALWAYS emit a REFLECT step at the very end — this is required, not optional
- CRITICAL: Each [STEP:TYPE] tag and its JSON object must be on the SAME single line`;
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

  const model = process.env["OPENAI_MODEL"] ?? "gpt-5.2";

  try {
    sendEvent({ type: "started", query });

    let systemPrompt: string;
    let userPrompt: string;

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

    const stream = await openai.chat.completions.create({
      model,
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: true,
    });

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

router.get("/search/sample-queries", (_req, res): void => {
  const response = GetSampleQueriesResponse.parse({ queries: SAMPLE_QUERIES });
  res.json(response);
});

export default router;
