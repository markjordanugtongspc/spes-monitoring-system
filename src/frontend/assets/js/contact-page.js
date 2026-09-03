import "../styles/tailwind.css";
import "./components/flow-debugger.js";
import "./components/analytics.js";
import "flowbite";
import { initLandingActiveNavHighlight } from "./components/animations";
import { initThemeToggle } from "./components/theme-toggle";
import { initAutoYear } from "./components/year";

initThemeToggle();
initLandingActiveNavHighlight();
initAutoYear();
