// Post detail modal — delete, save, post now

import {
  updatePost,
  deletePost,
  recalculateProductPostDate,
} from "../../api.js";
import { parseHashtags } from "../../captions.js";
import { getPostsContext } from "./postsContext.js";
import { closePostDetail } from "./postDetailRender.js";
import { refreshSchedulingHub } from "./schedulingRefresh.js";

export async function handleDeletePost() {
  const { state, loadStats, loadAutoQueueStats, loadCalendarPosts, loadQueuePosts } = getPostsContext();
  if (!state.editingPost) return;
  if (!confirm("Delete this post?")) return;

  try {
    const productId = state.editingPost.variation?.asset?.product?.id
                   || state.editingPost.variation?.asset?.product_id;

    await deletePost(state.editingPost.id);

    if (productId) await recalculateProductPostDate(productId);

    closePostDetail();
    await loadStats();

    if (state.currentTab === "autoqueue") await loadAutoQueueStats();
    else await refreshSchedulingHub();
  } catch (err) {
    console.error("Delete post error:", err);
    alert("Failed to delete post");
  }
}

export async function handleSavePost() {
  const { state, els, loadCalendarPosts, loadQueuePosts } = getPostsContext();
  if (!state.editingPost) return;

  try {
    const scheduledFor = new Date(`${els.postDetailDate.value}T${els.postDetailTime.value}:00`).toISOString();

    const updateData = {
      caption: els.postDetailCaption.value,
      hashtags: parseHashtags(els.postDetailHashtags.value),
      scheduled_for: scheduledFor,
    };

    if (state.editingPost.platform === "pinterest") {
      const modalBoardSelect = document.getElementById("postDetailBoard");
      if (modalBoardSelect?.value) updateData.pinterest_board_id = modalBoardSelect.value;
    }

    await updatePost(state.editingPost.id, updateData);
    closePostDetail();

    await refreshSchedulingHub();

    alert("Post updated!");
  } catch (err) {
    console.error("Save post error:", err);
    alert("Failed to save post");
  }
}

export async function handlePostNow() {
  const {
    state, els, postToInstagram, postToFacebook, postToPinterest,
    loadStats, loadCalendarPosts, loadQueuePosts, switchTab,
  } = getPostsContext();

  if (!state.editingPost) return;

  const post = state.editingPost;

  let imageUrl = post.image_url;
  if (!imageUrl && post.variation?.image_path) {
    const imagePath = post.variation.image_path;
    if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
      imageUrl = imagePath;
    } else {
      imageUrl = `https://yxdzvzscufkvewecvagq.supabase.co/storage/v1/object/public/social-media/${imagePath}`;
    }
  }

  if (!imageUrl) { alert("No image found for this post."); return; }

  if (post.platform === "instagram") {
    if (!confirm("Post this to Instagram now?")) return;

    const caption = post.caption || "";
    const hashtags = post.hashtags?.join(" ") || "";
    const fullCaption = hashtags ? `${caption}\n\n${hashtags}` : caption;

    const result = await postToInstagram(post.id, imageUrl, fullCaption);

    if (result?.success) {
      closePostDetail();
      await new Promise(r => setTimeout(r, 500));
      await loadStats();
      await refreshSchedulingHub();
    }
  } else if (post.platform === "pinterest") {
    const modalBoardSelect = document.getElementById("postDetailBoard");
    const boardId = modalBoardSelect?.value || post.pinterest_board_id;

    if (!boardId) { alert("Please select a Pinterest board."); return; }
    if (!confirm("Post this pin to Pinterest now?")) return;

    const result = await postToPinterest(
      post.id, imageUrl, post.title || "", post.caption || "",
      post.product_url || "", boardId,
    );

    if (result?.success) {
      els.postDetailModal?.classList.add("hidden");
      await loadStats();
      switchTab(state.currentTab);
    }
  } else if (post.platform === "facebook") {
    if (!confirm("Post this to Facebook now?")) return;

    const caption = post.caption || "";
    const hashtags = post.hashtags?.join(" ") || "";
    const fullCaption = hashtags ? `${caption}\n\n${hashtags}` : caption;
    const linkUrl = post.link_url || post.product_url || null;

    const result = await postToFacebook(post.id, imageUrl, fullCaption, linkUrl);

    if (result?.success) {
      closePostDetail();
      await new Promise(r => setTimeout(r, 500));
      await loadStats();
      await refreshSchedulingHub();
    }
  } else {
    alert(`Posting to ${post.platform} is not supported yet.`);
  }
}
