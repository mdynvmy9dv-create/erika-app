export const runtime = "nodejs";
export const maxDuration = 120;

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = "erika-photos";

// =====================================================
// ERIKA — ONE CHARACTER LORA ONLY
// =====================================================

const ERIKA_TRIGGER = "ERIKAFINAL";

const ERIKA_LORA_WEIGHTS =
  "https://replicate.delivery/xezq/eOU7OpAeaHlwoEavigAhW5vYackREGjOGY3LCyv1MwWcAeiuA/flux-lora.tar";

// =====================================================
// REALISM LORA
// Exact direct weights URL you previously confirmed works
// =====================================================

const REALISM_LORA =
  "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors";

// =====================================================
// SETTINGS
// =====================================================

const ERIKA_SCALE = 1.0;
const REALISM_SCALE = 0.55;
const GUIDANCE = 2.2;
const STEPS = 28;

const REPLICATE_RUNNER =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =====================================================
// PHOTO ROUTE
// =====================================================

export async function POST(req: Request) {
  try {
    // -------------------------------------------------
    // READ BODY SAFELY
    // -------------------------------------------------

    let body: any = {};

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    console.log("PHOTO BODY RECEIVED:", body);

    // Accept basically every field name we've used before.
    const incomingPrompt =
      body?.prompt ??
      body?.photo_prompt ??
      body?.photoPrompt ??
      body?.message ??
      body?.text ??
      "";

    /*
      IMPORTANT:

      Your current frontend is sometimes sending {}.

      Instead of failing with 400, use a good default Erika
      photo request. This gets the app generating again even
      before we touch page.tsx.
    */

    const prompt =
      typeof incomingPrompt === "string" &&
      incomingPrompt.trim().length > 0
        ? incomingPrompt.trim()
        : `
a realistic candid photo of Erika,
relaxed natural pose,
casual fitted outfit,
comfortable modern home setting,
soft natural window light,
realistic smartphone-camera framing
`.trim();

    console.log("PROMPT USED:", prompt);

    // -------------------------------------------------
    // ENV CHECKS
    // -------------------------------------------------

    if (!REPLICATE_API_TOKEN) {
      return Response.json(
        {
          error: "Missing REPLICATE_API_TOKEN",
        },
        {
          status: 500,
        }
      );
    }

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return Response.json(
        {
          error:
            "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        },
        {
          status: 500,
        }
      );
    }

    // =================================================
    // BUILD FINAL PROMPT
    // =================================================

    const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

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
authentic candid photography
`.trim();

    console.log("FINAL ERIKA PROMPT:", finalPrompt);

    // =================================================
    // START REPLICATE
    // =================================================

    const startResponse = await fetch(
      REPLICATE_RUNNER,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${REPLICATE_API_TOKEN}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          input: {
            // Prompt
            prompt: finalPrompt,

            // Erika
            lora_weights:
              ERIKA_LORA_WEIGHTS,

            lora_scale:
              ERIKA_SCALE,

            // Realism
            extra_lora:
              REALISM_LORA,

            extra_lora_scale:
              REALISM_SCALE,

            // Rendering
            guidance:
              GUIDANCE,

            num_inference_steps:
              STEPS,

            aspect_ratio:
              "4:5",

            num_outputs:
              1,

            go_fast:
              false,

            megapixels:
              "1",

            output_format:
              "jpg",

            output_quality:
              95,
          },
        }),
      }
    );

    let prediction =
      await startResponse.json();

    if (!startResponse.ok) {
      console.error(
        "REPLICATE START ERROR:",
        prediction
      );

      return Response.json(
        {
          error:
            "Replicate could not start the photo",
          details:
            prediction,
        },
        {
          status: 500,
        }
      );
    }

    console.log(
      "PREDICTION:",
      prediction.id,
      prediction.status
    );

    // =================================================
    // POLL
    // =================================================

    let attempts = 0;

    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled" &&
      attempts < 100
    ) {
      await sleep(1000);

      attempts++;

      const pollResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization:
              `Bearer ${REPLICATE_API_TOKEN}`,
          },

          cache: "no-store",
        }
      );

      const pollData =
        await pollResponse.json();

      if (!pollResponse.ok) {
        console.error(
          "REPLICATE POLL ERROR:",
          pollData
        );

        return Response.json(
          {
            error:
              "Could not check photo status",
            details:
              pollData,
          },
          {
            status: 500,
          }
        );
      }

      prediction = pollData;

      console.log(
        "PHOTO STATUS:",
        prediction.status
      );
    }

    // =================================================
    // FAILURE
    // =================================================

    if (prediction.status === "failed") {
      console.error(
        "PHOTO FAILED:",
        prediction
      );

      return Response.json(
        {
          error:
            prediction.error ||
            "Photo generation failed",

          predictionId:
            prediction.id,

          details:
            prediction,
        },
        {
          status: 500,
        }
      );
    }

    if (prediction.status === "canceled") {
      return Response.json(
        {
          error:
            "Photo generation was canceled",
        },
        {
          status: 500,
        }
      );
    }

    if (prediction.status !== "succeeded") {
      return Response.json(
        {
          error:
            "Photo generation timed out",

          predictionId:
            prediction.id,

          status:
            prediction.status,
        },
        {
          status: 504,
        }
      );
    }

    // =================================================
    // GET IMAGE URL
    // =================================================

    const outputUrl =
      Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;

    if (
      !outputUrl ||
      typeof outputUrl !== "string"
    ) {
      return Response.json(
        {
          error:
            "Replicate returned no image",
        },
        {
          status: 500,
        }
      );
    }

    console.log(
      "REPLICATE IMAGE URL:",
      outputUrl
    );

    // =================================================
    // DOWNLOAD IMAGE
    // =================================================

    const imageResponse =
      await fetch(outputUrl);

    if (!imageResponse.ok) {
      const errorText =
        await imageResponse.text();

      console.error(
        "IMAGE DOWNLOAD ERROR:",
        errorText
      );

      return Response.json(
        {
          error:
            "Could not download generated image",
        },
        {
          status: 500,
        }
      );
    }

    const imageBytes =
      await imageResponse.arrayBuffer();

    // =================================================
    // SAVE TO SUPABASE
    // =================================================

    const fileName =
      `erika-${Date.now()}-${crypto.randomUUID()}.jpg`;

    const uploadResponse = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${fileName}`,
      {
        method: "POST",

        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

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
        "SUPABASE ERROR:",
        uploadError
      );

      return Response.json(
        {
          error:
            "Photo generated but could not be saved",

          details:
            uploadError,
        },
        {
          status: 500,
        }
      );
    }

    // =================================================
    // PERMANENT IMAGE URL
    // =================================================

    const publicUrl =
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;

    // =================================================
    // SUCCESS
    // =================================================

    return Response.json({
      type:
        "photo",

      image:
        publicUrl,

      imageUrl:
        publicUrl,

      prompt:
        prompt,

      metadata: {
        predictionId:
          prediction.id,

        trigger:
          ERIKA_TRIGGER,

        erikaScale:
          ERIKA_SCALE,

        realismScale:
          REALISM_SCALE,

        guidance:
          GUIDANCE,

        steps:
          STEPS,

        usedFallbackPrompt:
          !incomingPrompt ||
          typeof incomingPrompt !== "string" ||
          incomingPrompt.trim().length === 0,

        storageFile:
          fileName,
      },
    });
  } catch (error) {
    console.error(
      "PHOTO ROUTE ERROR:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown photo generation error",
      },
      {
        status: 500,
      }
    );
  }
}
