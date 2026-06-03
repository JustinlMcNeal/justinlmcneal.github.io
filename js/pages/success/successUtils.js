// Reusable helpers for the success page modules.

export function cents(n) {
  return "$" + (Math.abs(n || 0) / 100).toFixed(2);
}

export function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatPhoneDisplay(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const d = digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone;
}

export function toUsE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  return null;
}

export async function readJsonResponse(res) {
  try {
    return await res.json();
  } catch (_) {
    return {};
  }
}
