export function formatPhone(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function stripPhone(formatted) {
  return formatted.replace(/\D/g, "");
}

export function toUsE164FromNationalPhone(formatted) {
  return "+1" + stripPhone(formatted);
}
