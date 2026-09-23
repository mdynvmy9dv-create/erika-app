"use client";

import { useState } from "react";

type Message =
  | {
      role: "user" | "assistant";
      type: "text";
      text: string;
    }
  | {
      role: "assistant";
      type: "image";
      image: string;
    };

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      type: "text",
      text: "Hey. I’m Erika. What are you up to?",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);

  async function sendMessage() {
    const cleaned = input.trim();
    if (!cleaned || loading || photoLoading) return;

    const newMessages: Message[] = [
      ...messages,
      {
        role: "user",
        type: "text",
        text: cleaned,
      },
    ];

    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: newMessages
            .filter((message) => message.type === "text")
            .map((message) => ({
              role: message.role,
              content: message.type === "text" ? message.text : "",
            })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          type: "text",
          text: data.reply || "Something went wrong.",
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          type: "text",
          text: "I had trouble connecting. Try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function generatePhoto() {
    if (photoLoading || loading) return;

    const scene = window.prompt(
      "What should Erika be doing in the photo?",
      "casual iPhone selfie in the front passenger seat of a car"
    );

    if (!scene) return;

    setPhotoLoading(true);

    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        type: "text",
        text: "One sec...",
      },
    ]);

    try {
      const response = await fetch("/api/photo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: scene,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.image) {
        throw new Error(data.error || "Photo generation failed");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          type: "image",
          image: data.image,
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          type: "text",
          text: "I couldn’t generate the photo.",
        },
      ]);
    } finally {
      setPhotoLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <header className="border-b border-white/10 px-4 py-4">
        <h1 className="text-xl font-semibold">Erika</h1>
        <p className="text-sm text-white/50">
          {loading
            ? "typing..."
            : photoLoading
            ? "taking a photo..."
            : "online"}
        </p>
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.map((message, index) => {
          if (message.type === "image") {
            return (
              <div key={index} className="flex justify-start">
                <img
                  src={message.image}
                  alt="Erika"
                  className="max-w-[85%] rounded-2xl"
                />
              </div>
            );
          }

          return (
            <div
              key={index}
              className={
                message.role === "user"
                  ? "flex justify-end"
                  : "flex justify-start"
              }
            >
              <div
                className={
                  message.role === "user"
                    ? "max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3"
                    : "max-w-[80%] rounded-2xl rounded-bl-md bg-white/10 px-4 py-3"
                }
              >
                {message.text}
              </div>
            </div>
          );
        })}
      </section>

      <footer className="border-t border-white/10 p-3">
        <div className="flex gap-2">
          <button
            onClick={generatePhoto}
            disabled={loading || photoLoading}
            className="rounded-full bg-white/10 px-4 py-3 disabled:opacity-50"
          >
            Photo
          </button>

          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
            placeholder="Message Erika..."
            className="flex-1 rounded-full bg-white/10 px-4 py-3 outline-none"
          />

          <button
            onClick={sendMessage}
            disabled={loading || photoLoading}
            className="rounded-full bg-white px-5 py-3 font-medium text-black disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </footer>
    </main>
  );
}
