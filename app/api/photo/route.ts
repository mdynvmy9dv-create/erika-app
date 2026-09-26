export const runtime = "nodejs";
export const maxDuration = 120;

const replicateToken = process.env.REPLICATE_API_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// =====================================================
// CURRENT ERIKA
// =====================================================

const ERIKA_TRIGGER = "ERIKA407";

const ERIKA_LORA_WEIGHTS =
  "https://replicate.delivery/xezq/foQjh8G9WnQ2IanVxAScVn2xJRJGeMmfffM0rKWHecWc4bU0F/flux-lora.tar";

const REPLICATE_RUNNER =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions";

// =====================================================

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const prompt =
      typeof body?.prompt === "string"
        ? body.prompt.trim()
        : "";

    if (!prompt) {
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

    // =====================================================
    // BUILD PHOTO PROMPT
    // =====================================================

    const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

same adult woman,
photorealistic candid photograph,
natural skin texture,
subtle pores and natural skin variation,
realistic dark wavy hair with individual strands and flyaways,
natural facial detail,
realistic fabric texture,
natural feminine proportions,
realistic anatomy,
believable posture,
soft natural or cinematic lighting,
slight lens softness,
subtle camera sensor texture,
unretouched realistic photography
`.trim();

    console.log("ERIKA407 PROMPT:", finalPrompt);

    // =====================================================
    // START FLUX DEV LORA
    // =====================================================

    const predictionResponse = await fetch(
      REPLICATE_RUNNER,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
          Prefer: "wait=60",
        },

        body: JSON.stringify({
          input: {
            prompt: finalPrompt,

            lora_weights: ERIKA_LORA_WEIGHTS,
            lora_scale: 1,

            guidance: 2.5,
            num_inference_steps: 28,

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

    let prediction = await predictionResponse.json();

    if (!predictionResponse.ok) {
      console.error(
        "REPLICATE START ERROR:",
        prediction
      );

      return Response.json(
        {
          error: "Could not start Erika photo generation",
          details: prediction,
        },
        { status: 500 }
      );
    }

    console.log(
      "ERIKA407 PREDICTION:",
      prediction.id,
      prediction.status
    );

    // =====================================================
    // POLL UNTIL COMPLETE
    // =====================================================

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
            Authorization: `Bearer ${replicateToken}`,
          },
          cache: "no-store",
        }
      );

      const checkData = await checkResponse.json();

      if (!checkResponse.ok) {
        console.error(
          "REPLICATE STATUS ERROR:",
          checkData
        );

        return Response.json(
          {
            error: "Could not check Erika photo status",
            details: checkData,
          },
          { status: 500 }
        );
      }

      prediction = checkData;

      console.log(
        "ERIKA407 STATUS:",
        prediction.status
      );
    }

    // =====================================================
    // FAILURE HANDLING
    // =====================================================

    if (prediction.status === "failed") {
      console.error(
        "ERIKA407 FAILED:",
        prediction
      );

      return Response.json(
        {
          error:
            prediction.error ||
            "Erika photo generation failed",
          predictionId: prediction.id,
        },
        { status: 500 }
      );
    }

    if (prediction.status === "canceled") {
      return Response.json(
        {
          error: "Erika photo generation was canceled",
        },
        { status: 500 }
      );
    }

    if (prediction.status !== "succeeded") {
      return Response.json(
        {
          error: "Erika photo generation timed out",
          status: prediction.status,
          predictionId: prediction.id,
        },
        { status: 504 }
      );
    }

    // =====================================================
    // GET GENERATED IMAGE
    // =====================================================

    const output = prediction.output;

    const replicateImageUrl =
      Array.isArray(output)
        ? output[0]
        : output;

    if (
      !replicateImageUrl ||
      typeof replicateImageUrl !== "string"
    ) {
      console.error(
        "NO IMAGE RETURNED:",
        output
      );

      return Response.json(
        {
          error: "Replicate returned no image",
        },
        { status: 500 }
      );
    }

    // =====================================================
    // DOWNLOAD IMAGE
    // =====================================================

    const imageResponse = await fetch(
      replicateImageUrl
    );

    if (!imageResponse.ok) {
      return Response.json(
        {
          error: "Could not download Erika photo",
        },
        { status: 500 }
      );
    }

    const imageBytes =
      await imageResponse.arrayBuffer();

    // =====================================================
    // SAVE TO SUPABASE
    // =====================================================

    const fileName =
      `erika-${Date.now()}-${crypto.randomUUID()}.jpg`;

    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/erika-photos/${fileName}`,
      {
        method: "POST",

        headers: {
          apikey: supabaseKey,

          Authorization:
            `Bearer ${supabaseKey}`,

          "Content-Type": "image/jpeg",

          "x-upsert": "false",
        },

        body: imageBytes,
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
            "Photo generated but could not be saved",
          details: uploadError,
        },
        { status: 500 }
      );
    }

    // =====================================================
    // PERMANENT PHOTO URL
    // =====================================================

    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    return Response.json({
      image: permanentImageUrl,

      metadata: {
        prediction_id: prediction.id,

        runner:
          "black-forest-labs/flux-dev-lora",

        trigger:
          ERIKA_TRIGGER,

        lora_weights:
          ERIKA_LORA_WEIGHTS,

        lora_scale:
          1,

        guidance:
          2.5,

        steps:
          28,

        original_prompt:
          prompt,

        final_prompt:
          finalPrompt,

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
      { status: 500 }
    );
  }
}
