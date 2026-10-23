import { OPERATOR as O } from './operator';
import type { LegalDocPair } from './types';

export const COOKIES: LegalDocPair = {
  de: {
    title: 'Cookies',
    intro: 'Dex setzt nur die Cookies, die für die Anmeldung technisch notwendig sind. Wir nutzen keine Analyse-, Werbe- oder Tracking-Cookies. Deshalb sehen Sie bei uns keinen Cookie-Banner.',
    sections: [
      {
        heading: 'Welche Cookies wir verwenden',
        blocks: [
          { table: { head: ['Cookie', 'Anbieter', 'Zweck', 'Dauer'], rows: [['Anmelde-Cookies (z. B. __session, __client_uat)', 'Clerk Inc.', 'Hält Sie angemeldet und schützt Ihr Konto', 'Bis zur Abmeldung bzw. Ablauf der Sitzung']] } },
          'Rechtsgrundlage ist § 25 Abs. 2 Nr. 2 TDDDG (unbedingt erforderlich) und Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung). Eine Einwilligung ist dafür nicht nötig.',
        ],
      },
      {
        heading: 'Lokaler Speicher im Browser',
        blocks: ['Einige Einstellungen, etwa das gewählte Farbschema, speichern wir nur in Ihrem Browser (Local Storage). Diese Daten verlassen Ihr Gerät nicht.'],
      },
      {
        heading: 'Cookies löschen',
        blocks: [`Sie können Cookies jederzeit in Ihrem Browser löschen. Danach müssen Sie sich neu anmelden. Fragen: ${O.email}.`],
      },
    ],
  },
  en: {
    title: 'Cookies',
    intro: "Dex only sets the cookies that sign-in strictly needs. We use no analytics, advertising or tracking cookies. That's why you won't see a cookie banner here.",
    sections: [
      {
        heading: 'Cookies we use',
        blocks: [
          { table: { head: ['Cookie', 'Provider', 'Purpose', 'Duration'], rows: [['Sign-in cookies (e.g. __session, __client_uat)', 'Clerk Inc.', 'Keeps you signed in and protects your account', 'Until you sign out or the session ends']] } },
          'The legal basis is § 25(2) no. 2 TDDDG (strictly necessary) and Art. 6(1)(b) GDPR (performance of the contract). No consent is needed for these.',
        ],
      },
      {
        heading: 'Local storage in your browser',
        blocks: ['A few settings, such as your colour theme, are kept only in your browser (local storage). This data never leaves your device.'],
      },
      {
        heading: 'Deleting cookies',
        blocks: [`You can delete cookies in your browser at any time; you will then need to sign in again. Questions: ${O.email}.`],
      },
    ],
  },
};
