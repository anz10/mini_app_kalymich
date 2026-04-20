import { ALLOWED_CITY, ALLOWED_COUNTRY, MAX_DAILY_JOBS, getDayRange, json, notifyAdminAboutNewJob, parsePrice, prisma, readJsonBody, readSessionFromRequest } from "./_lib";

export default async function handler(request: any, response: any) {
  if (request.method !== "POST") {
    return json(response, 405, { ok: false, error: "Method not allowed." });
  }

  const session = readSessionFromRequest(request);
  if (!session) {
    return json(response, 401, { ok: false, error: "Unauthorized." });
  }

  const body = await readJsonBody<any>(request);
  const title = body?.title?.trim() ?? "";
  const address = body?.address?.trim() ?? "";
  const price = parsePrice(body?.price);
  const whenNeeded = body?.whenNeeded?.trim() ?? "";

  if (!title) {
    return json(response, 400, { ok: false, error: "Field 'what needs to be done' is required." });
  }
  if (!address) {
    return json(response, 400, { ok: false, error: "Address is required." });
  }
  if (price === null || price <= 0) {
    return json(response, 400, { ok: false, error: "Price must be greater than 0." });
  }
  if (!whenNeeded || Number.isNaN(Date.parse(whenNeeded))) {
    return json(response, 400, { ok: false, error: "A valid 'when needed' value is required." });
  }

  const { dayStart, dayEnd } = getDayRange(new Date());
  const todayJobsCount = await prisma.job.count({
    where: {
      customerId: session.userId,
      createdAt: { gte: dayStart, lt: dayEnd }
    }
  });

  if (todayJobsCount >= MAX_DAILY_JOBS) {
    return json(response, 429, { ok: false, error: "Daily limit reached. No more than 3 jobs per day." });
  }

  const result = await prisma.$transaction(async (tx) => {
    const location = await tx.location.create({
      data: {
        country: session.country ?? ALLOWED_COUNTRY,
        city: session.city ?? ALLOWED_CITY,
        addressLine: address
      }
    });

    const job = await tx.job.create({
      data: {
        customerId: session.userId,
        title,
        description: title,
        budget: price,
        currency: "KZT",
        status: "DRAFT",
        moderationStatus: "PENDING",
        locationId: location.id,
        startsAt: new Date(whenNeeded)
      }
    });

    await tx.moderationQueue.create({
      data: {
        entityType: "JOB",
        entityId: job.id,
        status: "PENDING_MODERATION" as never,
        payload: { title, address, price, whenNeeded }
      }
    });

    return {
      id: job.id,
      title: job.title,
      address,
      price,
      whenNeeded,
      moderationQueueStatus: "pending_moderation"
    };
  });

  await notifyAdminAboutNewJob(result);

  return json(response, 201, { ok: true, job: result, moderationQueue: { status: "pending_moderation" } });
}
