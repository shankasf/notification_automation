"""Email notification sender using AWS SES SMTP.

Sends styled HTML emails to sourcing managers for change summaries, anomaly
alerts, budget warnings, and milestones. Emails include both a plain-text
fallback and an HTML body with a branded template pointing to the dashboard.

SMTP credentials are read from environment variables. If not configured, email
sends are silently skipped (logged as a warning) so the rest of the system
continues to function in development environments.
"""

import html
import os
import smtplib
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone

from logging_config import get_logger

logger = get_logger("email")

SMTP_HOST = os.environ.get("SMTP_HOST", "email-smtp.us-east-1.amazonaws.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "")


def _mask_email(email: str) -> str:
    """Mask an email address for safe logging. e.g. 'sarah@gmail.com' -> 's***@gmail.com'."""
    if not email or "@" not in email:
        return "***"
    local, domain = email.rsplit("@", 1)
    if len(local) <= 1:
        masked_local = "*"
    else:
        masked_local = local[0] + "***"
    return f"{masked_local}@{domain}"


def send_notification_email(to_email: str, manager_name: str, subject: str, body_text: str, notif_type: str = "CHANGE_SUMMARY"):
    """Send an email notification to a sourcing manager."""
    masked = _mask_email(to_email)

    if not SMTP_USER or not SMTP_PASS or not SMTP_FROM:
        logger.warning(
            "smtp_not_configured",
            extra={"extra_data": {"to_email": masked, "subject": subject}},
        )
        return False

    logger.info(
        "sending_email",
        extra={
            "extra_data": {
                "to_email": masked,
                "subject": subject,
                "notif_type": notif_type,
            }
        },
    )
    start = time.time()

    # Color-code the notification badge by type for visual distinction
    type_colors = {
        "CHANGE_SUMMARY": "#3B82F6",   # blue
        "ANOMALY_ALERT": "#EF4444",    # red
        "BUDGET_WARNING": "#F59E0B",   # amber
        "MILESTONE": "#10B981",        # green
    }
    color = type_colors.get(notif_type, "#6B7280")
    type_label = notif_type.replace("_", " ").title()

    # HTML-escape all user-supplied content to prevent XSS in email clients
    safe_name = html.escape(manager_name)
    safe_subject = html.escape(subject)
    safe_body = html.escape(body_text)

    html_content = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #1e40af 0%, #4338ca 100%); padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 20px;">MetaSource</h1>
            <p style="color: rgba(255,255,255,0.7); margin: 4px 0 0; font-size: 13px;">Sourcing Manager Notification</p>
        </div>
        <div style="background: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="color: #374151; margin: 0 0 8px;">Hi {safe_name},</p>
            <div style="display: inline-block; background: {color}15; color: {color}; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 16px;">
                {type_label}
            </div>
            <h2 style="color: #111827; margin: 0 0 12px; font-size: 18px;">{safe_subject}</h2>
            <div style="background: #f9fafb; border-radius: 8px; padding: 16px; border-left: 4px solid {color}; margin-bottom: 24px;">
                <p style="color: #4b5563; margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">{safe_body}</p>
            </div>
            <a href="https://meta.callsphere.tech/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">
                Open Dashboard
            </a>
        </div>
        <div style="padding: 16px 32px; text-align: center;">
            <p style="color: #9ca3af; font-size: 11px; margin: 0;">
                {datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")} &middot; MetaSource Automated Notification
            </p>
        </div>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["From"] = f"MetaSource <{SMTP_FROM}>"
    msg["To"] = to_email
    msg["Subject"] = f"[MetaSource] {subject}"
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(html_content, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        duration_ms = round((time.time() - start) * 1000, 2)
        logger.info(
            "email_sent",
            extra={
                "extra_data": {
                    "to_email": masked,
                    "subject": subject,
                    "duration_ms": duration_ms,
                }
            },
        )
        return True
    except Exception as e:
        logger.error(
            "email_send_failed",
            extra={
                "extra_data": {
                    "to_email": masked,
                    "subject": subject,
                    "error": str(e),
                }
            },
            exc_info=True,
        )
        return False


def send_manager_notification(manager_id: str, subject: str, body: str, notif_type: str = "CHANGE_SUMMARY"):
    """Look up the manager's name and email from the SourcingManager table,
    then delegate to send_notification_email. Returns True on success."""
    logger.info(
        "send_manager_notification",
        extra={
            "extra_data": {
                "manager_id": manager_id,
                "subject": subject,
                "notif_type": notif_type,
            }
        },
    )
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        cur.execute('SELECT name, email FROM "SourcingManager" WHERE id = %s', (manager_id,))
        row = cur.fetchone()
        if row:
            logger.info(
                "manager_found",
                extra={
                    "extra_data": {
                        "manager_id": manager_id,
                        "manager_name": row[0],
                    }
                },
            )
            return send_notification_email(row[1], row[0], subject, body, notif_type)
        else:
            logger.warning(
                "manager_not_found",
                extra={"extra_data": {"manager_id": manager_id}},
            )
        return False
    finally:
        conn.close()
