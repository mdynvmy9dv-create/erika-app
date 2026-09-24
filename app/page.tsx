"use client";

import { useEffect, useRef, useState } from "react";

type Message =
  | {
      role: "user" | "assistant";
      type: "text";
      text: string;
      source?: "text" | "voice";
    }
  | {
      role: "assistant";
      type: "image";
      image: string;
      source?: "photo";
    };

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  const savedVoiceItemsRef = useRef<Set<string>>(new Set());

  // -------------------------
  // LOAD HISTORY
  // -------------------------

  useEffect(() => {
    async function loadHistory() {
      try {
        const response = await fetch("/api/messages", {
          cache: "no-store",
        });

        const data = await response.json();

        if (
          response.ok &&
          Array.isArray(data.messages) &&
          data.messages.length > 0
        ) {
          const loaded: Message[] = data.messages
            .map((message: any) => {
              if (
                message.type === "text" &&
                (message.role === "user" ||
                  message.role === "assistant")
              ) {
                return {
                  role: message.role,
                  type: "text",
                  text: message.text || "",
                  source: message.source || "text",
                } as Message;
              }

              if (
                message.type === "image" &&
                message.role === "assistant" &&
                message.image
              ) {
                return {
                  role: "assistant",
                  type: "image",
                  image: message.image,
                  source: "photo",
                } as Message;
              }

              return null;
            })
            .filter(Boolean) as Message[];

          setMessages(loaded);
        } else {
          setMessages([
            {
              role: "assistant",
              type: "text",
              text: "Hey. I’m Erika. What are you up to?",
              source: "text",
            },
          ]);
        }
      } catch (error) {
        console.error("Could not load history:", error);

        setMessages([
          {
            role: "assistant",
            type: "text",
            text: "Hey. I’m Erika. What are you up to?",
            source: "text",
          },
        ]);
      } finally {
        setHistoryLoaded(true);
      }
    }

    loadHistory();
  }, []);

  // -------------------------
  // SAVE MESSAGE
  // -------------------------

  async function saveMessage(
    message: Message,
    metadata: Record<string, any> = {}
  ) {
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: message.role,
          type: message.type,
          text:
            message.type === "text"
              ? message.text
              : null,
          image:
            message.type === "image"
              ? message.image
              : null,
          source:
            message.type === "image"
              ? "photo"
              : message.source || "text",
          conversation_id: "main",
          metadata,
        }),
      });
    } catch (error) {
      console.error("Could not save message:", error);
    }
  }

  // -------------------------
  // NORMAL TEXT CHAT
  // -------------------------

  async function sendMessage() {
    const cleaned = input.trim();

    if (!cleaned || loading) return;

    const userMessage: Message = {
      role: "user",
      type: "text",
      text: cleaned,
      source: "text",
    };

    const newMessages = [...messages, userMessage];

    setMessages(newMessages);
    setInput("");
    setLoading(true);

    await saveMessage(userMessage);

    try {
      const textHistory = newMessages
        .filter((message) => message.type === "text")
        .slice(-40)
        .map((message) => ({
          role: message.role,
          content:
            message.type === "text"
              ? message.text
              : "",
        }));

      const chatResponse = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: textHistory,
        }),
      });

      const chatData = await chatResponse.json();

      if (!chatResponse.ok) {
        throw new Error(
          chatData.error || "Chat request failed"
        );
      }

      if (chatData.type === "text") {
        const assistantMessage: Message = {
          role: "assistant",
          type: "text",
          text: chatData.message,
          source: "text",
        };

        setMessages((current) => [
          ...current,
          assistantMessage,
        ]);

        await saveMessage(assistantMessage);

        return;
      }

      if (chatData.type === "photo") {
        if (chatData.message) {
          const beforePhotoMessage: Message = {
            role: "assistant",
            type: "text",
            text: chatData.message,
            source: "text",
          };

          setMessages((current) => [
            ...current,
            beforePhotoMessage,
          ]);

          await saveMessage(beforePhotoMessage);
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

        if (
          !photoResponse.ok ||
          !photoData.image
        ) {
          throw new Error(
            photoData.error ||
              "Photo generation failed"
          );
        }

        const imageMessage: Message = {
          role: "assistant",
          type: "image",
          image: photoData.image,
          source: "photo",
        };

        setMessages((current) => [
          ...current,
          imageMessage,
        ]);

        await saveMessage(
          imageMessage,
          photoData.metadata || {
            prompt: chatData.photoPrompt,
          }
        );

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
          source: "text",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // -------------------------
  // VOICE EVENT HANDLER
  // -------------------------

  async function handleRealtimeEvent(event: any) {
    try {
      // User speech transcription completed
      if (
        event.type ===
          "conversation.item.input_audio_transcription.completed" &&
        event.transcript
      ) {
        const key =
          event.item_id ||
          `user-${event.transcript}`;

        if (savedVoiceItemsRef.current.has(key)) {
          return;
        }

        savedVoiceItemsRef.current.add(key);

        const voiceUserMessage: Message = {
          role: "user",
          type: "text",
          text: event.transcript,
          source: "voice",
        };

        setMessages((current) => [
          ...current,
          voiceUserMessage,
        ]);

        await saveMessage(voiceUserMessage, {
          realtime_item_id: event.item_id || null,
        });

        return;
      }

      // Erika's spoken response transcript completed
      if (
        event.type ===
          "response.audio_transcript.done" &&
        event.transcript
      ) {
        const key =
          event.item_id ||
          event.response_id ||
          `assistant-${event.transcript}`;

        if (savedVoiceItemsRef.current.has(key)) {
          return;
        }

        savedVoiceItemsRef.current.add(key);

        const voiceAssistantMessage: Message = {
          role: "assistant",
          type: "text",
          text: event.transcript,
          source: "voice",
        };

        setMessages((current) => [
          ...current,
          voiceAssistantMessage,
        ]);

        await saveMessage(voiceAssistantMessage, {
          realtime_item_id: event.item_id || null,
          realtime_response_id:
            event.response_id || null,
        });

        return;
      }
    } catch (error) {
      console.error(
        "Realtime event handling error:",
        error
      );
    }
  }

  // -------------------------
  // LIVE VOICE
  // -------------------------

  async function startVoice() {
    if (voiceActive || voiceConnecting) return;

    setVoiceConnecting(true);

    try {
      const tokenResponse =
        await fetch("/api/realtime");

      const tokenData =
        await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        !tokenData.value
      ) {
        throw new Error(
          tokenData.error ||
            "Could not get voice token"
        );
      }

      const ephemeralKey = tokenData.value;

      const pc = new RTCPeerConnection();
      peerRef.current = pc;

      const audio =
        document.createElement("audio");

      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];

        audio.play().catch((error) => {
          console.error(
            "Audio play error:",
            error
          );
        });
      };

      const micStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

      micStreamRef.current = micStream;

      for (const track of micStream.getTracks()) {
        pc.addTrack(track, micStream);
      }

      const dataChannel =
        pc.createDataChannel("oai-events");

      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => {
        console.log(
          "Realtime voice connected"
        );
      };

      dataChannel.onmessage = async (event) => {
        try {
          const realtimeEvent =
            JSON.parse(event.data);

          await handleRealtimeEvent(
            realtimeEvent
          );
        } catch (error) {
          console.error(
            "Realtime message parse error:",
            error
          );
        }
      };

      dataChannel.onerror = (event) => {
        console.error(
          "Realtime channel error:",
          event
        );
      };

      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);

      if (!offer.sdp) {
        throw new Error(
          "Missing WebRTC offer"
        );
      }

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
        const errorText =
          await realtimeResponse.text();

        throw new Error(errorText);
      }

      const answerSdp =
        await realtimeResponse.text();

      await pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });

      setVoiceActive(true);
    } catch (error) {
      console.error(
        "Voice connection error:",
        error
      );

      stopVoice();

      alert("Voice couldn't connect.");
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

    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
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

  // -------------------------
  // SCREEN
  // -------------------------

  if (!historyLoaded) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/50">
          Loading Erika...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <header className="border-b border-white/10 px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            Erika
          </h1>

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
          onClick={
            voiceActive
              ? stopVoice
              : startVoice
          }
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
              <div
                key={index}
                className="flex justify-start"
              >
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
            onChange={(e) =>
              setInput(e.target.value)
            }
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
