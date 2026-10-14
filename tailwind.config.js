// "Terminal brutalism" theme shared with OneSwap. Components keep their Tailwind classes;
// the neutral palette is remapped onto CSS tokens (src/index.css) so light/dark switch in one place.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        white: token("surface"),
        gray: {
          50: token("sub"),
          100: token("hover"),
          200: token("line2"),
          300: token("line3"),
          400: token("faint"),
          500: token("muted"),
          600: token("muted"),
          700: token("ink2"),
          800: token("ink2"),
          900: token("ink"),
        },
      },
      fontFamily: {
        sans: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // Square corners everywhere except true circles (rounded-full)
      borderRadius: {
        sm: "0px", DEFAULT: "0px", md: "0px", lg: "0px", xl: "0px", "2xl": "0px", "3xl": "0px",
      },
    },
  },
  plugins: [],
};
