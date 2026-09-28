// Turns raw extracted text into a list of words a person can actually type
// on a regular keyboard.

const REPLACEMENTS: [RegExp, string][] = [
  // soft hyphen at a line break means the word continues on the next line
  [/­\s*\n\s*/g, ''],
  [/[­​-‍⁠﻿]/g, ''],
  [/[‘’‚‛′`´]/g, "'"],
  [/[“”„‟″«»]/g, '"'],
  [/[—―⸺⸻]/g, ' - '],
  [/[‐‑‒–−]/g, '-'],
  [/…/g, '...'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/Æ/g, 'AE'],
  [/œ/g, 'oe'],
  [/Œ/g, 'OE'],
  [/ø/g, 'o'],
  [/Ø/g, 'O'],
  [/ł/g, 'l'],
  [/Ł/g, 'L'],
  [/đ/g, 'd'],
  [/Đ/g, 'D'],
  [/þ/g, 'th'],
  [/Þ/g, 'Th'],
];

const nonSpaceLength = (s: string) => s.replace(/\s/g, '').length;

// Project Gutenberg files wrap the book in a license header/footer.
function stripGutenberg(text: string): string {
  const start = text.match(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  const end = text.match(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (!start || start.index === undefined) return text;
  const from = start.index + start[0].length;
  const to = end?.index !== undefined && end.index > from ? end.index : text.length;
  return text.slice(from, to);
}

export function textToWords(raw: string): string[] {
  // NFKC also expands ligatures (ﬁ, ﬂ) and turns nbsp into a normal space
  let text = stripGutenberg(raw).normalize('NFKC');
  for (const [re, sub] of REPLACEMENTS) text = text.replace(re, sub);

  // re-join words hyphenated across a line break: "exam-\nple" -> "example"
  text = text.replace(/(\p{L})-[ \t]*\r?\n\s*(\p{Ll})/gu, '$1$2');

  // plain-text italics markup used by Project Gutenberg: _like this_
  text = text.replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '');

  // Fold accents (é -> e) and drop anything else that isn't printable ASCII,
  // unless that would throw away most of the text (e.g. a non-Latin book).
  const ascii = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7E\s]/g, '');
  if (nonSpaceLength(ascii) >= 0.8 * nonSpaceLength(text)) text = ascii;
  else text = text.normalize('NFC');

  // keep punctuation-only tokens too ("...", "*", '"'); the punctuation
  // toggle in applyOptions is what removes them
  return text.split(/\s+/).filter((w) => w.length > 0);
}

export interface WordOptions {
  punctuation: boolean;
  capitals: boolean;
}

// Applies the user's toggles to a slice of book words.
export function applyOptions(words: string[], opts: WordOptions): string[] {
  let out = words;
  if (!opts.punctuation) {
    out = out.flatMap((w) =>
      w
        .replace(/-/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .split(' ')
        .filter(Boolean),
    );
  }
  if (!opts.capitals) out = out.map((w) => w.toLowerCase());
  return out;
}
