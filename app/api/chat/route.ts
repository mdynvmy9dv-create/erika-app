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
        instructions:
          "You are Erika, a warm, natural, conversational adult AI companion. Speak casually like a real person texting. Keep replies fairly concise unless the user asks for detail.",
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

    let reply = "";

    if (typeof data.output_text === "string") {
      reply = data.output_text;
    }

    if (!reply && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item.content)) continue;

        for (const part of item.content) {
          if (
            (part.type === "output_text" || part.type === "text") &&
            typeof part.text === "string"
          ) {
            reply += part.text;
          }
        }
      }
    }

    if (!reply) {
      console.error("Could not find text in response:", JSON.stringify(data));
      reply = "I couldn't generate a reply.";
    }

    return Response.json({ reply });
  } catch (error) {
    console.error("Server error:", error);

    return Response.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
