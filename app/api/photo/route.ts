export const runtime = "nodejs";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const replicateToken = process.env.REPLICATE_API_TOKEN;

// New unified Erika LoRA
const ERIKA_MODEL = "mdynvmy9dv-create/erika9dv";
const ERIKA_TRIGGER = "erika9dv";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
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

    // --------------------------------------------
    // GET LATEST VERSION OF ERIKA MODEL
    // --------------------------------------------

    const modelResponse = await fetch(
      `https://api.replicate.com/v1/models/${ERIKA_MODEL}`,
      {
        headers: {
          Authorization: `Bearer ${replicateToken}`,
        },
      }
    );

    if (!modelResponse.ok) {
      const text = await modelResponse.text();

      console.error(
        "Replicate model lookup error:",
        text
      );

      return Response.json(
        {
          error:
            "Could not load Erika model",
          details: text,
        },
        { status: 500 }
      );
    }

    const modelData = await modelResponse.json();

    const version = modelData.latest_version?.id;

    if (!version) {
      console.error(
        "No model version found:",
        modelData
      );

      return Response.json(
        {
          error:
            "No trained Erika model version found",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------
    // BUILD IMAGE PROMPT
    // --------------------------------------------

    const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

realistic candid smartphone photograph,
natural skin texture,
subtle pores and skin variation,
realistic hair texture,
natural facial detail,
soft natural lighting,
slight lens softness,
subtle sensor noise,
natural feminine proportions,
realistic anatomy,
unretouched real-life photography
`.trim();

    // --------------------------------------------
    // START REPLICATE PREDICTION
    // --------------------------------------------

    const predictionResponse = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          version,

          input: {
            prompt: finalPrompt,

            aspect_ratio: "4:5",

            num_outputs: 1,

            num_inference_steps: 28,

            guidance_scale: 2.17,

            lora_scale: 1.0,

            output_format: "jpg",

            output_quality: 95,

            megapixels: "1",

            go_fast: false,
          },
        }),
      }
    );

    const predictionData =
      await predictionResponse.json();

    if (!predictionResponse.ok) {
      console.error(
        "Replicate prediction error:",
        predictionData
      );

      return Response.json(
        {
          error:
            "Failed to start Erika photo generation",

          details:
            predictionData,
        },
        { status: 500 }
      );
    }

    let prediction = predictionData;

    // --------------------------------------------
    // POLL UNTIL IMAGE FINISHES
    // --------------------------------------------

    for (let i = 0; i < 60; i++) {
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

      const checkResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization: `Bearer ${replicateToken}`,
          },
        }
      );

      const checkData = await checkResponse.json();

      if (!checkResponse.ok) {
        console.error(
          "Replicate polling error:",
          checkData
        );

        return Response.json(
          {
            error:
              "Could not check Erika photo status",
          },
          { status: 500 }
        );
      }

      prediction = checkData;
    }

    // --------------------------------------------
    // HANDLE FAILURE
    // --------------------------------------------

    if (prediction.status !== "succeeded") {
      console.error(
        "Erika prediction failed:",
        prediction
      );

      return Response.json(
        {
          error:
            prediction.error ||
            "Erika photo generation did not succeed",

          predictionId:
            prediction.id,

          status:
            prediction.status,
        },
        { status: 500 }
      );
    }

    // --------------------------------------------
    // GET REPLICATE IMAGE URL
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
            "Replicate returned no Erika image",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------
    // DOWNLOAD IMAGE
    // --------------------------------------------

    const imageResponse =
      await fetch(replicateImageUrl);

    if (!imageResponse.ok) {
      const text =
        await imageResponse.text();

      console.error(
        "Generated image download error:",
        text
      );

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

    // --------------------------------------------
    // SAVE IMAGE TO SUPABASE
    // --------------------------------------------

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
        "Supabase upload error:",
        uploadError
      );

      return Response.json(
        {
          error:
            "Erika photo generated but could not be saved permanently",

          details:
            uploadError,
        },
        { status: 500 }
      );
    }

    // --------------------------------------------
    // PERMANENT SUPABASE URL
    // --------------------------------------------

    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    return Response.json({
      image: permanentImageUrl,

      metadata: {
        replicate_prediction_id:
          prediction.id,

        model:
          ERIKA_MODEL,

        trigger:
          ERIKA_TRIGGER,

        original_prompt:
          prompt,

        final_prompt:
          finalPrompt,

        lora_scale:
          1.0,

        guidance_scale:
          2.17,

        steps:
          28,

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
            : "Something went wrong generating the Erika photo",
      },
      { status: 500 }
    );
  }
}
