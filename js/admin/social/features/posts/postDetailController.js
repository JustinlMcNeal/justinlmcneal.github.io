// Post detail modal — init, setup, open/close

import { initPostsContext, getPostsContext } from "./postsContext.js";
import {
  navigateCarousel,
  populatePostDetailModal,
  closePostDetail,
} from "./postDetailRender.js";
import {
  handleDeletePost,
  handleSavePost,
  handlePostNow,
} from "./postActions.js";

export function initPostDetail(deps) {
  initPostsContext(deps);
}

export function setupPostDetailModal() {
  const { els } = getPostsContext();

  els.btnClosePostDetail?.addEventListener("click", closePostDetail);
  els.postDetailModal?.addEventListener("click", (e) => {
    if (e.target === els.postDetailModal) closePostDetail();
  });

  els.btnDeletePost?.addEventListener("click", handleDeletePost);
  els.btnSavePost?.addEventListener("click", handleSavePost);
  els.btnPostNow?.addEventListener("click", handlePostNow);

  document.getElementById("postDetailPrev")?.addEventListener("click", () => navigateCarousel(-1));
  document.getElementById("postDetailNext")?.addEventListener("click", () => navigateCarousel(1));
}

export function openPostDetail(post) {
  const { state } = getPostsContext();
  state.editingPost = post;
  populatePostDetailModal(post);
}
