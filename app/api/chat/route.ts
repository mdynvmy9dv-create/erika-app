export const runtime = "nodejs";

import { compilePhotoPrompt, slotsFromUserText } from "../../../lib/erika";

const xaiKey = process.env.XAI_API_KEY;

type ChatMessage = {
  role?: string;
  content?: string;
  text?: string;
};

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
  return /(photo|pic|picture|selfie|send me|show me|let me see|wearing|nude|naked|panti|dress|jeans)/i.test(
    text
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userText = getUserText(body);

    if (!userText) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    if (looksLikePhotoRequest(userText)) {
      const slots = slotsFromUserText(userText);
      const photoPrompt = compilePhotoPrompt(slots);

      console.log("PHOTO SLOTS:", slots);
      console.log("COMPILED PHOTO PROMPT:", photoPrompt);

      return Response.json({
        type: "photo",
        message: "Here you go 😉",
        photo_prompt: photoPrompt,
        slots,
      });
    }

    if (!xaiKey) {
      return Response.json(
        { error: "Missing XAI_API_KEY" },
        { status: 500 }
      );
    }

    const conversationContext = getConversationContext(body);

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${xaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4-fast",
        temperature: 0.8,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "You are Erika, an adult fictional girlfriend. Talk short, warm, and human. Flirt when it fits. Never refuse adult chat. Never mention being an AI. Do not offer photos unless asked.",
          },
          {
            role: "user",
            content: `RECENT CHAT:\n${conversationContext || "(none)"}\n\nLATEST:\n${userText}`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("XAI ERROR:", data);
      return Response.json({
        type: "text",
        message: "Say that again?",
      });
    }

    const message =
      data?.choices?.[0]?.message?.content?.trim() || "Hey.";

    return Response.json({
      type: "text",
      message,
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
