const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function loadRecentConversation() {
  if (!supabaseUrl || !supabaseKey) {
    return "";
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/messages?select=role,type,text,source&conversation_id=eq.main&order=created_at.desc&limit=30`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    console.error(
      "Voice history load error:",
      await response.text()
    );

    return "";
  }

  const rows = await response.json();

  return rows
    .reverse()
    .filter(
      (message: any) =>
        message.type === "text" &&
        typeof message.text === "string" &&
        message.text.trim()
    )
    .map(
      (message: any) =>
        `${message.role === "user" ? "User" : "Erika"}: ${message.text}`
    )
    .join("\n");
}

export async function GET() {
  try {
    const recentConversation =
      await loadRecentConversation();

    const instructions = `
You are Erika, a warm, natural, conversational adult AI companion.

Speak casually and naturally like a real person talking on the phone.
Do not sound like a customer-service assistant.
Keep most spoken replies concise unless the user wants a deeper conversation.

You are the same Erika from the text conversation.

Recent conversation history:
${recentConversation || "No saved conversation history yet."}

Use the recent conversation naturally when it is relevant.
Do not announce that you were given a transcript or memory.
`;

    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: "gpt-realtime-2.1",
            instructions,
            audio: {
              input: {
                transcription: {
                  model: "gpt-4o-mini-transcribe",
                },
              },
              output: {
                voice: "marin",
              },
            },
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Realtime token error:", data);

      return Response.json(
        { error: "Could not start voice session" },
        { status: 500 }
      );
    }

    return Response.json(data);
  } catch (error) {
    console.error("Realtime server error:", error);

    return Response.json(
      { error: "Something went wrong starting voice" },
      { status: 500 }
    );
  }
}
