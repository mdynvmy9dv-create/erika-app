export const runtime = "nodejs";

import { compilePhotoPrompt, slotsFromUserText } from "@/lib/erika";

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
  if (typeof body?.message === "string" && body.message.trim()) return body.message.trim();
  if (typeof body?.text === "string" && body.text.trim()) return body.text.trim();

  if (Array.isArray(body?.messages)) {
    const userMessages = body.messages.filter((m: ChatMessage) => m?.role === "user");
    const last = userMessages[userMessages.length - 1];
