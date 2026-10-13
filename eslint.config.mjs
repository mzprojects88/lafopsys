import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

/**
 * The same rules eslint-config-next's core-web-vitals + typescript presets turned on, composed
 * here from the plugins themselves. eslint-config-next is not installed: its Next plugin pins
 * fast-glob -> micromatch -> braces, an advisory with no fixed release, and the user's rule is
 * that nothing reaches Jesse's repo with an npm audit finding (2026-10-13). What's lost is only
 * Next's own handful of rules (<img> vs <Image>, <Head> usage, sync scripts).
 */
const eslintConfig = defineConfig([
  { settings: { react: { version: "detect" } } },
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    plugins: { "jsx-a11y": jsxA11y },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "no-unused-vars": "off",
      // `import * as React` is kept in files that only use JSX, as the Next preset allowed.
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^React$" }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"]),
]);

export default eslintConfig;
