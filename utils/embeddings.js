/**
 * Local sentence embeddings — no API, no cost, nothing leaves the server.
 *
 * Uses @xenova/transformers with all-MiniLM-L6-v2 (384 dims, ~90 MB, downloaded
 * once to a local cache on first use). Runs on CPU; fine for this corpus size.
 *
 *   npm install @xenova/transformers
 */
const MODEL_NAME = process.env.EMBED_MODEL || "Xenova/all-MiniLM-L6-v2";
const EMBED_DIM = 384;

let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      // keep the model cache inside the project so it survives restarts
      env.cacheDir = process.env.EMBED_CACHE_DIR || "./.model-cache";
      env.allowRemoteModels = true;
      return pipeline("feature-extraction", MODEL_NAME);
    })();
  }
  return extractorPromise;
}

/** Embed one string -> normalised 384-dim vector. */
async function embed(text) {
  const extractor = await getExtractor();
  const out = await extractor(String(text || "").slice(0, 2000), {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(out.data);
}

/** Embed many strings sequentially (keeps memory flat on a small instance). */
async function embedMany(texts, onProgress) {
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(await embed(texts[i]));
    if (onProgress && (i + 1) % 25 === 0) onProgress(i + 1, texts.length);
  }
  return vectors;
}

/** Vectors are normalised, so the dot product IS the cosine similarity. */
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

module.exports = { embed, embedMany, cosine, MODEL_NAME, EMBED_DIM };
