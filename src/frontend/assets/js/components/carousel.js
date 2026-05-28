import { Carousel } from "flowbite";
import { applyCarouselSmoothness } from "./animation";


/**
 * Initializes the carousel for the login page with custom timing.
 * The first slide has a longer duration than the others.
 */
export function initLoginCarousel() {
  const $carouselEl = document.getElementById("login-carousel");
  const $items = document.querySelectorAll("[data-carousel-item]");

  if (!$carouselEl || !$items.length) return;

  // Apply smooth transitions
  applyCarouselSmoothness();


  // Map elements to Flowbite item format
  const items = Array.from($items).map((el, index) => ({
    position: index,
    el: el
  }));

  const options = {
    defaultPosition: 0,
    interval: 3500, // Default interval
    // We handle the cycling manually to allow variable intervals
    onChange: (index) => {
      startCustomCycle(index);
    }
  };

  let cycleTimeout;
  const carousel = new Carousel($carouselEl, items, options);



  /**
   * Starts a custom cycle with variable timing
   * @param {number} index Current slide index
   */
  function startCustomCycle(index) {
    if (cycleTimeout) clearTimeout(cycleTimeout);

    // first.jpg (index 0) stays longer (e.g., 6 seconds)
    // others stay for 3.5 seconds
    const duration = index === 0 ? 6000 : 3500;

    cycleTimeout = setTimeout(() => {
      carousel.next();
    }, duration);
  }

  // Initial start
  startCustomCycle(0);
}
