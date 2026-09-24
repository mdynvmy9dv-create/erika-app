const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const replicateToken = process.env.REPLICATE_API_TOKEN;

const FACE_LORA = "mdynvmy9dv-create/erikaface";
const BODY_LORA = "mdynvmy9dv-create/erikabody";

// These are the trigger words you trained with.
const FACE_TRIGGER = "ERIKAFACE";
const BODY_TRIGGER = "ERIKABODY";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

    // Get latest version of the base model that supports multiple LoRAs
    const baseModelResponse = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora",
      {
        headers: {
          Authorization: `Bearer ${replicateToken}`,
        },
      }
    );

    if (!baseModelResponse.ok) {
      const text = await baseModelResponse.text();
      console.error("Replicate base model lookup error:", text);

      return Response.json(
        { error: "Could not load base Flux LoRA model" },
        { status: 500 }
      );
    }

    const baseModelData = await baseModelResponse.json();
    const version = baseModelData.latest_version?.id;

    if (!version) {
      console.error("No base model version found:", baseModelData);

      return Response.json(
        { error: "No base model version found" },
        { status: 500 }
      );
    }

    // IMPORTANT:
    // Include BOTH trigger words in the prompt so both LoRAs activate.
    const finalPrompt = `${FACE_TRIGGER}, ${BODY_TRIGGER}, ${prompt}`;

    const predictionResponse = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          version,
          input: {
            prompt: finalPrompt,

            // Main LoRA = face
            lora_weights: FACE_LORA,
            lora_scale: 1.0,

            // Extra LoRA = body
            extra_lora: BODY_LORA,
            extra_lora_scale: 1.0,

            aspect_ratio: "4:5",
            num_outputs: 1,
            num_inference_steps: 28,
            guidance: 3,
            output_format: "jpg",
            output_quality: 95,
            go_fast: false,
            megapixels: "1",
          },
        }),
      }
    );

    if (!predictionResponse.ok) {
      const text = await predictionResponse.text();
      console.error("Replicate prediction error:", text);

      return Response.json(
        { error: "Photo generation failed" },
        { status: 500 }
      );
    }

    let prediction = await predictionResponse.json();

    // Poll until finished
    for (let i = 0; i < 60; i++) {
      if (
        prediction.status === "succeeded" ||
        prediction.status === "failed" ||
        prediction.status === "canceled"
      ) {
        break;
      }

      await sleep(1000);

      const checkResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization: `Bearer ${replicateToken}`,
          },
        }
      );

      if (!checkResponse.ok) {
        console.error(
          "Replicate status error:",
          await checkResponse.text()
        );
        break;
      }

      prediction = await checkResponse.json();
    }

    if (prediction.status !== "succeeded") {
      console.error("Prediction did not succeed:", prediction);

      return Response.json(
        {
          error: prediction.error || "Erika photo did not finish generating",
          prediction,
        },
        { status: 500 }
      );
    }

    const replicateImageUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;

    if (!replicateImageUrl) {
      return Response.json(
        { error: "No generated image returned" },
        { status: 500 }
      );
    }

    // Download image from Replicate
    const imageResponse = await fetch(replicateImageUrl);

    if (!imageResponse.ok) {
      console.error(
        "Replicate image download error:",
        await imageResponse.text()
      );

      return Response.json(
        { error: "Could not download generated image" },
        { status: 500 }
      );
    }

    const imageBytes = await imageResponse.arrayBuffer();

    // Save permanently to Supabase storage
    const fileName = `erika-${Date.now()}-${crypto.randomUUID()}.jpg`;

    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/erika-photos/${fileName}`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "image/jpeg",
          "x-upsert": "false",
        },
        body: imageBytes,
      }
    );

    if (!uploadResponse.ok) {
      const uploadError = await uploadResponse.text();
      console.error("Supabase photo upload error:", uploadError);

      return Response.json(
        { error: "Could not save Erika photo permanently" },
        { status: 500 }
      );
    }

    const permanentImageUrl = `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    return Response.json({
      image: permanentImageUrl,
      metadata: {
        replicate_prediction_id: prediction.id,
        prompt,
        final_prompt: finalPrompt,
        face_lora: FACE_LORA,
        body_lora: BODY_LORA,
        storage_file: fileName,
        permanent: true,
      },
    });
  } catch (error) {
    console.error("Photo server error:", error);

    return Response.json(
      { error: "Something went wrong generating the photo" },
      { status: 500 }
    );
  }
}
