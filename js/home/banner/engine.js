import { highlightSlide, updateDots } from './dom.js';

export function initBannerScroll(track, dotsContainer, rawDataLength, cloneCount) {
  let isLooping = rawDataLength > 1;
  let currentSlide = 0;
  let isTeleporting = false;
  let skipAnimationUntil = 0;  // Timestamp until which animations should be skipped
  let scrollDebounce = null;
  let autoPlayTimer = null;
  
  // Total slides in DOM (including clones)
  const totalSlides = rawDataLength + (isLooping ? cloneCount * 2 : 0);

  // --- Core Logic ---

  const calculateActiveIndex = () => {
    const center = track.scrollLeft + (track.offsetWidth / 2);
    let bestIdx = 0;
    let minDiff = Infinity;
    
    // Find centered slide
    Array.from(track.children).forEach((child, idx) => {
       const childCenter = child.offsetLeft + (child.offsetWidth / 2);
       const diff = Math.abs(childCenter - center);
       if(diff < minDiff) {
          minDiff = diff;
          bestIdx = idx;
       }
    });
    return bestIdx;
  };

  const updateVisuals = () => {
    if(isTeleporting) return;

    const bestIdx = calculateActiveIndex();
    
    // 1. Update Slide Scales/Blur - skip animation if we recently teleported
    const shouldSkipAnimation = Date.now() < skipAnimationUntil;
    highlightSlide(track, bestIdx, shouldSkipAnimation);

    // 2. Update Dots
    let realIndex = bestIdx;
    if (isLooping) {
        realIndex = bestIdx - cloneCount;
        // Normalize
        realIndex = realIndex % rawDataLength; 
        if (realIndex < 0) realIndex += rawDataLength;
    }
    
    updateDots(dotsContainer, realIndex);
    currentSlide = realIndex;
    
    return bestIdx;
  };

  const handleTeleport = (targetIdx, sourceIdx) => {
      isTeleporting = true;
      
      // Skip animations for the next 800ms to prevent double animation after teleport
      skipAnimationUntil = Date.now() + 800;
      
      // Disable snapping and transitions during jump
      track.classList.remove("snap-x", "snap-mandatory");
      track.classList.add("no-transition");

      const target = track.children[targetIdx];
      const source = track.children[sourceIdx];
      
      // Pre-apply the active state to target
      if (target) {
          target.classList.remove('scale-95', 'opacity-50', 'blur-[2px]', 'brightness-75');
          target.classList.add('scale-100', 'opacity-100', 'blur-0', 'brightness-100', 'z-10', 'shadow-2xl', 'active');
      }
      
      // Remove active from source (clone)
      if (source) {
          source.classList.remove('scale-100', 'opacity-100', 'blur-0', 'brightness-100', 'z-10', 'shadow-2xl', 'active');
          source.classList.add('scale-95', 'opacity-50', 'blur-[2px]', 'brightness-75');
      }
      
      const relativeOffset = track.scrollLeft - source.offsetLeft;
      track.scrollTo({ left: target.offsetLeft + relativeOffset, behavior: "auto" });
      
      // Force reflow
      void track.offsetHeight;
      
      // Apply visual state to all slides
      highlightSlide(track, targetIdx, true);
      
      // Re-enable snapping quickly, but keep transitions disabled longer
      setTimeout(() => {
          track.classList.add("snap-x", "snap-mandatory");
          isTeleporting = false;
      }, 50);
      
      // Re-enable transitions after everything settles
      setTimeout(() => {
          track.classList.remove("no-transition");
      }, 400);
  };

  const handleScrollStop = () => {
    if(!isLooping || isTeleporting) return;

    const bestIdx = updateVisuals();
    
    // Teleport logic on REST
    // Left Clones: Indices 0 to cloneCount-1
    if (bestIdx < cloneCount) {
        // Jump to Real Tail
        handleTeleport(bestIdx + rawDataLength, bestIdx);
    } 
    // Right Clones: Indices totalSlides-cloneCount to totalSlides-1
    else if (bestIdx >= totalSlides - cloneCount) {
        // Jump to Real Head
        handleTeleport(bestIdx - rawDataLength, bestIdx);
    }
  };

  const onScroll = () => {
     window.requestAnimationFrame(updateVisuals);
     
     // Debounce the "Stop" check
     if(scrollDebounce) clearTimeout(scrollDebounce);
     scrollDebounce = setTimeout(handleScrollStop, 60);
  };

  const scrollToSlide = (realIdx) => {
     // If looping, realIdx 0 -> DOM Index cloneCount
     const domIdx = isLooping ? realIdx + cloneCount : realIdx;
     
     const child = track.children[domIdx];
     if(!child) return;
     
     const trackCenter = track.offsetWidth / 2;
     const childCenter = child.offsetWidth / 2;
     const scrollLeft = child.offsetLeft - trackCenter + childCenter;
     
     track.scrollTo({ left: scrollLeft, behavior: 'smooth' });
  };

  const playNext = () => {
     let targetDom = (isLooping ? currentSlide + cloneCount : currentSlide) + 1;
     
     // Loop safety
     if (targetDom >= track.children.length) targetDom = 0;

     const child = track.children[targetDom];
     if(!child) return;

     const childCenter = child.offsetWidth / 2;
     const trackCenter = track.offsetWidth / 2;
     track.scrollTo({ 
        left: child.offsetLeft - trackCenter + childCenter, 
        behavior: 'smooth' 
     });
  };

  const resetTimer = () => {
    if (autoPlayTimer) clearInterval(autoPlayTimer);
    if (rawDataLength > 1) {
       autoPlayTimer = setInterval(playNext, 7000); 
    }
  };

  // --- Initialization ---

  // 1. Jump to start
  if (isLooping) {
     const initialReal = track.children[cloneCount];
     requestAnimationFrame(() => {
        if(initialReal) {
            const centerOffset = (initialReal.offsetLeft + initialReal.offsetWidth/2) - (track.offsetWidth/2);
            track.scrollTo({ left: centerOffset, behavior: 'auto' });
        }
        updateVisuals();
     });
  } else {
      updateVisuals(); 
  }

  // 2. Listeners
  track.addEventListener("scroll", onScroll, { passive: true });
  
  // Dots
  if(dotsContainer) {
      dotsContainer.addEventListener("click", (e) => {
         if(e.target.dataset.idx) {
            const i = Number(e.target.dataset.idx);
            scrollToSlide(i);
            resetTimer();
         }
      });
  }

  // Touch / Hover timers
  track.addEventListener("touchstart", () => {
      if(autoPlayTimer) clearInterval(autoPlayTimer);
  }, {passive:true});
  
  track.addEventListener("touchend", () => {
      resetTimer();
  }, {passive:true});

  track.addEventListener("mouseenter", () => {
    if (autoPlayTimer) clearInterval(autoPlayTimer);
  });
  
  track.addEventListener("mouseleave", () => {
    resetTimer();
  });

  // Start timer
  resetTimer();
}
