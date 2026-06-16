// Shared shipping-address heuristics + Shippo USPS validation.

export type ShippingAddressFields = {
  first_name?: string | null;
  last_name?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
};

export type AddressValidationMessage = {
  source: string;
  text: string;
  code?: string;
  type?: string;
};

export type AddressValidationResult = {
  is_valid: boolean;
  local_issues: string[];
  messages: AddressValidationMessage[];
  suggested?: Partial<ShippingAddressFields>;
};

const SHIPPO_BASE = "https://api.goshippo.com";

function trim(v: unknown, max = 200): string {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

export function normalizeShippingAddress(
  input: ShippingAddressFields,
): Required<Pick<ShippingAddressFields, "street_address" | "city" | "state" | "zip" | "country">> &
  Pick<ShippingAddressFields, "first_name" | "last_name"> {
  return {
    first_name: trim(input.first_name, 80) || null,
    last_name: trim(input.last_name, 80) || null,
    street_address: trim(input.street_address, 200),
    city: trim(input.city, 120),
    state: trim(input.state, 32).toUpperCase(),
    zip: trim(input.zip, 16),
    country: (trim(input.country, 8) || "US").toUpperCase(),
  };
}

/** Fast local checks before calling Shippo (catches obvious bad data like "123"). */
export function localAddressIssues(addr: ShippingAddressFields): string[] {
  const issues: string[] = [];
  const street = trim(addr.street_address);
  const city = trim(addr.city);
  const state = trim(addr.state);
  const zip = trim(addr.zip);
  const country = (trim(addr.country) || "US").toUpperCase();

  if (!street) issues.push("Street address is required.");
  else {
    if (street.length < 5) issues.push("Street address looks too short.");
    if (!/[a-zA-Z]/.test(street)) {
      issues.push("Street address should include a street name, not only a number.");
    }
    if (/^\d+\s*$/.test(street)) {
      issues.push("Street address appears incomplete (number only).");
    }
  }

  if (!city) issues.push("City is required.");
  if (!state || state.length < 2) issues.push("State is required.");

  if (country === "US") {
    if (!zip || !/^\d{5}(-\d{4})?$/.test(zip)) {
      issues.push("ZIP code must be 5 digits (or ZIP+4).");
    }
  } else if (!zip) {
    issues.push("Postal code is required.");
  }

  return issues;
}

function mapShippoMessages(raw: unknown): AddressValidationMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const o = m as Record<string, unknown>;
      const text = trim(o.text);
      if (!text) return null;
      return {
        source: trim(o.source, 80) || "Shippo",
        text,
        code: trim(o.code, 80) || undefined,
        type: trim(o.type, 40) || undefined,
      };
    })
    .filter(Boolean) as AddressValidationMessage[];
}

function suggestedFromShippo(data: Record<string, unknown>): Partial<ShippingAddressFields> | undefined {
  const street1 = trim(data.street1);
  const city = trim(data.city);
  const state = trim(data.state);
  const zip = trim(data.zip);
  const country = trim(data.country);

  if (!street1 && !city && !state && !zip) return undefined;
  return {
    street_address: street1 || undefined,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined,
    country: country || undefined,
  };
}

export async function validateShippingAddressWithShippo(
  addr: ShippingAddressFields,
  shippoKey: string,
): Promise<AddressValidationResult> {
  const normalized = normalizeShippingAddress(addr);
  const local_issues = localAddressIssues(normalized);

  if (local_issues.length) {
    return {
      is_valid: false,
      local_issues,
      messages: local_issues.map((text) => ({ source: "Karry Kraze", text })),
    };
  }

  const name = [normalized.first_name, normalized.last_name].filter(Boolean).join(" ").trim() || "Customer";

  const res = await fetch(`${SHIPPO_BASE}/addresses/`, {
    method: "POST",
    headers: {
      Authorization: `ShippoToken ${shippoKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      street1: normalized.street_address,
      city: normalized.city,
      state: normalized.state,
      zip: normalized.zip,
      country: normalized.country,
      validate: true,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data === "object" ? JSON.stringify(data) : String(data);
    throw new Error(`Shippo address validation failed (${res.status}): ${detail}`);
  }

  const validation = (data as Record<string, unknown>).validation_results as Record<string, unknown> | undefined;
  const is_valid = validation?.is_valid === true;
  const messages = mapShippoMessages(validation?.messages);

  return {
    is_valid,
    local_issues: [],
    messages: messages.length
      ? messages
      : is_valid
        ? [{ source: "Shippo", text: "Address validated for shipping." }]
        : [{ source: "Shippo", text: "Address could not be validated for delivery." }],
    suggested: suggestedFromShippo(data as Record<string, unknown>),
  };
}

export function formatValidationError(result: AddressValidationResult): string {
  const parts = [...result.local_issues];
  for (const m of result.messages) {
    if (m.text && !parts.includes(m.text)) parts.push(m.text);
  }
  return parts.join(" ") || "Shipping address is not valid.";
}
