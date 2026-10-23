import { OPERATOR as O } from './operator';
import type { LegalDocPair } from './types';

const address = (country: string) => [O.name, O.street, `${O.postcode} ${O.city}`, country];

export const IMPRESSUM: LegalDocPair = {
  de: {
    title: 'Impressum',
    sections: [
      { heading: 'Angaben gemäß § 5 DDG', blocks: [`${O.brand} ist ein Angebot von:`, { list: address(O.country.de) }] },
      { heading: 'Kontakt', blocks: [`E-Mail: ${O.email}`] },
      {
        heading: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV',
        blocks: [{ list: address(O.country.de) }],
      },
      {
        heading: 'Verbraucherstreitbeilegung',
        blocks: [
          'Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.',
        ],
      },
      {
        heading: 'Haftung für Inhalte und Links',
        blocks: [
          'Wir erstellen die Inhalte dieser Website mit Sorgfalt. Für Inhalte externer Websites, auf die wir verlinken, sind allein deren Betreiber verantwortlich. Wenn uns ein Rechtsverstoß bekannt wird, entfernen wir den betreffenden Inhalt oder Link umgehend.',
        ],
      },
    ],
  },
  en: {
    title: 'Legal notice',
    sections: [
      { heading: 'Information under § 5 DDG (German Digital Services Act)', blocks: [`${O.brand} is provided by:`, { list: address(O.country.en) }] },
      { heading: 'Contact', blocks: [`Email: ${O.email}`] },
      { heading: 'Responsible for content under § 18(2) MStV', blocks: [{ list: address(O.country.en) }] },
      {
        heading: 'Consumer dispute resolution',
        blocks: ['We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.'],
      },
      {
        heading: 'Liability for content and links',
        blocks: [
          'We create the content of this website with care. The operators of external websites we link to are solely responsible for their content. If we learn of a legal violation, we remove the content or link concerned without delay.',
        ],
      },
    ],
  },
};
