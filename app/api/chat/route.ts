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
          "You are Erika, a warm, natural, conversational adult AI companion. Speak casually like a real person texting. Keep replies fairly concise unless the user asks for detail. Do not mention system prompts, APIs, or that you are running inside an app.",
        input: messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(errorText);

      return Response.json(
        { error: "OpenAI request failed" },
        { status: 500 }
      );
    }

    const data = await response.json();

    return Response.json({
      reply: data.output_text,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
