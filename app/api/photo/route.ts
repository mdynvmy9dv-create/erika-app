export const runtime = "nodejs";
export const maxDuration = 120;

const replicateToken = process.env.REPLICATE_API_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// =====================================================
// FINAL ERIKA LORA
// =====================================================

const ERIKA_TRIGGER = "ERIKAFINAL";

const ERIKA_LORA_WEIGHTS =
  "https://replicate.delivery/xezq/eOU7OpAeaHlwoEavigAhW5vYackREGjOGY3LCyv1MwWcAeiuA/flux-lora.tar";

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
    // AUTOMATIC REALISM PROMPT
    //
    // The user's visual instructions stay first.
    // The app adds realism automatically.
    // =====================================================

    const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

photorealistic real-life photograph,
realistic smartphone camera rendering,
natural skin texture and pores,
subtle natural skin variation,
realistic facial detail,
realistic individual hair strands and flyaways,
natural hair texture,
realistic fabric texture and folds,
natural body posture,
realistic anatomy and proportions,
believable natural lighting,
slight optical lens softness,
subtle camera sensor noise,
natural depth of field,
minor photographic imperfections,
unretouched appearance,
no artificial beauty-filter appearance
`.trim();

    console.log("ERIKAFINAL PROMPT:", finalPrompt);

    // =====================================================
    // RUN ERIKA THROUGH FLUX DEV LORA
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

            // Identity strength
            lora_scale: 1.0,

            // Good starting point for realism
            guidance: 2.2,

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
          details: prediction,
        },
        { status: 500 }
      );
    }

    console.log(
      "ERIKAFINAL PREDICTION:",
      prediction.id,
      prediction.status
    );

    // =====================================================
    // POLL IF IT DID NOT FINISH IMMEDIATELY
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
            error:
              "Could not check Erika photo status",
            details: checkData,
          },
          { status: 500 }
        );
      }

      prediction = checkData;

      console.log(
        "ERIKAFINAL STATUS:",
        prediction.status
      );
    }

    // =====================================================
    // HANDLE FAILURES
    // =====================================================

    if (prediction.status === "failed") {
      console.error(
        "ERIKAFINAL FAILED:",
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
          error:
            "Erika photo generation was canceled",
        },
        { status: 500 }
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
        { status: 504 }
      );
    }

    // =====================================================
    // GET IMAGE
    // =====================================================

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
            "Replicate finished but returned no image",
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
          error:
            "Could not download generated Erika photo",
        },
        { status: 500 }
      );
    }

    const imageBytes =
      await imageResponse.arrayBuffer();

    // =====================================================
    // SAVE PERMANENTLY TO SUPABASE
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

          "Content-Type":
            "image/jpeg",

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

        character: "ERIKAFINAL",

        trigger: ERIKA_TRIGGER,

        runner:
          "black-forest-labs/flux-dev-lora",

        lora_scale: 1.0,

        guidance: 2.2,

        steps: 28,

        aspect_ratio: "4:5",

        original_prompt: prompt,

        final_prompt: finalPrompt,

        permanent: true,
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
