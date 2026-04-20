import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";

type TelegramUserPayload = {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
};

type AuthRequestBody = {
  initData?: string;
  telegramUser?: TelegramUserPayload;
  profile?: {
    country?: string;
    city?: string;
  };
};

type ProfileUpdateBody = {
  firstName?: string;
  phone?: string;
  country?: string;
  city?: string;
};

type CreateJobBody = {
  title?: string;
  address?: string;
  price?: number | string;
  whenNeeded?: string;
};

type SessionRecord = {
  sessionId: string;
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

type PersistedUser = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
};

type CreatedJob = {
  id: string;
  title: string;
  address: string;
  price: number;
  whenNeeded: string;
  moderationQueueStatus: string;
};

type ModeratedJob = {
  id: string;
  status: string;
  moderationStatus: string;
  moderationQueueStatus: string;
};

type AppRepository = {
  upsertTelegramUser(input: {
    telegramId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    country?: string;
    city?: string;
  }): Promise<PersistedUser>;
  updateProfile(userId: string, input: { firstName: string; phone: string; country: string; city: string }): Promise<PersistedUser | null>;
  createJob(input: {
    customerId: string;
    title: string;
    address: string;
    price: number;
    whenNeeded: string;
    country?: string | null;
    city?: string | null;
  }): Promise<CreatedJob>;
  countJobsCreatedToday(customerId: string, dayStart: Date, dayEnd: Date): Promise<number>;
  moderateJob(jobId: string, action: "approve" | "reject"): Promise<ModeratedJob | null>;
};

type MemoryJobRecord = {
  id: string;
  customerId: string;
  title: string;
  address: string;
  price: number;
  whenNeeded: string;
  createdAt: Date;
  status: string;
  moderationStatus: string;
  moderationQueueStatus: string;
};

const port = Number(process.env.PORT ?? 3001);
const sessionCookieName = "mini_app_session";
const sessionStore = new Map<string, SessionRecord>();
const ALLOWED_COUNTRY = "\u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d";
const ALLOWED_CITY = "\u041a\u0443\u0448\u043c\u0443\u0440\u0443\u043d";
const MAX_DAILY_JOBS = 3;

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
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
}

loadEnvFile();

const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
const adminChatId = process.env.ADMIN_CHAT_ID ?? "";

function createMemoryRepository(): AppRepository {
  const users = new Map<string, PersistedUser>();
  const jobs: MemoryJobRecord[] = [];

  return {
    async upsertTelegramUser(input) {
      const existing = users.get(input.telegramId);
      const nextUser: PersistedUser = {
        id: existing?.id ?? `memory_${input.telegramId}`,
        telegramId: input.telegramId,
        username: input.username ?? existing?.username ?? null,
        firstName: input.firstName ?? existing?.firstName ?? null,
        lastName: input.lastName ?? existing?.lastName ?? null,
        phone: input.phone ?? existing?.phone ?? null,
        country: input.country ?? existing?.country ?? null,
        city: input.city ?? existing?.city ?? null
      };

      users.set(input.telegramId, nextUser);
      return nextUser;
    },
    async updateProfile(userId, input) {
      const existing = Array.from(users.values()).find((user) => user.id === userId);
      if (!existing) {
        return null;
      }

      const nextUser: PersistedUser = {
        ...existing,
        firstName: input.firstName,
        phone: input.phone,
        country: input.country,
        city: input.city
      };

      users.set(existing.telegramId, nextUser);
      return nextUser;
    },
    async createJob(input) {
      const job: MemoryJobRecord = {
        id: `job_${jobs.length + 1}`,
        customerId: input.customerId,
        title: input.title,
        address: input.address,
        price: input.price,
        whenNeeded: input.whenNeeded,
        createdAt: new Date(),
        status: "DRAFT",
        moderationStatus: "PENDING",
        moderationQueueStatus: "pending_moderation"
      };

      jobs.push(job);

      return {
        id: job.id,
        title: job.title,
        address: job.address,
        price: job.price,
        whenNeeded: job.whenNeeded,
        moderationQueueStatus: job.moderationQueueStatus
      };
    },
    async countJobsCreatedToday(customerId, dayStart, dayEnd) {
      return jobs.filter((job) => job.customerId === customerId && job.createdAt >= dayStart && job.createdAt < dayEnd).length;
    },
    async moderateJob(jobId, action) {
      const job = jobs.find((item) => item.id === jobId);
      if (!job) {
        return null;
      }

      if (action === "approve") {
        job.status = "ACTIVE";
        job.moderationStatus = "APPROVED";
        job.moderationQueueStatus = "APPROVED";
      } else {
        job.status = "CANCELED";
        job.moderationStatus = "REJECTED";
        job.moderationQueueStatus = "REJECTED";
      }

      return {
        id: job.id,
        status: job.status.toLowerCase(),
        moderationStatus: job.moderationStatus.toLowerCase(),
        moderationQueueStatus: job.moderationQueueStatus.toLowerCase()
      };
    }
  };
}

async function createRepository(): Promise<AppRepository> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    return {
      async upsertTelegramUser(input) {
        const user = await prisma.user.upsert({
          where: { telegramId: input.telegramId },
          update: {
            username: input.username ?? null,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            phone: input.phone ?? null,
            country: input.country ?? null,
            city: input.city ?? null
          },
          create: {
            telegramId: input.telegramId,
            username: input.username ?? null,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            phone: input.phone ?? null,
            country: input.country ?? null,
            city: input.city ?? null
          }
        });

        return {
          id: user.id,
          telegramId: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          country: user.country,
          city: user.city
        };
      },
      async updateProfile(userId, input) {
        const user = await prisma.user.update({
          where: { id: userId },
          data: {
            firstName: input.firstName,
            phone: input.phone,
            country: input.country,
            city: input.city
          }
        });

        return {
          id: user.id,
          telegramId: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          country: user.country,
          city: user.city
        };
      },
      async createJob(input) {
        return prisma.$transaction(async (tx) => {
          const location = await tx.location.create({
            data: {
              country: input.country ?? ALLOWED_COUNTRY,
              city: input.city ?? ALLOWED_CITY,
              addressLine: input.address
            }
          });

          const job = await tx.job.create({
            data: {
              customerId: input.customerId,
              title: input.title,
              description: input.title,
              budget: input.price,
              currency: "KZT",
              status: "DRAFT",
              moderationStatus: "PENDING",
              locationId: location.id,
              startsAt: new Date(input.whenNeeded)
            }
          });

          await tx.moderationQueue.create({
            data: {
              entityType: "JOB",
              entityId: job.id,
              status: "PENDING_MODERATION" as never,
              payload: {
                title: input.title,
                address: input.address,
                price: input.price,
                whenNeeded: input.whenNeeded
              }
            }
          });

          return {
            id: job.id,
            title: job.title,
            address: input.address,
            price: input.price,
            whenNeeded: input.whenNeeded,
            moderationQueueStatus: "pending_moderation"
          };
        });
      },
      async countJobsCreatedToday(customerId, dayStart, dayEnd) {
        return prisma.job.count({
          where: {
            customerId,
            createdAt: {
              gte: dayStart,
              lt: dayEnd
            }
          }
        });
      },
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
    console.warn("[api] Prisma repository unavailable, using in-memory storage.", error);
    return createMemoryRepository();
  }
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  const raw = request.headers.cookie;
  if (!raw) {
    return {};
  }

  return raw.split(";").reduce<Record<string, string>>((accumulator, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) {
      return accumulator;
    }

    accumulator[name] = decodeURIComponent(rest.join("="));
    return accumulator;
  }, {});
}

function readJsonBody<T>(request: IncomingMessage): Promise<T | null> {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
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

function sendJson(response: ServerResponse, statusCode: number, body: unknown, headers?: Record<string, string>) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function getCorsHeaders(origin: string | undefined): Record<string, string> {
  const allowedOrigin = origin && origin === webOrigin ? origin : webOrigin;

  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  };
}

function buildSessionCookie(sessionId: string): string {
  return `${sessionCookieName}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`;
}

function clearSessionCookie(): string {
  return `${sessionCookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function getSessionFromRequest(request: IncomingMessage): SessionRecord | null {
  const cookies = parseCookies(request);
  return cookies[sessionCookieName] ? sessionStore.get(cookies[sessionCookieName]) ?? null : null;
}

function isValidPhone(phone: string): boolean {
  return /^\+?[0-9]{10,15}$/.test(phone);
}

function getDayRange(now: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}

function parsePrice(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = Number(value.replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(normalized) ? normalized : null;
  }

  return null;
}

function extractUserFromInitData(initData: string, botToken: string | undefined): TelegramUserPayload | null {
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

function normalizeTelegramUser(input: TelegramUserPayload | null | undefined): TelegramUserPayload | null {
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

async function notifyAdminAboutNewJob(job: CreatedJob) {
  if (!telegramBotToken || !adminChatId) {
    return;
  }

  const payload = {
    chat_id: adminChatId,
    text:
      [
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
  };

  try {
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("[api] failed to notify admin", error);
  }
}

async function main() {
  const repository = await createRepository();

  createServer(async (request, response) => {
    const corsHeaders = getCorsHeaders(request.headers.origin);

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (request.url === "/health") {
      sendJson(response, 200, { ok: true, service: "api" }, corsHeaders);
      return;
    }

    if (request.method === "GET" && request.url === "/auth/session") {
      const session = getSessionFromRequest(request);

      if (!session) {
        sendJson(response, 200, { ok: true, authenticated: false, user: null }, corsHeaders);
        return;
      }

      sendJson(response, 200, { ok: true, authenticated: true, user: session }, corsHeaders);
      return;
    }

    if (request.method === "POST" && request.url === "/auth/logout") {
      const cookies = parseCookies(request);
      if (cookies[sessionCookieName]) {
        sessionStore.delete(cookies[sessionCookieName]);
      }

      sendJson(response, 200, { ok: true, authenticated: false }, { ...corsHeaders, "set-cookie": clearSessionCookie() });
      return;
    }

    if (request.method === "POST" && request.url === "/auth/telegram") {
      try {
        const body = await readJsonBody<AuthRequestBody>(request);
        const verifiedFromInitData = body?.initData ? extractUserFromInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN) : null;
        const telegramUser = normalizeTelegramUser(verifiedFromInitData ?? body?.telegramUser);

        if (!telegramUser) {
          sendJson(response, 400, { ok: false, error: "Telegram user payload is required." }, corsHeaders);
          return;
        }

        const user = await repository.upsertTelegramUser({
          telegramId: String(telegramUser.id),
          username: telegramUser.username,
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          country: body?.profile?.country,
          city: body?.profile?.city
        });

        const sessionId = randomBytes(24).toString("hex");
        const session: SessionRecord = {
          sessionId,
          userId: user.id,
          telegramId: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          country: user.country,
          city: user.city,
          createdAt: new Date().toISOString()
        };

        sessionStore.set(sessionId, session);
        sendJson(response, 200, { ok: true, authenticated: true, user: session }, { ...corsHeaders, "set-cookie": buildSessionCookie(sessionId) });
      } catch (error) {
        console.error("[api] auth error", error);
        sendJson(response, 500, { ok: false, error: "Unable to authenticate user." }, corsHeaders);
      }
      return;
    }

    if (request.method === "POST" && request.url === "/profile") {
      try {
        const session = getSessionFromRequest(request);
        if (!session) {
          sendJson(response, 401, { ok: false, error: "Unauthorized." }, corsHeaders);
          return;
        }

        const body = await readJsonBody<ProfileUpdateBody>(request);
        const firstName = body?.firstName?.trim() ?? "";
        const phone = body?.phone?.trim() ?? "";
        const country = body?.country?.trim() ?? "";
        const city = body?.city?.trim() ?? "";

        if (!firstName) {
          sendJson(response, 400, { ok: false, error: "Name is required." }, corsHeaders);
          return;
        }

        if (!isValidPhone(phone)) {
          sendJson(response, 400, { ok: false, error: "Phone must contain 10 to 15 digits and may start with '+'." }, corsHeaders);
          return;
        }

        if (country !== ALLOWED_COUNTRY) {
          sendJson(response, 400, { ok: false, error: "Country must be Kazakhstan." }, corsHeaders);
          return;
        }

        if (city !== ALLOWED_CITY) {
          sendJson(response, 400, { ok: false, error: "City must be Kushmurun." }, corsHeaders);
          return;
        }

        const user = await repository.updateProfile(session.userId, { firstName, phone, country, city });
        if (!user) {
          sendJson(response, 404, { ok: false, error: "User not found." }, corsHeaders);
          return;
        }

        const nextSession: SessionRecord = {
          ...session,
          firstName: user.firstName,
          phone: user.phone,
          country: user.country,
          city: user.city
        };

        sessionStore.set(session.sessionId, nextSession);
        sendJson(response, 200, { ok: true, user: nextSession }, corsHeaders);
      } catch (error) {
        console.error("[api] profile update error", error);
        sendJson(response, 500, { ok: false, error: "Unable to save profile." }, corsHeaders);
      }
      return;
    }

    if (request.method === "POST" && request.url === "/jobs") {
      try {
        const session = getSessionFromRequest(request);
        if (!session) {
          sendJson(response, 401, { ok: false, error: "Unauthorized." }, corsHeaders);
          return;
        }

        const body = await readJsonBody<CreateJobBody>(request);
        const title = body?.title?.trim() ?? "";
        const address = body?.address?.trim() ?? "";
        const price = parsePrice(body?.price);
        const whenNeeded = body?.whenNeeded?.trim() ?? "";

        if (!title) {
          sendJson(response, 400, { ok: false, error: "Field 'what needs to be done' is required." }, corsHeaders);
          return;
        }

        if (!address) {
          sendJson(response, 400, { ok: false, error: "Address is required." }, corsHeaders);
          return;
        }

        if (price === null || price <= 0) {
          sendJson(response, 400, { ok: false, error: "Price must be greater than 0." }, corsHeaders);
          return;
        }

        if (!whenNeeded || Number.isNaN(Date.parse(whenNeeded))) {
          sendJson(response, 400, { ok: false, error: "A valid 'when needed' value is required." }, corsHeaders);
          return;
        }

        const { dayStart, dayEnd } = getDayRange(new Date());
        const todayJobsCount = await repository.countJobsCreatedToday(session.userId, dayStart, dayEnd);

        if (todayJobsCount >= MAX_DAILY_JOBS) {
          sendJson(response, 429, { ok: false, error: "Daily limit reached. No more than 3 jobs per day." }, corsHeaders);
          return;
        }

        const job = await repository.createJob({
          customerId: session.userId,
          title,
          address,
          price,
          whenNeeded,
          country: session.country,
          city: session.city
        });

        await notifyAdminAboutNewJob(job);

        sendJson(
          response,
          201,
          {
            ok: true,
            job,
            moderationQueue: {
              status: "pending_moderation"
            }
          },
          corsHeaders
        );
      } catch (error) {
        console.error("[api] create job error", error);
        sendJson(response, 500, { ok: false, error: "Unable to create job." }, corsHeaders);
      }
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found." }, corsHeaders);
  }).listen(port, () => {
    console.log(`[api] listening on http://localhost:${port}`);
  });
}

void main();
