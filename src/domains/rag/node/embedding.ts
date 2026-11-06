import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { platformPaths } from "../../../platform/paths.ts";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const MODEL_CACHE_DIR = join(platformPaths.appDataDir, "models", "rag");

type FeatureExtractor = (
  input: string | string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<{ tolist(): unknown }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

async function loadExtractor(): Promise<FeatureExtractor> {
  mkdirSync(MODEL_CACHE_DIR, { recursive: true });
  const transformers = await import("@xenova/transformers");
  transformers.env.cacheDir = MODEL_CACHE_DIR;
  const pipeline = transformers.pipeline as unknown as (
    task: "feature-extraction",
    model: string,
  ) => Promise<FeatureExtractor>;
  return pipeline("feature-extraction", MODEL_ID);
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  extractorPromise ??= loadExtractor();
  const extractor = await extractorPromise;
  const result = await extractor(texts, { pooling: "mean", normalize: true });
  const values = result.tolist();
  if (!Array.isArray(values)) throw new Error("embedding 返回格式无效");
  return values.map((value) => {
    if (!Array.isArray(value) || value.length !== 384) {
      throw new Error("embedding 维度不是 384");
    }
    return Float32Array.from(value as number[]);
  });
}

export function resetEmbeddingRuntime(): void {
  extractorPromise = null;
}

export const ragEmbeddingModel = MODEL_ID;
export const ragEmbeddingCacheDir = MODEL_CACHE_DIR;
