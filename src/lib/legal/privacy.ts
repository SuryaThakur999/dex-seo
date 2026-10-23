import { OPERATOR as O } from './operator';
import { processorTable } from './processors';
import type { LegalDocPair } from './types';

// Structure adapted from General-Legal/legal-templates "privacy-policy-gdpr" (CC0), rewritten
// for a German operator and for what Dex actually processes. Every processing activity named
// here exists in the code; nothing is listed "just in case".
export const PRIVACY: LegalDocPair = {
  de: {
    title: 'Datenschutzerklärung',
    intro: 'Hier erklären wir, welche personenbezogenen Daten Dex verarbeitet, warum, auf welcher Rechtsgrundlage und welche Rechte Sie haben. Kurz gesagt: Wir verarbeiten nur, was Dex zum Arbeiten braucht, speichern Ihre Daten in Frankfurt und nutzen keine Werbe- oder Analyse-Tracker.',
    sections: [
      { heading: '1. Verantwortlicher', blocks: ['Verantwortlich für Dex ist der im Impressum genannte Betreiber. Dort finden Sie Name und Anschrift.', { link: { label: 'Zum Impressum', href: '/impressum?lang=de' } }, `E-Mail: ${O.email}`, 'Einen Datenschutzbeauftragten müssen wir nicht benennen. Wenden Sie sich bei allen Fragen direkt an uns.'] },
      {
        heading: '2. Besuch unserer Website',
        blocks: [
          'Wenn Sie unsere Website aufrufen, verarbeitet unser Hosting-Anbieter Vercel technisch notwendige Daten: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Browser und Betriebssystem. Das ist nötig, um die Seite auszuliefern und vor Missbrauch zu schützen.',
          'Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren, funktionierenden Angebot). Diese Protokolle werden nur so lange gespeichert, wie es für Sicherheit und Fehlersuche nötig ist.',
        ],
      },
      {
        heading: '3. Ihr Konto',
        blocks: [
          'Für die Anmeldung nutzen wir Clerk. Dabei verarbeiten wir Ihre E-Mail-Adresse, Ihren Namen und Ihr Passwort. Das Passwort sieht und speichert Dex selbst nie.',
          'Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Vertrag über die Nutzung von Dex).',
        ],
      },
      {
        heading: '4. Ihre Website und was Dex daraus macht',
        blocks: [
          'Dex speichert die Adresse Ihrer Website und liest deren öffentlich erreichbare Seiten. Dabei beachtet Dex die Sperrregeln Ihrer robots.txt. Aus den Seiten entstehen Befunde, Entwürfe für Verbesserungen und ein Protokoll Ihrer Entscheidungen. Dex hat keinen Zugang zu Ihrem Content-Management-System und ändert nichts auf Ihrer Website.',
          'Öffentliche Seiten können personenbezogene Daten enthalten, zum Beispiel Namen auf einer Team-Seite. Für Geschäftskunden verarbeiten wir solche Daten als Auftragsverarbeiter nach unserem Auftragsverarbeitungsvertrag.',
          'Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.',
        ],
      },
      {
        heading: '5. Wettbewerber-Beobachtung',
        blocks: [
          'Wenn Sie Wettbewerber angeben, liest Dex deren öffentliche Seiten, um Veränderungen zu erkennen. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (Ihr Interesse an Marktbeobachtung; es werden nur öffentlich zugängliche Inhalte gelesen).',
        ],
      },
      {
        heading: '6. Google Search Console (freiwillig)',
        blocks: [
          'Nur wenn Sie es selbst verbinden, ruft Dex Ihre Suchdaten aus Google Search Console ab, etwa Klicks und Suchbegriffe Ihrer Seiten. Die Zugangsschlüssel von Google speichern wir zusätzlich verschlüsselt (AES-256-GCM). Sie können die Verbindung jederzeit in Ihrem Google-Konto widerrufen.',
          'Rechtsgrundlage: Art. 6 Abs. 1 lit. a und b DSGVO.',
        ],
      },
      {
        heading: '7. Künstliche Intelligenz',
        blocks: [
          'Um Entwürfe zu schreiben, sendet Dex den nötigen Text Ihrer öffentlichen Seiten an ein KI-Modell bei Groq. Jeder Entwurf ist als KI-generiert gekennzeichnet und wird erst nach Ihrer Freigabe verwendet. Dex trifft keine automatisierten Entscheidungen mit rechtlicher Wirkung für Sie (Art. 22 DSGVO). Dex trainiert keine KI-Modelle mit Ihren Daten.',
        ],
      },
      {
        heading: '8. Cookies',
        blocks: ['Wir setzen nur technisch notwendige Anmelde-Cookies und nutzen keine Analyse- oder Werbe-Tracker. Details stehen auf unserer Seite „Cookies“.'],
      },
      {
        heading: '9. Empfänger und Dienstleister',
        blocks: [
          'Wir setzen diese Dienstleister ein. Alle verarbeiten Daten nur in unserem Auftrag und nach unseren Weisungen (Art. 28 DSGVO):',
          processorTable('de'),
          'Ihre Datenbank liegt in Frankfurt. Einige Dienstleister haben ihren Sitz in den USA. Übermittlungen dorthin stützen wir auf den EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist, und sonst auf die Standardvertragsklauseln der EU-Kommission (Art. 46 DSGVO). Eine Kopie der Garantien erhalten Sie auf Anfrage.',
          'Wir verkaufen keine Daten und geben sie nicht für Werbung weiter.',
        ],
      },
      {
        heading: '10. Speicherdauer',
        blocks: [
          'Wir speichern Ihre Daten, solange Ihr Konto besteht. Wenn Sie die Löschung Ihres Kontos verlangen, löschen wir Ihre Daten innerhalb von 30 Tagen, soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen. Daten, die wir aufbewahren müssen, sperren wir für jede andere Nutzung.',
        ],
      },
      {
        heading: '11. Ihre Rechte',
        blocks: [
          { list: ['Auskunft (Art. 15 DSGVO)', 'Berichtigung (Art. 16 DSGVO)', 'Löschung (Art. 17 DSGVO)', 'Einschränkung der Verarbeitung (Art. 18 DSGVO)', 'Datenübertragbarkeit (Art. 20 DSGVO)', 'Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21 DSGVO)', 'Widerruf einer Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO)'] },
          `Schreiben Sie dazu einfach an ${O.email}.`,
          `Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren. Für uns zuständig ist: ${O.authority.name}, ${O.authority.url}.`,
        ],
      },
      {
        heading: '12. Pflicht zur Bereitstellung',
        blocks: ['Ohne E-Mail-Adresse und die Adresse Ihrer Website kann Dex nicht arbeiten. Alle weiteren Angaben, etwa die Search-Console-Verbindung, sind freiwillig.'],
      },
      {
        heading: '13. Änderungen',
        blocks: ['Wenn sich Dex ändert, passen wir diese Erklärung an. Über wesentliche Änderungen informieren wir angemeldete Nutzer vorab.'],
      },
    ],
  },
  en: {
    title: 'Privacy policy',
    intro: 'This page explains what personal data Dex processes, why, on what legal basis, and what rights you have. In short: we process only what Dex needs to work, store your data in Frankfurt, and use no advertising or analytics trackers.',
    sections: [
      { heading: '1. Controller', blocks: ['The controller for Dex is the operator named in our legal notice (Impressum), which lists the name and postal address.', { link: { label: 'Open the legal notice', href: '/impressum?lang=en' } }, `Email: ${O.email}`, 'We are not required to appoint a data protection officer. Please contact us directly with any question.'] },
      {
        heading: '2. Visiting our website',
        blocks: [
          'When you open our website, our hosting provider Vercel processes technically necessary data: IP address, date and time, the page requested, browser and operating system. This is needed to deliver the page and protect it from abuse.',
          'Legal basis: Art. 6(1)(f) GDPR (legitimate interest in a secure, working service). These logs are kept only as long as security and troubleshooting require.',
        ],
      },
      {
        heading: '3. Your account',
        blocks: [
          'We use Clerk for sign-in. This involves your email address, your name and your password. Dex itself never sees or stores your password.',
          'Legal basis: Art. 6(1)(b) GDPR (the contract for using Dex).',
        ],
      },
      {
        heading: '4. Your website and what Dex does with it',
        blocks: [
          "Dex stores your website's address and reads its publicly reachable pages, following the disallow rules in your robots.txt. From those pages it produces findings, drafted improvements and a record of your decisions. Dex has no access to your content management system and changes nothing on your website.",
          'Public pages can contain personal data, such as names on a team page. For business customers we process such data as a processor under our data processing agreement.',
          'Legal basis: Art. 6(1)(b) GDPR.',
        ],
      },
      {
        heading: '5. Competitor monitoring',
        blocks: ["If you name competitors, Dex reads their public pages to spot changes. Legal basis: Art. 6(1)(f) GDPR (your interest in watching your market; only publicly available content is read)."],
      },
      {
        heading: '6. Google Search Console (optional)',
        blocks: [
          'Only if you connect it yourself, Dex reads your Google Search Console data, such as clicks and search terms for your pages. We store the Google access keys with additional encryption (AES-256-GCM). You can revoke the connection in your Google account at any time.',
          'Legal basis: Art. 6(1)(a) and (b) GDPR.',
        ],
      },
      {
        heading: '7. Artificial intelligence',
        blocks: ['To write drafts, Dex sends the necessary text from your public pages to an AI model hosted by Groq. Every draft is labelled as AI-generated and is used only after you approve it. Dex makes no automated decisions with legal effect on you (Art. 22 GDPR). Dex does not train AI models on your data.'],
      },
      { heading: '8. Cookies', blocks: ['We set only strictly necessary sign-in cookies and use no analytics or advertising trackers. Details are on our Cookies page.'] },
      {
        heading: '9. Recipients and service providers',
        blocks: [
          'We use these service providers. All of them process data only on our behalf and on our instructions (Art. 28 GDPR):',
          processorTable('en'),
          'Your database is in Frankfurt. Some providers are based in the USA. We base transfers there on the EU-US Data Privacy Framework where the provider is certified, and otherwise on the European Commission’s standard contractual clauses (Art. 46 GDPR). You can request a copy of the safeguards.',
          'We do not sell data or share it for advertising.',
        ],
      },
      {
        heading: '10. How long we keep data',
        blocks: ['We keep your data for as long as your account exists. If you ask us to delete your account, we delete your data within 30 days unless a legal retention duty applies. Data we must keep is blocked from any other use.'],
      },
      {
        heading: '11. Your rights',
        blocks: [
          { list: ['Access (Art. 15 GDPR)', 'Rectification (Art. 16 GDPR)', 'Erasure (Art. 17 GDPR)', 'Restriction of processing (Art. 18 GDPR)', 'Data portability (Art. 20 GDPR)', 'Objection to processing based on legitimate interests (Art. 21 GDPR)', 'Withdrawal of consent with effect for the future (Art. 7(3) GDPR)'] },
          `Just write to ${O.email}.`,
          `You can also complain to a data protection supervisory authority. The authority responsible for us is: ${O.authority.name}, ${O.authority.url}.`,
        ],
      },
      { heading: '12. Do you have to provide data?', blocks: ["Dex can't work without your email address and your website's address. Everything else, such as the Search Console connection, is optional."] },
      { heading: '13. Changes', blocks: ['When Dex changes, we update this policy. We tell signed-in users about significant changes in advance.'] },
    ],
  },
};
