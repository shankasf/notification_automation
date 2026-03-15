import { NextRequest, NextResponse } from "next/server";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, managerId, sessionId } = body;

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const response = await fetch(`${AI_SERVICE_URL}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        managerId,
        sessionId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI service error:", errorText);
      return NextResponse.json(
        { error: "AI service unavailable", details: errorText },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error calling AI service:", error);
    return NextResponse.json(
      {
        error: "AI service unavailable",
        reply: "I'm sorry, the AI service is currently unavailable. Please try again later.",
      },
      { status: 502 }
    );
  }
}
