export const runtime = "nodejs";
export const maxDuration = 120;

const REPLICATE_API_TOKEN =
  process.env.REPLICATE_API_TOKEN;

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = "erika-photos";
const REFERENCE_FOLDER = "references";

// =====================================================
// ERIKA FINAL
// =====================================================

const ERIKA_TRIGGER = "ERIKAFINAL";

const ERIKA_LORA =
  "https://replicate.delivery/xezq/eOU7OpAeaHlwoEavigAhW5vYackREGjOGY3LCyv1MwWcAeiuA/flux-lora.tar";

const REALISM_LORA =
  "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors";

// Normal Erika backend
const NORMAL_MODEL_URL =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions";

// Adult/reference backend version
const REFERENCE_VERSION =
  "d9aab9a980d2368bc9d4b9537267ff55fad72c74d4d405de936101c18e45ecfc";

// =====================================================

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

// =====================================================
// ROUTING
// =====================================================

function shouldUseReferenceBackend(
  prompt: string
) {
  const text = prompt.toLowerCase();

  const terms = [
    "panties",
    "panty",
    "lingerie",
    "underwear",
    "bra",
    "thong",
    "bikini",
    "swimsuit",
    "booty",
    "butt",
    "buttocks",
    "ass",
    "rear view",
    "cheeky",
    "micro bikini",
    "topless",
    "nude",
    "naked",
  ];

  return terms.some((term) =>
    text.includes(term)
  );
}

// =====================================================
// RANDOM REFERENCE IMAGE
// =====================================================

async function getRandomReferenceImage() {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Missing Supabase environment variables"
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`,
    {
      method: "POST",

      headers: {
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        prefix:
          `${REFERENCE_FOLDER}/`,

        limit:
          100,

        offset:
          0,

        sortBy: {
          column:
            "name",

          order:
            "asc",
        },
      }),
    }
  );

  const files =
    await response.json();

  if (!response.ok) {
    console.error(
      "REFERENCE LIST ERROR:",
      files
    );

    throw new Error(
      "Could not read references folder"
    );
  }

  const validFiles =
    Array.isArray(files)
      ? files.filter((file: any) => {
          const name =
            String(
              file.name || ""
            ).toLowerCase();

          return (
            name.endsWith(".jpg") ||
            name.endsWith(".jpeg") ||
            name.endsWith(".png") ||
            name.endsWith(".webp")
          );
        })
      : [];

  if (!validFiles.length) {
    console.error(
      "REFERENCE FILE LIST:",
      files
    );

    throw new Error(
      "No reference images found in erika-photos/references"
    );
  }

  const selected =
    validFiles[
      Math.floor(
        Math.random() *
          validFiles.length
      )
    ];

  const selectedName =
    String(selected.name);

  const fullPath =
    selectedName.startsWith(
      `${REFERENCE_FOLDER}/`
    )
      ? selectedName
      : `${REFERENCE_FOLDER}/${selectedName}`;

  const publicUrl =
    `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fullPath}`;

  console.log(
    "REFERENCE SELECTED:",
    fullPath
  );

  console.log(
    "REFERENCE URL:",
    publicUrl
  );

  return {
    path:
      fullPath,

    url:
      publicUrl,
  };
}

// =====================================================
// WAIT FOR REPLICATE
// =====================================================

async function waitForPrediction(
  prediction: any
) {
  let current =
    prediction;

  let attempts =
    0;

  while (
    current.status !== "succeeded" &&
    current.status !== "failed" &&
    current.status !== "canceled" &&
    attempts < 110
  ) {
    await sleep(1000);

    attempts++;

    const response =
      await fetch(
        `https://api.replicate.com/v1/predictions/${current.id}`,
        {
          headers: {
            Authorization:
              `Bearer ${REPLICATE_API_TOKEN}`,
          },

          cache:
            "no-store",
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        "POLL ERROR:",
        data
      );

      throw new Error(
        "Could not check photo status"
      );
    }

    current =
      data;

    console.log(
      "PHOTO STATUS:",
      current.status
    );
  }

  return current;
}

// =====================================================
// NORMAL ERIKA PHOTO
// =====================================================

async function generateNormalPhoto(
  prompt: string
) {
  const finalPrompt = `
${ERIKA_TRIGGER}, ${prompt}

photorealistic real-life photograph,
realistic smartphone camera rendering,
natural skin texture,
subtle visible pores,
natural skin tone variation,
realistic facial detail,
individual hair strands,
natural flyaway hairs,
realistic dark wavy hair,
realistic fabric texture,
natural fabric folds,
natural posture,
realistic anatomy,
natural human proportions,
realistic hands,
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

  console.log(
    "PHOTO ROUTE: ERIKAFINAL"
  );

  const response =
    await fetch(
      NORMAL_MODEL_URL,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${REPLICATE_API_TOKEN}`,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            input: {
              prompt:
                finalPrompt,

              lora_weights:
                ERIKA_LORA,

              lora_scale:
                1.0,

              extra_lora:
                REALISM_LORA,

              extra_lora_scale:
                0.55,

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

  const prediction =
    await response.json();

  if (!response.ok) {
    console.error(
      "NORMAL START ERROR:",
      prediction
    );

    throw new Error(
      prediction?.detail ||
        prediction?.error ||
        "Could not start normal photo"
    );
  }

  console.log(
    "NORMAL PREDICTION:",
    prediction.id
  );

  const result =
    await waitForPrediction(
      prediction
    );

  if (
    result.status !== "succeeded"
  ) {
    console.error(
      "NORMAL PHOTO FAILED:",
      result
    );

    throw new Error(
      result.error ||
        "Normal photo failed"
    );
  }

  const output =
    Array.isArray(
      result.output
    )
      ? result.output[0]
      : result.output;

  if (
    !output ||
    typeof output !== "string"
  ) {
    throw new Error(
      "Normal model returned no image"
    );
  }

  return {
    image:
      output,

    backend:
      "erikafinal",

    reference:
      null,
  };
}

// =====================================================
// REFERENCE / ADULT PHOTO
// =====================================================

async function generateReferencePhoto(
  prompt: string
) {
  console.log(
    "PHOTO ROUTE: REFERENCE"
  );

  const reference =
    await getRandomReferenceImage();

  const finalPrompt = `
photorealistic photograph of the same adult woman shown in the reference image,
preserve her recognizable facial identity,
${prompt},
natural realistic skin texture,
realistic facial detail,
realistic hair texture,
realistic fabric texture,
natural body posture,
realistic lighting,
natural shadows,
high photographic detail
`.trim();

  console.log(
    "REFERENCE PROMPT:",
    finalPrompt
  );

  // IMPORTANT:
  // Use version-specific Replicate prediction endpoint.
  const response =
    await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${REPLICATE_API_TOKEN}`,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            version:
              REFERENCE_VERSION,

            input: {
              prompt:
                finalPrompt,

              reference_image:
                reference.url,

              negative_prompt:
                "lowres, bad anatomy, bad hands, text, watermark, blurry",

              width:
                768,

              height:
                1024,

              steps:
                30,

              cfg:
                7,

              sampler_name:
                "dpmpp_2m_sde",

              scheduler:
                "karras",

              seed:
                0,

              face_weight:
                0.8,

              instantid_weight:
                0.8,

              facedetail_strength:
                0.5,
            },
          }),
      }
    );

  const prediction =
    await response.json();

  if (!response.ok) {
    console.error(
      "REFERENCE MODEL START ERROR:",
      prediction
    );

    throw new Error(
      prediction?.detail ||
        prediction?.error ||
        "Could not start reference photo"
    );
  }

  console.log(
    "REFERENCE PREDICTION:",
    prediction.id
  );

  const result =
    await waitForPrediction(
      prediction
    );

  if (
    result.status !== "succeeded"
  ) {
    console.error(
      "REFERENCE PHOTO FAILED:",
      result
    );

    throw new Error(
      result.error ||
        "Reference photo failed"
    );
  }

  const output =
    Array.isArray(
      result.output
    )
      ? result.output[0]
      : result.output;

  if (
    !output ||
    typeof output !== "string"
  ) {
    throw new Error(
      "Reference model returned no image"
    );
  }

  return {
    image:
      output,

    backend:
      "reference",

    reference:
      reference.path,
  };
}

// =====================================================
// SAVE TO SUPABASE
// =====================================================

async function saveImage(
  sourceUrl: string
) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Missing Supabase environment variables"
    );
  }

  const imageResponse =
    await fetch(
      sourceUrl
    );

  if (!imageResponse.ok) {
    throw new Error(
      "Could not download generated photo"
    );
  }

  const imageBytes =
    await imageResponse.arrayBuffer();

  const contentType =
    imageResponse.headers.get(
      "content-type"
    ) || "image/jpeg";

  let extension =
    "jpg";

  if (
    contentType.includes(
      "png"
    )
  ) {
    extension =
      "png";
  }

  if (
    contentType.includes(
      "webp"
    )
  ) {
    extension =
      "webp";
  }

  const fileName =
    `erika-${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const uploadResponse =
    await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${fileName}`,
      {
        method:
          "POST",

        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            contentType,

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

    throw new Error(
      "Generated image could not be saved"
    );
  }

  return {
    fileName,

    publicUrl:
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`,
  };
}

// =====================================================
// MAIN ROUTE
// =====================================================

export async function POST(
  request: Request
) {
  try {
    if (!REPLICATE_API_TOKEN) {
      return Response.json(
        {
          error:
            "Missing REPLICATE_API_TOKEN",
        },

        {
          status:
            500,
        }
      );
    }

    let body: any =
      {};

    try {
      body =
        await request.json();
    } catch {
      body =
        {};
    }

    console.log(
      "PHOTO BODY RECEIVED:",
      body
    );

    const rawPrompt =
      body?.prompt ??
      body?.photo_prompt ??
      body?.photoPrompt ??
      body?.message ??
      body?.text ??
      "";

    const prompt =
      typeof rawPrompt ===
      "string"
        ? rawPrompt.trim()
        : "";

    if (!prompt) {
      return Response.json(
        {
          error:
            "No photo prompt received",
        },

        {
          status:
            400,
        }
      );
    }

    console.log(
      "PROMPT USED:",
      prompt
    );

    const useReference =
      shouldUseReferenceBackend(
        prompt
      );

    console.log(
      "BACKEND SELECTED:",
      useReference
        ? "REFERENCE"
        : "ERIKAFINAL"
    );

    const generated =
      useReference
        ? await generateReferencePhoto(
            prompt
          )
        : await generateNormalPhoto(
            prompt
          );

    const stored =
      await saveImage(
        generated.image
      );

    return Response.json({
      type:
        "photo",

      image:
        stored.publicUrl,

      imageUrl:
        stored.publicUrl,

      metadata: {
        backend:
          generated.backend,

        reference:
          generated.reference,

        originalPrompt:
          prompt,

        storageFile:
          stored.fileName,
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
            : "Unknown photo generation error",
      },

      {
        status:
          500,
      }
    );
  }
}
