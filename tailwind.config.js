import flowbite from "flowbite/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/frontend/login/",
    "./src/frontend/pages/**/*.html",
    "./src/frontend/components/**/*.html",
    "./src/frontend/**/*.js",
    "./node_modules/flowbite/**/*.js"
  ],
  theme: {
    extend: {
      fontFamily: {
        montserrat: ["Montserrat", "ui-sans-serif", "system-ui", "sans-serif"],
        poppins: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        "spes-blue": "#0038A8",
        "spes-red": "#CE1126",
        "spes-yellow": "#FCD116",
        "spes-black": "#000000",
        "spes-white": "#FFFFFF",
        "spes-dark-blue": "#001B52",
        "spes-dark-primary": "#243447",
        "spes-dark-secondary": "#141D26"
      }
    }
  },
  plugins: [flowbite]
};
