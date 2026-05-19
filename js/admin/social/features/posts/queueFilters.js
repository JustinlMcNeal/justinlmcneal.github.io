// Queue tab — platform filter

import { loadQueuePosts } from "./queueList.js";
import { getPostsContext } from "./postsContext.js";

export function setupQueueFilter() {
  getPostsContext().els.queueFilter?.addEventListener("change", loadQueuePosts);
}
