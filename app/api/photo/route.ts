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

    const realismPrompt = `
ordinary handheld iPhone photo,
natural skin texture,
slight lens softness,
subtle sensor noise,
imperfect natural lighting,
realistic hair clumping and flyaways,
casual unposed snapshot,
realistic body proportions,
natural posture,
no beauty-filter look,
no glossy advertising look,
no excessive sharpening,
no artificial HDR look
`;

    const finalPrompt = `
ERIKAFACE, ERIKABODY,
${prompt},
${realismPrompt}
`;

    // --------------------------------------------------
    // CREATE REPLICATE PREDICTION
    // --------------------------------------------------

    const predictionResponse = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-dev-lora/predictions",
      {
        method: "POST",

        headers: {
