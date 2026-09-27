export const runtime = "nodejs";
export const maxDuration = 120;

// =====================================================
// ENVIRONMENT
// =====================================================

const REPLICATE_API_TOKEN =
  process.env.REPLICATE_API_TOKEN;

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// =====================================================
// SUPABASE
// =====================================================

const BUCKET = "erika-photos";
const REFERENCE_FOLDER = "references";

// =====================================================
// ERIKA FINAL LORA
// =====================================================

const ERIKA_TRIGGER = "ERIKAFINAL";

const ERIKA_LORA =
  "https://replicate.delivery/xezq/eOU7OpAeaHlwoEavigAhW5vYackREGjOGY3LCyv1MwWcAeiuA/flux-lora.tar";

// =====================================================
// REALISM LORA
// =====================================================

const REALISM_LORA =
  "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors";

// =====================================================
// NORMAL PHOTO MODEL
// =====================================================

const NORMAL_MODEL_URL =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions";

// =====================================================
// ADULT / REFERENCE PHOTO MODEL
// =====================================================

const REFERENCE_MODEL_URL =
  "https://api.replicate.com/v1/models/nsfw-api/realvis-hyper-lora/predictions";

// =====================================================

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

// =====================================================
// DETECT WHICH PHOTO BACKEND TO USE
// =====================================================

function shouldUseReferenceBackend(
  prompt: string
) {
  const adultTerms =
    /\b(
      panties|
      panty|
      lingerie|
      underwear|
      bra|
      thong|
      bikini|
      swimsuit|
      booty|
      butt|
      buttocks|
      ass|
      rear view|
      cheeky|
      micro bikini|
      topless|
      nude|
      naked
    )\b/ix;

  return adultTerms.test(prompt);
}

// =====================================================
// GET RANDOM ERIKA REFERENCE
// FROM:
// erika-photos/references/
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
          REFERENCE_FOLDER,

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
      "Could not read Erika references folder"
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
      "REFERENCE FILES:",
      files
    );

    throw new Error(
      "No Erika reference images found in references folder"
    );
  }

  const selected =
    validFiles[
      Math.floor(
        Math.random() *
          validFiles.length
      )
    ];

  /*
    Supabase list can return either:
      image.jpg

    or:
      references/image.jpg

    depending on response formatting.

    Handle both.
  */

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
    "ERIKA REFERENCE SELECTED:",
    fullPath
  );

  console.log(
    "ERIKA REFERENCE URL:",
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
        "Could not check photo generation"
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
// NORMAL ERIKAFINAL GENERATOR
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
    "USING NORMAL ERIKA BACKEND"
  );

  console.log(
    "FINAL ERIKA PROMPT:",
    finalPrompt
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
      "NORMAL MODEL START ERROR:",
      prediction
    );

    throw new Error(
      prediction?.detail ||
        prediction?.error ||
        "Could not start Erika generation"
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
        "Normal Erika photo failed"
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
      "Normal generator returned no image"
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
// REFERENCE / ADULT GENERATOR
// =====================================================

async function generateReferencePhoto(
  prompt: string
) {
  console.log(
    "USING REFERENCE BACKEND"
  );

  const reference =
    await getRandomReferenceImage();

  const referencePrompt = `
photorealistic photograph of the same adult woman shown in the reference image,
preserve her facial identity and recognizable appearance,
${prompt},
natural realistic skin texture,
realistic hair,
realistic lighting,
realistic fabric,
realistic photography,
high photographic detail
`.trim();

  console.log(
    "REFERENCE PROMPT:",
    referencePrompt
  );

  const response =
    await fetch(
      REFERENCE_MODEL_URL,
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
                referencePrompt,

              reference_image:
                reference.url,

              width:
                768,

              height:
                1024,

              steps:
                30,

              cfg:
                7,

              sampler_name:
                "dpmpp_2m",

              scheduler:
                "karras",

              seed:
                0,

              hyperlora_weight:
                0.65,

              instantid_weight:
                0.8,

              facedetail_strength:
                0.45,
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
        "Could not start reference generation"
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
        "Reference photo generation failed"
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
      "Reference generator returned no image"
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
// SAVE FINAL IMAGE TO SUPABASE
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
      "Could not download generated image"
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

  const response =
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

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      "SUPABASE UPLOAD ERROR:",
      errorText
    );

    throw new Error(
      "Generated photo could not be saved"
    );
  }

  return {
    fileName,

    publicUrl:
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`,
  };
}

// =====================================================
// MAIN POST ROUTE
// =====================================================

export async function POST(
  request: Request
) {
  try {
    // -------------------------------------------------
    // ENV CHECK
    // -------------------------------------------------

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

    // -------------------------------------------------
    // READ BODY
    // -------------------------------------------------

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

    // -------------------------------------------------
    // ACCEPT EITHER CHAT NAMING STYLE
    // -------------------------------------------------

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

    // =================================================
    // PICK BACKEND
    // =================================================

    const useReference =
      shouldUseReferenceBackend(
        prompt
      );

    console.log(
      "PHOTO ROUTE:",
      useReference
        ? "REFERENCE"
        : "ERIKAFINAL"
    );

    // =================================================
    // GENERATE
    // =================================================

    const generated =
      useReference
        ? await generateReferencePhoto(
            prompt
          )
        : await generateNormalPhoto(
            prompt
          );

    // =================================================
    // SAVE PERMANENT COPY
    // =================================================

    const stored =
      await saveImage(
        generated.image
      );

    // =================================================
    // RETURN TO APP
    // =================================================

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
