// Browsers don't expose a voice's gender, so we infer it from well-known voice names.

const FEMALE = new Set(`
  female woman girl lady zira aria jenny hazel susan samantha victoria karen moira tessa fiona veena libby sonia
  natasha clara emma ava allison serena catherine kate heera kalpana sabina helena hortense julie elsa ingrid nora
  sara paulina salli joanna kendra kimberly ivy michelle ana amy olivia emily linda heather eva hiu haruka ayumi
  sayaka huihui yaoyao xiaoxiao xiaoyi heami sunhi nanami martha nicky stephanie noelle zoe joelle grandma amber
  ashley cora elizabeth jane nancy jessa molly maisie bella hollie abbie neerja swara denise elvira dalia
  francisca isabella katja amala seraphina vivienne brigitte eloise coralie yvonne ximena lucia laura monica
  paola luciana marisol alice anna mei lekha damayanti kyoko tingting sinji yuna milena zuzana mariska ioana
`.trim().split(/\s+/));

const MALE = new Set(`
  male man boy gentleman david mark guy george james daniel alex fred tom ryan eric christopher roger steffan
  brian andrew william ravi rishi richard thomas matthew justin joey oliver arthur aaron gordon lee jorge diego
  paul stefan pablo raul ichiro keita kangkang yunyang yunxi injoon danny liam connor mitchell prabhat madhur
  ethan evan nathan reed rocko eddy grandpa alvaro henri remy conrad killian florian gilles alonso antonio
  giuseppe jacob tony davis jason brandon ralf ralph luca diogo juan carlos felipe maged tarik xander yuri otoya
`.trim().split(/\s+/));

const NATURAL_RE = /natural|neural|online|premium|enhanced|wavenet|studio/i;

export function classifyVoice(voice) {
  const name = (voice && voice.name ? voice.name : '').toLowerCase();
  const words = name.split(/[^a-z]+/).filter(Boolean);
  // Explicit gender words win over names ("Google UK English Male").
  if (words.some((w) => w === 'female' || w === 'woman')) return 'female';
  if (words.some((w) => w === 'male' || w === 'man')) return 'male';
  if (words.some((w) => FEMALE.has(w))) return 'female';
  if (words.some((w) => MALE.has(w))) return 'male';
  // Chrome's built-in "Google <language>" voices are female unless marked otherwise.
  if (/^google\s/.test(name)) return 'female';
  return 'unknown';
}

export const isNaturalVoice = (voice) => NATURAL_RE.test(voice.name || '');

export function voiceQuality(voice) {
  let score = 0;
  if (isNaturalVoice(voice)) score += 10;
  if (/^google\s/i.test(voice.name || '')) score += 3;
  if (voice.localService === false) score += 1;
  return score;
}

export function languageOf(voice) {
  return (voice.lang || '').replace('_', '-').split('-')[0].toLowerCase() || 'und';
}

export function listLanguages(voices, displayLocale = 'en') {
  let names = null;
  try {
    names = new Intl.DisplayNames([displayLocale, 'en'], { type: 'language' });
  } catch {
    names = null;
  }
  const label = (code) => {
    try {
      return (names && names.of(code)) || code;
    } catch {
      return code;
    }
  };
  return [...new Set(voices.map(languageOf))]
    .map((code) => ({ code, label: label(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Groups voices into female / male / unknown, best-sounding first. Accepts any {name, lang, gender?, quality?}. */
export function groupVoices(voices, lang = 'all') {
  const groups = { female: [], male: [], unknown: [] };
  for (const v of voices) {
    if (lang !== 'all' && languageOf(v) !== lang) continue;
    const gender = v.gender === 'female' || v.gender === 'male' ? v.gender : classifyVoice(v);
    groups[gender].push(v);
  }
  const score = (v) => (typeof v.quality === 'number' ? v.quality : voiceQuality(v));
  const byQuality = (a, b) => score(b) - score(a) || a.name.localeCompare(b.name);
  Object.values(groups).forEach((list) => list.sort(byQuality));
  return groups;
}

/** Short, friendly label: "Microsoft Aria Online (Natural) - English (United States)" -> "Aria". */
export function shortVoiceName(voice) {
  return (voice.name || 'Voice')
    .replace(/^(Microsoft|Google|Apple)\s+/i, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*\((Natural|Neural|Premium|Enhanced)\)/gi, '')
    .replace(/\s+Online\b/i, '')
    .trim();
}
