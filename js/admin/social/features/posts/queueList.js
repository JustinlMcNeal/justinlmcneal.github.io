// Calendar hub — list view (posted + upcoming posts)

import { fetchPosts, getPublicUrl } from "../../api.js";
import { formatScheduleDate, formatScheduleTime } from "../../utils/dates.js";
import { isPostedSuccessStatus } from "../../postStatus.js";
import { getPostsContext } from "./postsContext.js";
import { handlePostClick } from "./postClickRouting.js";

const LIST_STATUSES_ALL = ["posted", "queued", "scheduled"];
const LIST_STATUSES_UPCOMING = ["queued", "scheduled"];

function statusesForFilter(statusFilter) {
  if (statusFilter === "posted") return ["posted"];
  if (statusFilter === "upcoming") return LIST_STATUSES_UPCOMING;
  return LIST_STATUSES_ALL;
}

function getListSortTime(post) {
  const iso =
    (isPostedSuccessStatus(post.status) && post.posted_at) ||
    post.posted_at ||
    post.scheduled_for ||
    post.created_at;
  return iso ? new Date(iso).getTime() : 0;
}

function getListDisplayDate(post) {
  const iso =
    (isPostedSuccessStatus(post.status) && post.posted_at) ||
    post.scheduled_for ||
    post.created_at;
  return iso ? new Date(iso) : null;
}

export async function loadQueuePosts() {
  const { els } = getPostsContext();
  const platform = els.queueFilter?.value || "all";
  const statusFilter = els.listStatusFilter?.value || "all";
  const baseFilters = platform !== "all" ? { platform } : {};
  const statuses = statusesForFilter(statusFilter);

  const batches = await Promise.all(
    statuses.map((status) => fetchPosts({ ...baseFilters, status }))
  );

  const allowed = new Set(statuses);
  const byId = new Map();
  for (const batch of batches) {
    for (const post of batch) {
      if (allowed.has(post.status)) {
        byId.set(post.id, post);
      }
    }
  }

  const posts = Array.from(byId.values()).sort(
    (a, b) => getListSortTime(b) - getListSortTime(a)
  );
  renderQueueList(posts);
}

function renderQueueList(posts) {
  const { els } = getPostsContext();

  if (!posts.length) {
    els.queueList.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <p>No posts found for this filter.</p>
      </div>
    `;
    return;
  }

  els.queueList.innerHTML = posts.map(post => {
    const imageUrl = post.variation?.image_path
      ? getPublicUrl(post.variation.image_path)
      : "/imgs/placeholder.jpg";

    const displayDate = getListDisplayDate(post);
    const dateStr = displayDate ? formatScheduleDate(displayDate) : "—";
    const timeStr = displayDate ? formatScheduleTime(displayDate) : "";
    const dateLabel = isPostedSuccessStatus(post.status) ? "Posted" : "Scheduled";

    return `
      <div class="queue-item cursor-pointer" data-post-id="${post.id}">
        <img src="${imageUrl}" alt="" class="queue-item-image">
        <div class="queue-item-content">
          <div class="queue-item-caption">${post.caption || "No caption"}</div>
          <div class="queue-item-meta">
            <span class="badge badge-${post.platform}">${post.platform === "instagram" ? "\ud83d\udcf8" : "\ud83d\udccc"} ${post.platform}</span>
            <span class="ml-2">${dateLabel} ${dateStr}${timeStr ? ` at ${timeStr}` : ""}</span>
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
      if (post) handlePostClick(post);
    });
  });
}
