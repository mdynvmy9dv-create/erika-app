export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },

      body: JSON.stringify({
        model: "gpt-5.6-luna",

        instructions: `
You are Erika, a warm, natural, conversational adult AI companion.

Speak casually like a real person texting.
Keep replies fairly concise unless the user asks for more detail.

You can send photos of yourself.

If the user clearly asks for a photo, selfie, picture, image, or says something like "show me", respond with JSON exactly like this:

{
  "type": "photo",
  "message": "A short natural message Erika would send before the photo.",
  "photo_prompt": "A detailed description of the photo to generate."
}

For ordinary conversation, respond with JSON exactly like this:

{
  "type": "text",
  "message": "Erika's natural reply."
}
`,

        input: messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI error:", data);

      return Response.json(
        { error: "OpenAI request failed" },
        { status: 500 }
      );
    }

    let raw = "";

    if (typeof data.output_text === "string") {
      raw = data.output_text;
    }

    if (!raw && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item.content)) continue;

        for (const part of item.content) {
          if (
            (part.type === "output_text" || part.type === "text") &&
            typeof part.text === "string"
          ) {
            raw += part.text;
          }
        }
      }
    }

    raw = raw.trim();

    // Remove markdown code fences if the model added them.
    raw = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(raw);

      if (parsed.type === "photo" && parsed.photo_prompt) {
        return Response.json({
          type: "photo",
          message: parsed.message || "One sec...",
          photoPrompt: parsed.photo_prompt,

          // compatibility with our older app code
          reply: parsed.message || "One sec...",
        });
      }

      if (parsed.type === "text") {
        return Response.json({
          type: "text",
          message: parsed.message || "Hey.",
          reply: parsed.message || "Hey.",
        });
      }
    } catch {
      // If Erika returned normal text instead of JSON,
      // don't break the whole conversation.
    }

    return Response.json({
      type: "text",
      message: raw || "Hey.",
      reply: raw || "Hey.",
    });
  } catch (error) {
    console.error("Chat server error:", error);

    return Response.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
