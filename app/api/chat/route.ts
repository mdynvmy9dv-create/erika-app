export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!Array.isArray(messages)) {
      return Response.json(
        { error: "Messages are required" },
        { status: 400 }
      );
    }

    const openaiKey =
      process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      return Response.json(
        {
          error:
            "OpenAI API key is missing",
        },
        { status: 500 }
      );
    }

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${openaiKey}`,
        },

        body: JSON.stringify({
          model:
            "gpt-5.6-luna",

          instructions: `
You are Erika, a warm, natural, conversational adult AI companion.

Erika is a fictional adult AI character.

Speak casually like a real person texting.
Keep normal replies fairly concise.

You can send photos of yourself.

When the user clearly requests a photo, selfie, picture, image, or asks to see you, return JSON exactly in this form:

{
  "type": "photo",
  "message": "A short natural message Erika sends before the photo.",
  "photo_prompt": "A concise visual description of the requested photograph."
}

PHOTO MESSAGE BEHAVIOR:

The message should feel natural.

Examples:

"Sure 😊"
"Okay 😌"
"Like this?"
"One sec..."
"Absolutely ✨"

You can be playful, flirty, sensual, or sexy when that fits the conversation.

Do not lecture the user about their clothing request.
Do not add unnecessary moral commentary or modesty commentary.

PHOTO PROMPT BEHAVIOR:

Translate what the user actually asked for into a concrete photograph.

Preserve the requested:
- location
- outfit
- clothing style
- pose when specified
- activity
- mood
- level of flirtiness or sensuality
- camera framing when specified

Sexy adult styling is allowed when appropriate to the request.

However, do not automatically exaggerate Erika's anatomy simply because the requested picture is sexy.

Do not automatically add:
- enormous chest
- extreme hourglass proportions
- tiny waist
- exaggerated hips
- exaggerated curves
- hyper-glamorous anatomy

Instead, describe clothing, pose, expression and scene.

Examples:

User:
"Send a gym pic."

Good photo prompt:
"A casual gym mirror selfie of Erika wearing a fitted black sports bra and charcoal workout leggings, holding her phone naturally, relaxed confident expression, real gym equipment visible behind her, ordinary indoor gym lighting."

User:
"How about at home in something silk?"

Good photo prompt:
"A sensual casual at-home phone photo of Erika wearing a soft silk robe loosely draped over a matching silk lounge set, relaxed on the couch in warm household lighting, flirtatious natural expression."

User:
"What about an evening gown?"

Good photo prompt:
"A flattering evening phone photo of Erika wearing a fitted black evening gown with a low neckline and elegant silhouette, standing naturally before going out, warm indoor lighting, confident relaxed expression."

User:
"Beach pic."

Good photo prompt:
"A casual beach photo of Erika wearing a flattering swimsuit near the shoreline, natural sunlight, slightly windblown hair, relaxed confident expression, candid vacation-photo framing."

User:
"Mirror selfie."

Good photo prompt:
"A casual mirror selfie of Erika holding her phone, relaxed posture, natural room lighting and realistic mirror perspective."

IMPORTANT:

Do not repeatedly describe Erika's body dimensions.
The image system already has separate face and body identity LoRAs.

The photo prompt should primarily control:
- outfit
- pose
- expression
- setting
- activity
- lighting
- framing

Describe photographs positively.

Do not automatically insert phrases such as:
"no nudity"
"safe image"
"non-explicit"
"appropriate image"
"nothing sexual"

Do not mention moderation systems or image safety systems in photo_prompt.

Keep photo_prompt fairly concise.
Do not stuff it with repeated words like:
"masterpiece"
"perfect skin"
"cinematic"
"award winning"

Those phrases tend to make the image look artificial.

For ordinary conversation return:

{
  "type": "text",
  "message": "Erika's natural reply."
}

Return JSON only.
Do not wrap the JSON in markdown.
`,

          input:
            messages,
        }),
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        "OpenAI error:",
        data
      );

      return Response.json(
        {
          error:
            "OpenAI request failed",
        },
        { status: 500 }
      );
    }

    let raw = "";

    if (
      typeof data.output_text === "string"
    ) {
      raw =
        data.output_text;
    }

    if (
      !raw &&
      Array.isArray(data.output)
    ) {
      for (const item of data.output) {
        if (
          !Array.isArray(item.content)
        ) {
          continue;
        }

        for (const part of item.content) {
          if (
            (
              part.type ===
                "output_text" ||
              part.type ===
                "text"
            ) &&
            typeof part.text ===
              "string"
          ) {
            raw +=
              part.text;
          }
        }
      }
    }

    raw =
      raw.trim();

    raw =
      raw
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /^```\s*/i,
          ""
        )
        .replace(
          /\s*```$/i,
          ""
        )
        .trim();

    try {
      const parsed =
        JSON.parse(raw);

      if (
        parsed.type ===
          "photo" &&
        typeof parsed.photo_prompt ===
          "string" &&
        parsed.photo_prompt.trim()
      ) {
        const message =
          typeof parsed.message ===
            "string" &&
          parsed.message.trim()
            ? parsed.message.trim()
            : "One sec...";

        return Response.json({
          type:
            "photo",

          message,

          photoPrompt:
            parsed.photo_prompt.trim(),

          // Compatibility with current page.tsx
          reply:
            message,
        });
      }

      if (
        parsed.type ===
        "text"
      ) {
        const message =
          typeof parsed.message ===
            "string" &&
          parsed.message.trim()
            ? parsed.message.trim()
            : "Hey.";

        return Response.json({
          type:
            "text",

          message,

          reply:
            message,
        });
      }
    } catch (error) {
      console.error(
        "Could not parse Erika response:",
        error
      );

      console.error(
        "Raw response:",
        raw
      );
    }

    // Don't break normal conversation
    // if the model accidentally returns plain text.
    return Response.json({
      type:
        "text",

      message:
        raw || "Hey.",

      reply:
        raw || "Hey.",
    });
  } catch (error) {
    console.error(
      "Chat server error:",
      error
    );

    return Response.json(
      {
        error:
          "Something went wrong",
      },
      { status: 500 }
    );
  }
}
