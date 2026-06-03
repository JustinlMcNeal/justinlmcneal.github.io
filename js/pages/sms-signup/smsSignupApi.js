import { SUPABASE_URL } from "/js/config/env.js";

const SUBSCRIBE_URL = `${SUPABASE_URL}/functions/v1/sms-subscribe`;

export async function subscribeSms(payload) {
  const resp = await fetch(SUBSCRIBE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}
