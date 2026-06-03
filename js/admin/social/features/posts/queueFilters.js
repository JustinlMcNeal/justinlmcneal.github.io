// Calendar list view — platform + status filters

import { loadQueuePosts } from "./queueList.js";
import { getPostsContext } from "./postsContext.js";

export function setupQueueFilter() {
  const { els } = getPostsContext();
  els.queueFilter?.addEventListener("change", loadQueuePosts);
  els.listStatusFilter?.addEventListener("change", loadQueuePosts);
}
