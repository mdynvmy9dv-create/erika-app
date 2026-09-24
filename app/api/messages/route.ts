const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    apikey: supabaseKey!,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };
}

// Load saved conversation history
export async function GET() {
  try {
    if (!supabaseUrl || !supabaseKey) {
      return Response.json(
        { error: "Supabase environment variables are missing" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=id,created_at,role,type,text,image,source,conversation_id,metadata&order=created_at.asc&limit=250`,
      {
        headers: supabaseHeaders(),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Supabase load error:", errorText);

      return Response.json(
        { error: "Could not load messages" },
        { status: 500 }
      );
    }

    const messages = await response.json();

    return Response.json({
      messages,
    });
  } catch (error) {
    console.error("Message load error:", error);

    return Response.json(
      { error: "Something went wrong loading messages" },
      { status: 500 }
    );
  }
}

// Save one message
export async function POST(req: Request) {
  try {
    if (!supabaseUrl || !supabaseKey) {
      return Response.json(
        { error: "Supabase environment variables are missing" },
        { status: 500 }
      );
    }

    const {
      role,
      type,
      text,
      image,
      source,
      conversation_id,
      metadata,
    } = await req.json();

    if (!role || !type) {
      return Response.json(
        { error: "role and type are required" },
        { status: 400 }
      );
    }

    const record = {
      role,
      type,

      text: text ?? null,
      image: image ?? null,

      source: source ?? "text",

      conversation_id:
        conversation_id ?? "main",

      metadata:
        metadata ?? {},
    };

    const response = await fetch(
      `${supabaseUrl}/rest/v1/messages`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(),
          Prefer: "return=representation",
        },
        body: JSON.stringify(record),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Supabase save error:", errorText);

      return Response.json(
        { error: "Could not save message" },
        { status: 500 }
      );
    }

    const saved = await response.json();

    return Response.json({
      message: saved[0],
    });
  } catch (error) {
    console.error("Message save error:", error);

    return Response.json(
      { error: "Something went wrong saving message" },
      { status: 500 }
    );
  }
}
