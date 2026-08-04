/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		fontFamily: {
  			heading: ['var(--font-heading)'],
  			body: ['var(--font-body)']
  		},
  		// ── Type ramp ────────────────────────────────────────────────
  		// Six named steps, defined once WITH their line-height and
  		// tracking so vertical rhythm can't drift per call-site. See the
  		// long note in src/index.css for why the floor is 11px.
  		//
  		// These are ADDITIVE — Tailwind's numeric scale (text-xs … text-4xl)
  		// still exists and is still correct for one-off display sizes.
  		// What they replace is the 95 arbitrary `text-[Npx]` values that
  		// had accumulated on the dashboard.
  		//
  		// Naming note: none of these six collide with a color token, so
  		// `text-title` can never be ambiguous with a `text-<color>` utility.
  		fontSize: {
  			display: ['var(--text-display)', { lineHeight: '1.05', letterSpacing: '-0.021em' }],
  			title: ['var(--text-title)', { lineHeight: '1.2', letterSpacing: '-0.011em' }],
  			body: ['var(--text-body)', { lineHeight: '1.45' }],
  			label: ['var(--text-label)', { lineHeight: '1.35' }],
  			caption: ['var(--text-caption)', { lineHeight: '1.3' }],
  			// Tracking opens up as size drops — tight spacing is what makes
  			// small grotesque text turn to mud.
  			micro: ['var(--text-micro)', { lineHeight: '1.25', letterSpacing: '0.017em' }]
  		},
  		// ── Radius rhythm ────────────────────────────────────────────
  		// THREE steps plus `full`, all derived from --radius so they move
  		// together. The dashboard was running six radii (full 47, lg 26,
  		// md 18, xl 15, 2xl 12, sm 3) against a single --radius token that
  		// had stopped meaning anything.
  		//
  		//   sm   inner chrome — icon tiles, chips, small controls
  		//   lg   the default surface — cards, buttons, inputs
  		//   2xl  large surfaces — hero, sheets, modals
  		//   full pills, avatars, rings. Nothing else.
  		//
  		// `xl` is pinned to var(--radius) — identical to `lg`. Tailwind's
  		// default xl is already 0.75rem, the same value --radius holds, so
  		// the app had two names for one radius and no way to tell which
  		// was intended. Aliasing rather than deleting keeps the ~15
  		// existing rounded-xl call-sites on other pages working while
  		// removing the drift. `md` is kept for the same reason.
  		borderRadius: {
  			lg: 'var(--radius)',
  			xl: 'var(--radius)',
  			'2xl': 'calc(var(--radius) + 4px)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			// The other two thirds of the semantic budget. See the long
  			// note in src/index.css — these exist so `text-emerald-500`
  			// and the blue/sky/cyan trio have somewhere principled to go
  			// instead of being hardcoded per card.
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))'
  			},
  			info: {
  				DEFAULT: 'hsl(var(--info))',
  				foreground: 'hsl(var(--info-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: { height: '0' },
  				to: { height: 'var(--radix-accordion-content-height)' }
  			},
  			'accordion-up': {
  				from: { height: 'var(--radix-accordion-content-height)' },
  				to: { height: '0' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
