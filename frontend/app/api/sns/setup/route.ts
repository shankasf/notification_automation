import { NextRequest, NextResponse } from "next/server";
import { ensureTopic, subscribeAdminEmail } from "@/lib/sns";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = body.email;

    // Create topic (idempotent)
    const topicArn = await ensureTopic();

    // Subscribe admin email
    const subscription = await subscribeAdminEmail(email);

    return NextResponse.json({
      success: true,
      topicArn,
      subscription: {
        arn: subscription.subscriptionArn,
        alreadySubscribed: subscription.alreadySubscribed,
        message: subscription.alreadySubscribed
          ? "Email is already subscribed"
          : "Confirmation email sent — check inbox to confirm subscription",
      },
    });
  } catch (error) {
    console.error("Error setting up SNS:", error);
    return NextResponse.json(
      { error: "Failed to set up SNS topic", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const topicArn = await ensureTopic();
    return NextResponse.json({ topicArn, status: "active" });
  } catch (error) {
    return NextResponse.json(
      { error: "SNS not configured", details: String(error) },
      { status: 500 }
    );
  }
}
