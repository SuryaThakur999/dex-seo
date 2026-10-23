import { OPERATOR as O } from './operator';
import { processorTable } from './processors';
import type { LegalDocPair } from './types';

// Only claims the code backs today (checked 2026-10-19): Supabase in eu-central-1, AES-256-GCM
// for Google tokens (src/lib/crypto.ts), robots.txt disallow rules (src/lib/crawler.ts), the
// SSRF-safe fetcher with tests (src/lib/safe-fetch.ts), Clerk sign-in, the decision log. No
// certifications are claimed because none exist yet.
export const SECURITY: LegalDocPair = {
  de: {
    title: 'Sicherheit',
    intro: 'So schützt Dex Ihre Daten. Wir beschreiben nur, was heute wirklich umgesetzt ist.',
    sections: [
      {
        heading: 'Daten und Verschlüsselung',
        blocks: [{ list: ['Ihre Daten liegen in einer Datenbank in Frankfurt am Main.', 'Alle Verbindungen sind per HTTPS (TLS) verschlüsselt.', 'Die Datenbank wird vom Anbieter verschlüsselt gespeichert.', 'Zugangsschlüssel für Google Search Console verschlüsseln wir zusätzlich mit AES-256-GCM, bevor sie gespeichert werden.'] }],
      },
      {
        heading: 'Zugriff auf Ihre Website',
        blocks: [{ list: ['Dex liest nur öffentlich erreichbare Seiten. Es hat keinen Zugang zu Ihrem Content-Management-System und ändert nichts auf Ihrer Website.', 'Dex beachtet die Sperrregeln Ihrer robots.txt.', 'Nichts wird ohne Ihre Freigabe übernommen. Jede Entscheidung wird mit Zeitpunkt protokolliert.'] }],
      },
      {
        heading: 'Schutz vor Missbrauch',
        blocks: [{ list: ['Bevor Dex eine Adresse abruft, prüft es das Ziel und blockiert interne Adressen wie localhost, private Netze und Cloud-Metadaten-Adressen. Weiterleitungen werden bei jedem Schritt erneut geprüft. Automatisierte Tests sichern das ab.', 'Die Anmeldung läuft über Clerk. Dex selbst speichert keine Passwörter.', 'Hintergrundaufgaben akzeptieren nur signierte Aufrufe.'] }],
      },
      { heading: 'Dienstleister', blocks: [processorTable('de')] },
      { heading: 'KI', blocks: ['Dex trainiert keine KI-Modelle mit Ihren Daten. An das KI-Modell geht nur der Seitentext, der für einen Entwurf nötig ist.'] },
      { heading: 'Sicherheitslücke melden', blocks: [`Wenn Sie eine Schwachstelle finden, schreiben Sie bitte an ${O.email}. Wir antworten so schnell wie möglich und gehen nicht rechtlich gegen Meldungen in gutem Glauben vor.`] },
    ],
  },
  en: {
    title: 'Security',
    intro: 'How Dex protects your data. We describe only what is in place today.',
    sections: [
      {
        heading: 'Data and encryption',
        blocks: [{ list: ['Your data is stored in a database in Frankfurt, Germany.', 'Every connection is encrypted with HTTPS (TLS).', 'The database is stored encrypted by its provider.', 'Google Search Console access keys are additionally encrypted with AES-256-GCM before they are stored.'] }],
      },
      {
        heading: 'Access to your website',
        blocks: [{ list: ['Dex only reads publicly reachable pages. It has no access to your content management system and changes nothing on your website.', 'Dex follows the disallow rules in your robots.txt.', 'Nothing is used without your approval. Every decision is recorded with its time.'] }],
      },
      {
        heading: 'Protection against misuse',
        blocks: [{ list: ['Before Dex fetches an address, it checks the target and blocks internal addresses such as localhost, private networks and cloud metadata addresses. Redirects are checked again at every step. Automated tests cover this.', 'Sign-in runs through Clerk. Dex itself stores no passwords.', 'Background jobs only accept signed requests.'] }],
      },
      { heading: 'Service providers', blocks: [processorTable('en')] },
      { heading: 'AI', blocks: ['Dex does not train AI models on your data. Only the page text needed for a draft is sent to the AI model.'] },
      { heading: 'Reporting a vulnerability', blocks: [`If you find a vulnerability, please write to ${O.email}. We reply as fast as we can and take no legal action against reports made in good faith.`] },
    ],
  },
};
