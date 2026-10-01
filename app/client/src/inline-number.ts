/**
 * A standalone figure in reader-facing prose: a date, or a number with an
 * optional sign, currency, decimal, percent, or magnitude suffix.
 *
 * DIGITS INSIDE A WORD ARE NOT A FIGURE. "NBA 2K25", "PS5", "Q3", and
 * "COVID-19" are names; without the boundaries the pattern cut "2K25" into a
 * marked "2", a plain "K", and a marked "25". A figure may not touch a letter,
 * digit, or underscore on either side, and a leading hyphen joined to a word is
 * part of that word, not a minus sign. A figure also may not stop short at a
 * decimal or group separator: "1.5pp" is not a "1" followed by ".5pp".
 */
export const INLINE_NUMBER =
  /(?<![\p{L}\d_.,])(?<![\p{L}_][-\u2212])(?:\d{4}-\d{1,2}-\d{1,2}|[-+\u2212]?(?:[$€£]\s*)?\d[\d,]*(?:\.\d+)?(?:%|bn|[KMBTkmbtx])?)(?![\p{L}\d_]|[.,]\d)/gu;
