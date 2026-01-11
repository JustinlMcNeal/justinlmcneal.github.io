import { buildSlide, startCountdown } from './dom.js';
import { initBannerScroll } from './engine.js';

export function renderHomeBanner(promos) {
  // Normalize input to array
  const rawData = Array.isArray(promos) ? promos : (promos ? [promos] : []);
  
  // If empty, add a default null so we render welcome slide
  if (rawData.length === 0) rawData.push(null);

  // If we have >1 items, we need infinite loop clones
  let data = rawData;
  let isLooping = false;
  let cloneCount = 0;
  
  if(rawData.length > 1) {
     isLooping = true;
     // Minimum 2 clones per side. If rawData is small (2 items), we repeat it.
     const clonesRequired = 2;
     cloneCount = clonesRequired;
     
     // Create left clones (tail of array)
     let leftClones = [];
     for(let i=0; i<clonesRequired; i++) {
         leftClones.unshift(rawData[(rawData.length - 1 - i + rawData.length * 10) % rawData.length]);
     }
     
     // Create right clones (head of array)
     let rightClones = [];
     for(let i=0; i<clonesRequired; i++) {
         rightClones.push(rawData[i % rawData.length]);
     }
     
     data = [...leftClones, ...rawData, ...rightClones];
  }
  
  const track = document.getElementById("promoSliderTrack");
  const dotsContainer = document.getElementById("promoSliderDots");
  
  if (!track || !dotsContainer) return;

  // Render Slides
  track.style.width = ""; 
  track.innerHTML = data.map((p, i) => buildSlide(p, i)).join("");

  // Start Countdowns
  data.forEach((p, i) => {
     if(p && p.end_date) {
        startCountdown(p.end_date, document.getElementById(`timer-${i}`), document.getElementById(`timer-val-${i}`));
     }
  });

  // Render Dots (Only for REAL items)
  if (rawData.length > 1) {
    dotsContainer.innerHTML = rawData.map((_, i) => `
      <button class="w-3 h-3 rounded-full bg-white/50 hover:bg-white transition-all slider-dot shadow-md backdrop-blur-sm" data-idx="${i}" aria-label="Go to slide ${i+1}"></button>
    `).join("");
  } else {
    dotsContainer.innerHTML = "";
  }

  // Initialize Scroll Engine
  initBannerScroll(track, dotsContainer, rawData.length, cloneCount);
}
