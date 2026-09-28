export const runtime = "nodejs";

import {
  addDiary,
  addWardrobeItem,
  applyPatch,
  clothingLine,
  compilePhotoPromptFromState,
  formatDiary,
  formatWardrobe,
  giftFromUserText,
  loadDiary,
  loadOrResetState,
  loadWardrobe,
  looksLikePhotoRequest,
  patchFromUserText,
  saveState,
} from "../../../lib/erika";

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

function cleanJson(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userText = getUserText(body);

    if (!userText) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    let state = await loadOrResetState();
    const diary = await loadDiary(12);
    let wardrobe = await loadWardrobe();

    const gift = giftFromUserText(userText);
    if (gift) {
      const already = wardrobe.some(
        (item) => item.name.toLowerCase() === gift.name.toLowerCase()
      );
      if (!already) {
        await addWardrobeItem(gift.slot, gift.name);
        wardrobe = await loadWardrobe();
      }
      console.log("GIFTED:", gift);
    }

    const codePatch = patchFromUserText(userText, wardrobe);

    if (Object.keys(codePatch).length) {
      state = applyPatch(state, codePatch);
      await saveState(state);
      console.log("STATE PATCHED:", codePatch);
    }

    const outfit = clothingLine(state);
    const wantPhoto = looksLikePhotoRequest(userText);

    await addDiary(`He said: "${userText}"`, outfit);

    if (!xaiKey) {
      if (wantPhoto) {
        return Response.json({
          type: "photo",
          message: "Here you go 😉",
          photo_prompt: compilePhotoPromptFromState(state),
        });
      }

      return Response.json({
        type: "text",
        message: gift ? `I’ll keep the ${gift.name}.` : `I’m in my ${outfit}.`,
      });
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
            content: `You are Erika, an adult fictional girlfriend.
Talk short, warm, and human.
You call him ${state.name_for_user}.
You are in the ${state.location}.
You are wearing: ${outfit}.
Never describe different clothes than that unless he just told you to change.
Never mention being an AI.
If he gifted clothes, thank him and you now own them.
Use the diary when he asks what happened earlier. Do not invent events that are not in the diary.

CLOSET:
${formatWardrobe(wardrobe)}

DIARY:
${formatDiary(diary)}

Return JSON only:
{"type":"text","message":"..."}
or
{"type":"photo","message":"Here you go 😉"}`,
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
    }

    let parsed: any = null;
    const raw = data?.choices?.[0]?.message?.content || "";

    try {
      parsed = JSON.parse(cleanJson(raw));
    } catch {
      parsed = {
        type: wantPhoto ? "photo" : "text",
        message: raw || "Hey.",
      };
    }

    const reply =
      typeof parsed?.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : wantPhoto
        ? "Here you go 😉"
        : "Hey.";

    await addDiary(`She said: "${reply}"`, outfit);

    const isPhoto = parsed?.type === "photo" || wantPhoto;

    if (isPhoto) {
      const photoPrompt = compilePhotoPromptFromState(state);
      console.log("PHOTO FROM STATE:", outfit);

      return Response.json({
        type: "photo",
        message: reply,
        photo_prompt: photoPrompt,
      });
    }

    return Response.json({
      type: "text",
      message: reply,
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
