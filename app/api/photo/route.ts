export const runtime = "nodejs";
export const maxDuration = 120;

const replicateToken = process.env.REPLICATE_API_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// =====================================================
// ERIKA FINAL
// =====================================================

const ERIKA_TRIGGER = "ERIKAFINAL";

const ERIKA_LORA_WEIGHTS =
  "https://replicate.delivery/xezq/eOU7OpAeaHlwoEavigAhW5vYackREGjOGY3LCyv1MwWcAeiuA/flux-lora.tar";

// =====================================================
// REALISM LORA
// =====================================================

const REALISM_LORA =
  "huggingface.co/XLabs-AI/flux-RealismLora";

const REALISM_SCALE = 0.55;

// =====================================================
// REPLICATE MODEL
// =====================================================

const REPLICATE_RUNNER =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions";

// =====================================================
// PHOTO ROUTE
// =====================================================

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const prompt =
      typeof body?.prompt === "string"
        ? body.prompt.trim()
        : "";

    // -------------------------------------------------
    // VALIDATE REQUEST
    // -------------------------------------------------

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
    // BUILD PHOTO PROMPT
    //
    // User request stays at the front.
    // Realism language is added automatically.
    // =================================================

    const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

photorealistic real-life photograph,
realistic smartphone-camera rendering,
natural skin texture,
visible subtle pores,
natural skin tone variation,
realistic facial detail,
natural individual hair strands,
realistic flyaway hairs,
natural hair texture,
realistic fabric texture,
natural fabric folds,
realistic fabric compression,
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
natural asymmetry,
unretouched appearance,
authentic candid photography
`.trim();

    console.log("====================================");
    console.log("ERIKAFINAL PHOTO");
    console.log("Original prompt:", prompt);
    console.log("Final prompt:", finalPrompt);
    console.log("Erika LoRA: 1.0");
    console.log("Realism LoRA:", REALISM_SCALE);
    console.log("====================================");

    // =================================================
    // START REPLICATE GENERATION
    // =================================================

    const predictionResponse = await fetch(
      REPLICATE_RUNNER,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          input: {
            // ------------------------------------------
            // PROMPT
            // ------------------------------------------

            prompt: finalPrompt,

            // ------------------------------------------
            // ERIKA CHARACTER LORA
            // ------------------------------------------

            lora_weights:
              ERIKA_LORA_WEIGHTS,

            lora_scale:
              1.0,

            // ------------------------------------------
            // REALISM LORA
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
    // REPLICATE START ERROR
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
      "Prediction created:",
      prediction.id,
      prediction.status
    );

    // =================================================
    // POLL REPLICATE
    // =================================================

    let attempts = 0;

    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled" &&
      attempts < 100
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
        "ERIKA STATUS:",
        prediction.status
      );
    }

    // =================================================
    // GENERATION FAILED
    // =================================================

    if (prediction.status === "failed") {
      console.error(
        "ERIKA GENERATION FAILED:",
        prediction
      );

      return Response.json(
        {
          error:
            prediction.error ||
            "Erika photo generation failed",

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

    // =================================================
    // GENERATION CANCELED
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
    // GENERATION TIMEOUT
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
    // GET OUTPUT IMAGE
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
            "Replicate completed but returned no image",
        },
        {
          status: 500,
        }
      );
    }

    console.log(
      "Replicate image:",
      replicateImageUrl
    );

    // =================================================
    // DOWNLOAD IMAGE FROM REPLICATE
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
    // CREATE FILE NAME
    // =================================================

    const fileName =
      `erika-${Date.now()}-${crypto.randomUUID()}.jpg`;

    // =================================================
    // SAVE PERMANENTLY TO SUPABASE
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
    // PERMANENT SUPABASE IMAGE URL
    // =================================================

    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    // =================================================
    // SUCCESS
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
