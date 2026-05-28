import "../styles/tailwind.css";
import "flowbite";
import { initLandingActiveNavHighlight } from "./components/animation";
import { initThemeToggle } from "./components/theme-toggle";
import { initAutoYear } from "./components/year";

initThemeToggle();
initLandingActiveNavHighlight();
initAutoYear();
