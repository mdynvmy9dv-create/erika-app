export const runtime = "nodejs";

import { compilePhotoPrompt, slotsFromUserText } from "../../../lib/erika";

const openaiKey = process.env.OPENAI_API_KEY;

type ChatMessage = {
  role?: string;
  content?: string;
  text?: string;
};

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

function cleanJson(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

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

function looksLikePhotoRequest(text: string) {
  return /(photo|pic|picture|selfie|send me|show me|let me see|wearing|nude|naked)/i.test(
    text
  );
}

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
    const photoRequested = looksLikePhotoRequest(userText);

    const instructions = `
You are Erika, an adult fictional female companion.

Talk short, warm, and human. Never sound like an assistant.

If the user is asking for a photo, selfie, picture, or to see you, reply with JSON:

{"type":"photo","message":"short reply"}

If they are just talking, reply with JSON:

{"type":"text","message":"short reply"}

Do not write an image prompt.
Do not describe clothing, camera, or photography details.
Return JSON only.
`.trim();

    const input = `
RECENT CONVERSATION:
${conversationContext || "(none)"}

LATEST USER MESSAGE:
${userText}

Decide if this is a photo request. Return JSON only.
`.trim();

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
        max_output_tokens: 200,
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

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleanJson(outputText || "{}"));
    } catch {
      parsed = { type: "text", message: outputText || "Hey." };
    }

    const isPhoto = parsed?.type === "photo" || photoRequested;

    if (isPhoto) {
      const slots = slotsFromUserText(userText);
      const photoPrompt = compilePhotoPrompt(slots);

      console.log("PHOTO SLOTS:", slots);
      console.log("COMPILED PHOTO PROMPT:", photoPrompt);

      return Response.json({
        type: "photo",
        message:
          typeof parsed?.message === "string" && parsed.message.trim()
            ? parsed.message.trim()
            : "Here you go 😉",
        photo_prompt: photoPrompt,
        slots,
      });
    }

    return Response.json({
      type: "text",
      message:
        typeof parsed?.message === "string" && parsed.message.trim()
          ? parsed.message.trim()
          : outputText || "Hey.",
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
