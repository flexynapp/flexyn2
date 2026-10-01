import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  getTrophy, parseLeadTrophy, trophyName, trophyDescription, TROPHY_BY_ID,
} from '@/lib/trophyDefinitions';

// A translator that ignores the English fallback and interpolates the key's
// own template, so a dropped var shows up as a literal {placeholder}.
function localeT(lang) {
  const dict = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../locales/${lang}.json`), 'utf8'));
  return (key, _en, vars = {}) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

describe('Lead Lifter trophies', () => {
  it('parses the ids the migration writes', () => {
    const lvl = parseLeadTrophy('league_lead_gold_3_2026w40');
    expect(lvl).toMatchObject({ kind: 'gold', leadLevel: 3, year: 2026, week: 40, leagueTier: 'gold', isLeadLifter: true });
    const league = parseLeadTrophy('league_lead_legend_2026w02');
    expect(league).toMatchObject({ kind: 'legend', leadLevel: null, week: 2 });
    expect(getTrophy('league_lead_silver_1_2026w41')?.isLeadLifter).toBe(true);
  });

  it('rejects anything else', () => {
    for (const id of ['league_lead_gold_5_2026w40', 'league_lead_champion_2026w40', 'league_s3_gold', 'league_lead_gold_2026w4']) {
      expect(parseLeadTrophy(id)).toBeNull();
    }
    expect(TROPHY_BY_ID['league_lead_gold_2026w40']).toBeUndefined();
  });

  it('names read like the notification in every released locale', () => {
    const lvl = parseLeadTrophy('league_lead_gold_3_2026w40');
    const league = parseLeadTrophy('league_lead_gold_2026w40');
    expect(trophyName(lvl)).toBe('Gold III Lead Lifter, Week 40');
    expect(trophyName(league)).toBe('Gold Lead Lifter, Week 40');
    expect(trophyName(lvl, localeT('en'))).toBe('Gold III Lead Lifter, Week 40');
    expect(trophyName(lvl, localeT('es'))).toBe('Atleta líder de Oro III, semana 40');
    expect(trophyName(league, localeT('es'))).toBe('Atleta líder de la Liga Oro, semana 40');
    expect(trophyName(lvl, localeT('fr'))).toBe('Athlète de tête en Or III, semaine 40');
    for (const lang of ['en', 'es', 'fr']) {
      for (const t of [lvl, league]) {
        expect(trophyName(t, localeT(lang))).not.toMatch(/[{}]/);
        expect(trophyDescription(t, localeT(lang))).not.toMatch(/[{}]/);
      }
    }
  });

  it('matches the migration, which is the only writer', () => {
    const dir = path.resolve(__dirname, '../../../supabase/migrations');
    const file = fs.readdirSync(dir).find((f) => f.endsWith('_league_lead_lifter_trophies.sql'));
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    expect(sql).toContain("'league_lead_' || v_win.tier");
    expect(sql).toContain("'Gold III Lead Lifter, Week 40'");
    expect(sql).toContain("'Atleta líder de Oro III, semana 40'");
  });

  it('starts with the first full November week (Kegan, 2026-09-30)', () => {
    const dir = path.resolve(__dirname, '../../../supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    // The newest migration that redefines the award is the one production runs.
    const latest = files
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .filter((sql) => sql.includes('FUNCTION public.award_league_lead_trophies_internal(p_week_start date)'))
      .pop();
    expect(latest).toContain("c_first_week CONSTANT date := DATE '2026-11-02'");
    expect(latest).toContain('p_week_start < c_first_week THEN RETURN 0');
  });
});

describe('Lead Lifter artwork', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: Icon } = await import('@/components/leagues/LeadLifterTrophyIcon');

  it('counts the level in pips and gives the league trophy none', () => {
    for (const level of [1, 2, 3, 4]) {
      const html = renderToStaticMarkup(React.createElement(Icon, { tier: 'gold', level }));
      expect(html.match(/data-pip/g)?.length).toBe(level);
    }
    const whole = renderToStaticMarkup(React.createElement(Icon, { tier: 'gold', level: null }));
    expect(whole).not.toContain('data-pip');
  });

  it('draws every league in its own crest colour, never gold as a fallback', () => {
    const colours = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend']
      .map((tier) => renderToStaticMarkup(React.createElement(Icon, { tier, level: 1 })));
    expect(new Set(colours).size).toBe(6);
  });
});
