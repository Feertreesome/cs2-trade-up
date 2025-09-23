import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.{ts,tsx}", "**/*.ts", "**/*.tsx"],
    ignores: ["node_modules/**", "**/dist/**"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
      },
    },
    rules: {},
  },
];
