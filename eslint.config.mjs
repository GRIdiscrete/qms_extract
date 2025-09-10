// eslint.config.mjs (or eslint.config.js if your package.json has "type":"module")
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// ✅ bring in the plugins you want to override
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  // Next.js presets
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Ignores
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },

  // ⬇️ Global overrides (must redeclare plugins here to override their rules)
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "prefer-const": "off",
      // Optional: quiet the warning you saw
      // "react-hooks/exhaustive-deps": "warn", // or "off"
    },
  },
];
