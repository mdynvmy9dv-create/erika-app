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
// REPLICATE MODELS
// =====================================================

const NORMAL_MODEL =
  "black-forest-labs/flux-dev-lora";

const REFERENCE_MODEL =
  "nsfw-api/realvis-hyper-lora";

// =====================================================

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

// =====================================================
// STORAGE PATH ENCODING
// =====================================================

function encodeStoragePath(path: string) {
  return path
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

// =====================================================
// READ RANDOM REFERENCE IMAGE
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

  const data = await response.json();

  if (!response.ok) {
    console.error(
      "REFERENCE LIST ERROR:",
      data
    );

    throw new Error(
      "Could not read Erika reference folder"
    );
  }

  const files = Array.isArray(data)
    ? data.filter((item: any) => {
        const name =
          String(item?.name || "").toLowerCase();

        return (
          name.endsWith(".jpg") ||
          name.endsWith(".jpeg") ||
          name.endsWith(".png") ||
          name.endsWith(".webp")
        );
      })
    : [];

  if (files.length === 0) {
    throw new Error(
      "No Erika reference images found in erika-photos/references"
    );
  }

  const randomFile =
    files[
      Math.floor(Math.random() * files.length)
    ];

  let fileName =
    String(randomFile.name);

  /*
    Supabase may return either:

    image.jpg

    or:

    references/image.jpg

    depending on listing behavior.

    Handle both.
  */

  if (
    !fileName.startsWith(
      `${REFERENCE_FOLDER}/`
    )
  ) {
    fileName =
      `${REFERENCE_FOLDER}/${fileName}`;
  }

  const encodedPath =
    encodeStoragePath(fileName);

  const publicUrl =
    `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodedPath}`;

  console.log(
    "REFERENCE IMAGE CHOSEN:",
    publicUrl
  );

  return publicUrl;
}

// =====================================================
// SHOULD USE REFERENCE BACKEND?
// =====================================================

function shouldUseReferenceBackend(
  prompt: string
) {
  /*
    These are clothing / photo-category terms.

    We are choosing the appropriate model BEFORE
    generation rather than sending the request through
    one model and then reacting to a safety rejection.
  */

  return /\b(
    panties|
    lingerie|
    underwear|
    bra|
    bralette|
    thong|
    bodysuit|
    bikini|
    swimsuit|
    swimwear|
    two-piece|
    one-piece
  )\b/ix.test(prompt);
}

// =====================================================
// JAVASCRIPT DOES NOT SUPPORT /x REGEX FLAGS
// =====================================================

// Use this actual JS-compatible matcher.

function useReferenceBackend(
  prompt: string
) {
  const words =
    [
      "panties",
      "lingerie",
      "underwear",
      "bra",
      "bralette",
      "thong",
      "bodysuit",
      "bikini",
      "swimsuit",
      "swimwear",
      "two-piece",
      "one-piece",
    ];

  const lower =
    prompt.toLowerCase();

  return words.some((word) =>
    lower.includes(word)
  );
}

// =====================================================
// BUILD NORMAL ERIKA PROMPT
// =====================================================

function buildNormalPrompt(
  prompt: string
) {
  return `
${ERIKA_TRIGGER}, ${prompt}

photorealistic real-life photograph,
realistic smartphone camera rendering,
natural skin texture,
subtle visible pores,
natural skin tone variation,
realistic facial detail,
individual hair strands,
natural flyaway hairs,
realistic dark wavy hair texture,
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
}

// =====================================================
// BUILD REFERENCE-BACKEND PROMPT
// =====================================================

function buildReferencePrompt(
  prompt: string
) {
  return `
Adult woman shown in the supplied identity reference image.

Preserve the same facial identity and overall appearance.

${prompt}

Photorealistic real-life photography,
natural skin texture,
realistic facial detail,
realistic hair strands,
realistic fabric texture,
natural posture,
believable indoor or outdoor lighting,
realistic shadows,
natural depth of field,
smartphone or lifestyle photography,
unretouched appearance.
`.trim();
}

// =====================================================
// CREATE REPLICATE PREDICTION
// =====================================================

async function createPrediction(
  model: string,
  input: Record<string, any>
) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error(
      "Missing REPLICATE_API_TOKEN"
    );
  }

  const response = await fetch(
    `https://api.replicate.com/v1/models/${model}/predictions`,
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
          input,
        }),
    }
  );

  const data =
    await response.json();

  if (!response.ok) {
    console.error(
      "REPLICATE START ERROR:",
      data
    );

    throw new Error(
      data?.detail ||
      data?.error ||
      "Could not start Replicate prediction"
    );
  }

  return data;
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
        "PREDICTION STATUS ERROR:",
        data
      );

      throw new Error(
        "Could not check prediction status"
      );
    }

    current =
      data;

    console.log(
      "PHOTO STATUS:",
      current.status
    );
  }

  if (
    current.status === "failed"
  ) {
    console.error(
      "PHOTO FAILED:",
      current
    );

    throw new Error(
      current.error ||
      "Photo generation failed"
    );
  }

  if (
    current.status === "canceled"
  ) {
    throw new Error(
      "Photo generation canceled"
    );
  }

  if (
    current.status !== "succeeded"
  ) {
    throw new Error(
      "Photo generation timed out"
    );
  }

  return current;
}

// =====================================================
// EXTRACT IMAGE URL
// =====================================================

function getOutputUrl(
  output: any
) {
  if (
    Array.isArray(output) &&
    typeof output[0] === "string"
  ) {
    return output[0];
  }

  if (
    typeof output === "string"
  ) {
    return output;
  }

  return null;
}

// =====================================================
// SAVE GENERATED IMAGE
// =====================================================

async function saveImageToSupabase(
  imageUrl: string
) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Missing Supabase environment variables"
    );
  }

  const download =
    await fetch(imageUrl);

  if (!download.ok) {
    throw new Error(
      "Could not download generated photo"
    );
  }

  const bytes =
    await download.arrayBuffer();

  const contentType =
    download.headers.get(
      "content-type"
    ) || "image/jpeg";

  let extension =
    "jpg";

  if (
    contentType.includes("png")
  ) {
    extension =
      "png";
  } else if (
    contentType.includes("webp")
  ) {
    extension =
      "webp";
  }

  const fileName =
    `erika-${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const encodedName =
    encodeStoragePath(
      fileName
    );

  const upload =
    await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodedName}`,
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
          bytes,
      }
    );

  if (!upload.ok) {
    const error =
      await upload.text();

    console.error(
      "SUPABASE SAVE ERROR:",
      error
    );

    throw new Error(
      "Photo generated but could not be saved"
    );
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodedName}`;
}

// =====================================================
// POST
// =====================================================

export async function POST(
  req: Request
) {
  try {
    let body: any = {};

    try {
      body =
        await req.json();
    } catch {
      body = {};
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
      typeof rawPrompt === "string"
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

    // =================================================
    // ROUTE REQUEST
    // =================================================

    const referenceMode =
      useReferenceBackend(
        prompt
      );

    console.log(
      "PHOTO ROUTE MODE:",
      referenceMode
        ? "REFERENCE BACKEND"
        : "ERIKAFINAL BACKEND"
    );

    let prediction: any;

    let referenceImage:
      | string
      | null =
      null;

    // =================================================
    // REFERENCE BACKEND
    // =================================================

    if (referenceMode) {
      referenceImage =
        await getRandomReferenceImage();

      const finalPrompt =
        buildReferencePrompt(
          prompt
        );

      console.log(
        "REFERENCE PROMPT:",
        finalPrompt
      );

      /*
        Current model schema:

        prompt
        reference_image
        width
        height
        steps
        cfg
        sampler_name
        scheduler
        seed
        hyperlora_weight
        instantid_weight
        facedetail_strength
      */

      prediction =
        await createPrediction(
          REFERENCE_MODEL,
          {
            prompt:
              finalPrompt,

            reference_image:
              referenceImage,

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
              0.7,

            facedetail_strength:
              0.4,
          }
        );
    }

    // =================================================
    // NORMAL ERIKAFINAL BACKEND
    // =================================================

    else {
      const finalPrompt =
        buildNormalPrompt(
          prompt
        );

      console.log(
        "ERIKAFINAL PROMPT:",
        finalPrompt
      );

      prediction =
        await createPrediction(
          NORMAL_MODEL,
          {
            prompt:
              finalPrompt,

            aspect_ratio:
              "4:5",

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

            num_outputs:
              1,

            output_format:
              "jpg",

            output_quality:
              95,

            megapixels:
              "1",

            go_fast:
              false,
          }
        );
    }

    // =================================================
    // WAIT
    // =================================================

    const completed =
      await waitForPrediction(
        prediction
      );

    const temporaryUrl =
      getOutputUrl(
        completed.output
      );

    if (!temporaryUrl) {
      throw new Error(
        "Prediction succeeded but returned no image"
      );
    }

    // =================================================
    // SAVE PERMANENT COPY
    // =================================================

    const permanentUrl =
      await saveImageToSupabase(
        temporaryUrl
      );

    // =================================================
    // SUCCESS
    // =================================================

    return Response.json({
      type:
        "photo",

      image:
        permanentUrl,

      imageUrl:
        permanentUrl,

      metadata: {
        predictionId:
          completed.id,

        backend:
          referenceMode
            ? REFERENCE_MODEL
            : NORMAL_MODEL,

        referenceMode,

        referenceImage,

        originalPrompt:
          prompt,

        trigger:
          referenceMode
            ? null
            : ERIKA_TRIGGER,

        erikaLoraScale:
          referenceMode
            ? null
            : 1.0,

        realismLoraScale:
          referenceMode
            ? null
            : 0.55,
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
