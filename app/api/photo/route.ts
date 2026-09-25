export const runtime = "nodejs";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const replicateToken = process.env.REPLICATE_API_TOKEN;

const FACE_LORA_URL =
  "https://pub-6c78a23ee9fc455dac17546e08d02ce9.r2.dev/erikaface.safetensors";

const BODY_LORA_URL =
  "https://pub-6c78a23ee9fc455dac17546e08d02ce9.r2.dev/erikabody.safetensors";

type PhotoPreset =
  | "gym"
  | "beach"
  | "home"
  | "evening"
  | "mirror"
  | "casual";

function detectPreset(prompt: string): PhotoPreset {
  const text = prompt.toLowerCase();

  if (
    text.includes("gym") ||
    text.includes("workout") ||
    text.includes("leggings") ||
    text.includes("sports bra")
  ) {
    return "gym";
  }

  if (
    text.includes("beach") ||
    text.includes("bikini") ||
    text.includes("swimsuit") ||
    text.includes("pool")
  ) {
    return "beach";
  }

  if (
    text.includes("gown") ||
    text.includes("dress") ||
    text.includes("dinner") ||
    text.includes("evening")
  ) {
    return "evening";
  }

  if (
    text.includes("mirror") ||
    text.includes("mirror selfie")
  ) {
    return "mirror";
  }

  if (
    text.includes("home") ||
    text.includes("bedroom") ||
    text.includes("couch") ||
    text.includes("silk") ||
    text.includes("robe") ||
    text.includes("lingerie")
  ) {
    return "home";
  }

  return "casual";
}

function getPresetText(preset: PhotoPreset) {
  switch (preset) {
    case "gym":
      return `
ordinary gym mirror photo taken on a phone,
real gym lighting,
natural standing posture,
believable athletic clothing fit,
slight mirror distortion,
casual composition,
background gym equipment,
not a professional fitness advertisement
`;

    case "beach":
      return `
ordinary beach phone photo,
natural outdoor sunlight,
realistic shadows from direct sun,
slight squinting and natural facial expression,
wind affecting individual hair strands,
casual beach posture,
real sand and ocean detail,
slightly imperfect vacation-photo framing
`;

    case "home":
      return `
casual intimate at-home phone photo,
warm ambient household lighting,
relaxed natural posture,
soft ordinary interior background,
believable fabric drape,
slight camera softness,
comfortable candid composition
`;

    case "evening":
      return `
casual phone photograph before going out,
realistic evening clothing fit and fabric drape,
natural indoor ambient light,
elegant but believable styling,
relaxed posture,
ordinary room background,
not a fashion campaign
`;

    case "mirror":
      return `
realistic handheld mirror selfie,
phone visible when appropriate,
natural mirror perspective,
slight perspective distortion,
ordinary room lighting,
casual posture,
imperfect framing typical of a real phone selfie
`;

    default:
      return `
ordinary candid smartphone photograph,
natural environment,
relaxed posture,
ambient available light,
slightly imperfect framing,
believable everyday photography
`;
  }
}

function buildPrompt(userPrompt: string) {
  const preset = detectPreset(userPrompt);
  const presetText = getPresetText(preset);

  const realism = `
ERIKAFACE, ERIKABODY.

${userPrompt}

${presetText}

Erika is an adult woman.
Preserve her established identity while keeping her anatomy believable and naturally proportioned.
Her figure can be feminine, curvy, attractive and sensual when the requested styling calls for it, while remaining physically plausible.

Photographic rendering:
ordinary modern iPhone camera appearance,
natural uneven skin texture,
subtle pores and skin variation,
minor facial asymmetry,
individual hair strands and flyaways,
realistic fabric texture,
soft lens rendering,
subtle sensor noise,
natural depth of field,
available-light exposure,
unretouched candid appearance.

The photograph should look like an ordinary real phone photo rather than polished AI glamour art.
`.trim();

  return {
    preset,
    prompt: realism,
  };
}

async function createPrediction(finalPrompt: string) {
  const response = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },

      body: JSON.stringify({
        input: {
          prompt: finalPrompt,

          // FACE:
          // Strong enough to keep Erika recognizable,
          // but below 1.0 to reduce the trained/glamour look.
          lora_weights: FACE_LORA_URL,
          lora_scale: 0.68,

          // BODY:
          // Intentionally low.
          // It should influence proportions rather than redraw her body.
          extra_lora: BODY_LORA_URL,
          extra_lora_scale: 0.07,

          aspect_ratio: "4:5",
          num_outputs: 1,

          num_inference_steps: 30,

          // Lower guidance tends to look less synthetic.
          guidance: 2.0,

          output_format: "jpg",
          output_quality: 95,
          megapixels: "1",

          // Keep full-quality FLUX inference.
          go_fast: false,
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Replicate prediction creation error:", data);

    throw new Error(
      data?.detail ||
        data?.error ||
        "Could not start Replicate generation"
    );
  }

  return data;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const userPrompt =
      typeof body.prompt === "string"
        ? body.prompt.trim()
        : "";

    if (!userPrompt) {
      return Response.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    if (!replicateToken) {
      return Response.json(
        { error: "Missing REPLICATE_API_TOKEN" },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !supabaseKey) {
      return Response.json(
        {
          error:
            "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
    }

    const built = buildPrompt(userPrompt);

    let prediction =
      await createPrediction(built.prompt);

    // --------------------------------------------
    // WAIT FOR REPLICATE TO FINISH
    // --------------------------------------------

    for (let i = 0; i < 75; i++) {
      if (
        prediction.status === "succeeded" ||
        prediction.status === "failed" ||
        prediction.status === "canceled"
      ) {
        break;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 1000)
      );

      const statusResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization:
              `Bearer ${replicateToken}`,
          },
        }
      );

      const statusData =
        await statusResponse.json();

      if (!statusResponse.ok) {
        console.error(
          "Replicate status error:",
          statusData
        );

        return Response.json(
          {
            error:
              "Could not check photo generation",
          },
          { status: 500 }
        );
      }

      prediction =
        statusData;
    }

    // --------------------------------------------
    // HANDLE FAILURE
    // --------------------------------------------

    if (
      prediction.status !== "succeeded"
    ) {
      console.error(
        "Prediction did not succeed:",
        prediction
      );

      return Response.json(
        {
          error:
            prediction.error ||
            "Photo generation did not succeed",

          predictionId:
            prediction.id,
        },
        { status: 500 }
      );
    }

    // --------------------------------------------
    // GET GENERATED IMAGE
    // --------------------------------------------

    const replicateImageUrl =
      Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;

    if (
      !replicateImageUrl ||
      typeof replicateImageUrl !== "string"
    ) {
      return Response.json(
        {
          error:
            "Replicate returned no image",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------
    // DOWNLOAD GENERATED IMAGE
    // --------------------------------------------

    const imageResponse =
      await fetch(replicateImageUrl);

    if (!imageResponse.ok) {
      console.error(
        "Generated image download failed:",
        await imageResponse.text()
      );

      return Response.json(
        {
          error:
            "Could not download generated photo",
        },
        { status: 500 }
      );
    }

    const imageBytes =
      await imageResponse.arrayBuffer();

    // --------------------------------------------
    // SAVE PERMANENTLY TO SUPABASE
    // --------------------------------------------

    const fileName =
      `erika-${Date.now()}-${crypto.randomUUID()}.jpg`;

    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/erika-photos/${fileName}`,
      {
        method: "POST",

        headers: {
          apikey:
            supabaseKey,

          Authorization:
            `Bearer ${supabaseKey}`,

          "Content-Type":
            "image/jpeg",

          "x-upsert":
            "false",
        },

        body:
          imageBytes,
      }
    );

    if (!uploadResponse.ok) {
      const uploadError =
        await uploadResponse.text();

      console.error(
        "Supabase photo upload error:",
        uploadError
      );

      return Response.json(
        {
          error:
            "Photo generated but could not be saved permanently",
        },
        { status: 500 }
      );
    }

    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    // IMPORTANT:
    // Keep "image" because your existing page.tsx
    // already expects this property.
    return Response.json({
      image:
        permanentImageUrl,

      metadata: {
        replicate_prediction_id:
          prediction.id,

        original_prompt:
          userPrompt,

        preset:
          built.preset,

        face_lora_scale:
          0.88,

        body_lora_scale:
          0.28,

        guidance:
          2.0,

        steps:
          30,

        storage_file:
          fileName,

        permanent:
          true,
      },
    });
  } catch (error) {
    console.error(
      "Photo route error:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong generating the photo",
      },
      { status: 500 }
    );
  }
}
