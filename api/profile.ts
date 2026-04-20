import { ALLOWED_CITY, ALLOWED_COUNTRY, createSessionCookie, isValidPhone, json, prisma, readJsonBody, readSessionFromRequest } from "./_lib";

export default async function handler(request: any, response: any) {
  if (request.method !== "POST") {
    return json(response, 405, { ok: false, error: "Method not allowed." });
  }

  const session = readSessionFromRequest(request);
  if (!session) {
    return json(response, 401, { ok: false, error: "Unauthorized." });
  }

  const body = await readJsonBody<any>(request);
  const firstName = body?.firstName?.trim() ?? "";
  const phone = body?.phone?.trim() ?? "";
  const country = body?.country?.trim() ?? "";
  const city = body?.city?.trim() ?? "";

  if (!firstName) {
    return json(response, 400, { ok: false, error: "Name is required." });
  }
  if (!isValidPhone(phone)) {
    return json(response, 400, { ok: false, error: "Phone must contain 10 to 15 digits and may start with '+'." });
  }
  if (country !== ALLOWED_COUNTRY) {
    return json(response, 400, { ok: false, error: "Country must be Kazakhstan." });
  }
  if (city !== ALLOWED_CITY) {
    return json(response, 400, { ok: false, error: "City must be Kushmurun." });
  }

  const user = await prisma.user.update({
    where: { id: session.userId },
    data: { firstName, phone, country, city }
  });

  const nextSession = {
    ...session,
    firstName: user.firstName,
    phone: user.phone,
    country: user.country,
    city: user.city
  };

  return json(response, 200, { ok: true, user: nextSession }, { "set-cookie": createSessionCookie(nextSession) });
}
