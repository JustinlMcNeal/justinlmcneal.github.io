// AWS STS AssumeRole for SP-API temporary signing credentials.

import { signSpApiRequest } from "./amazonSigV4Utils.ts";

export type AssumeRoleResult =
  | {
    ok: true;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  }
  | { ok: false; error: string; httpStatus?: number };

export async function assumeSpApiRole(input: {
  roleArn: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionName?: string;
  durationSeconds?: number;
}): Promise<AssumeRoleResult> {
  const roleArn = input.roleArn.trim();
  if (!roleArn) return { ok: false, error: "missing_role_arn" };

  const body = new URLSearchParams({
    Action: "AssumeRole",
    Version: "2011-06-15",
    RoleArn: roleArn,
    RoleSessionName: input.sessionName?.trim() || "karrykraze-sp-api",
    DurationSeconds: String(input.durationSeconds ?? 3600),
  }).toString();

  const url = `https://sts.${input.region}.amazonaws.com/`;

  const headers = await signSpApiRequest({
    method: "POST",
    url,
    region: input.region,
    service: "sts",
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const resp = await fetch(url, { method: "POST", headers, body });
  const text = await resp.text();

  if (!resp.ok) {
    console.log("[assumeSpApiRole] sts_failed", resp.status, text.slice(0, 400));
    return { ok: false, error: "sts_assume_role_failed", httpStatus: resp.status };
  }

  const accessKeyId = text.match(/<AccessKeyId>([^<]+)<\/AccessKeyId>/)?.[1]?.trim();
  const secretAccessKey = text.match(/<SecretAccessKey>([^<]+)<\/SecretAccessKey>/)?.[1]?.trim();
  const sessionToken = text.match(/<SessionToken>([^<]+)<\/SessionToken>/)?.[1]?.trim();

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    console.log("[assumeSpApiRole] sts_parse_failed");
    return { ok: false, error: "sts_parse_failed" };
  }

  return { ok: true, accessKeyId, secretAccessKey, sessionToken };
}
