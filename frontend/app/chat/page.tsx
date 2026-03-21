/**
 * AI Chat page — conversational interface for querying hiring request data
 * using natural language. Messages are sent to the backend AI service
 * (via /api/ai/chat) which has access to the full database context.
 *
 * Features:
 *  - Suggestion chips for common queries (e.g., "How many open hiring requests?")
 *  - Chat history persisted in sessionStorage (keyed by managerId)
 *  - "New Chat" button to clear history and start fresh
 *  - Auto-scroll to latest message
 *  - Typing indicator while waiting for AI response
 *  - Graceful fallback when the AI service is unavailable
 */
"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Send, Bot, User, Sparkles, MessageSquarePlus } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const suggestions = [
  "How many open hiring requests do I have?",
  "What percentage of my budget is used?",
  "Show unfilled positions",
  "What changed this week?",
  "Which staffing vendors have the highest rates?",
  "Show critical priority requests",
];

/** Chat interface with sessionStorage-backed message history. */
function ChatContent() {
  const searchParams = useSearchParams();
  const managerId = searchParams.get("manager");

  // Separate chat histories for each manager context (or "admin" for aggregate view)
  const storageKey = `chat_messages_${managerId || "admin"}`;

  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((m: Message & { timestamp: string }) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
      }
    } catch {}
    return [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Persist messages to sessionStorage on every change
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {}
  }, [messages, storageKey]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          managerId,
        }),
      });

      const data = await res.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          data.response ||
          data.reply ||
          data.message ||
          data.error ||
          "I received your message but could not generate a response.",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content:
            "Sorry, I could not connect to the AI service. Please make sure the backend service is running.",
          timestamp: new Date(),
        },
      ]);
    }

    setLoading(false);
    inputRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const startNewChat = () => {
    setMessages([]);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Assistant</h1>
          <p className="text-sm text-gray-500 mt-1">
            Ask questions about your hiring requests, budgets, and workforce data
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="outline"
            onClick={startNewChat}
            className="flex items-center gap-2 rounded-xl"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New Chat
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin rounded-xl border border-gray-200 bg-white p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="h-16 w-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-primary-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              How can I help you?
            </h3>
            <p className="text-sm text-gray-500 mb-6 max-w-md">
              Ask me anything about your hiring requests, budgets, staffing levels, or
              recent changes. I can analyze your data and provide insights.
            </p>

            {/* Suggestion chips */}
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => sendMessage(suggestion)}
                  className="px-3 py-1.5 rounded-full border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <Bot className="h-4 w-4 text-primary-600" />
                  </div>
                )}
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-primary-500 text-white"
                      : "bg-gray-100 text-gray-900"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  <p
                    className={`text-xs mt-1 ${
                      msg.role === "user"
                        ? "text-primary-200"
                        : "text-gray-400"
                    }`}
                  >
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {msg.role === "user" && (
                  <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-gray-600" />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-primary-600" />
                </div>
                <div className="bg-gray-100 rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                    <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                    <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your hiring requests, budgets, or workforce data..."
          className="flex-1 h-12 rounded-xl border border-gray-300 bg-white px-4 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          disabled={loading}
        />
        <Button
          type="submit"
          size="lg"
          disabled={!input.trim() || loading}
          className="h-12 px-6 rounded-xl"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-[calc(100vh-8rem)]">
          <div className="h-10 w-48 bg-gray-200 animate-pulse rounded mb-4" />
          <div className="flex-1 rounded-xl border bg-white animate-pulse" />
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}
