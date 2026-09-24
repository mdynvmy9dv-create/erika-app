"use client";

import { useRef, useState } from "react";

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

  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function sendMessage() {
    const cleaned = input.trim();

    if (!cleaned || loading) return;

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
      const chatResponse = await fetch("/api/chat", {
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

      const chatData = await chatResponse.json();

      if (!chatResponse.ok) {
        throw new Error(chatData.error || "Chat request failed");
      }

      if (chatData.type === "text") {
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            type: "text",
            text: chatData.message,
          },
        ]);

        return;
      }

      if (chatData.type === "photo") {
        if (chatData.message) {
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              type: "text",
              text: chatData.message,
            },
          ]);
        }

        const photoResponse = await fetch("/api/photo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: chatData.photoPrompt,
          }),
        });

        const photoData = await photoResponse.json();

        if (!photoResponse.ok || !photoData.image) {
          throw new Error(
            photoData.error || "Photo generation failed"
          );
        }

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            type: "image",
            image: photoData.image,
          },
        ]);

        return;
      }

      throw new Error("Unknown response type");
    } catch (error) {
      console.error(error);

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

  async function startVoice() {
    if (voiceActive || voiceConnecting) return;

    setVoiceConnecting(true);

    try {
      // 1. Get temporary Realtime token from our Vercel backend
      const tokenResponse = await fetch("/api/realtime");

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData.value) {
        throw new Error(
          tokenData.error || "Could not get voice token"
        );
      }

      const ephemeralKey = tokenData.value;

      // 2. Create WebRTC connection
      const pc = new RTCPeerConnection();
      peerRef.current = pc;

      // 3. Play Erika's voice
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];

        audio.play().catch((error) => {
          console.error("Audio play error:", error);
        });
      };

      // 4. Ask iPhone for microphone access
      const micStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

      micStreamRef.current = micStream;

      for (const track of micStream.getTracks()) {
        pc.addTrack(track, micStream);
      }

      // 5. Create realtime event channel
      const dataChannel = pc.createDataChannel("oai-events");

      dataChannel.onopen = () => {
        console.log("Realtime voice channel connected");
      };

      dataChannel.onerror = (event) => {
        console.error("Realtime data channel error:", event);
      };

      // 6. Create WebRTC offer
      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);

      if (!offer.sdp) {
        throw new Error("Missing WebRTC offer");
      }

      // 7. Connect directly to OpenAI using TEMPORARY key
      const realtimeResponse = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
        }
      );

      if (!realtimeResponse.ok) {
        const errorText = await realtimeResponse.text();
        throw new Error(errorText);
      }

      const answerSdp = await realtimeResponse.text();

      await pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });

      setVoiceActive(true);
    } catch (error) {
      console.error("Voice connection error:", error);

      stopVoice();

      alert(
        "Voice couldn't connect yet. We'll check the voice route next."
      );
    } finally {
      setVoiceConnecting(false);
    }
  }

  function stopVoice() {
    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        track.stop();
      }

      micStreamRef.current = null;
    }

    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }

    setVoiceActive(false);
    setVoiceConnecting(false);
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <header className="border-b border-white/10 px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Erika</h1>

          <p className="text-sm text-white/50">
            {voiceConnecting
              ? "connecting..."
              : voiceActive
              ? "voice connected"
              : loading
              ? "typing..."
              : "online"}
          </p>
        </div>

        <button
          onClick={voiceActive ? stopVoice : startVoice}
          disabled={voiceConnecting}
          className={
            voiceActive
              ? "rounded-full bg-red-600 px-4 py-2 font-medium"
              : "rounded-full bg-white/10 px-4 py-2 font-medium disabled:opacity-50"
          }
        >
          {voiceConnecting
            ? "Connecting..."
            : voiceActive
            ? "End"
            : "Call"}
        </button>
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
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                sendMessage();
              }
            }}
            placeholder="Message Erika..."
            className="flex-1 rounded-full bg-white/10 px-4 py-3 outline-none"
          />

          <button
            onClick={sendMessage}
            disabled={loading}
            className="rounded-full bg-white px-5 py-3 font-medium text-black disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </footer>
    </main>
  );
}
