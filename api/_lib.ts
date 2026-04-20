import { createHmac, timingSafeEqual } from "node:crypto";
import { PrismaClient } from "@prisma/client";

type SessionPayload = {
  userId: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  createdAt: string;
};

type TelegramUserPayload = {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
};

const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

export const ALLOWED_COUNTRY = "\u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d";
export const ALLOWED_CITY = "\u041a\u0443\u0448\u043c\u0443\u0440\u0443\u043d";
export const MAX_DAILY_JOBS = 3;
const SESSION_COOKIE_NAME = "mini_app_session";

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.TELEGRAM_BOT_TOKEN || "dev-secret";
}

export function json(response: any, statusCode: number, body: unknown, headers?: Record<string, string>) {
  response.status(statusCode).setHeader("content-type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(headers ?? {})) {
    response.setHeader(key, value);
  }
  response.send(JSON.stringify(body));
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((accumulator, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) {
      return accumulator;
    }
    accumulator[name] = decodeURIComponent(rest.join("="));
    return accumulator;
  }, {});
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("hex");
}

export function createSessionCookie(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(body);
  const token = `${body}.${signature}`;
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=604800`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0`;
}

export function readSessionFromRequest(request: any): SessionPayload | null {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expected = sign(body);
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

export async function readJsonBody<T>(request: any): Promise<T | null> {
  if (typeof request.body === "object" && request.body !== null) {
    return request.body as T;
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk: Buffer | string) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw) as T);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

export function normalizeTelegramUser(input: TelegramUserPayload | null | undefined): TelegramUserPayload | null {
  if (!input || input.id === undefined || input.id === null) {
    return null;
  }

  return {
    id: input.id,
    username: input.username,
    first_name: input.first_name,
    last_name: input.last_name,
    language_code: input.language_code
  };
}

export function extractUserFromInitData(initData: string, botToken: string | undefined): TelegramUserPayload | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const userRaw = params.get("user");

  if (!hash || !userRaw) {
    return null;
  }

  if (botToken) {
    const entries = Array.from(params.entries())
      .filter(([key]) => key !== "hash")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
    const generated = createHmac("sha256", secret).update(entries).digest("hex");
    const generatedBuffer = Buffer.from(generated, "hex");
    const receivedBuffer = Buffer.from(hash, "hex");

    if (generatedBuffer.length !== receivedBuffer.length || !timingSafeEqual(generatedBuffer, receivedBuffer)) {
      return null;
    }
  }

  try {
    return JSON.parse(userRaw) as TelegramUserPayload;
  } catch {
    return null;
  }
}

export function isValidPhone(phone: string): boolean {
  return /^\+?[0-9]{10,15}$/.test(phone);
}

export function parsePrice(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = Number(value.replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(normalized) ? normalized : null;
  }
  return null;
}

export function getDayRange(now: Date) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}

export async function notifyAdminAboutNewJob(job: { id: string; title: string; address: string; price: number; whenNeeded: string }) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (!botToken || !adminChatId) {
    return;
  }

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: adminChatId,
      text: [
        "\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430 \u043d\u0430 \u043c\u043e\u0434\u0435\u0440\u0430\u0446\u0438\u044e",
        "",
        `ID: ${job.id}`,
        `\u0427\u0442\u043e \u043d\u0443\u0436\u043d\u043e: ${job.title}`,
        `\u0410\u0434\u0440\u0435\u0441: ${job.address}`,
        `\u0426\u0435\u043d\u0430: ${job.price} KZT`,
        `\u041a\u043e\u0433\u0434\u0430 \u043d\u0443\u0436\u043d\u043e: ${job.whenNeeded}`
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: `approve:${job.id}` },
            { text: "Reject", callback_data: `reject:${job.id}` }
          ]
        ]
      }
    })
  });
}

export async function moderateJob(jobId: string, action: "approve" | "reject") {
  const approved = action === "approve";
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const nextJob = await tx.job.update({
      where: { id: jobId },
      data: {
        status: approved ? ("ACTIVE" as never) : "CANCELED",
        moderationStatus: approved ? "APPROVED" : "REJECTED"
      }
    });

    await tx.moderationQueue.updateMany({
      where: { entityType: "JOB", entityId: jobId },
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
