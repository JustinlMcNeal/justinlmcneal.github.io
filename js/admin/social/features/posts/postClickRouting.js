// Calendar / queue post click — Deep Analysis vs Post Detail

import { isPostedSuccessStatus } from "../../postStatus.js";
import { openPostAnalytics } from "../analytics/postAnalyticsModal.js";
import { openPostDetail } from "./postDetailController.js";

/**
 * Posted success → Deep Analysis modal.
 * Queued / draft / failed / processing / unknown → Post Detail (edit/post/delete).
 */
export function shouldOpenDeepAnalysis(post) {
  if (!post) return false;
  return isPostedSuccessStatus(post.status);
}

export function handlePostClick(post) {
  if (!post) return;
  if (shouldOpenDeepAnalysis(post)) {
    openPostAnalytics(post.id);
  } else {
    openPostDetail(post);
  }
}
