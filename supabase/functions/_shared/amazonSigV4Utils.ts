// AWS SigV4 signing for Amazon SP-API (execute-api service).

export const AWS_REGION_BY_SP_API: Record<string, string> = {
  na: "us-east-1",
  eu: "eu-west-1",
  fe: "us-west-2",
};

export function getAwsRegionForSpApiRegion(spApiRegion: string, override?: string | null): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  return AWS_REGION_BY_SP_API[spApiRegion] ?? AWS_REGION_BY_SP_API.na;
}

export function spApiHintForHttpStatus(httpStatus: number, signed: boolean): string | undefined {
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus >= 500) return "sp_api_unavailable";
  if (httpStatus === 401 || httpStatus === 403) {
    return signed ? "sigv4_failed_or_permission_denied" : "sigv4_may_be_required";
  }
  return undefined;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  data: string,
): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function getSignatureKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

function canonicalQueryString(url: URL): string {
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => pairs.push([key, value]));
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return pairs.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join("&");
}

export async function signSpApiRequest(input: {
  method: "GET" | "POST" | "PUT" | "PATCH";
  url: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
  headers: Record<string, string>;
  body?: string;
}): Promise<Record<string, string>> {
  const service = input.service ?? "execute-api";
  const body = input.body ?? "";
  const url = new URL(input.url);
  const { amzDate, dateStamp } = toAmzDate(new Date());
  const payloadHash = await sha256Hex(body);

  const signHeaders: Record<string, string> = {
    host: url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };

  for (const [key, value] of Object.entries(input.headers)) {
    signHeaders[key.toLowerCase()] = value.trim();
  }

  if (input.sessionToken?.trim()) {
    signHeaders["x-amz-security-token"] = input.sessionToken.trim();
  }

  const signedHeaderNames = Object.keys(signHeaders).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${signHeaders[name].trim()}\n`)
    .join("");
  const signedHeadersStr = signedHeaderNames.join(";");

  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQueryString(url),
    canonicalHeaders,
    signedHeadersStr,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSignatureKey(
    input.secretAccessKey,
    dateStamp,
    input.region,
    service,
  );
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  const fetchHeaders: Record<string, string> = { ...signHeaders, Authorization: authorization };
  delete fetchHeaders.host;
  return fetchHeaders;
}
