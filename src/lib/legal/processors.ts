import type { Lang } from './types';

// Every outside service that touches customer data, as the code uses them on 2026-10-19.
// Update this list (and tell customers) before adding a new one. Sources: package.json, the
// production environment variable names, and docs/adr/0006 (Groq as the AI provider).
type Processor = { name: string; purpose: Record<Lang, string>; location: Record<Lang, string> };

export const PROCESSORS: Processor[] = [
  {
    name: 'Supabase Inc.',
    purpose: { de: 'Datenbank (alle Kontodaten, Scans, Entwürfe, Entscheidungen)', en: 'Database (all account data, scans, drafts, decisions)' },
    location: { de: 'Speicherort Frankfurt am Main, Deutschland (AWS eu-central-1)', en: 'Stored in Frankfurt, Germany (AWS eu-central-1)' },
  },
  {
    name: 'Vercel Inc.',
    purpose: { de: 'Hosting der Website und Anwendung, Server-Logs', en: 'Website and app hosting, server logs' },
    location: { de: 'USA', en: 'USA' },
  },
  {
    name: 'Clerk Inc.',
    purpose: { de: 'Anmeldung und Kontoverwaltung (E-Mail, Name, Passwort)', en: 'Sign-in and account management (email, name, password)' },
    location: { de: 'USA', en: 'USA' },
  },
  {
    name: 'Groq Inc.',
    purpose: { de: 'KI-Modell, das Entwürfe aus öffentlichen Seiteninhalten erstellt', en: 'AI model that writes drafts from public page content' },
    location: { de: 'USA', en: 'USA' },
  },
  {
    name: 'Upstash Inc. (QStash)',
    purpose: { de: 'Steuerung von Hintergrundaufgaben (nur technische Kennungen)', en: 'Background job scheduling (technical IDs only)' },
    location: { de: 'USA', en: 'USA' },
  },
  {
    name: 'Google Ireland Ltd. / Google LLC',
    purpose: { de: 'Nur wenn Sie Google Search Console verbinden: Abruf Ihrer Suchdaten', en: 'Only if you connect Google Search Console: reading your search data' },
    location: { de: 'Irland / USA', en: 'Ireland / USA' },
  },
];

export function processorTable(lang: Lang) {
  return {
    table: {
      head: lang === 'de' ? ['Anbieter', 'Zweck', 'Ort'] : ['Provider', 'Purpose', 'Location'],
      rows: PROCESSORS.map((p) => [p.name, p.purpose[lang], p.location[lang]]),
    },
  };
}
