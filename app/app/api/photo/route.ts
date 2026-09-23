export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return Response.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return Response.json(
        { error: "Replicate token is missing" },
        { status: 500 }
      );
    }

    // 1. Get the latest version of our private Erika model
    const modelResponse = await fetch(
      "https://api.replicate.com/v1/models/mdynvmy9dv-create/erikaface",
      {
        headers: {
          Authorization: `Bearer ${token}`,
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
      console.error("No model version found:", modelData);

      return Response.json(
        { error: "No Erika model version found" },
        { status: 500 }
      );
    }

    // 2. Start the Erika image generation
    const predictionResponse = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
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

    // 3. If Replicate is still generating, wait for it
    for (let i = 0; i < 30; i++) {
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
            Authorization: `Bearer ${token}`,
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

    const image =
      Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;

    return Response.json({
      image,
    });
  } catch (error) {
    console.error("Photo server error:", error);

    return Response.json(
      { error: "Something went wrong generating the photo" },
      { status: 500 }
    );
  }
}
