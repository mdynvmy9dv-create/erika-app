export const runtime = "nodejs";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const replicateToken = process.env.REPLICATE_API_TOKEN;

const FACE_LORA_URL =
  "https://pub-6c78a23ee9fc455dac17546e08d02ce9.r2.dev/erikaface.safetensors";

const BODY_LORA_URL =
  "https://pub-6c78a23ee9fc455dac17546e08d02ce9.r2.dev/erikabody.safetensors";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

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
            prompt: `ERIKAFACE, ERIKABODY, ${prompt}`,

            lora_weights: FACE_LORA_URL,
            lora_scale: 1,

            extra_lora: BODY_LORA_URL,
            extra_lora_scale: 1,

            aspect_ratio: "4:5",

            num_outputs: 1,

            num_inference_steps: 28,

            guidance: 3,

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
            "Failed to start image generation",

          details:
            predictionData,
        },
        { status: 500 }
      );
    }

    let prediction =
      predictionData;

    // Poll until finished
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

      const checkData =
        await checkResponse.json();

      if (!checkResponse.ok) {
        console.error(
          "Replicate polling error:",
          checkData
        );

        return Response.json(
          {
            error:
              "Failed while checking prediction status",

            details:
              checkData,
          },
          { status: 500 }
        );
      }

      prediction =
        checkData;
    }

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
            "Prediction did not succeed",

          details:
            prediction,
        },
        { status: 500 }
      );
    }

    const replicateImageUrl =
      Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;

    if (!replicateImageUrl) {
      return Response.json(
        {
          error:
            "No image returned from Replicate",
        },
        { status: 500 }
      );
    }

    // Download generated image
    const imageResponse = await fetch(
      replicateImageUrl
    );

    if (!imageResponse.ok) {
      const text =
        await imageResponse.text();

      console.error(
        "Image download error:",
        text
      );

      return Response.json(
        {
          error:
            "Failed to download generated image",
        },
        { status: 500 }
      );
    }

    const imageBytes =
      await imageResponse.arrayBuffer();

    // Save permanently in Supabase
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
        "Supabase upload error:",
        uploadError
      );

      return Response.json(
        {
          error:
            "Image generated, but failed to save to Supabase",

          details:
            uploadError,
        },
        { status: 500 }
      );
    }

    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    return Response.json({
      image:
        permanentImageUrl,

      metadata: {
        predictionId:
          prediction.id,

        prompt,

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
          "Something went wrong generating the photo",
      },
      { status: 500 }
    );
  }
}
