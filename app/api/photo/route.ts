export const runtime = "nodejs";
export const maxDuration = 120;

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = "erika-photos";

// ===============================
// ERIKA FINAL SETTINGS
// ===============================
const ERIKA_TRIGGER = "ERIKAFINAL";

const ERIKA_LORA_WEIGHTS =
  "https://replicate.delivery/xezq/eOU7OpAeaHlwoEavigAhW5vYackREGjOGY3LCyv1MwWcAeiuA/flux-lora.tar";

const REALISM_LORA =
  "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors";

// Good starting values
const ERIKA_LORA_SCALE = 1.0;
const REALISM_LORA_SCALE = 0.6;
const GUIDANCE = 2.2;
const STEPS = 28;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    console.log("PHOTO BODY:", body);

    const rawPrompt =
      body?.prompt ??
      body?.photo_prompt ??
      body?.photoPrompt ??
      body?.message ??
      body?.text ??
      "";

    const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";

    if (!prompt) {
      return Response.json(
        {
          error: "No photo prompt received",
          receivedKeys:
            body && typeof body === "object" ? Object.keys(body) : [],
        },
        { status: 400 }
      );
    }

    if (!REPLICATE_API_TOKEN) {
      return Response.json(
        { error: "Missing REPLICATE_API_TOKEN" },
        { status: 500 }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json(
        {
          error:
            "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
    }

    const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

photorealistic real-life photograph,
realistic smartphone-camera rendering,
natural skin texture,
subtle pores,
natural skin tone variation,
realistic facial detail,
realistic hair strands,
natural hair texture,
realistic fabric texture,
realistic anatomy,
natural feminine proportions,
soft natural lighting,
slight lens softness,
subtle sensor noise,
unretouched real-life photography
    `.trim();

    console.log("FINAL PROMPT:", finalPrompt);

    // Start Replicate prediction
    const startRes = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: {
            prompt: finalPrompt,

            // Main Erika LoRA
            lora_weights: ERIKA_LORA_WEIGHTS,
            lora_scale: ERIKA_LORA_SCALE,

            // Realism LoRA
            extra_lora: REALISM_LORA,
            extra_lora_scale: REALISM_LORA_SCALE,

            guidance: GUIDANCE,
            num_inference_steps: STEPS,
            aspect_ratio: "4:5",
            num_outputs: 1,
            go_fast: false,
            megapixels: "1",
            output_format: "jpg",
            output_quality: 95,
          },
        }),
      }
    );

    const startData = await startRes.json();

    if (!startRes.ok) {
      console.error("REPLICATE START ERROR:", startData);
      return Response.json(
        {
          error: "Failed to start photo generation",
          details: startData,
        },
        { status: 500 }
      );
    }

    let prediction = startData;
    console.log("PREDICTION STARTED:", prediction.id, prediction.status);

    // Poll until done
    let tries = 0;
    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled" &&
      tries < 100
    ) {
      await sleep(1000);
      tries++;

      const pollRes = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          },
          cache: "no-store",
        }
      );

      const pollData = await pollRes.json();

      if (!pollRes.ok) {
        console.error("REPLICATE POLL ERROR:", pollData);
        return Response.json(
          {
            error: "Failed checking prediction status",
            details: pollData,
          },
          { status: 500 }
        );
      }

      prediction = pollData;
      console.log("PREDICTION STATUS:", prediction.status);
    }

    if (prediction.status === "failed") {
      console.error("PREDICTION FAILED:", prediction);
      return Response.json(
        {
          error: prediction.error || "Prediction failed",
          details: prediction,
        },
        { status: 500 }
      );
    }

    if (prediction.status === "canceled") {
      return Response.json(
        { error: "Prediction canceled" },
        { status: 500 }
      );
    }

    if (prediction.status !== "succeeded") {
      return Response.json(
        {
          error: "Prediction timed out",
          status: prediction.status,
        },
        { status: 504 }
      );
    }

    const outputUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;

    if (!outputUrl || typeof outputUrl !== "string") {
      return Response.json(
        {
          error: "No image returned from Replicate",
          output: prediction.output,
        },
        { status: 500 }
      );
    }

    // Download generated image
    const imageRes = await fetch(outputUrl);
    if (!imageRes.ok) {
      const text = await imageRes.text();
      console.error("IMAGE DOWNLOAD ERROR:", text);
      return Response.json(
        { error: "Failed to download generated image" },
        { status: 500 }
      );
    }

    const imageBuffer = await imageRes.arrayBuffer();
    const fileName = `erika-${Date.now()}-${crypto.randomUUID()}.jpg`;

    // Upload to Supabase Storage
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${fileName}`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "image/jpeg",
          "x-upsert": "false",
        },
        body: imageBuffer,
      }
    );

    if (!uploadRes.ok) {
      const uploadText = await uploadRes.text();
      console.error("SUPABASE UPLOAD ERROR:", uploadText);
      return Response.json(
        {
          error: "Image generated but failed to save to Supabase",
          details: uploadText,
        },
        { status: 500 }
      );
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;

    return Response.json({
      type: "photo",
      image: publicUrl,
      imageUrl: publicUrl,
      prompt,
      finalPrompt,
      predictionId: prediction.id,
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
