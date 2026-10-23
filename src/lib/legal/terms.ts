import { OPERATOR as O } from './operator';
import type { LegalDocPair } from './types';

// Name and postal address appear only in the Impressum; the terms refer to it.
const addr = (country: string) =>
  country === O.country.de
    ? `Dex (Betreiber und Anschrift: siehe Impressum), E-Mail: ${O.email}`
    : `Dex (operator and postal address: see the legal notice), email: ${O.email}`;

// Structure adapted from General-Legal/legal-templates "terms-of-use" (CC0), rewritten for German
// law, for both businesses and consumers. The withdrawal notice follows the statutory model
// (Anlage 1 zu Art. 246a § 1 Abs. 2 EGBGB). Have it checked by a lawyer before paid plans launch.
export const TERMS: LegalDocPair = {
  de: {
    title: 'Allgemeine Geschäftsbedingungen',
    sections: [
      { heading: '1. Geltungsbereich und Anbieter', blocks: [`Diese Bedingungen gelten für die Nutzung von Dex. Anbieter ist ${addr(O.country.de)}. Dex richtet sich an Unternehmen und Verbraucher. Abweichende Bedingungen von Nutzern gelten nur, wenn wir ihnen ausdrücklich zustimmen.`, { link: { label: 'Zum Impressum', href: '/impressum?lang=de' } }] },
      {
        heading: '2. Was Dex leistet',
        blocks: [
          'Dex liest die öffentlichen Seiten Ihrer Website, findet Probleme bei Suchmaschinen- und KI-Sichtbarkeit, schreibt Entwürfe für Verbesserungen und prüft diese, bevor Sie sie sehen. Sie entscheiden, was übernommen wird. Dex veröffentlicht nichts selbst und hat keinen Zugang zu Ihrem Content-Management-System.',
          'Dex befindet sich in einer frühen Phase. Funktionen können sich ändern, wir informieren Sie über wesentliche Änderungen.',
        ],
      },
      { heading: '3. Vertragsschluss und Konto', blocks: ['Der Vertrag kommt zustande, wenn Sie ein Konto anlegen. Sie müssen mindestens 18 Jahre alt sein. Halten Sie Ihre Zugangsdaten geheim und informieren Sie uns bei Verdacht auf Missbrauch.'] },
      { heading: '4. Preise', blocks: ['Dex ist derzeit kostenlos. Kostenpflichtige Tarife führen wir nur mit vorheriger Ankündigung ein. Kosten entstehen Ihnen erst, wenn Sie einem kostenpflichtigen Tarif ausdrücklich zustimmen.'] },
      {
        heading: '5. Ihre Pflichten',
        blocks: [
          {
            list: [
              'Lassen Sie Dex nur Websites prüfen, die Ihnen gehören oder für die Sie berechtigt sind.',
              'Geben Sie als Wettbewerber nur öffentlich erreichbare Websites an.',
              'Nutzen Sie Dex nicht, um Systeme anzugreifen, zu überlasten oder Schutzmaßnahmen zu umgehen.',
              'Prüfen Sie jeden Entwurf, bevor Sie ihn veröffentlichen. Für Inhalte, die Sie veröffentlichen, sind Sie selbst verantwortlich.',
            ],
          },
        ],
      },
      {
        heading: '6. KI-Entwürfe',
        blocks: ['Entwürfe werden von einem KI-Modell erstellt und als KI-generiert gekennzeichnet. Sie sind Vorschläge und können Fehler enthalten. Dex prüft sie auf bekannte Risiken, ersetzt aber nicht Ihre eigene Prüfung, etwa auf Wettbewerbs-, Marken- oder Urheberrecht.'],
      },
      { heading: '7. Keine Erfolgsgarantie', blocks: ['Suchmaschinen und KI-Dienste entscheiden selbst über Platzierungen. Wir schulden kein bestimmtes Ranking, keine bestimmte Besucherzahl und keinen bestimmten Umsatz.'] },
      { heading: '8. Verfügbarkeit', blocks: ['Wir bemühen uns um einen störungsfreien Betrieb, können aber keine ununterbrochene Verfügbarkeit zusagen. Wartungen kündigen wir nach Möglichkeit vorher an.'] },
      { heading: '9. Rechte an Inhalten', blocks: ['Ihre Inhalte bleiben Ihre Inhalte. Entwürfe, die Dex für Sie erstellt, dürfen Sie frei nutzen. Rechte an der Software Dex verbleiben beim Anbieter.'] },
      {
        heading: '10. Haftung',
        blocks: [
          'Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit, nach dem Produkthaftungsgesetz und soweit wir eine Garantie übernommen haben.',
          'Bei leichter Fahrlässigkeit haften wir nur für die Verletzung wesentlicher Vertragspflichten, also solcher, deren Erfüllung die Nutzung von Dex erst ermöglicht und auf die Sie vertrauen dürfen. In diesem Fall ist die Haftung auf den vorhersehbaren, typischen Schaden begrenzt. Im Übrigen ist die Haftung bei leichter Fahrlässigkeit ausgeschlossen.',
          'Solange Dex kostenlos ist, haften wir nur für Vorsatz und grobe Fahrlässigkeit, soweit gesetzlich zulässig. Die unbeschränkte Haftung nach Absatz 1 bleibt unberührt.',
        ],
      },
      { heading: '11. Laufzeit und Kündigung', blocks: [`Sie können Ihr Konto jederzeit ohne Frist kündigen, eine E-Mail an ${O.email} genügt. Wir können kostenlose Konten mit einer Frist von 30 Tagen kündigen. Das Recht zur fristlosen Kündigung aus wichtigem Grund, etwa bei Missbrauch, bleibt unberührt.`] },
      {
        heading: '12. Widerrufsbelehrung für Verbraucher',
        blocks: [
          'Widerrufsrecht',
          'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsschlusses.',
          `Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${addr(O.country.de)}) mittels einer eindeutigen Erklärung (z. B. eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das unten stehende Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist. Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.`,
          'Folgen des Widerrufs',
          'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet. Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.',
          'Muster-Widerrufsformular',
          `(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.) An ${addr(O.country.de)}: Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung (*): Nutzung von Dex. Bestellt am (*) / erhalten am (*). Name des/der Verbraucher(s). Anschrift des/der Verbraucher(s). Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier). Datum. (*) Unzutreffendes streichen.`,
        ],
      },
      { heading: '13. Änderungen dieser Bedingungen', blocks: ['Wir können diese Bedingungen ändern, wenn sich Dex oder die Rechtslage ändert. Wir informieren Sie mindestens sechs Wochen vorher per E-Mail. Widersprechen Sie nicht bis zum Inkrafttreten, gelten die neuen Bedingungen; darauf weisen wir Sie in der Mitteilung hin. Bei Widerspruch können beide Seiten den Vertrag kündigen.'] },
      {
        heading: '14. Recht und Gerichtsstand',
        blocks: [
          'Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Für Verbraucher gilt diese Rechtswahl nur, soweit ihnen dadurch nicht der Schutz zwingender Vorschriften des Staates ihres gewöhnlichen Aufenthalts entzogen wird.',
          'Ist der Nutzer Kaufmann, juristische Person des öffentlichen Rechts oder öffentlich-rechtliches Sondervermögen, ist Gerichtsstand Leipzig.',
          'Sollte eine Bestimmung unwirksam sein, bleiben die übrigen Bestimmungen wirksam.',
        ],
      },
    ],
  },
  en: {
    title: 'Terms of use',
    sections: [
      { heading: '1. Scope and provider', blocks: [`These terms govern the use of Dex. The provider is ${addr(O.country.en)}. Dex is offered to businesses and consumers. A user's own terms apply only if we expressly agree to them.`, { link: { label: 'Open the legal notice', href: '/impressum?lang=en' } }] },
      {
        heading: '2. What Dex does',
        blocks: [
          'Dex reads the public pages of your website, finds problems with search and AI visibility, writes draft improvements and checks them before you see them. You decide what gets used. Dex publishes nothing itself and has no access to your content management system.',
          'Dex is at an early stage. Features may change; we tell you about significant changes.',
        ],
      },
      { heading: '3. Contract and account', blocks: ['The contract is concluded when you create an account. You must be at least 18. Keep your sign-in details secret and tell us if you suspect misuse.'] },
      { heading: '4. Prices', blocks: ['Dex is currently free. We introduce paid plans only with advance notice. You pay nothing until you expressly agree to a paid plan.'] },
      {
        heading: '5. Your obligations',
        blocks: [
          {
            list: [
              'Only let Dex check websites you own or are authorised to check.',
              'Only name publicly reachable websites as competitors.',
              'Do not use Dex to attack or overload systems or to get around security measures.',
              'Review every draft before you publish it. You are responsible for content you publish.',
            ],
          },
        ],
      },
      { heading: '6. AI drafts', blocks: ['Drafts are written by an AI model and labelled as AI-generated. They are suggestions and may contain errors. Dex checks them for known risks, but this does not replace your own review, for example for competition, trademark or copyright law.'] },
      { heading: '7. No guaranteed results', blocks: ['Search engines and AI services decide rankings themselves. We do not owe any particular ranking, number of visitors or revenue.'] },
      { heading: '8. Availability', blocks: ['We aim for smooth operation but cannot promise uninterrupted availability. Where possible we announce maintenance in advance.'] },
      { heading: '9. Rights to content', blocks: ['Your content remains yours. You may use drafts Dex creates for you freely. Rights in the Dex software remain with the provider.'] },
      {
        heading: '10. Liability',
        blocks: [
          'We are liable without limitation for intent and gross negligence, for injury to life, body or health, under the German Product Liability Act, and where we have given a guarantee.',
          'For slight negligence we are liable only for breach of essential contractual obligations, meaning obligations whose fulfilment makes using Dex possible in the first place and on which you may rely. In that case liability is limited to foreseeable, typical damage. Otherwise liability for slight negligence is excluded.',
          'While Dex is free, we are liable only for intent and gross negligence, as far as the law permits. Unlimited liability under the first paragraph is unaffected.',
        ],
      },
      { heading: '11. Term and termination', blocks: [`You can close your account at any time without notice; an email to ${O.email} is enough. We can terminate free accounts with 30 days' notice. Either side may terminate without notice for good cause, such as misuse.`] },
      {
        heading: '12. Right of withdrawal for consumers',
        blocks: [
          'Right of withdrawal',
          'You have the right to withdraw from this contract within fourteen days without giving any reason. The withdrawal period is fourteen days from the day the contract is concluded.',
          `To exercise your right of withdrawal, you must inform us (${addr(O.country.en)}) of your decision to withdraw from this contract by a clear statement (for example, an email). You may use the model withdrawal form below, but it is not obligatory. To meet the withdrawal deadline, it is sufficient for you to send your notice before the withdrawal period expires.`,
          'Effects of withdrawal',
          'If you withdraw from this contract, we shall reimburse all payments received from you without undue delay and at the latest within fourteen days from the day we are informed of your decision to withdraw. We will use the same means of payment you used for the original transaction, unless you have expressly agreed otherwise; in any event, you will not incur any fees as a result. If you requested that the services begin during the withdrawal period, you shall pay us an amount proportionate to what has been provided until you informed us of your withdrawal, compared with the full coverage of the contract.',
          'Model withdrawal form',
          `(Complete and return this form only if you wish to withdraw from the contract.) To ${addr(O.country.en)}: I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract for the provision of the following service: use of Dex. Ordered on (*) / received on (*). Name of consumer(s). Address of consumer(s). Signature of consumer(s) (only if this form is notified on paper). Date. (*) Delete as appropriate.`,
        ],
      },
      { heading: '13. Changes to these terms', blocks: ['We may change these terms if Dex or the law changes. We tell you by email at least six weeks in advance. If you do not object before the changes take effect, the new terms apply; we will point this out in the notice. If you object, either side may terminate the contract.'] },
      {
        heading: '14. Governing law and jurisdiction',
        blocks: [
          'German law applies, excluding the UN Convention on Contracts for the International Sale of Goods. For consumers, this choice of law applies only insofar as it does not deprive them of the protection of mandatory provisions of the country where they habitually reside.',
          'If the user is a merchant, a legal entity under public law or a special fund under public law, the place of jurisdiction is Leipzig, Germany.',
          'If any provision is invalid, the remaining provisions remain valid.',
        ],
      },
    ],
  },
};
