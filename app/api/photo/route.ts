export const runtime = "nodejs";
export const maxDuration = 120;

const replicateToken = process.env.REPLICATE_API_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// =====================================================
// ERIKA FINAL CHARACTER
// =====================================================

const ERIKA_TRIGGER = "ERIKAFINAL";

const ERIKA_LORA_WEIGHTS =
  "https://replicate.delivery/xezq/eOU7OpAeaHlwoEavigAhW5vYackREGjOGY3LCyv1MwWcAeiuA/flux-lora.tar";

// =====================================================
// REALISM LORA
//
// Second LoRA layered on top of Erika.
// Start at 0.55 so it improves photographic rendering
// without overpowering Erika's identity.
// =====================================================

const REALISM_LORA =
  "huggingface.co/XLabs-AI/flux-RealismLora/lora.safetensors";

const REALISM_SCALE = 0.55;

// =====================================================
// REPLICATE RUNNER
// =====================================================

const REPLICATE_RUNNER =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions";

// =====================================================
// PHOTO ROUTE
// =====================================================

export async function POST(req: Request) {
  try {
    // -------------------------------------------------
    // READ REQUEST
    // -------------------------------------------------

    const body = await req.json();

    const prompt =
      typeof body?.prompt === "string"
        ? body.prompt.trim()
        : "";

    if (!prompt) {
      return Response.json(
        {
          error: "Prompt is required",
        },
        {
          status: 400,
        }
      );
    }

    // -------------------------------------------------
    // CHECK ENVIRONMENT VARIABLES
    // -------------------------------------------------

    if (!replicateToken) {
      return Response.json(
        {
          error: "Missing REPLICATE_API_TOKEN",
        },
        {
          status: 500,
        }
      );
    }

    if (!supabaseUrl || !supabaseKey) {
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
    // BUILD FINAL PHOTO PROMPT
    //
    // User instructions remain near the beginning.
    // The app automatically adds realistic rendering.
    // =================================================

    const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

photorealistic real-life photograph,
realistic smartphone camera rendering,
natural skin texture,
visible subtle pores,
natural skin tone variation,
realistic facial detail,
natural individual hair strands,
realistic flyaway hairs,
natural hair texture,
realistic fabric texture,
realistic fabric folds and compression,
natural body posture,
realistic anatomy,
natural human proportions,
realistic hands and fingers,
believable natural lighting,
realistic shadows,
slight optical lens softness,
subtle camera sensor noise,
natural depth of field,
minor photographic imperfections,
unretouched appearance,
authentic candid photography
`.trim();

    console.log("========================================");
    console.log("ERIKAFINAL PHOTO REQUEST");
    console.log("User prompt:", prompt);
    console.log("Final prompt:", finalPrompt);
    console.log("Erika LoRA scale: 1.0");
    console.log("Realism LoRA scale:", REALISM_SCALE);
    console.log("========================================");

    // =================================================
    // CREATE REPLICATE PREDICTION
    // =================================================

    const predictionResponse = await fetch(
      REPLICATE_RUNNER,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",

          // If the model is warm, Replicate can return
          // the result immediately instead of polling.
          Prefer: "wait=60",
        },

        body: JSON.stringify({
          input: {
            // ------------------------------------------
            // PROMPT
            // ------------------------------------------

            prompt: finalPrompt,

            // ------------------------------------------
            // PRIMARY LORA — ERIKA
            // ------------------------------------------

            lora_weights:
              ERIKA_LORA_WEIGHTS,

            lora_scale:
              1.0,

            // ------------------------------------------
            // SECONDARY LORA — REALISM
            // ------------------------------------------

            extra_lora:
              REALISM_LORA,

            extra_lora_scale:
              REALISM_SCALE,

            // ------------------------------------------
            // GENERATION SETTINGS
            // ------------------------------------------

            guidance:
              2.2,

            num_inference_steps:
              28,

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
      await predictionResponse.json();

    // =================================================
    // HANDLE CREATION ERROR
    // =================================================

    if (!predictionResponse.ok) {
      console.error(
        "REPLICATE START ERROR:",
        prediction
      );

      return Response.json(
        {
          error:
            "Could not start Erika photo generation",

          details:
            prediction,
        },
        {
          status: 500,
        }
      );
    }

    console.log(
      "ERIKAFINAL PREDICTION:",
      prediction.id,
      prediction.status
    );

    // =================================================
    // POLL UNTIL COMPLETE
    // =================================================

    let attempts = 0;

    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled" &&
      attempts < 90
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, 1000)
      );

      attempts++;

      const checkResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization:
              `Bearer ${replicateToken}`,
          },

          cache: "no-store",
        }
      );

      const checkData =
        await checkResponse.json();

      if (!checkResponse.ok) {
        console.error(
          "REPLICATE STATUS ERROR:",
          checkData
        );

        return Response.json(
          {
            error:
              "Could not check Erika photo status",

            details:
              checkData,
          },
          {
            status: 500,
          }
        );
      }

      prediction = checkData;

      console.log(
        "ERIKAFINAL STATUS:",
        prediction.status
      );
    }

    // =================================================
    // FAILED
    // =================================================

    if (prediction.status === "failed") {
      console.error(
        "ERIKAFINAL GENERATION FAILED:",
        prediction
      );

      return Response.json(
        {
          error:
            prediction.error ||
            "Erika photo generation failed",

          predictionId:
            prediction.id,
        },
        {
          status: 500,
        }
      );
    }

    // =================================================
    // CANCELED
    // =================================================

    if (prediction.status === "canceled") {
      return Response.json(
        {
          error:
            "Erika photo generation was canceled",

          predictionId:
            prediction.id,
        },
        {
          status: 500,
        }
      );
    }

    // =================================================
    // TIMEOUT
    // =================================================

    if (prediction.status !== "succeeded") {
      return Response.json(
        {
          error:
            "Erika photo generation timed out",

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
    // GET GENERATED IMAGE
    // =================================================

    const replicateImageUrl =
      Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;

    if (
      !replicateImageUrl ||
      typeof replicateImageUrl !== "string"
    ) {
      console.error(
        "NO IMAGE RETURNED:",
        prediction.output
      );

      return Response.json(
        {
          error:
            "Replicate finished but returned no image",
        },
        {
          status: 500,
        }
      );
    }

    // =================================================
    // DOWNLOAD FROM REPLICATE
    // =================================================

    const imageResponse =
      await fetch(replicateImageUrl);

    if (!imageResponse.ok) {
      const imageError =
        await imageResponse.text();

      console.error(
        "IMAGE DOWNLOAD ERROR:",
        imageError
      );

      return Response.json(
        {
          error:
            "Could not download generated Erika photo",
        },
        {
          status: 500,
        }
      );
    }

    const imageBytes =
      await imageResponse.arrayBuffer();

    // =================================================
    // CREATE PERMANENT FILE NAME
    // =================================================

    const fileName =
      `erika-${Date.now()}-${crypto.randomUUID()}.jpg`;

    // =================================================
    // UPLOAD TO SUPABASE
    // =================================================

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
        "SUPABASE UPLOAD ERROR:",
        uploadError
      );

      return Response.json(
        {
          error:
            "Erika generated the photo, but it could not be saved",

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

    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    // =================================================
    // RETURN PHOTO TO APP
    // =================================================

    return Response.json({
      image:
        permanentImageUrl,

      metadata: {
        prediction_id:
          prediction.id,

        character:
          "ERIKAFINAL",

        trigger:
          ERIKA_TRIGGER,

        runner:
          "black-forest-labs/flux-dev-lora",

        erika_lora:
          ERIKA_LORA_WEIGHTS,

        erika_lora_scale:
          1.0,

        realism_lora:
          REALISM_LORA,

        realism_lora_scale:
          REALISM_SCALE,

        guidance:
          2.2,

        steps:
          28,

        aspect_ratio:
          "4:5",

        original_prompt:
          prompt,

        final_prompt:
          finalPrompt,

        storage_file:
          fileName,

        permanent:
          true,
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
            : "Something went wrong generating Erika's photo",
      },
      {
        status: 500,
      }
    );
  }
}
