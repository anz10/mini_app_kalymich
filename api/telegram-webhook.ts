import { json, moderateJob } from "./_lib";

async function telegramRequest(method: string, body: unknown) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return;
  }

  await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function buildDecisionText(action: "approve" | "reject", result: { id: string; status: string; moderationStatus: string; moderationQueueStatus: string }) {
  const title = action === "approve" ? "Заявка approved" : "Заявка rejected";
  return [
    title,
    "",
    `ID: ${result.id}`,
    `Job status: ${result.status}`,
    `Moderation: ${result.moderationStatus}`,
    `Queue: ${result.moderationQueueStatus}`
  ].join("\n");
}

export default async function handler(request: any, response: any) {
  if (request.method !== "POST") {
    return json(response, 405, { ok: false, error: "Method not allowed." });
  }

  const callback = request.body?.callback_query;
  if (!callback?.data || !callback.message) {
    return json(response, 200, { ok: true, ignored: true });
  }

  const [actionRaw, jobId] = String(callback.data).split(":");
  const action = actionRaw === "approve" || actionRaw === "reject" ? actionRaw : null;
  if (!action || !jobId) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Unknown moderation action."
    });
    return json(response, 200, { ok: true });
  }

  if (process.env.ADMIN_CHAT_ID && String(callback.message.chat.id) !== String(process.env.ADMIN_CHAT_ID)) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "This action is only available for the configured admin."
    });
    return json(response, 200, { ok: true });
  }

  const result = await moderateJob(jobId, action);
  if (!result) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Job not found."
    });
    return json(response, 200, { ok: true });
  }

  await telegramRequest("answerCallbackQuery", {
    callback_query_id: callback.id,
    text: action === "approve" ? "Job approved." : "Job rejected."
  });

  await telegramRequest("editMessageText", {
    chat_id: callback.message.chat.id,
    message_id: callback.message.message_id,
    text: buildDecisionText(action, result)
  });

  return json(response, 200, { ok: true, result });
}
