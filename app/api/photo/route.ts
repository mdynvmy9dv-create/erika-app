export const runtime = "nodejs";
export const maxDuration = 120;

const replicateToken = process.env.REPLICATE_API_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// --------------------------------------------------
// ERIKA V2
// --------------------------------------------------

const ERIKA_TRIGGER = "ERIKA407";

const ERIKA_LORA_WEIGHTS =
  "https://replicate.delivery/xezq/foQjh8G9WnQ2IanVxAScVn2xJRJGeMmfffM0rKWHecWc4bU0F/flux-lora.tar";

const REPLICATE_RUNNER =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions";

// --------------------------------------------------

export async function POST(req: Request) {
  try {
    // --------------------------------------------------
    // READ REQUEST
    // --------------------------------------------------

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

    // --------------------------------------------------
    // CHECK ENVIRONMENT VARIABLES
    // --------------------------------------------------

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

    // --------------------------------------------------
    // BUILD ERIKA PROMPT
    // --------------------------------------------------

    const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

realistic photograph of the same adult woman,
natural feminine proportions,
realistic skin texture,
subtle pores and natural skin variation,
realistic individual hair strands and flyaways,
natural facial detail,
realistic fabric texture,
natural posture,
soft believable lighting,
slight camera lens softness,
subtle photographic sensor texture,
highly realistic photography
`.trim();

    console.log("ERIKA PHOTO PROMPT:", finalPrompt);

    // --------------------------------------------------
    // CREATE REPLICATE PREDICTION
    //
    // This uses the SAME FLUX DEV LORA runner
    // that successfully generated ERIKA407 manually.
    // --------------------------------------------------

    const predictionResponse = await fetch(
      REPLICATE_RUNNER,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",

          // Give Replicate a chance to return the finished
          // image immediately when the model is warm.
          Prefer: "wait=60",
        },

        body: JSON.stringify({
          input: {
            prompt: finalPrompt,

            lora_weights: ERIKA_LORA_WEIGHTS,

            lora_scale: 1,

            guidance: 2.5,

            num_inference_steps: 28,

            num_outputs: 1,

            aspect_ratio: "4:5",

            megapixels: "1",

            go_fast: false,

            output_format: "webp",

            output_quality: 95,
          },
        }),
      }
    );

    let prediction =
      await predictionResponse.json();

    if (!predictionResponse.ok) {
      console.error(
        "Replicate creation error:",
        prediction
      );

      return Response.json(
        {
          error:
            "Replicate could not start the Erika photo",
          details: prediction,
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

    // --------------------------------------------------
    // POLL IF REPLICATE DID NOT FINISH IMMEDIATELY
    // --------------------------------------------------

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

      const statusResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization: `Bearer ${replicateToken}`,
          },

          cache: "no-store",
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
              "Could not check Erika photo status",
            details: statusData,
          },
          {
            status: 500,
          }
        );
      }

      prediction = statusData;

      console.log(
        "ERIKA STATUS:",
        prediction.id,
        prediction.status
      );
    }

    // --------------------------------------------------
    // HANDLE FAILED GENERATION
    // --------------------------------------------------

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
          predictionId: prediction.id,
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
          predictionId: prediction.id,
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
          predictionId: prediction.id,
          status: prediction.status,
        },
        {
          status: 504,
        }
      );
    }

    // --------------------------------------------------
    // GET IMAGE URL
    // --------------------------------------------------

    const replicateImageUrl =
      Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;

    if (
      !replicateImageUrl ||
      typeof replicateImageUrl !== "string"
    ) {
      console.error(
        "No image returned:",
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

    // --------------------------------------------------
    // DOWNLOAD IMAGE FROM REPLICATE
    // --------------------------------------------------

    const imageResponse = await fetch(
      replicateImageUrl
    );

    if (!imageResponse.ok) {
      const errorText =
        await imageResponse.text();

      console.error(
        "Image download failed:",
        errorText
      );

      return Response.json(
        {
          error:
            "Could not download Erika photo",
        },
        {
          status: 500,
        }
      );
    }

    const imageBytes =
      await imageResponse.arrayBuffer();

    // --------------------------------------------------
    // CREATE PERMANENT FILE NAME
    // --------------------------------------------------

    const fileName =
      `erika-${Date.now()}-${crypto.randomUUID()}.webp`;

    // --------------------------------------------------
    // UPLOAD IMAGE TO SUPABASE
    // --------------------------------------------------

    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/erika-photos/${fileName}`,
      {
        method: "POST",

        headers: {
          apikey: supabaseKey,

          Authorization:
            `Bearer ${supabaseKey}`,

          "Content-Type":
            "image/webp",

          "x-upsert":
            "false",
        },

        body: imageBytes,
      }
    );

    if (!uploadResponse.ok) {
      const uploadError =
        await uploadResponse.text();

      console.error(
        "Supabase upload failed:",
        uploadError
      );

      return Response.json(
        {
          error:
            "Erika generated the photo, but it could not be saved",
          details: uploadError,
        },
        {
          status: 500,
        }
      );
    }

    // --------------------------------------------------
    // BUILD PERMANENT URL
    // --------------------------------------------------

    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    // --------------------------------------------------
    // RETURN PHOTO TO APP
    // --------------------------------------------------

    return Response.json({
      image: permanentImageUrl,

      metadata: {
        prediction_id: prediction.id,

        runner:
          "black-forest-labs/flux-dev-lora",

        trigger:
          ERIKA_TRIGGER,

        lora_scale:
          1,

        guidance:
          2.5,

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
