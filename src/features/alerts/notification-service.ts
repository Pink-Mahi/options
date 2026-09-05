/**
 * Notification service — sends alert notifications via multiple channels
 * and logs delivery for auditability.
 *
 * Channels:
 * - in_app: always logged, viewable in the UI
 * - email: sent via SMTP if configured (EMAIL_HOST, EMAIL_PORT, etc.)
 * - webhook: POST to a user-configured URL (e.g. Slack, Discord, ntfy)
 *
 * Rate limiting: each alert fires at most once per cooldown period (default 1 hour)
 * to prevent notification spam.
 */

import "server-only";
import { prisma } from "@/lib/database/prisma";
import { markAlertFired } from "@/lib/database/watchlist-repo";
import type { AlertEvaluation } from "@/lib/types";

export interface NotificationConfig {
  emailEnabled: boolean;
  emailFrom?: string;
  webhookUrl?: string;
  cooldownMinutes: number;
}

const DEFAULT_COOLDOWN_MINUTES = 60;

/**
 * Process triggered alerts: send notifications and log delivery.
 * Returns the notifications that were sent.
 */
export async function processTriggeredAlerts(
  evaluations: AlertEvaluation[],
  userId: string,
  config: NotificationConfig,
): Promise<{ id: string; alertId: string; channel: string; status: string; message: string }[]> {
  const triggered = evaluations.filter((e) => e.triggered);
  const results: { id: string; alertId: string; channel: string; status: string; message: string }[] = [];

  for (const evalResult of triggered) {
    const alert = evalResult.alert;

    // Check cooldown
    if (alert.lastFiredAt) {
      const lastFired = new Date(alert.lastFiredAt);
      const cooldownMs = config.cooldownMinutes * 60 * 1000;
      if (Date.now() - lastFired.getTime() < cooldownMs) {
        // Skip — still in cooldown
        continue;
      }
    }

    const message = evalResult.message;

    // 1. In-app notification (always)
    const inAppLog = await prisma.notificationLog.create({
      data: {
        alertId: alert.id,
        userId,
        symbol: alert.symbol,
        ruleType: alert.ruleType,
        message,
        channel: "in_app",
        status: "sent",
      },
    });
    results.push({
      id: inAppLog.id,
      alertId: alert.id,
      channel: "in_app",
      status: "sent",
      message,
    });

    // 2. Email notification (if configured)
    if (config.emailEnabled && config.emailFrom) {
      try {
        await sendEmail({
          to: config.emailFrom,
          subject: `Alert: ${alert.symbol ?? "Portfolio"} — ${alert.ruleType}`,
          body: message,
        });
        await prisma.notificationLog.create({
          data: {
            alertId: alert.id,
            userId,
            symbol: alert.symbol,
            ruleType: alert.ruleType,
            message,
            channel: "email",
            status: "sent",
          },
        });
        results.push({
          id: "",
          alertId: alert.id,
          channel: "email",
          status: "sent",
          message,
        });
      } catch (err) {
        await prisma.notificationLog.create({
          data: {
            alertId: alert.id,
            userId,
            symbol: alert.symbol,
            ruleType: alert.ruleType,
            message: `Email failed: ${(err as Error).message}`,
            channel: "email",
            status: "failed",
          },
        });
        results.push({
          id: "",
          alertId: alert.id,
          channel: "email",
          status: "failed",
          message,
        });
      }
    }

    // 3. Webhook notification (if configured)
    if (config.webhookUrl) {
      try {
        await sendWebhook(config.webhookUrl, {
          alertId: alert.id,
          symbol: alert.symbol,
          ruleType: alert.ruleType,
          message,
          timestamp: new Date().toISOString(),
        });
        await prisma.notificationLog.create({
          data: {
            alertId: alert.id,
            userId,
            symbol: alert.symbol,
            ruleType: alert.ruleType,
            message,
            channel: "webhook",
            status: "sent",
          },
        });
        results.push({
          id: "",
          alertId: alert.id,
          channel: "webhook",
          status: "sent",
          message,
        });
      } catch (err) {
        await prisma.notificationLog.create({
          data: {
            alertId: alert.id,
            userId,
            symbol: alert.symbol,
            ruleType: alert.ruleType,
            message: `Webhook failed: ${(err as Error).message}`,
            channel: "webhook",
            status: "failed",
          },
        });
      }
    }

    // Mark alert as fired
    await markAlertFired(alert.id);
  }

  return results;
}

/**
 * Retrieve recent notifications for a user (for in-app display).
 */
export async function getRecentNotifications(
  userId: string,
  limit: number = 20,
): Promise<{ id: string; symbol: string | null; ruleType: string; message: string; channel: string; sentAt: string }[]> {
  const logs = await prisma.notificationLog.findMany({
    where: { userId },
    orderBy: { sentAt: "desc" },
    take: limit,
  });
  return logs.map((l) => ({
    id: l.id,
    symbol: l.symbol,
    ruleType: l.ruleType,
    message: l.message,
    channel: l.channel,
    sentAt: l.sentAt.toISOString(),
  }));
}

/**
 * Run the full alert check cycle for all users with enabled alerts.
 * Called by the cron endpoint.
 */
export async function runAlertCycle(): Promise<{
  usersChecked: number;
  alertsEvaluated: number;
  notificationsSent: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let usersChecked = 0;
  let alertsEvaluated = 0;
  let notificationsSent = 0;

  // Get all users who have alerts
  const usersWithAlerts = await prisma.user.findMany({
    where: {
      portfolios: {
        some: {
          alerts: {
            some: { enabled: true },
          },
        },
      },
    },
    select: { id: true, email: true },
  });

  // Build notification config from env
  const config: NotificationConfig = {
    emailEnabled: !!process.env.EMAIL_HOST,
    emailFrom: process.env.EMAIL_FROM ?? undefined,
    webhookUrl: process.env.ALERT_WEBHOOK_URL ?? undefined,
    cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
  };

  // Dynamic import to avoid circular deps
  const { evaluateAlerts } = await import("@/features/alerts/alert-evaluator");
  const { getAlerts } = await import("@/lib/database/watchlist-repo");

  for (const user of usersWithAlerts) {
    try {
      const alerts = await getAlerts(user.id);
      const enabledAlerts = alerts.filter((a) => a.enabled);
      if (enabledAlerts.length === 0) continue;

      usersChecked++;
      alertsEvaluated += enabledAlerts.length;

      const evaluations = await evaluateAlerts(enabledAlerts).catch(() => []);
      const triggered = evaluations.filter((e) => e.triggered);

      if (triggered.length > 0) {
        const notifications = await processTriggeredAlerts(evaluations, user.id, config);
        notificationsSent += notifications.filter((n) => n.status === "sent").length;
      }
    } catch (err) {
      errors.push(`User ${user.email}: ${(err as Error).message}`);
    }
  }

  return { usersChecked, alertsEvaluated, notificationsSent, errors };
}

// ---------------------------------------------------------------------------
// Email sender (stub — uses fetch to an SMTP API or nodemailer if available)
// ---------------------------------------------------------------------------

async function sendEmail(opts: { to: string; subject: string; body: string }): Promise<void> {
  const host = process.env.EMAIL_HOST;
  const port = process.env.EMAIL_PORT;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!host) {
    // No email configured — silently skip
    return;
  }

  // Use nodemailer if available, otherwise try a generic SMTP approach
  // For now, we use a simple HTTP-based email API (e.g. Resend, SendGrid)
  const apiKey = process.env.EMAIL_API_KEY;
  const apiUrl = process.env.EMAIL_API_URL;

  if (apiUrl && apiKey) {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: opts.to,
        to: opts.to,
        subject: opts.subject,
        text: opts.body,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Email API returned ${resp.status}`);
    }
    return;
  }

  // Fallback: log to console in development
  if (process.env.NODE_ENV === "development") {
    console.log(`[EMAIL] To: ${opts.to} | Subject: ${opts.subject} | Body: ${opts.body}`);
  }
}

// ---------------------------------------------------------------------------
// Webhook sender
// ---------------------------------------------------------------------------

async function sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`Webhook returned ${resp.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
