/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FAF7F2",
        ink: "#2B2A28",
        accent: { DEFAULT: "#C77B4A", dark: "#A9603A" },
        sage: { DEFAULT: "#8B9A8C", dark: "#5F7361" },
        stone: { DEFAULT: "#8A8478", dark: "#5C574C" },
        line: "#E8E1D4",
        cart: { DEFAULT: "#CB11AB", dark: "#A20E8A" },
      },
    },
  },
  plugins: [],
};
