import js from '@eslint/js';

export default [
  {
    ignores: ['node_modules', 'dist', 'build'],
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ignores: [
      'src/lib/data/**',           // The data layer is the seam — it's allowed to call db.
      'src/api/db.js',             // The client itself.
      'src/lib/AuthContext.jsx',   // Auth bootstrapping needs the raw client.
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-restricted-syntax': [
        'warn',
        {
          selector: "MemberExpression[object.name='db'][property.name='entities']",
          message:
            "❌ Direct db.entities access is not allowed outside the data layer.\n" +
            "   Use src/lib/data/* instead. See BACKEND_CONTRACT.md.\n" +
            "   Example: import { workouts } from '@/lib/data'; workouts.list(email)",
        },
        {
          selector: "MemberExpression[object.name='db'][property.name='auth']",
          message:
            "❌ Direct db.auth access is not allowed outside the data layer.\n" +
            "   Use src/lib/data/me.js instead.\n" +
            "   Example: import { me } from '@/lib/data'; me.update({...})",
        },
        {
          selector: "MemberExpression[object.name='db'][property.name='functions']",
          message:
            "❌ Direct db.functions access is not allowed outside the data layer.\n" +
            "   Use src/lib/data/serverFunctions.js instead.",
        },
      ],
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: '@/api/db',
              message:
                "❌ Don't import the db client outside src/lib/data/. " +
                "All data access must go through src/lib/data/*. See BACKEND_CONTRACT.md.",
            },
          ],
        },
      ],
    },
  },
];