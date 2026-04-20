import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type TelegramUpdate = {
  update_id: number;
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat: {
        id: number;
      };
      message_id: number;
      text?: string;
    };
  };
};

type ModerationResult = {
  id: string;
  status: string;
  moderationStatus: string;
  moderationQueueStatus: string;
};

type ModerationRepository = {
  moderateJob(jobId: string, action: "approve" | "reject"): Promise<ModerationResult | null>;
};

function loadEnvFile() {
  const envCandidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", "..", ".env")
  ];

  for (const envPath of envCandidates) {
    if (!existsSync(envPath)) {
      continue;
    }

    const content = readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^"(.*)"$/, "$1");

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }

    return;
  }
}

loadEnvFile();

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
const adminChatId = process.env.ADMIN_CHAT_ID ?? "";
const apiBase = `https://api.telegram.org/bot${telegramBotToken}`;

function createMemoryRepository(): ModerationRepository {
  const jobs = new Map<string, ModerationResult>();

  return {
    async moderateJob(jobId, action) {
      const current = jobs.get(jobId) ?? {
        id: jobId,
        status: "draft",
        moderationStatus: "pending",
        moderationQueueStatus: "pending_moderation"
      };

      const next: ModerationResult =
        action === "approve"
          ? {
              ...current,
              status: "active",
              moderationStatus: "approved",
              moderationQueueStatus: "approved"
            }
          : {
              ...current,
              status: "canceled",
              moderationStatus: "rejected",
              moderationQueueStatus: "rejected"
            };

      jobs.set(jobId, next);
      return next;
    }
  };
}

async function createRepository(): Promise<ModerationRepository> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    return {
      async moderateJob(jobId, action) {
        const job = await prisma.job.findUnique({ where: { id: jobId } });
        if (!job) {
          return null;
        }

        const approved = action === "approve";

        const updated = await prisma.$transaction(async (tx) => {
          const nextJob = await tx.job.update({
            where: { id: jobId },
            data: {
              status: approved ? ("ACTIVE" as never) : "CANCELED",
              moderationStatus: approved ? "APPROVED" : "REJECTED"
            }
          });

          await tx.moderationQueue.updateMany({
            where: {
              entityType: "JOB",
              entityId: jobId
            },
            data: {
              status: approved ? "APPROVED" : "REJECTED",
              reviewedAt: new Date()
            }
          });

          return nextJob;
        });

        return {
          id: updated.id,
          status: updated.status.toLowerCase(),
          moderationStatus: updated.moderationStatus.toLowerCase(),
          moderationQueueStatus: approved ? "approved" : "rejected"
        };
      }
    };
  } catch (error) {
    console.warn("[bot] Prisma unavailable, using in-memory moderation.", error);
    return createMemoryRepository();
  }
}

async function telegramRequest(method: string, body: unknown) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Telegram API request failed for ${method}`);
  }

  return response.json();
}

async function answerCallbackQuery(callbackQueryId: string, text: string) {
  await telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text
  });
}

async function editModerationMessage(chatId: number, messageId: number, text: string) {
  await telegramRequest("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text
  });
}

function buildDecisionText(action: "approve" | "reject", result: ModerationResult) {
  const title = action === "approve" ? "\u0417\u0430\u044f\u0432\u043a\u0430 approved" : "\u0417\u0430\u044f\u0432\u043a\u0430 rejected";

  return [
    title,
    "",
    `ID: ${result.id}`,
    `Job status: ${result.status}`,
    `Moderation: ${result.moderationStatus}`,
    `Queue: ${result.moderationQueueStatus}`
  ].join("\n");
}

async function processUpdate(repository: ModerationRepository, update: TelegramUpdate) {
  const callback = update.callback_query;
  if (!callback?.data || !callback.message) {
    return;
  }

  const [actionRaw, jobId] = callback.data.split(":");
  const action = actionRaw === "approve" || actionRaw === "reject" ? actionRaw : null;
  if (!action || !jobId) {
    await answerCallbackQuery(callback.id, "Unknown moderation action.");
    return;
  }

  if (adminChatId && String(callback.message.chat.id) !== String(adminChatId)) {
    await answerCallbackQuery(callback.id, "This action is only available for the configured admin.");
    return;
  }

  const result = await repository.moderateJob(jobId, action);
  if (!result) {
    await answerCallbackQuery(callback.id, "Job not found.");
    return;
  }

  await answerCallbackQuery(callback.id, action === "approve" ? "Job approved." : "Job rejected.");
  await editModerationMessage(callback.message.chat.id, callback.message.message_id, buildDecisionText(action, result));
}

async function runBot() {
  if (!telegramBotToken) {
    console.log("[bot] TELEGRAM_BOT_TOKEN is not set. Bot is idle.");
    return;
  }

  const repository = await createRepository();
  let offset = 0;

  console.log("[bot] moderation bot is running.");

  while (true) {
    try {
      const response = await telegramRequest("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["callback_query"]
      });

      const updates = Array.isArray(response.result) ? (response.result as TelegramUpdate[]) : [];

      for (const update of updates) {
        offset = update.update_id + 1;
        await processUpdate(repository, update);
      }
    } catch (error) {
      console.error("[bot] polling error", error);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

void runBot();
