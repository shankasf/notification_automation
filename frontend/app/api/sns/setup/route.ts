/**
 * SNS Setup API route — manages AWS SNS topic and email subscriptions.
 *
 * POST /api/sns/setup — creates the SNS topic (idempotent) and subscribes an
 *   email address. If the email is already subscribed, returns that info.
 *   Otherwise, AWS sends a confirmation email the user must click.
 *
 * GET /api/sns/setup — health check that verifies the SNS topic exists and
 *   returns its ARN.
 *
 * Used to set up email notifications for requisition change alerts.
 */
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
