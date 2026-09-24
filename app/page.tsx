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

type Activity = "idle" | "typing" | "photo";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [input, setInput] = useState("");
  const [activity, setActivity] = useState<Activity>("idle");

  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  const savedVoiceItemsRef = useRef<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // --------------------------------------------------
  // AUTO SCROLL
  // --------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, activity]);

  // --------------------------------------------------
  // LOAD SAVED HISTORY
  // --------------------------------------------------

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

  // --------------------------------------------------
  // SAVE MESSAGE
  // --------------------------------------------------

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

  // --------------------------------------------------
  // TEXT CHAT
  // --------------------------------------------------

  async function sendMessage() {
    const cleaned = input.trim();

    if (!cleaned || activity !== "idle") return;

    const userMessage: Message = {
      role: "user",
      type: "text",
      text: cleaned,
      source: "text",
    };

    const newMessages = [...messages, userMessage];

    setMessages(newMessages);
    setInput("");
    setActivity("typing");

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

      // -------------------------
      // NORMAL TEXT
      // -------------------------

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

      // -------------------------
      // PHOTO
      // -------------------------

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

        setActivity("photo");

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
      setActivity("idle");
    }
  }

  // --------------------------------------------------
  // REALTIME VOICE EVENTS
  // --------------------------------------------------

  async function handleRealtimeEvent(event: any) {
    try {
      // -------------------------
      // YOUR VOICE
      // -------------------------

      if (
        event.type ===
          "conversation.item.input_audio_transcription.completed" &&
        event.transcript
      ) {
        const transcript = event.transcript.trim();

        if (!transcript) return;

        const key =
          event.item_id ||
          `user-${transcript}`;

        if (savedVoiceItemsRef.current.has(key)) {
          return;
        }

        savedVoiceItemsRef.current.add(key);

        const message: Message = {
          role: "user",
          type: "text",
          text: transcript,
          source: "voice",
        };

        setMessages((current) => [
          ...current,
          message,
        ]);

        await saveMessage(message, {
          realtime_item_id:
            event.item_id || null,
        });

        return;
      }

      // -------------------------
      // ERIKA'S VOICE
      // -------------------------

      if (
        (
          event.type ===
            "response.output_audio_transcript.done" ||
          event.type ===
            "response.audio_transcript.done"
        ) &&
        event.transcript
      ) {
        const transcript = event.transcript.trim();

        if (!transcript) return;

        const key =
          event.item_id ||
          event.response_id ||
          `assistant-${transcript}`;

        if (savedVoiceItemsRef.current.has(key)) {
          return;
        }

        savedVoiceItemsRef.current.add(key);

        const message: Message = {
          role: "assistant",
          type: "text",
          text: transcript,
          source: "voice",
        };

        setMessages((current) => [
          ...current,
          message,
        ]);

        await saveMessage(message, {
          realtime_item_id:
            event.item_id || null,

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

  // --------------------------------------------------
  // START VOICE
  // --------------------------------------------------

  async function startVoice() {
    if (voiceActive || voiceConnecting) return;

    setVoiceConnecting(true);

    savedVoiceItemsRef.current.clear();

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

      // -------------------------
      // ERIKA AUDIO OUTPUT
      // -------------------------

      const audio =
        document.createElement("audio");

      audio.autoplay = true;

      audio.setAttribute(
        "playsinline",
        "true"
      );

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

      // -------------------------
      // IPHONE MICROPHONE
      //
      // These settings reduce Erika hearing
      // herself through the speaker.
      // -------------------------

      const micStream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

      micStreamRef.current = micStream;

      for (const track of micStream.getTracks()) {
        pc.addTrack(track, micStream);
      }

      // -------------------------
      // REALTIME DATA CHANNEL
      // -------------------------

      const dataChannel =
        pc.createDataChannel("oai-events");

      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => {
        console.log(
          "Realtime voice connected"
        );
      };

      dataChannel.onmessage = async (
        messageEvent
      ) => {
        try {
          const realtimeEvent =
            JSON.parse(messageEvent.data);

          await handleRealtimeEvent(
            realtimeEvent
          );
        } catch (error) {
          console.error(
            "Realtime event parse error:",
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

      // -------------------------
      // WEBRTC CONNECTION
      // -------------------------

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
            Authorization:
              `Bearer ${ephemeralKey}`,

            "Content-Type":
              "application/sdp",
          },
        }
      );

      if (!realtimeResponse.ok) {
        throw new Error(
          await realtimeResponse.text()
        );
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

      alert(
        "Voice couldn't connect. Try again."
      );
    } finally {
      setVoiceConnecting(false);
    }
  }

  // --------------------------------------------------
  // STOP VOICE
  // --------------------------------------------------

  function stopVoice() {
    if (micStreamRef.current) {
      for (
        const track of
        micStreamRef.current.getTracks()
      ) {
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

  // --------------------------------------------------
  // LOADING SCREEN
  // --------------------------------------------------

  if (!historyLoaded) {
    return (
      <main className="min-h-[100dvh] bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-white/10 flex items-center justify-center text-2xl font-semibold">
            E
          </div>

          <p className="text-white/50">
            Loading Erika...
          </p>
        </div>
      </main>
    );
  }

  // --------------------------------------------------
  // CALL SCREEN
  // --------------------------------------------------

  if (voiceActive || voiceConnecting) {
    return (
      <main className="min-h-[100dvh] bg-black text-white flex flex-col items-center justify-between px-6 py-14">

        <div className="text-center">
          <p className="text-sm text-white/50">
            Erika
          </p>

          <p className="mt-1 text-lg">
            {voiceConnecting
              ? "Connecting..."
              : "Voice connected"}
          </p>
        </div>

        <div className="flex flex-col items-center">
          <div
            className={
              voiceActive
                ? "h-40 w-40 rounded-full bg-white/10 flex items-center justify-center animate-pulse"
                : "h-40 w-40 rounded-full bg-white/10 flex items-center justify-center"
            }
          >
            <div className="h-32 w-32 rounded-full bg-white/10 flex items-center justify-center text-5xl font-semibold">
              E
            </div>
          </div>

          <p className="mt-8 text-white/50">
            {voiceConnecting
              ? "Starting call..."
              : "Talk naturally"}
          </p>
        </div>

        <button
          onClick={stopVoice}
          className="rounded-full bg-red-600 px-8 py-4 text-lg font-semibold"
        >
          End call
        </button>
      </main>
    );
  }

  // --------------------------------------------------
  // NORMAL CHAT SCREEN
  // --------------------------------------------------

  return (
    <main className="min-h-[100dvh] bg-black text-white flex flex-col">

      {/* HEADER */}

      <header className="sticky top-0 z-10 bg-black/90 backdrop-blur-xl border-b border-white/10 px-4 py-3">

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-3">

            <div className="h-11 w-11 rounded-full bg-white/10 flex items-center justify-center font-semibold">
              E
            </div>

            <div>
              <h1 className="font-semibold">
                Erika
              </h1>

              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />

                <p className="text-xs text-white/50">
                  {activity === "typing"
                    ? "typing..."
                    : activity === "photo"
                    ? "taking a photo..."
                    : "online"}
                </p>
              </div>
            </div>

          </div>

          <button
            onClick={startVoice}
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium"
          >
            Call
          </button>

        </div>

      </header>

      {/* MESSAGES */}

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
                  className="max-w-[88%] rounded-3xl object-cover"
                />
              </div>
            );
          }

          const voiceMessage =
            message.source === "voice";

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
                    ? "max-w-[82%] rounded-3xl rounded-br-lg bg-blue-600 px-4 py-3"
                    : "max-w-[82%] rounded-3xl rounded-bl-lg bg-white/10 px-4 py-3"
                }
              >
                <p>{message.text}</p>

                {voiceMessage && (
                  <p className="mt-1 text-[10px] text-white/35">
                    voice
                  </p>
                )}
              </div>

            </div>
          );
        })}

        {activity !== "idle" && (
          <div className="flex justify-start">
            <div className="rounded-3xl rounded-bl-lg bg-white/10 px-4 py-3 text-white/50">
              {activity === "photo"
                ? "Taking a photo..."
                : "•••"}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />

      </section>

      {/* MESSAGE BOX */}

      <footer
        className="sticky bottom-0 bg-black/90 backdrop-blur-xl border-t border-white/10 px-3 pt-3"
        style={{
          paddingBottom:
            "max(12px, env(safe-area-inset-bottom))",
        }}
      >

        <div className="flex items-end gap-2">

          <textarea
            value={input}
            onChange={(e) =>
              setInput(e.target.value)
            }
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey
              ) {
                e.preventDefault();
                sendMessage();
              }
            }}
            rows={1}
            placeholder="Message Erika..."
            className="max-h-32 min-h-[46px] flex-1 resize-none rounded-3xl bg-white/10 px-4 py-3 outline-none"
          />

          <button
            onClick={sendMessage}
            disabled={
              activity !== "idle" ||
              !input.trim()
            }
            className="h-12 rounded-full bg-white px-5 font-semibold text-black disabled:opacity-30"
          >
            Send
          </button>

        </div>

      </footer>

    </main>
  );
}
