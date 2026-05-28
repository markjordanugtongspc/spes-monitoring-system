import "../styles/tailwind.css";
import "flowbite";
import { initThemeToggle } from "./components/theme-toggle";
import {
  initDropdownAutoClose,
  initGuidedAnchorEffects,
  initLandingActiveNavHighlight,
  initLandingHeroAnimation,
  initStickyCardHoverAnimation
} from "./components/animations";
import { initScopedTextPlaceholders } from "./components/content-placeholders";
import { initLandingVideoPlayer } from "./components/video-player";
import { initProgramOverviewCards } from "./components/program-overview-cards";
import { initAutoYear } from "./components/year";

initThemeToggle();
initLandingVideoPlayer();
initLandingHeroAnimation();
initLandingActiveNavHighlight();
initStickyCardHoverAnimation();
initGuidedAnchorEffects();
initProgramOverviewCards();
initScopedTextPlaceholders();
initAutoYear();
initDropdownAutoClose();
