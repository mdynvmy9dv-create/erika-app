export const runtime = "nodejs";
export const maxDuration = 120;

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

    if (!response.ok) {
      console.error("POLL ERROR:", data);
      throw new Error("Could not check photo generation status");
    }

    current = data;
    console.log("PHOTO STATUS:", current.status);
  }

  return current;
}

async function generateErikaPhoto(prompt: string) {
  const cleaned = prompt
    .replace(/MANDATORY USER VISUAL INSTRUCTIONS:[\s\S]*/i, "")
    .replace(/The mandatory user visual instructions[\s\S]*/i, "")
    .trim();

  const lower = cleaned.toLowerCase();

  const clothingLock = lower.includes("panti")
    ? "wearing only panties, bare back, no bra straps"
    : "";

  const poseLock =
    lower.includes("stomach") || lower.includes("on your stomach")
      ? "lying on her stomach, looking back over her shoulder, cropped at mid-thigh"
      : "cropped at mid-thigh";

  const finalPrompt = `
ERIKAFINAL, exact same woman as always, same face, same body, same long dark wavy hair,
${cleaned},
${poseLock},
${clothingLock},
close crop from head to thighs,
natural body, two arms, correct anatomy,
candid iphone photo, ordinary bedroom, natural indoor light,
real skin, visible pores
`.replace(/\s+/g, " ").trim();

  console.log("USING ERIKA LORA BACKEND");
  console.log("FINAL PROMPT:", finalPrompt);

  const response = await fetch(MODEL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        prompt: finalPrompt,
        lora_weights: ERIKA_LORA,
        lora_scale: 1.1,
        extra_lora: REALISM_LORA,
        extra_lora_scale: 0.65,
        guidance: 2.4,
        num_inference_steps: 32,
        aspect_ratio: "4:5",
        num_outputs: 1,
        go_fast: false,
        megapixels: "1",
        output_format: "jpg",
        output_quality: 95,
        seed: getRandomSeed(),
        disable_safety_checker: true,
      },
    }),
  });

  const prediction = await response.json();

  if (!response.ok) {
    console.error("MODEL START ERROR:", prediction);
    throw new Error(
      prediction?.detail || prediction?.error || "Could not start photo generation"
    );
  }

  console.log("PREDICTION ID:", prediction.id);

  const result = await waitForPrediction(prediction);

  if (result.status !== "succeeded") {
    console.error("GENERATION FAILED:", result);
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
  if (!imageResponse.ok) {
    throw new Error("Could not download generated image");
  }

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
    const errorText = await response.text();
    console.error("SUPABASE UPLOAD ERROR:", errorText);
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
    } catch (err) {
      console.error("Failed to parse body:", err);
      body = {};
    }

    console.log("PARSED BODY:", body);

    const rawPrompt =
      body?.prompt ??
      body?.photo_prompt ??
      body?.photoPrompt ??
      body?.message ??
      body?.text ??
      "";

    const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";

    console.log("EXTRACTED PROMPT:", prompt);

    if (!prompt) {
      return Response.json(
        {
          error: "No photo prompt received",
          debug: {
            rawBody,
            parsedBody: body,
          },
        },
        { status: 400 }
      );
    }

    const imageUrl = await generateErikaPhoto(prompt);
    const stored = await saveImage(imageUrl);

    return Response.json({
      type: "photo",
      image: stored.publicUrl,
      imageUrl: stored.publicUrl,
      metadata: {
        backend: "erikafinal",
        originalPrompt: prompt,
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
