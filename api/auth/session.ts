import { json, readSessionFromRequest } from "../_lib";

export default async function handler(request: any, response: any) {
  const session = readSessionFromRequest(request);
  return json(response, 200, { ok: true, authenticated: Boolean(session), user: session });
}
