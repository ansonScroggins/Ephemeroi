import OpenAI from "openai";

const EMBEDDING_MODEL = process.env["OPENAI_EMBEDDING_MODEL"] ?? "text-embedding-3-small";

let _embeddingsClient: OpenAI | null = null;

/**
 * Embeddings go through the user-provided OPENAI_API_KEY against api.openai.com
 * directly, because the Replit AI proxy (used for chat completions elsewhere in
 * this app) does not support the /embeddings endpoint.
 */
function getEmbeddingsClient(): OpenAI {
  if (_embeddingsClient) return _embeddingsClient;
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for Society mode embeddings. Add it as a Replit Secret.",
    );
  }
  _embeddingsClient = new OpenAI({ apiKey });
  return _embeddingsClient;
}

/** Batched embedding call. Returns one vector per input string. */
export async function embedBatch(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const client = getEmbeddingsClient();
  const resp = await client.embeddings.create(
    { model: EMBEDDING_MODEL, input: inputs },
    { signal },
  );
  return resp.data.map((d) => d.embedding);
}

export function normalize(v: number[]): number[] {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s) || 1;
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    s += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : s / denom;
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i]! * b[i]!;
  return s;
}

/** out = a + scalar * (b - a). Modifies nothing; returns a new vector. */
export function lerpToward(a: number[], b: number[], scalar: number): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + scalar * (b[i]! - a[i]!);
  return out;
}

export function subtract(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! - b[i]!;
  return out;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Project belief vectors to 2D via PCA over the small (n×d) sample matrix using
 * the n×n Gram-matrix trick (since d >> n in practice).
 *
 * Stabilises sign of each principal component round-to-round by picking the
 * orientation that maximises agreement with `prevPositions` when supplied.
 */
export function pca2d(
  vectors: number[][],
  prevPositions?: Array<[number, number]> | null,
): Array<[number, number]> {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [[0, 0]];
  const d = vectors[0]!.length;

  // Mean-centre.
  const mean = new Array<number>(d).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < d; i++) mean[i]! += v[i]!;
  }
  for (let i = 0; i < d; i++) mean[i]! /= n;
  const centred = vectors.map((v) => v.map((x, i) => x - mean[i]!));

  // n×n Gram matrix.
  const G: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      const ci = centred[i]!;
      const cj = centred[j]!;
      for (let k = 0; k < d; k++) s += ci[k]! * cj[k]!;
      G[i]![j] = s;
      G[j]![i] = s;
    }
  }

  // Top eigenvector via power iteration; deflate; second eigenvector.
  const v1 = powerIterate(G, n);
  const lam1 = rayleigh(G, v1);
  const G2: number[][] = G.map((row, i) =>
    row.map((x, j) => x - lam1 * v1[i]! * v1[j]!),
  );
  const v2 = powerIterate(G2, n);
  const lam2 = rayleigh(G2, v2);

  const s1 = Math.sqrt(Math.max(0, lam1));
  const s2 = Math.sqrt(Math.max(0, lam2));
  let coords: Array<[number, number]> = v1.map((u, i) => [u * s1, v2[i]! * s2]);

  // Sign-stabilise against previous frame to keep the constellation from
  // flipping randomly between rounds (power iteration is sign-ambiguous).
  if (prevPositions && prevPositions.length === n) {
    let dotX = 0;
    let dotY = 0;
    for (let i = 0; i < n; i++) {
      dotX += coords[i]![0] * prevPositions[i]![0];
      dotY += coords[i]![1] * prevPositions[i]![1];
    }
    if (dotX < 0) coords = coords.map(([x, y]) => [-x, y] as [number, number]);
    if (dotY < 0) coords = coords.map(([x, y]) => [x, -y] as [number, number]);
  }

  return coords;
}

function powerIterate(M: number[][], n: number, iters = 80): number[] {
  // Deterministic seed so two consecutive PCAs on the same data agree.
  let v = new Array<number>(n).fill(0).map((_, i) => Math.cos(i * 1.1) + 0.123);
  let norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  v = v.map((x) => x / norm);
  for (let k = 0; k < iters; k++) {
    const w = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) w[i]! += M[i]![j]! * v[j]!;
    }
    norm = Math.sqrt(w.reduce((a, x) => a + x * x, 0)) || 1;
    v = w.map((x) => x / norm);
  }
  return v;
}

function rayleigh(M: number[][], v: number[]): number {
  let num = 0;
  const n = v.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) num += v[i]! * M[i]![j]! * v[j]!;
  }
  return num;
}
