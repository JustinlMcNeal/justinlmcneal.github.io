// /js/success/index.js
import { initNavbar } from "/js/shared/navbar.js";
import { initFooter } from "/js/shared/footer.js";
import { clearCart } from "/js/shared/cartStore.js";

/* ── Confetti ── */
function spawnConfetti() {
  const container = document.getElementById("confettiContainer");
  if (!container) return;

  const colors = ["#f58f86", "#f6dcc6", "#FFD700", "#FF69B4", "#87CEEB", "#98FB98"];
  const count = 40;

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 1.5}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    piece.style.width = `${6 + Math.random() * 8}px`;
    piece.style.height = `${6 + Math.random() * 8}px`;
    container.appendChild(piece);
  }

  // Clean up after animations finish
  setTimeout(() => container.innerHTML = "", 5000);
}

/* ── Order ID from URL ── */
function showOrderId() {
  const params = new URLSearchParams(window.location.search);
  const oid = params.get("oid");
  if (oid) {
    const el = document.getElementById("orderId");
    const wrap = document.getElementById("orderIdWrap");
    if (el) el.textContent = oid;
    if (wrap) wrap.classList.remove("hidden");
  }
}

/* ── Boot ── */
document.addEventListener("DOMContentLoaded", async () => {
  // Clear the cart — order is confirmed
  clearCart();

  await initNavbar();
  showOrderId();
  spawnConfetti();
  await initFooter();
});
