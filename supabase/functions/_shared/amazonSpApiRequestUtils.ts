// Shared SP-API HTTP helpers (GET/POST + Restricted Data Token).

import { signSpApiRequest, spApiHintForHttpStatus } from "./amazonSigV4Utils.ts";
import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";

export type SpApiResult =
  | { ok: true; data: Record<string, unknown>; httpStatus: number }
  | { ok: false; error: string; httpStatus?: number; hint?: string; data?: Record<string, unknown> };

export function extractSpApiErrorMessage(data: Record<string, unknown> | undefined): string {
  if (!data) return "sp_api_request_failed";

  const errors = data.errors;
  if (Array.isArray(errors) && errors.length) {
    return errors
      .map((entry) => {
        const rec = asRecord(entry);
        return [rec?.code, rec?.message, rec?.details].filter(Boolean).join(": ");
      })
      .filter(Boolean)
      .join("; ") || "sp_api_request_failed";
  }

  const message = data.message ?? data.error_description ?? data.error;
  if (message != null && String(message).trim()) return String(message).trim();
  return "sp_api_request_failed";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function buildSignedHeaders(
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  accessToken: string,
  aws: AmazonCredentials["aws"],
  body = "",
): Promise<Record<string, string>> {
  const baseHeaders: Record<string, string> = {
    "x-amz-access-token": accessToken,
    "content-type": "application/json",
    "user-agent": "KarryKraze-AmazonSPAPI/1.0",
  };

  if (!aws) return baseHeaders;

  return signSpApiRequest({
    method,
    url,
    region: aws.region,
    service: "execute-api",
    accessKeyId: aws.accessKeyId,
    secretAccessKey: aws.secretAccessKey,
    sessionToken: aws.sessionToken,
    headers: baseHeaders,
    body,
  });
}

export async function spApiGet(
  url: string,
  accessToken: string,
  aws?: AmazonCredentials["aws"],
): Promise<SpApiResult> {
  const signed = Boolean(aws);
  const headers = await buildSignedHeaders("GET", url, accessToken, aws);
  const resp = await fetch(url, { method: "GET", headers });

  let data: Record<string, unknown> = {};
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    if (!resp.ok) {
      return {
        ok: false,
        error: "sp_api_request_failed",
        httpStatus: resp.status,
        hint: spApiHintForHttpStatus(resp.status, signed),
      };
    }
    return { ok: true, data: {}, httpStatus: resp.status };
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: extractSpApiErrorMessage(data),
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, signed),
      data,
    };
  }

  return { ok: true, data, httpStatus: resp.status };
}

export async function spApiPost(
  url: string,
  accessToken: string,
  body: Record<string, unknown>,
  aws?: AmazonCredentials["aws"],
): Promise<SpApiResult> {
  const signed = Boolean(aws);
  const bodyStr = JSON.stringify(body);
  const headers = await buildSignedHeaders("POST", url, accessToken, aws, bodyStr);
  const resp = await fetch(url, { method: "POST", headers, body: bodyStr });

  if (resp.status === 204) {
    return { ok: true, data: {}, httpStatus: resp.status };
  }

  let data: Record<string, unknown> = {};
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    if (!resp.ok) {
      return {
        ok: false,
        error: "sp_api_request_failed",
        httpStatus: resp.status,
        hint: spApiHintForHttpStatus(resp.status, signed),
      };
    }
    return { ok: true, data: {}, httpStatus: resp.status };
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: extractSpApiErrorMessage(data),
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, signed),
      data,
    };
  }

  return { ok: true, data, httpStatus: resp.status };
}

export async function createRestrictedDataToken(
  creds: AmazonCredentials,
  restrictedResources: Array<{ method: string; path: string; dataElements?: string[] }>,
): Promise<{ ok: true; token: string } | { ok: false; error: string; hint?: string; httpStatus?: number }> {
  const base = creds.endpoint.replace(/\/$/, "");
  const url = `${base}/tokens/2021-03-01/restrictedDataToken`;
  const result = await spApiPost(
    url,
    creds.accessToken,
    { restrictedResources },
    creds.aws,
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      hint: result.hint,
      httpStatus: result.httpStatus,
    };
  }

  const token = String(result.data.restrictedDataToken || "").trim();
  if (!token) return { ok: false, error: "rdt_missing" };
  return { ok: true, token };
}

export function parsePayload(data: Record<string, unknown>): Record<string, unknown> {
  return asRecord(data.payload) ?? data;
}
