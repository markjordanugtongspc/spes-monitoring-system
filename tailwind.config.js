import flowbite from "flowbite/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/frontend/**/*.js",
    "./node_modules/flowbite/**/*.js"
  ],
  theme: {
    extend: {}
  },
  plugins: [flowbite]
};
