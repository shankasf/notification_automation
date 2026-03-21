/**
 * AWS SNS integration for email notifications about requisition changes.
 *
 * Manages an SNS topic ("metasource-requisition-changes") and provides:
 *  - ensureTopic(): creates the topic (idempotent) and caches its ARN
 *  - subscribeAdminEmail(): subscribes an email (checks for duplicates first)
 *  - publishChangeNotification(): sends a formatted change email to all subscribers
 *
 * SNS failures are logged but never thrown, so they don't block the main operation.
 * Requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION env vars.
 */
import {
  SNSClient,
  PublishCommand,
  CreateTopicCommand,
  SubscribeCommand,
  ListSubscriptionsByTopicCommand,
} from "@aws-sdk/client-sns";

const TOPIC_NAME = "metasource-requisition-changes";
const ADMIN_EMAIL = process.env.SNS_ADMIN_EMAIL || "";

// Cache the topic ARN across requests to avoid repeated CreateTopic calls
let cachedTopicArn: string | null = null;

function getSNSClient() {
  return new SNSClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export async function ensureTopic(): Promise<string> {
  if (cachedTopicArn) return cachedTopicArn;

  const client = getSNSClient();
  // CreateTopic is idempotent — returns existing ARN if topic already exists
  const result = await client.send(
    new CreateTopicCommand({ Name: TOPIC_NAME })
  );
  cachedTopicArn = result.TopicArn!;
  return cachedTopicArn;
}

export async function subscribeAdminEmail(
  email?: string
): Promise<{ subscriptionArn: string; alreadySubscribed: boolean }> {
  const client = getSNSClient();
  const topicArn = await ensureTopic();
  const targetEmail = email || ADMIN_EMAIL;

  if (!targetEmail) {
    return { subscriptionArn: "NoEmailConfigured", alreadySubscribed: false };
  }

  // Check if already subscribed
  const existing = await client.send(
    new ListSubscriptionsByTopicCommand({ TopicArn: topicArn })
  );

  const alreadySubscribed = existing.Subscriptions?.some(
    (sub) => sub.Protocol === "email" && sub.Endpoint === targetEmail
  );

  if (alreadySubscribed) {
    const sub = existing.Subscriptions!.find(
      (s) => s.Protocol === "email" && s.Endpoint === targetEmail
    );
    return {
      subscriptionArn: sub?.SubscriptionArn || "PendingConfirmation",
      alreadySubscribed: true,
    };
  }

  const result = await client.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "email",
      Endpoint: targetEmail,
    })
  );

  return {
    subscriptionArn: result.SubscriptionArn || "PendingConfirmation",
    alreadySubscribed: false,
  };
}

export type ChangeEvent = {
  type: "CREATED" | "UPDATED" | "DELETED" | "BULK_IMPORT";
  requisitionId: string;
  roleTitle: string;
  category: string;
  changes?: { field: string; oldValue: string; newValue: string }[];
  summary: string;
  changedBy: string;
  timestamp: string;
};

export async function publishChangeNotification(
  event: ChangeEvent
): Promise<void> {
  try {
    const client = getSNSClient();
    const topicArn = await ensureTopic();

    const subject = `[MetaSource] ${event.type}: ${event.requisitionId} — ${event.roleTitle}`;

    let body = `MetaSource Hiring Request Change Notification\n`;
    body += `${"=".repeat(50)}\n\n`;
    body += `Type: ${event.type}\n`;
    body += `Request ID: ${event.requisitionId}\n`;
    body += `Role: ${event.roleTitle}\n`;
    body += `Category: ${event.category}\n`;
    body += `Changed By: ${event.changedBy}\n`;
    body += `Time: ${event.timestamp}\n\n`;

    if (event.changes && event.changes.length > 0) {
      body += `Changes:\n`;
      body += `${"-".repeat(30)}\n`;
      for (const c of event.changes) {
        body += `  ${c.field}: ${c.oldValue} → ${c.newValue}\n`;
      }
      body += `\n`;
    }

    body += `Summary: ${event.summary}\n\n`;
    body += `---\nView details: https://meta.callsphere.tech/requisitions\n`;

    await client.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: subject.substring(0, 100), // SNS subject max 100 chars
        Message: body,
        MessageAttributes: {
          changeType: { DataType: "String", StringValue: event.type },
          category: { DataType: "String", StringValue: event.category },
          requisitionId: {
            DataType: "String",
            StringValue: event.requisitionId,
          },
        },
      })
    );

    console.log(
      `[SNS] Published: ${event.type} for ${event.requisitionId}`
    );
  } catch (error) {
    // Log but don't throw — SNS failure shouldn't block the main operation
    console.error("[SNS] Failed to publish notification:", error);
  }
}
