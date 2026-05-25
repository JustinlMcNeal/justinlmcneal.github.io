/**
 * Instagram Content Publishing helpers.
 *
 * Meta's container status_code poll often returns Authorization Error (code 100,
 * subcode 33) even when create + media_publish work. Prefer publish-with-retry.
 */

export type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
};

export function isMediaNotReadyError(error: GraphError | undefined): boolean {
  if (!error) return false;
  // Common "not ready yet" subcodes from Content Publishing API
  if (error.error_subcode === 2207027 || error.error_subcode === 2207001) return true;
  const msg = (error.message || "").toLowerCase();
  return (
    msg.includes("not ready") ||
    msg.includes("not available") ||
    msg.includes("in progress") ||
    msg.includes("still being processed")
  );
}

export async function publishMediaContainer(
  userId: string,
  containerId: string,
  accessToken: string,
  options: { maxAttempts?: number; delayMs?: number; apiVersion?: string } = {}
): Promise<{ id: string } | { error: string }> {
  const maxAttempts = options.maxAttempts ?? 30;
  const delayMs = options.delayMs ?? 1000;
  const apiVersion = options.apiVersion ?? "v18.0";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const publishParams = new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken,
    });

    const publishResp = await fetch(
      `https://graph.facebook.com/${apiVersion}/${userId}/media_publish?${publishParams.toString()}`,
      { method: "POST" }
    );
    const publishResult = await publishResp.json();

    if (publishResult.id) {
      return { id: publishResult.id };
    }

    if (publishResult.error && isMediaNotReadyError(publishResult.error)) {
      console.log(
        `[instagram-publish] Container ${containerId} not ready (attempt ${attempt + 1}/${maxAttempts})`
      );
      continue;
    }

    return {
      error: publishResult.error?.message || "Failed to publish media",
    };
  }

  return { error: "Media processing timed out before publish" };
}
