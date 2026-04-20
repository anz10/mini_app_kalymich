import { clearSessionCookie, json } from "../_lib";

export default async function handler(request: any, response: any) {
  return json(response, 200, { ok: true, authenticated: false }, { "set-cookie": clearSessionCookie() });
}
