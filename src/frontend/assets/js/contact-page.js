import "../styles/tailwind.css";
import "flowbite";
import { initLandingActiveNavHighlight } from "./components/animations";
import { initThemeToggle } from "./components/theme-toggle";
import { initAutoYear } from "./components/year";

initThemeToggle();
initLandingActiveNavHighlight();
initAutoYear();
