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
      // The plugin was registered but this, its other half, never was —
      // so for as long as the project has existed every
      // `eslint-disable-line react-hooks/exhaustive-deps` in the codebase
      // has been suppressing a rule that wasn't running. 34 of them had
      // accumulated, all reported by ESLint as "unused directive", which
      // reads like dead comments and is a standing invitation to delete
      // them. 26 were doing real work the moment this line exists.
      //
      // A dependency array that lies is how a component ends up rendering
      // last render's data: the effect closes over a stale value and
      // never re-runs to see the new one. It is the same shape of defect
      // as the TDZ bug below — invisible until a specific interleaving
      // hits it, and then inexplicable.
      //
      // CURRENT LEVEL: 'warn'. 65 pre-existing violations sit in files
      // carrying no directive at all; they are not audited and this line
      // is what makes them visible. `npm run lint` runs --quiet, so
      // warnings don't block — same posture as no-use-before-define
      // below, and for the same reason.
      //
      // GOAL: 'error', once those 65 are triaged. Each is either a
      // genuine missing dep (add it) or a deliberate omission (a
      // disable-line WITH a comment saying why — the omission is the
      // interesting part, not the suppression).
      "react-hooks/exhaustive-deps": "warn",
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
  // src/lib — added 2026-08-06, having gone unlinted since the project
  // started.
  //
  // The block above covers only src/components, src/pages and Layout.jsx,
  // and lists src/lib in its `ignores` on top of that. So every data
  // module, every context provider, every helper and every i18n part file
  // was unchecked: no-undef, unused imports, hook rules, all of it. That
  // is most of the app's logic, and `npm run lint` exiting clean said
  // nothing whatsoever about it.
  //
  // Same rules as the component block. Two are load-bearing here in
  // particular: `no-undef` is the one that catches a helper reading an
  // identifier nobody passed it (it builds and renders fine, then throws
  // at runtime when the path is finally taken), and the react-hooks pair
  // matters because src/lib holds the context providers — AuthContext,
  // LanguageContext, RestTimerContext and the rest — which are React,
  // whatever the directory name suggests.
  {
    files: ["src/lib/**/*.{js,mjs,cjs,jsx}"],
    // Generated by scripts/split-i18n.mjs at build time and gitignored.
    // ESLint does not read .gitignore, so it has to be named here or the
    // lint run spends its time on 15 machine-written aggregates.
    ignores: ["src/lib/i18n-langs/**"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: "detect" } },
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
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-use-before-define": [
        "warn",
        {
          functions: false,
          classes: true,
          variables: true,
          allowNamedExports: true,
        },
      ],
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
