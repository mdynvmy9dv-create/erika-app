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

    // Get latest version of Erika model
    const modelResponse = await fetch(
      "https://api.replicate.com/v1/models/mdynvmy9dv-create/erikaface",
      {
        headers: {
          Authorization: `Bearer ${replicateToken}`,
        },
      }
    );

    if (!modelResponse.ok) {
      const text = await modelResponse.text();
      console.error("Replicate model error:", text);

      return Response.json(
        { error: "Could not load Erika model" },
        { status: 500 }
      );
    }

    const modelData = await modelResponse.json();
    const version = modelData.latest_version?.id;

    if (!version) {
      return Response.json(
        { error: "No Erika model version found" },
        { status: 500 }
      );
    }

    // Start photo generation
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
            prompt: `ERIKAFACE, ${prompt}`,
            aspect_ratio: "4:5",
            num_outputs: 1,
            num_inference_steps: 28,
            guidance_scale: 2.17,
            lora_scale: 1.05,
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

    // Poll until done
    for (let i = 0; i < 45; i++) {
      if (
        prediction.status === "succeeded" ||
        prediction.status === "failed" ||
        prediction.status === "canceled"
      ) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const checkResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization: `Bearer ${replicateToken}`,
          },
        }
      );

      prediction = await checkResponse.json();
    }

    if (prediction.status !== "succeeded") {
      console.error("Prediction did not succeed:", prediction);

      return Response.json(
        { error: "Erika photo did not finish generating" },
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

    // Download generated image from Replicate
    const imageResponse = await fetch(replicateImageUrl);

    if (!imageResponse.ok) {
      return Response.json(
        { error: "Could not download generated image" },
        { status: 500 }
      );
    }

    const imageBytes = await imageResponse.arrayBuffer();

    const fileName = `erika-${Date.now()}-${crypto.randomUUID()}.jpg`;

    // Upload permanently to Supabase Storage
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

    // Public bucket URL
    const permanentImageUrl =
      `${supabaseUrl}/storage/v1/object/public/erika-photos/${fileName}`;

    return Response.json({
      image: permanentImageUrl,

      metadata: {
        replicate_prediction_id: prediction.id,
        prompt,
        storage_file: fileName,
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
