import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    ignores: ["src/lib/**/*", "src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
      // Catches the exact pattern that caused the production Hub TDZ:
      // a useEffect referencing a `const` declared later in the same
      // function body. JavaScript hoists function declarations but NOT
      // `const`/`let`, so accessing them before their line throws
      // ReferenceError. In dev mode some patterns mask this; in prod
      // minified everything fails.
      //
      // CURRENT LEVEL: 'warn' (visible in `npm run lint` output but
      // doesn't block CI). The codebase has ~41 pre-existing instances
      // — most are safe-in-practice (the use sits inside a JSX callback
      // that only fires after render completes), but they're all
      // latent bugs of the same class waiting for a refactor to put
      // them in a synchronous evaluation path.
      //
      // GOAL: upgrade to 'error' once those 41 are cleaned up. The
      // mechanical fix is to move the `const X = ...` declaration
      // above its first use. Each occurrence takes ~30 seconds to fix
      // and lint will tell you the exact line.
      "no-use-before-define": [
        "warn",
        {
          functions: false,    // function declarations DO hoist; OK to use earlier
          classes: true,
          variables: true,     // const/let do NOT hoist — this is the bug class we caught
          allowNamedExports: true,
        },
      ],
      // Catches free/undeclared identifiers — e.g. a sub-component using
      // `tFallback` that was never passed down, or `userProfile` read in a
      // helper that doesn't receive it. These build + render fine until the
      // code path runs, then throw "Can't find variable: X" at runtime and
      // trip the section ErrorBoundary (the DailyQuestsCard/Duels/RestTimer/
      // LeagueStandings crashes). recommended ships this as an error, but
      // the explicit rules block above overwrote it — re-enabled so
      // `npm run lint` blocks the whole class before it can deploy.
      "no-undef": "error",
    },
  },
  // Test files use Vitest globals (describe/it/expect/vi/beforeEach/…) and
  // occasional Node globals (global, process). Declare them so no-undef
  // doesn't flag them as undeclared.
  {
    files: ["**/*.test.{js,mjs,cjs,jsx}", "**/__tests__/**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.vitest,
        ...globals.node,
      },
    },
  },
];
