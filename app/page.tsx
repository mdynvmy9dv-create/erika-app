"use client";

import { useState } from "react";

type Message = {
  role: "user" | "assistant";
  text: string;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hey. I’m Erika. What are you up to?",
    },
  ]);

  const [input, setInput] = useState("");

  function sendMessage() {
    const cleaned = input.trim();
    if (!cleaned) return;

    setMessages((current) => [
      ...current,
      { role: "user", text: cleaned },
      {
        role: "assistant",
        text: "I’m not connected to the AI yet, but the chat screen is working.",
      },
    ]);

    setInput("");
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <header className="border-b border-white/10 px-4 py-4">
        <h1 className="text-xl font-semibold">Erika</h1>
        <p className="text-sm text-white/50">online</p>
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.map((message, index) => (
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
        ))}
      </section>

      <footer className="border-t border-white/10 p-3">
        <div className="flex gap-2">
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
            className="rounded-full bg-white px-5 py-3 font-medium text-black"
          >
            Send
          </button>
        </div>
      </footer>
    </main>
  );
}
