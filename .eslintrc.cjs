/* Общая конфигурация для client и server */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "jsdoc"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:jsdoc/recommended"
  ],
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  env: { es2022: true, node: true, browser: true },
  rules: {
    // Стиль функций
    "func-style": ["error", "expression", { allowArrowFunctions: true }],
    "prefer-arrow-callback": ["error", { allowNamedFunctions: false }],
    "arrow-body-style": ["error", "as-needed"],
    // Именование
    "id-length": ["error", { min: 2, exceptions: ["i", "j", "k", "_"] }],
    // Современный JS
    "no-var": "error",
    "prefer-const": "error",
    "object-shorthand": ["error", "always"],
    // TS-строгость
    "@typescript-eslint/explicit-module-boundary-types": "warn",
    "@typescript-eslint/consistent-type-imports": "error",
    // Обязательные JSDoc у экспортируемых функций
    "jsdoc/require-returns": "off",
    "jsdoc/require-param-type": "off",
    "jsdoc/require-returns-type": "off",
    "jsdoc/require-jsdoc": [
      "warn",
      {
        contexts: [
          "TSInterfaceDeclaration",
          "TSTypeAliasDeclaration",
          "ExportNamedDeclaration > FunctionDeclaration",
          "ExportNamedDeclaration > TSDeclareFunction",
          "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type='ArrowFunctionExpression']",
          "Program > VariableDeclaration > VariableDeclarator[init.type='ArrowFunctionExpression'][id.type='Identifier'][parent.declare!=true]"
        ],
        require: {
          ArrowFunctionExpression: true,
          FunctionDeclaration: true,
          MethodDefinition: true,
          ClassDeclaration: false
        }
      }
    ]
  },
  settings: { jsdoc: { mode: "typescript" } },
  overrides: [
    // клиент
    { files: ["client/**"], env: { browser: true, node: false } },
    // сервер
    { files: ["server/**"], env: { node: true, browser: false } }
  ]
};
