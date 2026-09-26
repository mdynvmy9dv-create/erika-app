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

// Exact realism weights URL that worked for you
const REALISM_LORA =
  "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors";

const ERIKA_LORA_SCALE = 1.0;
const REALISM_LORA_SCALE = 0.55;

const REPLICATE_RUNNER =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions";

// =====================================================
// PHOTO ROUTE
// =====================================================

export async function POST(req: Request) {
  try {
    const body = await req.json();

    console.log("PHOTO BODY RECEIVED:", body);

    // Accept every likely field name from the existing app
    const rawPrompt =
      body?.prompt ??
      body?.photo_prompt ??
      body?.photoPrompt ??
      body?.message ??
      body?.text ??
      "";

    const prompt =
      typeof rawPrompt === "string"
        ? rawPrompt.trim()
        : "";

    if (!prompt) {
      console.error(
        "PHOTO ROUTE: no prompt found in request body:",
        body
      );

      return Response.json(
        {
          error: "No photo prompt received",
          receivedKeys:
            body && typeof body === "object"
              ? Object.keys(body)
              : [],
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
    // FINAL IMAGE PROMPT
    // =================================================

    const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

photorealistic real-life photograph,
realistic smartphone-camera rendering,
natural skin texture,
subtle visible pores,
natural skin tone variation,
realistic facial detail,
individual hair strands,
natural flyaway hairs,
realistic hair texture,
realistic fabric texture,
natural fabric folds and compression,
natural body posture,
realistic anatomy,
natural human proportions,
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
    console.log("====================================");

    // =================================================
    // START REPLICATE
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
            prompt: finalPrompt,

            // Erika
            lora_weights:
              ERIKA_LORA_WEIGHTS,

            lora_scale:
              ERIKA_LORA_SCALE,

            // Realism
            extra_lora:
              REALISM_LORA,

            extra_lora_scale:
              REALISM_LORA_SCALE,

            // Rendering
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
      "ERIKA PREDICTION CREATED:",
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
    // FAILURE
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
            "Replicate completed but returned no image",
        },
        {
          status: 500,
        }
      );
    }

    // =================================================
    // DOWNLOAD IMAGE
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
    // SAVE TO SUPABASE
    // =================================================

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
    // PERMANENT URL
    // =================================================

    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    // =================================================
    // SUCCESS
    // =================================================

    return Response.json({
      image:
        permanentImageUrl,

      // Include this too in case the frontend expects imageUrl
      imageUrl:
        permanentImageUrl,

      type:
        "photo",

      metadata: {
        prediction_id:
          prediction.id,

        character:
          "ERIKAFINAL",

        trigger:
          ERIKA_TRIGGER,

        erika_lora_scale:
          ERIKA_LORA_SCALE,

        realism_lora_scale:
          REALISM_LORA_SCALE,

        guidance:
          2.2,

        steps:
          28,

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
