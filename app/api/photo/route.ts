export const runtime = "nodejs";
export const maxDuration = 120;

import {
  compilePhotoPromptFromState,
  loadOrResetState,
  photoSettings,
  saveState,
} from "../../../lib/erika";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = "erika-photos";

const ERIKA_LORA =
  "https://replicate.delivery/xezq/eOU7OpAeaHlwoEavigAhW5vYackREGjOGY3LCyv1MwWcAeiuA/flux-lora.tar";

const REALISM_LORA =
  "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors";

const MODEL_URL =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomSeed() {
  return Math.floor(Math.random() * 1_000_000_000);
}

async function waitForPrediction(prediction: any) {
  let current = prediction;
  let attempts = 0;

  while (
    current.status !== "succeeded" &&
    current.status !== "failed" &&
    current.status !== "canceled" &&
    attempts < 110
  ) {
    await sleep(1000);
    attempts++;

    const response = await fetch(
      `https://api.replicate.com/v1/predictions/${current.id}`,
      {
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error("Could not check photo status");
    current = data;
    console.log("PHOTO STATUS:", current.status);
  }

  return current;
}

async function generateErikaPhoto(prompt: string) {
  const settings = photoSettings();

  console.log("USING STATE PROMPT");
  console.log("FINAL PROMPT:", prompt);
  console.log("SETTINGS:", settings);

  const input = {
    prompt,
    lora_weights: ERIKA_LORA,
    extra_lora: REALISM_LORA,
    ...settings,
    num_inference_steps: 32,
    go_fast: false,
    megapixels: "1",
    output_format: "jpg",
    output_quality: 95,
    seed: getRandomSeed(),
    disable_safety_checker: true,
  };

  const response = await fetch(MODEL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });

  const prediction = await response.json();

  if (!response.ok) {
    console.error("MODEL START ERROR:", prediction);
    throw new Error(prediction?.detail || "Could not start photo generation");
  }

  const result = await waitForPrediction(prediction);

  if (result.status !== "succeeded") {
    throw new Error(result.error || "Photo generation failed");
  }

  const output = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!output || typeof output !== "string") {
    throw new Error("Model returned no image URL");
  }

  return output;
}

async function saveImage(sourceUrl: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase environment variables");
  }

  const imageResponse = await fetch(sourceUrl);
  if (!imageResponse.ok) throw new Error("Could not download generated image");

  const imageBytes = await imageResponse.arrayBuffer();
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

  let extension = "jpg";
  if (contentType.includes("png")) extension = "png";
  if (contentType.includes("webp")) extension = "webp";

  const fileName = `erika-${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${fileName}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "false",
      },
      body: imageBytes,
    }
  );

  if (!response.ok) {
    throw new Error("Generated photo could not be saved to storage");
  }

  return {
    fileName,
    publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`,
  };
}

export async function POST(request: Request) {
  try {
    if (!REPLICATE_API_TOKEN) {
      return Response.json(
        { error: "Missing REPLICATE_API_TOKEN" },
        { status: 500 }
      );
    }

    const rawBody = await request.text();
    console.log("RAW BODY RECEIVED:", rawBody);

    let body: any = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      body = {};
    }

    const rawPrompt =
      body?.prompt ??
      body?.photo_prompt ??
      body?.photoPrompt ??
      "";

    const state = await loadOrResetState();
    const prompt =
      typeof rawPrompt === "string" && rawPrompt.trim()
        ? rawPrompt.trim()
        : compilePhotoPromptFromState(state);

    const imageUrl = await generateErikaPhoto(prompt);
    const stored = await saveImage(imageUrl);

    state.last_photo_url = stored.publicUrl;
    await saveState(state);

    return Response.json({
      type: "photo",
      image: stored.publicUrl,
      imageUrl: stored.publicUrl,
      metadata: {
        backend: "state",
        outfit: prompt,
        storageFile: stored.fileName,
      },
    });
  } catch (error) {
    console.error("PHOTO ROUTE ERROR:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown photo generation error",
      },
      { status: 500 }
    );
  }
}
