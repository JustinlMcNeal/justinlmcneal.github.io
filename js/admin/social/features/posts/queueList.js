// Queue tab — load and render scheduled posts list

import { fetchPosts, getPublicUrl } from "../../api.js";
import { formatScheduleDate, formatScheduleTime } from "../../utils/dates.js";
import { getPostsContext } from "./postsContext.js";
import { openPostDetail } from "./postDetailController.js";

export async function loadQueuePosts() {
  const { els } = getPostsContext();
  const platform = els.queueFilter.value;
  const filters = { status: "queued" };
  if (platform !== "all") filters.platform = platform;
  const posts = await fetchPosts(filters);
  renderQueueList(posts);
}

function renderQueueList(posts) {
  const { els } = getPostsContext();

  if (!posts.length) {
    els.queueList.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <p>No scheduled posts yet</p>
        <button class="mt-2 text-sm text-black font-medium hover:underline" onclick="document.getElementById('btnUpload').click()">
          Create your first post \u2192
        </button>
      </div>
    `;
    return;
  }

  els.queueList.innerHTML = posts.map(post => {
    const imageUrl = post.variation?.image_path
      ? getPublicUrl(post.variation.image_path)
      : "/imgs/placeholder.jpg";

    const scheduledDate = new Date(post.scheduled_for);
    const dateStr = formatScheduleDate(scheduledDate);
    const timeStr = formatScheduleTime(scheduledDate);

    return `
      <div class="queue-item cursor-pointer" data-post-id="${post.id}">
        <img src="${imageUrl}" alt="" class="queue-item-image">
        <div class="queue-item-content">
          <div class="queue-item-caption">${post.caption || "No caption"}</div>
          <div class="queue-item-meta">
            <span class="badge badge-${post.platform}">${post.platform === "instagram" ? "\ud83d\udcf8" : "\ud83d\udccc"} ${post.platform}</span>
            <span class="ml-2">${dateStr} at ${timeStr}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge badge-${post.status}">${post.status}</span>
        </div>
      </div>
    `;
  }).join("");

  els.queueList.querySelectorAll(".queue-item").forEach(el => {
    el.addEventListener("click", () => {
      const postId = el.dataset.postId;
      const post = posts.find(p => p.id === postId);
      if (post) openPostDetail(post);
    });
  });
}
