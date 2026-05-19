// Refresh calendar hub data after post mutations

import { getPostsContext } from "./postsContext.js";
import { isCalendarQueueViewActive } from "./calendarHubView.js";

export async function refreshSchedulingHub() {
  const { state, loadCalendarPosts, loadQueuePosts } = getPostsContext();

  if (state.currentTab === "calendar" || state.currentTab === "queue") {
    if (loadCalendarPosts) await loadCalendarPosts();
    if (
      loadQueuePosts &&
      (state.currentTab === "queue" || isCalendarQueueViewActive())
    ) {
      await loadQueuePosts();
    }
  }
}
