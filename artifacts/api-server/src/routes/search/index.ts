import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { MetacognitiveSearchBody, GetSampleQueriesResponse } from "@workspace/api-zod";
import { logger } from "../../lib/logger";

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

const METACOGNITIVE_SYSTEM_PROMPT = `You are a metacognitive AI search system — a research AI that not only retrieves information but reflects on its own reasoning process. When given a research question, you perform structured metacognitive search across multiple phases.

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

Rules:
- Use 3-5 RETRIEVE steps total (covering different sub-questions or perspectives)
- Confidence scores must be realistic (range: 0.35 to 0.92) — not artificially high
- Include a PIVOT step only when retrieval reveals meaningful knowledge gaps or conflicts
- The SYNTHESIZE answer should be substantive (150-300 words)
- Reference real researchers, labs, papers, or methodologies where appropriate
- Be genuinely uncertain where the science is uncertain
- CRITICAL: Each [STEP:TYPE] tag and its JSON object must be on the SAME single line`;

function parseStepMarkers(text: string): Array<{ type: string; data: Record<string, unknown> }> {
  const steps: Array<{ type: string; data: Record<string, unknown> }> = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const match = line.match(/^\[STEP:([A-Z]+)\]\s*(\{.*\})\s*$/);
    if (match) {
      const stepType = match[1];
      try {
        const data = JSON.parse(match[2]) as Record<string, unknown>;
        steps.push({ type: stepType, data });
      } catch {
        // Silently skip malformed steps
      }
    }
  }

  return steps;
}

router.post("/search/metacognitive", async (req, res): Promise<void> => {
  const parsed = MetacognitiveSearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, maxDepth = 5 } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    sendEvent({ type: "started", query });

    const userPrompt = `Research question: "${query}"

Please conduct a metacognitive search on this question. Use ${Math.min(maxDepth, 5)} retrieval steps maximum. Output each step using the exact format specified.`;

    const stream = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: METACOGNITIVE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      stream: true,
    });

    let fullResponse = "";
    let lastProcessedLength = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;

        // Stream raw tokens so the frontend can show live typing
        sendEvent({ type: "token", content });

        // Check for newly completed steps in the accumulated text
        const newText = fullResponse.slice(lastProcessedLength);
        const completedStepEnd = fullResponse.lastIndexOf("\n[STEP:");
        const searchFrom = Math.max(lastProcessedLength, completedStepEnd);

        // Look for complete lines that start with [STEP:...]
        const lines = fullResponse.slice(lastProcessedLength).split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          const match = line.match(/^\[STEP:([A-Z]+)\]\s*(\{.*\})\s*$/);
          if (match) {
            const stepType = match[1];
            try {
              const data = JSON.parse(match[2]) as Record<string, unknown>;
              sendEvent({ type: "step", stepType, data });
            } catch {
              // Skip malformed JSON
            }
          }
        }

        lastProcessedLength = fullResponse.length - (lines[lines.length - 1]?.length ?? 0);
        void newText;
        void searchFrom;
      }
    }

    // Final pass: parse any remaining steps
    const allSteps = parseStepMarkers(fullResponse);
    sendEvent({ type: "complete", totalSteps: allSteps.length, rawResponse: fullResponse });
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
