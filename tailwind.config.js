/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#F5F5F7",
        ink: "#1A1A1A",
        accent: { DEFAULT: "#CB11AB", dark: "#9E0D87" },
        sage: { DEFAULT: "#00A046", dark: "#00863A" },
        stone: { DEFAULT: "#767676", dark: "#4A4A4A" },
        line: "#E5E5E5",
        cart: { DEFAULT: "#CB11AB", dark: "#9E0D87" },
      },
    },
  },
  plugins: [],
};
