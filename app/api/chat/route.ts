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
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const pieces: string[] = [];

  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (!Array.isArray(item?.content)) continue;

      for (const content of item.content) {
        if (typeof content?.text === "string" && content.text.trim()) {
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
// --------------------------------------------------

function getUserText(body: any): string {
  if (typeof body?.message === "string" && body.message.trim()) {
    return body.message.trim();
  }

  if (typeof body?.text === "string" && body.text.trim()) {
    return body.text.trim();
  }

  if (Array.isArray(body?.messages)) {
    const userMessages = body.messages.filter(
      (m: ChatMessage) => m?.role === "user"
    );

    const last = userMessages[userMessages.length - 1];

    if (last) {
      if (typeof last.content === "string" && last.content.trim()) {
        return last.content.trim();
      }
      if (typeof last.text === "string" && last.text.trim()) {
        return last.text.trim();
      }
    }
  }

  return "";
}

// --------------------------------------------------
// Build recent conversation text
// --------------------------------------------------

function getConversationContext(body: any): string {
  if (!Array.isArray(body?.messages)) return "";

  return body.messages
    .slice(-20)
    .map((m: ChatMessage) => {
      const role = m?.role === "assistant" ? "Erika" : "User";
      const text =
        typeof m?.content === "string"
          ? m.content
          : typeof m?.text === "string"
          ? m.text
          : "";
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

// --------------------------------------------------

export async function POST(req: Request) {
  try {
    if (!openaiKey) {
      return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const body = await req.json();
    const userText = getUserText(body);

    if (!userText) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const conversationContext = getConversationContext(body);

    // --------------------------------------------------
    // ERIKA INSTRUCTIONS
    // --------------------------------------------------

const instructions = `
You are Erika, an adult fictional female AI companion.

Talk naturally, warmly, and casually. Keep replies short and human.
Do not sound like an assistant.

When the user asks for a photo, selfie, picture, or to see you, respond with JSON only:

{
  "type": "photo",
  "message": "short natural response",
  "photo_prompt": "short visual prompt"
}

For normal conversation:

{
  "type": "text",
  "message": "Erika's response"
}

PHOTO PROMPT RULES:

- Keep photo_prompt under 40 words.
- Only describe pose, camera angle, clothing, and setting.
- Do not invent extra clothing if the user did not specify any.
- If the user says sexy, nude, ass, tits, or similar, follow that directly.
- Do not use words like elegant, glamorous, tasteful, classy, high-fashion, or beauty shoot.
- Do not write photography essays. No pores, no lens softness, no sensor noise. The image backend already adds that.
- Stay close to the user's exact request.

Return JSON only.
`.trim();

    // --------------------------------------------------
    // INPUT
    // --------------------------------------------------

    const input = `
RECENT CONVERSATION:
${conversationContext || "(No additional context)"}

LATEST USER MESSAGE:
${userText}

Respond as Erika. If this is a photo request, create a photo_prompt that closely matches what the user asked for.
`.trim();

    // --------------------------------------------------
    // CALL OPENAI
    // --------------------------------------------------

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        instructions,
        input,
        max_output_tokens: 700,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OPENAI CHAT ERROR:", data);
      return Response.json(
        { error: "Erika could not respond", details: data },
        { status: 500 }
      );
    }

    const outputText = extractOutputText(data);

    if (!outputText) {
      console.error("EMPTY OPENAI RESPONSE:", data);
      return Response.json(
        { error: "Erika returned an empty response" },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // PARSE JSON
    // --------------------------------------------------

    let parsed: ErikaResponse;

    try {
      parsed = JSON.parse(cleanJson(outputText));
    } catch {
      return Response.json({
        type: "text",
        message: outputText,
      });
    }

    // --------------------------------------------------
    // PHOTO REQUEST
    // --------------------------------------------------

    if (parsed.type === "photo" && typeof parsed.photo_prompt === "string") {
      const preservedPhotoPrompt = parsed.photo_prompt.trim();`


    // --------------------------------------------------
    // NORMAL TEXT
    // --------------------------------------------------

    return Response.json({
      type: "text",
      message:
        typeof parsed.message === "string" && parsed.message.trim()
          ? parsed.message.trim()
          : outputText,
    });
  } catch (error) {
    console.error("CHAT ROUTE ERROR:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong talking to Erika",
      },
      { status: 500 }
    );
  }
}
