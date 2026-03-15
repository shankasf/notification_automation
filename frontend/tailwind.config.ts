import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#EBF2FE",
          100: "#D6E4FD",
          200: "#ADC9FB",
          300: "#85AEF9",
          400: "#5C93F7",
          500: "#0668E1",
          600: "#0553B4",
          700: "#043E87",
          800: "#032A5A",
          900: "#01152D",
        },
        meta: {
          blue: "#0668E1",
          darkBlue: "#0553B4",
          gray: {
            50: "#F5F6F7",
            100: "#EBEDF0",
            200: "#DADDE1",
            300: "#BEC3C9",
            400: "#8D949E",
            500: "#606770",
            600: "#444950",
            700: "#373E4A",
            800: "#242A30",
            900: "#1C2028",
          },
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
