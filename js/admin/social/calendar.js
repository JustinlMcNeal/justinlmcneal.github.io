// /js/admin/social/calendar.js
// Calendar rendering and interaction

/**
 * Calendar state
 */
let currentDate = new Date();
let posts = [];
let onPostClick = null;

/**
 * Initialize calendar
 */
export function initCalendar(containerEl, monthEl, options = {}) {
  onPostClick = options.onPostClick || (() => {});
  
  renderCalendar(containerEl, monthEl);
  
  return {
    setPosts: (newPosts) => {
      posts = newPosts;
      renderCalendar(containerEl, monthEl);
    },
    nextMonth: () => {
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
      renderCalendar(containerEl, monthEl);
    },
    prevMonth: () => {
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
      renderCalendar(containerEl, monthEl);
    },
    goToDate: (date) => {
      currentDate = new Date(date);
      renderCalendar(containerEl, monthEl);
    },
    getCurrentMonth: () => currentDate,
    refresh: () => renderCalendar(containerEl, monthEl)
  };
}

/**
 * Render the calendar grid
 */
function renderCalendar(containerEl, monthEl) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // Update month label
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  monthEl.textContent = `${monthNames[month]} ${year}`;
  
  // Get first day of month and total days
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startingDay = firstDay.getDay(); // 0 = Sunday
  const totalDays = lastDay.getDate();
  
  // Get days from previous month to fill first row
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  
  // Build calendar grid
  let html = "";
  let dayCount = 1;
  let nextMonthDay = 1;
  
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  
  // 6 rows max
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const cellIndex = row * 7 + col;
      
      let cellDate = null;
      let isOtherMonth = false;
      let dayNumber = 0;
      
      if (cellIndex < startingDay) {
        // Previous month
        dayNumber = prevMonthLastDay - startingDay + cellIndex + 1;
        cellDate = new Date(year, month - 1, dayNumber);
        isOtherMonth = true;
      } else if (dayCount <= totalDays) {
        // Current month
        dayNumber = dayCount;
        cellDate = new Date(year, month, dayNumber);
        dayCount++;
      } else {
        // Next month
        dayNumber = nextMonthDay;
        cellDate = new Date(year, month + 1, dayNumber);
        nextMonthDay++;
        isOtherMonth = true;
      }
      
      const dateStr = formatDate(cellDate);
      const isToday = dateStr === todayStr;
      const dayPosts = getPostsForDate(dateStr);
      
      html += `
        <div class="cal-day ${isOtherMonth ? "other-month" : ""} ${isToday ? "today" : ""}" data-date="${dateStr}">
          <div class="cal-day-number">${dayNumber}</div>
          <div class="cal-day-posts">
            ${dayPosts.map(post => renderPostPill(post)).join("")}
          </div>
        </div>
      `;
    }
    
    // Stop if we've rendered all days and started next month
    if (dayCount > totalDays && row >= 4) break;
  }
  
  containerEl.innerHTML = html;
  
  // Add click handlers for posts
  containerEl.querySelectorAll(".cal-post").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const postId = el.dataset.postId;
      const post = posts.find(p => p.id === postId);
      if (post && onPostClick) {
        onPostClick(post);
      }
    });
  });
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get posts scheduled for a specific date
 */
function getPostsForDate(dateStr) {
  return posts.filter(post => {
    if (!post.scheduled_for) return false;
    const postDate = post.scheduled_for.split("T")[0];
    return postDate === dateStr;
  });
}

/**
 * Render a post pill for the calendar
 */
function renderPostPill(post) {
  const platform = post.platform || "unknown";
  const status = post.status || "queued";
  
  // Truncate caption for display
  let label = post.caption || "No caption";
  if (label.length > 15) {
    label = label.substring(0, 15) + "…";
  }
  
  // Time
  const time = post.scheduled_for ? formatTime(post.scheduled_for) : "";
  
  return `
    <div class="cal-post ${platform} ${status}" data-post-id="${post.id}" title="${post.caption || ""}">
      ${time} ${platform === "instagram" ? "📸" : "📌"}
    </div>
  `;
}

/**
 * Format time from ISO string
 */
function formatTime(isoString) {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes}`;
}

/**
 * Get the date range for the current calendar view
 */
export function getCalendarDateRange() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // Start from first day that might be visible (could be from prev month)
  const firstDay = new Date(year, month, 1);
  const startingDay = firstDay.getDay();
  const start = new Date(year, month, 1 - startingDay);
  
  // End on last day that might be visible (could be from next month)
  const end = new Date(year, month + 1, 14); // Safe buffer
  
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}
