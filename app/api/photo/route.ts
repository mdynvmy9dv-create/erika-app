import { NextResponse } from "next/server";
import Replicate from "replicate";
import { createClient } from "@supabase/supabase-js";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = process.env.ERIKA_BUCKET || "erika-photos";
const REFERENCE_FOLDER = process.env.ERIKA_REFERENCE_FOLDER || "references";

// Your newly trained LoRA weights URL from Replicate training output
const ERIKA_LORA_URL =
  process.env.ERIKA_LORA_URL ||
  "https://replicate.delivery/xezq/eOU7OpAeaHlwoEavigAhW5vYackREGjOGY3LCyv1MwWcAeiuA/flux-lora.tar";

// Realism LoRA
const REALISM_LORA_URL =
  process.env.REALISM_LORA_URL ||
  "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors";

// Trigger word from your current training
const ERIKA_TRIGGER = process.env.ERIKA_TRIGGER_WORD || "ERIKAFINAL";

function buildPrompt(userPrompt?: string) {
  const basePrompt =
    userPrompt?.trim() ||
    "a realistic candid photo of Erika, relaxed natural pose, casual fitted outfit, comfortable modern home setting, soft natural window light, realistic smartphone-camera framing";

  return `${ERIKA_TRIGGER}, ${basePrompt}

photorealistic real-life photograph,
realistic smartphone camera rendering,
natural skin texture,
subtle visible pores,
natural skin color variation,
realistic facial detail,
individual hair strands,
natural flyaway hairs,
realistic dark wavy hair texture,
realistic fabric texture,
natural fabric folds,
natural posture,
realistic anatomy,
natural human proportions,
realistic hands,
believable lighting,
natural shadows,
slight optical lens softness,
subtle camera sensor noise,
natural depth of field,
minor photographic imperfections,
natural facial and body asymmetry,
unretouched appearance,
authentic candid photography`;
}

async function getRandomReferenceImageUrl() {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(REFERENCE_FOLDER, {
      limit: 100,
      sortBy: { column: "name", order: "asc" },
    });

  if (error) {
    console.error("SUPABASE LIST ERROR:", error);
    return null;
  }

  const validFiles = (data || []).filter((file) => {
    const name = file.name.toLowerCase();
    return (
      !file.name.startsWith(".") &&
      (name.endsWith(".jpg") ||
        name.endsWith(".jpeg") ||
        name.endsWith(".png") ||
        name.endsWith(".webp"))
    );
  });

  if (!validFiles.length) {
    console.error("No reference files found in Supabase references folder.");
    return null;
  }

  const randomFile =
    validFiles[Math.floor(Math.random() * validFiles.length)];

  const path = `${REFERENCE_FOLDER}/${randomFile.name}`;

  const { data: publicData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path);

  console.log("RANDOM REFERENCE CHOSEN:", path);
  return publicData.publicUrl;
}

function extractImageUrl(output: any): string | null {
  if (!output) return null;

  if (typeof output === "string") {
    return output;
  }

  if (Array.isArray(output) && output.length > 0) {
    if (typeof output[0] === "string") return output[0];
    if (output[0]?.url) return output[0].url;
  }

  if (output?.url) return output.url;

  return null;
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    let body: any = {};

    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (parseError) {
      console.error("PHOTO BODY PARSE ERROR:", parseError);
      console.error("RAW BODY:", rawBody);
      body = {};
    }

    console.log("PHOTO BODY RECEIVED:", body);

    const userPrompt =
      typeof body.prompt === "string" ? body.prompt : "";

    const finalPrompt = buildPrompt(userPrompt);

    console.log("PROMPT USED:", userPrompt);
    console.log("FINAL ERIKA PROMPT:", finalPrompt);

    // Optional helper:
    // If you later want a second backend that uses a random Erika reference,
    // this is ready to go.
    const randomReferenceUrl = await getRandomReferenceImageUrl();

    // Primary generation: your new LoRA + realism LoRA
    const input = {
      prompt: finalPrompt,
      aspect_ratio: "4:5",
      lora_weights: ERIKA_LORA_URL,
      lora_scale: 1,
      extra_lora: REALISM_LORA_URL,
      extra_lora_scale: 0.55,
      guidance: 2.2,
      num_inference_steps: 28,
      num_outputs: 1,
      output_format: "jpg",
      output_quality: 95,
      megapixels: "1",
      go_fast: false,
    };

    const output = await replicate.run(
      "black-forest-labs/flux-dev-lora",
      { input }
    );

    const image = extractImageUrl(output);

    if (!image) {
      console.error("PHOTO OUTPUT EMPTY:", output);
      return NextResponse.json(
        {
          error: "No image returned from model.",
          metadata: {
            prompt: finalPrompt,
            reference_used: randomReferenceUrl,
          },
        },
        { status: 500 }
      );
    }

    console.log("PHOTO SUCCESS:", image);

    return NextResponse.json({
      image,
      metadata: {
        prompt: finalPrompt,
        model: "black-forest-labs/flux-dev-lora",
        lora: ERIKA_LORA_URL,
        realism_lora: REALISM_LORA_URL,
        reference_used: randomReferenceUrl,
      },
    });
  } catch (error: any) {
    console.error("PHOTO FAILED:", error);

    return NextResponse.json(
      {
        error:
          error?.message || "Photo generation failed.",
      },
      { status: 500 }
    );
  }
}
