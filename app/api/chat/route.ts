export const runtime = "nodejs";

const openaiKey = process.env.OPENAI_API_KEY;

type ChatMessage = {
  role?: string;
  content?: string;
  text?: string;
};

type ErikaResponse =
  | {
      type: "text";
      message: string;
    }
  | {
      type: "photo";
      message: string;
      photo_prompt: string;
    };

// --------------------------------------------------
// Extract text from OpenAI Responses API
// --------------------------------------------------

function extractOutputText(data: any): string {
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  const pieces: string[] = [];

  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (!Array.isArray(item?.content)) continue;

      for (const content of item.content) {
        if (
          typeof content?.text === "string" &&
          content.text.trim()
        ) {
          pieces.push(content.text);
        }
      }
    }
  }

  return pieces.join("\n").trim();
}

// --------------------------------------------------
// Clean JSON if model wraps it in markdown
// --------------------------------------------------

function cleanJson(text: string): string {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

// --------------------------------------------------
// Find user's latest message
// Supports several possible frontend payload shapes
// --------------------------------------------------

function getUserText(body: any): string {
  if (
    typeof body?.message === "string" &&
    body.message.trim()
  ) {
    return body.message.trim();
  }

  if (
    typeof body?.text === "string" &&
    body.text.trim()
  ) {
    return body.text.trim();
  }

  if (Array.isArray(body?.messages)) {
    const userMessages = body.messages.filter(
      (m: ChatMessage) => m?.role === "user"
    );

    const last =
      userMessages[userMessages.length - 1];

    if (last) {
      if (
        typeof last.content === "string" &&
        last.content.trim()
      ) {
        return last.content.trim();
      }

      if (
        typeof last.text === "string" &&
        last.text.trim()
      ) {
        return last.text.trim();
      }
    }
  }

  return "";
}

// --------------------------------------------------
// Build recent conversation text if frontend supplies it
// --------------------------------------------------

function getConversationContext(body: any): string {
  if (!Array.isArray(body?.messages)) {
    return "";
  }

  return body.messages
    .slice(-20)
    .map((m: ChatMessage) => {
      const role =
        m?.role === "assistant"
          ? "Erika"
          : "User";

      const text =
        typeof m?.content === "string"
          ? m.content
          : typeof m?.text === "string"
          ? m.text
          : "";

      return text
        ? `${role}: ${text}`
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

// --------------------------------------------------

export async function POST(req: Request) {
  try {
    if (!openaiKey) {
      return Response.json(
        {
          error: "Missing OPENAI_API_KEY",
        },
        {
          status: 500,
        }
      );
    }

    const body = await req.json();

    const userText = getUserText(body);

    if (!userText) {
      return Response.json(
        {
          error: "Message is required",
        },
        {
          status: 400,
        }
      );
    }

    const conversationContext =
      getConversationContext(body);

    // --------------------------------------------------
    // ERIKA INSTRUCTIONS
    // --------------------------------------------------

    const instructions = `
You are Erika, an adult fictional female AI companion.

Your job is to talk naturally and conversationally.

Keep responses concise, warm, casual, and human.
Do not sound like an assistant or narrate what you are doing.

IMPORTANT PHOTO BEHAVIOR:

When the user asks for a photo, selfie, picture, image,
or asks to see what Erika looks like, respond with JSON:

{
  "type": "photo",
  "message": "short natural response from Erika",
  "photo_prompt": "detailed image description"
}

For normal conversation respond with:

{
  "type": "text",
  "message": "Erika's response"
}

PHOTO PROMPT RULES:

The user's requested visual details are mandatory.

Never discard or weaken requested:

- front view
- rear view
- back view
- side view
- left side
- right side
- three-quarter view
- full body
- head-to-toe framing
- portrait framing
- camera angle
- pose
- body orientation
- head orientation
- clothing
- garment style
- garment size or coverage
- color
- material
- setting
- lighting
- facial expression

If the user requests "side view", explicitly describe:
"strict 90-degree side profile, camera perpendicular to her body,
shoulders and hips aligned sideways to the camera."

If the user requests "back view" or "rear view", explicitly describe:
"dead-straight rear view, shoulders and hips facing directly away
from the camera."

If the user requests "front view", explicitly describe:
"dead-straight front view, shoulders and hips square to the camera."

If the user requests "full body" or "head to toe", explicitly say:
"entire body visible from the top of the head through both feet,
camera pulled back far enough to include the complete figure."

Do not spontaneously replace lingerie with ordinary clothing.
Do not spontaneously replace a dress with a romper.
Do not change requested clothing coverage or garment construction.

You may add realistic photography details, environment details,
and natural posing details, but they must not contradict what
the user actually requested.

Erika has long dark wavy hair.

PHOTO PROMPTS SHOULD AIM FOR:

photorealistic photography,
natural skin texture,
subtle pores and skin variation,
realistic hair strands and flyaways,
natural facial detail,
realistic fabric texture,
natural posture,
believable lighting,
slight lens softness,
subtle photographic sensor texture.

Return JSON only.
Do not wrap JSON in markdown.
`.trim();

    // --------------------------------------------------
    // INPUT
    // --------------------------------------------------

    const input = `
RECENT CONVERSATION:
${conversationContext || "(No additional context provided.)"}

LATEST USER MESSAGE:
${userText}

Respond as Erika.

If this is a photo request, preserve every visual instruction
from the LATEST USER MESSAGE.
`.trim();

    // --------------------------------------------------
    // CALL OPENAI
    // --------------------------------------------------

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model: "gpt-5.6-luna",
          instructions,
          input,
          max_output_tokens: 600,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "OPENAI CHAT ERROR:",
        data
      );

      return Response.json(
        {
          error:
            "Erika could not respond",
          details: data,
        },
        {
          status: 500,
        }
      );
    }

    const outputText =
      extractOutputText(data);

    if (!outputText) {
      console.error(
        "EMPTY OPENAI RESPONSE:",
        data
      );

      return Response.json(
        {
          error:
            "Erika returned an empty response",
        },
        {
          status: 500,
        }
      );
    }

    // --------------------------------------------------
    // PARSE JSON
    // --------------------------------------------------

    let parsed: ErikaResponse;

    try {
      parsed = JSON.parse(
        cleanJson(outputText)
      );
    } catch {
      // Never break normal chat if JSON formatting slips.
      return Response.json({
        type: "text",
        message: outputText,
      });
    }

    // --------------------------------------------------
    // PHOTO REQUEST
    // --------------------------------------------------

    if (
      parsed.type === "photo" &&
      typeof parsed.photo_prompt === "string"
    ) {
      /*
        CRITICAL FIX:

        The AI can expand the request, but the user's ORIGINAL
        instructions are appended afterward as mandatory image
        instructions.

        This prevents:
        "side view" becoming front-facing,
        "full body" becoming waist-up,
        clothing details disappearing, etc.
      */

      const preservedPhotoPrompt = `
${parsed.photo_prompt.trim()}

MANDATORY USER VISUAL INSTRUCTIONS:
${userText}

The mandatory user visual instructions above take priority over
any conflicting camera angle, orientation, framing, pose,
clothing, garment construction, color, material, setting,
or expression elsewhere in this prompt.
`.trim();

      console.log(
        "PHOTO REQUEST ORIGINAL:",
        userText
      );

      console.log(
        "PHOTO PROMPT PRESERVED:",
        preservedPhotoPrompt
      );

      return Response.json({
        type: "photo",

        message:
          typeof parsed.message === "string" &&
          parsed.message.trim()
            ? parsed.message.trim()
            : "Sure 😉",

        photo_prompt:
          preservedPhotoPrompt,
      });
    }

    // --------------------------------------------------
    // NORMAL TEXT
    // --------------------------------------------------

    return Response.json({
      type: "text",

      message:
        typeof parsed.message === "string" &&
        parsed.message.trim()
          ? parsed.message.trim()
          : outputText,
    });
  } catch (error) {
    console.error(
      "CHAT ROUTE ERROR:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong talking to Erika",
      },
      {
        status: 500,
      }
    );
  }
}
