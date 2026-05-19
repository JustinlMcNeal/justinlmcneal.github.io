// Calendar tab — calendar grid vs queue list view toggle

import { loadQueuePosts } from "./queueList.js";

const VIEW_CALENDAR = "calendar";
const VIEW_QUEUE = "queue";

let _currentView = VIEW_CALENDAR;

export function getCalendarHubView() {
  return _currentView;
}

export function isCalendarQueueViewActive() {
  return _currentView === VIEW_QUEUE;
}

export function setCalendarHubView(view) {
  const next = view === VIEW_QUEUE ? VIEW_QUEUE : VIEW_CALENDAR;
  _currentView = next;

  document.querySelectorAll("[data-calendar-hub-view]").forEach((btn) => {
    const active = btn.dataset.calendarHubView === next;
    btn.classList.toggle("active", active);
    btn.classList.toggle("bg-white", active);
    btn.classList.toggle("shadow-sm", active);
    btn.classList.toggle("text-black", active);
    btn.classList.toggle("text-gray-600", !active);
  });

  const calendarView = document.getElementById("calendarHubCalendarView");
  const queueView = document.getElementById("calendarHubQueueView");
  const calNav = document.getElementById("calendarHubNav");
  const queueHeader = document.getElementById("calendarHubQueueHeader");

  calendarView?.classList.toggle("hidden", next !== VIEW_CALENDAR);
  queueView?.classList.toggle("hidden", next !== VIEW_QUEUE);
  calNav?.classList.toggle("hidden", next !== VIEW_CALENDAR);
  queueHeader?.classList.toggle("hidden", next !== VIEW_QUEUE);

  if (next === VIEW_QUEUE) {
    loadQueuePosts();
  }
}

export function setupCalendarHubView() {
  document.querySelectorAll("[data-calendar-hub-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setCalendarHubView(btn.dataset.calendarHubView);
    });
  });
  setCalendarHubView(VIEW_CALENDAR);
}
