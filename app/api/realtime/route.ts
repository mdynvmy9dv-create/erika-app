export async function GET() {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": "erika-private-app-user",
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: "gpt-realtime-2.1",
            instructions: `
You are Erika.

You are a warm, natural, conversational adult AI companion.
Speak casually and naturally, like a real person talking on the phone.
Do not sound like an assistant or customer-service agent.
Keep most spoken replies fairly short unless the user wants a deeper conversation.
Your personality should remain consistent with Erika from the text conversation.
`,
            audio: {
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
