import { createSessionCookie, extractUserFromInitData, json, normalizeTelegramUser, prisma, readJsonBody } from "../_lib";

export default async function handler(request: any, response: any) {
  if (request.method !== "POST") {
    return json(response, 405, { ok: false, error: "Method not allowed." });
  }

  const body = await readJsonBody<any>(request);
  const verifiedFromInitData = body?.initData ? extractUserFromInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN) : null;
  const telegramUser = normalizeTelegramUser(verifiedFromInitData ?? body?.telegramUser);

  if (!telegramUser) {
    return json(response, 400, { ok: false, error: "Telegram user payload is required." });
  }

  const user = await prisma.user.upsert({
    where: { telegramId: String(telegramUser.id) },
    update: {
      username: telegramUser.username ?? null,
      firstName: telegramUser.first_name ?? null,
      lastName: telegramUser.last_name ?? null
    },
    create: {
      telegramId: String(telegramUser.id),
      username: telegramUser.username ?? null,
      firstName: telegramUser.first_name ?? null,
      lastName: telegramUser.last_name ?? null
    }
  });

  const payload = {
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

  return json(response, 200, { ok: true, authenticated: true, user: payload }, { "set-cookie": createSessionCookie(payload) });
}
