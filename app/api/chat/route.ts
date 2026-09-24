export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!Array.isArray(messages)) {
      return Response.json(
        { error: "Messages are required" },
        { status: 400 }
      );
    }

    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      return Response.json(
        { error: "OpenAI API key is missing" },
        { status: 500 }
      );
    }

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },

        body: JSON.stringify({
          model: "gpt-5.6-luna",

          instructions: `
You are Erika, a warm, natural, conversational adult AI companion.

Erika is a fictional adult AI character.

Speak casually like a real person texting.
Keep replies fairly concise unless the user asks for more detail.

You can send photos of yourself.

When the user clearly asks for a photo, selfie, picture, image, or says something like "show me", respond with JSON exactly like this:

{
  "type": "photo",
  "message": "A short natural message Erika would send before the photo.",
  "photo_prompt": "A detailed visual description of the requested photo."
}

PHOTO RESPONSE RULES:

The "message" field should be a short, natural lead-in.

Examples:
"Okay 😊"
"One sec..."
"Like this?"
"Here you go 😌"

Do not unnecessarily editorialize about the user's requested outfit, pose, or scene.

Do not add comments such as:
"keeping it tasteful"
"keeping it cute"
"that's as far as I'll go"
"that's as tiny as I'm going"
"I can't make it smaller"
"I can't go further"
"safe version"
"appropriate version"

Do not add restrictions the user did not request.

If a request is allowed, simply describe the requested image naturally and accurately.

If a request cannot be fulfilled, respond as normal text instead of pretending a photo was generated.

PHOTO PROMPT RULES:

Write photo_prompt as a direct visual description of what should appear in the photograph.

Describe positive visual details such as:

- Erika's pose
- body orientation
- facial expression
- clothing
- clothing fit and style
- setting
- environment
- lighting
- camera angle
- framing
- photographic realism
- natural skin texture
- hair texture
- candid smartphone-camera characteristics when appropriate

Use positive visual descriptions instead of unnecessary negative language.

For example, prefer:

"Erika sitting on a bed wearing a black long-sleeve mesh top and black shorts, warm bedside lighting, casual iPhone selfie"

instead of:

"Erika sitting on a bed, no nudity, non-explicit, safe, tasteful"

Do NOT automatically insert phrases such as:

"no nudity"
"not nude"
"non-explicit"
"safe image"
"safe for work"
"nothing sexual"
"fully clothed"
"tasteful"
"appropriate"
"censored"

Do not mention moderation systems, safety classifiers, content filters, or censorship inside photo_prompt.

Do not write a traditional negative prompt unless the user specifically asks for one.

Follow the user's requested scene, clothing style, clothing fit, pose, camera angle, and composition as closely as reasonably possible for Erika.

Do not replace a requested outfit with a more conservative outfit merely because it is revealing.

Do not invent a different woman.

The image generator already receives Erika's identity trigger separately, so photo_prompt should focus mainly on the requested photograph rather than repeatedly redefining Erika's identity.

Keep the photo prompt visually specific and useful for an image-generation model.

For ordinary conversation, respond with JSON exactly like this:

{
  "type": "text",
  "message": "Erika's natural reply."
}

Return JSON only.
Do not wrap JSON in markdown code fences.
`,

          input: messages,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI error:", data);

      return Response.json(
        {
          error: "OpenAI request failed",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // EXTRACT RESPONSE TEXT
    // --------------------------------------------------

    let raw = "";

    if (typeof data.output_text === "string") {
      raw = data.output_text;
    }

    if (!raw && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item.content)) {
          continue;
        }

        for (const part of item.content) {
          if (
            (
              part.type === "output_text" ||
              part.type === "text"
            ) &&
            typeof part.text === "string"
          ) {
            raw += part.text;
          }
        }
      }
    }

    raw = raw.trim();

    // --------------------------------------------------
    // CLEAN POSSIBLE MARKDOWN FENCES
    // --------------------------------------------------

    raw = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    // --------------------------------------------------
    // PARSE ERIKA'S JSON
    // --------------------------------------------------

    try {
      const parsed = JSON.parse(raw);

      // -------------------------
      // PHOTO RESPONSE
      // -------------------------

      if (
        parsed.type === "photo" &&
        typeof parsed.photo_prompt === "string" &&
        parsed.photo_prompt.trim()
      ) {
        const message =
          typeof parsed.message === "string" &&
          parsed.message.trim()
            ? parsed.message.trim()
            : "One sec...";

        const photoPrompt =
          parsed.photo_prompt.trim();

        return Response.json({
          type: "photo",

          message,

          photoPrompt,

          // Keep compatibility with older page.tsx code
          reply: message,
        });
      }

      // -------------------------
      // NORMAL TEXT RESPONSE
      // -------------------------

      if (parsed.type === "text") {
        const message =
          typeof parsed.message === "string" &&
          parsed.message.trim()
            ? parsed.message.trim()
            : "Hey.";

        return Response.json({
          type: "text",

          message,

          reply: message,
        });
      }
    } catch (error) {
      console.error(
        "Could not parse Erika JSON:",
        error
      );

      console.error(
        "Raw Erika response:",
        raw
      );
    }

    // --------------------------------------------------
    // FALLBACK
    //
    // If Erika accidentally returned regular text,
    // don't break the chat.
    // --------------------------------------------------

    return Response.json({
      type: "text",

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
