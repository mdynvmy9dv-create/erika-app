const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return Response.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const replicateToken = process.env.REPLICATE_API_TOKEN;

    if (!replicateToken) {
      return Response.json(
        { error: "Replicate token is missing" },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !supabaseKey) {
      return Response.json(
        { error: "Supabase environment variables are missing" },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // GENERATE WITH OFFICIAL FLUX DEV LORA MODEL
    // --------------------------------------------------

    const predictionResponse = await fetch(
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
            prompt: `ERIKAFACE, ${prompt}`,

            // Your trained Erika LoRA
            lora_weights:
              "mdynvmy9dv-create/erikaface",

            lora_scale: 1.05,

            aspect_ratio: "4:5",

            num_outputs: 1,

            num_inference_steps: 28,

            // IMPORTANT:
            // This official model calls it "guidance",
            // not "guidance_scale".
            guidance: 2.17,

            output_format: "jpg",

            output_quality: 95,

            go_fast: false,

            megapixels: "1",

            disable_safety_checker: true,
          },
        }),
      }
    );

    if (!predictionResponse.ok) {
      const text = await predictionResponse.text();

      console.error(
        "Replicate prediction error:",
        text
      );

      return Response.json(
        {
          error: "Photo generation failed",
          details: text,
        },
        { status: 500 }
      );
    }

    let prediction =
      await predictionResponse.json();

    // --------------------------------------------------
    // WAIT FOR GENERATION
    // --------------------------------------------------

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
            Authorization:
              `Bearer ${replicateToken}`,
          },
        }
      );

      if (!checkResponse.ok) {
        const text =
          await checkResponse.text();

        console.error(
          "Replicate status error:",
          text
        );

        return Response.json(
          {
            error:
              "Could not check photo generation status",
          },
          { status: 500 }
        );
      }

      prediction =
        await checkResponse.json();
    }

    // --------------------------------------------------
    // HANDLE FAILURE
    // --------------------------------------------------

    if (prediction.status !== "succeeded") {
      console.error(
        "Prediction did not succeed:",
        prediction
      );

      return Response.json(
        {
          error:
            prediction.error ||
            "Erika photo did not finish generating",

          predictionStatus:
            prediction.status,

          predictionId:
            prediction.id,
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // GET GENERATED IMAGE
    // --------------------------------------------------

    const replicateImageUrl =
      Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;

    if (!replicateImageUrl) {
      return Response.json(
        {
          error:
            "No generated image returned",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // DOWNLOAD FROM REPLICATE
    // --------------------------------------------------

    const imageResponse = await fetch(
      replicateImageUrl
    );

    if (!imageResponse.ok) {
      const text =
        await imageResponse.text();

      console.error(
        "Replicate image download error:",
        text
      );

      return Response.json(
        {
          error:
            "Could not download generated image",
        },
        { status: 500 }
      );
    }

    const imageBytes =
      await imageResponse.arrayBuffer();

    // --------------------------------------------------
    // SAVE PERMANENTLY TO SUPABASE
    // --------------------------------------------------

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
        "Supabase photo upload error:",
        uploadError
      );

      return Response.json(
        {
          error:
            "Could not save Erika photo permanently",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // PERMANENT IMAGE URL
    // --------------------------------------------------

    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    return Response.json({
      image: permanentImageUrl,

      metadata: {
        replicate_prediction_id:
          prediction.id,

        model:
          "black-forest-labs/flux-dev-lora",

        lora:
          "mdynvmy9dv-create/erikaface",

        prompt,

        storage_file:
          fileName,

        permanent: true,
      },
    });
  } catch (error) {
    console.error(
      "Photo server error:",
      error
    );

    return Response.json(
      {
        error:
          "Something went wrong generating the photo",
      },
      { status: 500 }
    );
  }
}
