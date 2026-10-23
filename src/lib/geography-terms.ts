// S4 fix: the markets profile-suggestion field must hold countries/regions, never industries
// ("freight software", "fintech SaaS"). Model instructions alone aren't deterministic, so this
// is a real allowlist check: ISO 3166-1 country names/codes plus common multi-country regions.
const COUNTRY_NAMES = [
  'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'antigua and barbuda', 'argentina',
  'armenia', 'australia', 'austria', 'azerbaijan', 'bahamas', 'bahrain', 'bangladesh', 'barbados',
  'belarus', 'belgium', 'belize', 'benin', 'bhutan', 'bolivia', 'bosnia and herzegovina',
  'botswana', 'brazil', 'brunei', 'bulgaria', 'burkina faso', 'burundi', 'cabo verde', 'cambodia',
  'cameroon', 'canada', 'central african republic', 'chad', 'chile', 'china', 'colombia',
  'comoros', 'congo', 'democratic republic of the congo', 'costa rica', 'croatia', 'cuba',
  'cyprus', 'czechia', 'czech republic', 'denmark', 'djibouti', 'dominica', 'dominican republic',
  'ecuador', 'egypt', 'el salvador', 'equatorial guinea', 'eritrea', 'estonia', 'eswatini',
  'ethiopia', 'fiji', 'finland', 'france', 'gabon', 'gambia', 'georgia', 'germany', 'ghana',
  'greece', 'grenada', 'guatemala', 'guinea', 'guinea-bissau', 'guyana', 'haiti', 'honduras',
  'hungary', 'iceland', 'india', 'indonesia', 'iran', 'iraq', 'ireland', 'israel', 'italy',
  'ivory coast', "cote d'ivoire", 'jamaica', 'japan', 'jordan', 'kazakhstan', 'kenya', 'kiribati',
  'kosovo', 'kuwait', 'kyrgyzstan', 'laos', 'latvia', 'lebanon', 'lesotho', 'liberia', 'libya',
  'liechtenstein', 'lithuania', 'luxembourg', 'madagascar', 'malawi', 'malaysia', 'maldives',
  'mali', 'malta', 'marshall islands', 'mauritania', 'mauritius', 'mexico', 'micronesia',
  'moldova', 'monaco', 'mongolia', 'montenegro', 'morocco', 'mozambique', 'myanmar', 'namibia',
  'nauru', 'nepal', 'netherlands', 'holland', 'new zealand', 'nicaragua', 'niger', 'nigeria',
  'north korea', 'north macedonia', 'norway', 'oman', 'pakistan', 'palau', 'palestine', 'panama',
  'papua new guinea', 'paraguay', 'peru', 'philippines', 'poland', 'portugal', 'qatar', 'romania',
  'russia', 'rwanda', 'saint kitts and nevis', 'saint lucia',
  'saint vincent and the grenadines', 'samoa', 'san marino', 'sao tome and principe',
  'saudi arabia', 'senegal', 'serbia', 'seychelles', 'sierra leone', 'singapore', 'slovakia',
  'slovenia', 'solomon islands', 'somalia', 'south africa', 'south korea', 'korea', 'south sudan',
  'spain', 'sri lanka', 'sudan', 'suriname', 'sweden', 'switzerland', 'syria', 'taiwan',
  'tajikistan', 'tanzania', 'thailand', 'timor-leste', 'togo', 'tonga', 'trinidad and tobago',
  'tunisia', 'turkey', 'turkmenistan', 'tuvalu', 'uganda', 'ukraine', 'united arab emirates',
  'uae', 'united kingdom', 'uk', 'united states', 'united states of america', 'usa', 'us',
  'uruguay', 'uzbekistan', 'vanuatu', 'vatican city', 'holy see', 'venezuela', 'vietnam', 'yemen',
  'zambia', 'zimbabwe',
];

const REGION_TERMS = [
  'dach', 'dach region', 'eu', 'european union', 'europe', 'eurozone', 'north america',
  'south america', 'latin america', 'central america', 'caribbean', 'asia', 'asia-pacific',
  'apac', 'middle east', 'africa', 'oceania', 'global', 'worldwide', 'nordics', 'scandinavia',
  'benelux', 'gcc',
];

// ISO 3166-1 alpha-2 codes, lowercased. Separate from country names since fixtures and real
// extractor output both use bare codes ("DE", "AT", "CH") as often as full names.
const ISO_ALPHA2_CODES = new Set([
  'ad', 'ae', 'af', 'ag', 'ai', 'al', 'am', 'ao', 'aq', 'ar', 'as', 'at', 'au', 'aw', 'ax', 'az',
  'ba', 'bb', 'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj', 'bl', 'bm', 'bn', 'bo', 'bq', 'br', 'bs',
  'bt', 'bv', 'bw', 'by', 'bz', 'ca', 'cc', 'cd', 'cf', 'cg', 'ch', 'ci', 'ck', 'cl', 'cm', 'cn',
  'co', 'cr', 'cu', 'cv', 'cw', 'cx', 'cy', 'cz', 'de', 'dj', 'dk', 'dm', 'do', 'dz', 'ec', 'ee',
  'eg', 'eh', 'er', 'es', 'et', 'fi', 'fj', 'fk', 'fm', 'fo', 'fr', 'ga', 'gb', 'gd', 'ge', 'gf',
  'gg', 'gh', 'gi', 'gl', 'gm', 'gn', 'gp', 'gq', 'gr', 'gs', 'gt', 'gu', 'gw', 'gy', 'hk', 'hm',
  'hn', 'hr', 'ht', 'hu', 'id', 'ie', 'il', 'im', 'in', 'io', 'iq', 'ir', 'is', 'it', 'je', 'jm',
  'jo', 'jp', 'ke', 'kg', 'kh', 'ki', 'km', 'kn', 'kp', 'kr', 'kw', 'ky', 'kz', 'la', 'lb', 'lc',
  'li', 'lk', 'lr', 'ls', 'lt', 'lu', 'lv', 'ly', 'ma', 'mc', 'md', 'me', 'mf', 'mg', 'mh', 'mk',
  'ml', 'mm', 'mn', 'mo', 'mp', 'mq', 'mr', 'ms', 'mt', 'mu', 'mv', 'mw', 'mx', 'my', 'mz', 'na',
  'nc', 'ne', 'nf', 'ng', 'ni', 'nl', 'no', 'np', 'nr', 'nu', 'nz', 'om', 'pa', 'pe', 'pf', 'pg',
  'ph', 'pk', 'pl', 'pm', 'pn', 'pr', 'ps', 'pt', 'pw', 'py', 'qa', 're', 'ro', 'rs', 'ru', 'rw',
  'sa', 'sb', 'sc', 'sd', 'se', 'sg', 'sh', 'si', 'sj', 'sk', 'sl', 'sm', 'sn', 'so', 'sr', 'ss',
  'st', 'sv', 'sx', 'sy', 'sz', 'tc', 'td', 'tf', 'tg', 'th', 'tj', 'tk', 'tl', 'tm', 'tn', 'to',
  'tr', 'tt', 'tv', 'tw', 'tz', 'ua', 'ug', 'um', 'us', 'uy', 'uz', 'va', 'vc', 've', 'vg', 'vi',
  'vn', 'vu', 'wf', 'ws', 'ye', 'yt', 'za', 'zm', 'zw',
]);

const GEOGRAPHY_NAMES = new Set([...COUNTRY_NAMES, ...REGION_TERMS]);

export function isGeographyTerm(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length === 2 && ISO_ALPHA2_CODES.has(normalized)) return true;
  if (GEOGRAPHY_NAMES.has(normalized)) return true;
  return [...GEOGRAPHY_NAMES].some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(normalized));
}
