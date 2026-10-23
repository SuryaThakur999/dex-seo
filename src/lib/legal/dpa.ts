import { OPERATOR as O } from './operator';
import { processorTable } from './processors';
import type { LegalDocPair } from './types';

// Art. 28 GDPR processing agreement, structure adapted from General-Legal/legal-templates
// "dpa-global" (CC0) and cut down to the clauses Art. 28(3) requires.
export const DPA: LegalDocPair = {
  de: {
    title: 'Auftragsverarbeitungsvertrag (AVV)',
    intro: 'Dieser Vertrag nach Art. 28 DSGVO gilt zwischen Ihnen als geschäftlichem Nutzer (Verantwortlicher) und uns (Auftragsverarbeiter), soweit Dex für Sie personenbezogene Daten verarbeitet. Er wird mit Annahme unserer AGB Teil des Vertrags.',
    sections: [
      {
        heading: '1. Gegenstand, Dauer, Art und Zweck',
        blocks: [
          'Gegenstand ist die Prüfung Ihrer Website, das Erstellen und Prüfen von Verbesserungsentwürfen, die Protokollierung Ihrer Entscheidungen und, falls verbunden, die Auswertung Ihrer Google-Search-Console-Daten. Die Verarbeitung dauert so lange wie der Hauptvertrag.',
        ],
      },
      {
        heading: '2. Art der Daten und Betroffene',
        blocks: [
          { list: ['Daten: Inhalte Ihrer öffentlichen Seiten (z. B. Namen, Funktionen, Kontaktangaben auf Team- oder Kontaktseiten), Suchdaten aus Search Console, Kontodaten Ihrer Teammitglieder', 'Betroffene: Ihre Beschäftigten und Teammitglieder, auf Ihrer Website genannte Personen, Ihre Kunden und Interessenten, soweit sie in Suchdaten erkennbar sind'] },
        ],
      },
      {
        heading: '3. Unsere Pflichten',
        blocks: [
          {
            list: [
              'Wir verarbeiten Daten nur auf Ihre dokumentierte Weisung, also im Rahmen der Funktionen von Dex und Ihrer Einstellungen.',
              'Personen mit Zugriff sind zur Vertraulichkeit verpflichtet.',
              'Wir treffen die technischen und organisatorischen Maßnahmen, die auf unserer Seite „Sicherheit“ beschrieben sind (Art. 32 DSGVO).',
              'Wir unterstützen Sie bei Anfragen betroffener Personen und bei Ihren Pflichten nach Art. 32 bis 36 DSGVO.',
              'Verletzungen des Schutzes personenbezogener Daten melden wir Ihnen unverzüglich, spätestens innerhalb von 48 Stunden nach Kenntnis.',
              'Nach Vertragsende löschen wir Ihre Daten innerhalb von 30 Tagen oder geben sie auf Wunsch vorher heraus, soweit keine Aufbewahrungspflicht besteht.',
              'Wir stellen Ihnen alle Informationen zum Nachweis dieser Pflichten zur Verfügung und ermöglichen Überprüfungen nach vorheriger Abstimmung.',
            ],
          },
        ],
      },
      {
        heading: '4. Unterauftragsverarbeiter',
        blocks: [
          'Sie stimmen dem Einsatz dieser Unterauftragsverarbeiter zu:',
          processorTable('de'),
          'Neue Unterauftragsverarbeiter kündigen wir mindestens 30 Tage vorher an. Sie können aus wichtigem datenschutzrechtlichem Grund widersprechen; dann können beide Seiten den Vertrag kündigen. Übermittlungen in Drittländer stützen wir auf den EU-US Data Privacy Framework oder die Standardvertragsklauseln der EU-Kommission.',
        ],
      },
      { heading: '5. Kontakt', blocks: [`Fragen zu diesem Vertrag: ${O.email}. Betreiber und Anschrift stehen im Impressum. Eine unterschriebene Fassung erhalten Sie auf Anfrage.`] },
    ],
  },
  en: {
    title: 'Data processing agreement (DPA)',
    intro: 'This agreement under Art. 28 GDPR applies between you as a business user (controller) and us (processor) wherever Dex processes personal data for you. It becomes part of the contract when you accept our terms.',
    sections: [
      { heading: '1. Subject, duration, nature and purpose', blocks: ['The subject is checking your website, writing and checking draft improvements, recording your decisions and, if connected, analysing your Google Search Console data. Processing lasts as long as the main contract.'] },
      {
        heading: '2. Types of data and data subjects',
        blocks: [{ list: ['Data: content of your public pages (e.g. names, roles and contact details on team or contact pages), Search Console data, account data of your team members', 'Data subjects: your staff and team members, people named on your website, your customers and prospects where identifiable in search data'] }],
      },
      {
        heading: '3. Our obligations',
        blocks: [
          {
            list: [
              'We process data only on your documented instructions, meaning within the functions of Dex and your settings.',
              'Everyone with access is bound to confidentiality.',
              'We apply the technical and organisational measures described on our Security page (Art. 32 GDPR).',
              'We help you with data subject requests and your obligations under Art. 32 to 36 GDPR.',
              'We notify you of personal data breaches without undue delay, at the latest within 48 hours of becoming aware.',
              'When the contract ends we delete your data within 30 days, or hand it over first if you ask, unless a retention duty applies.',
              'We give you all information needed to demonstrate these obligations and allow audits by prior arrangement.',
            ],
          },
        ],
      },
      {
        heading: '4. Sub-processors',
        blocks: [
          'You agree to the use of these sub-processors:',
          processorTable('en'),
          'We announce new sub-processors at least 30 days in advance. You may object on reasonable data protection grounds, in which case either side may terminate. Transfers to third countries rely on the EU-US Data Privacy Framework or the European Commission’s standard contractual clauses.',
        ],
      },
      { heading: '5. Contact', blocks: [`Questions about this agreement: ${O.email}. The operator and postal address are in the legal notice. A signed copy is available on request.`] },
    ],
  },
};
