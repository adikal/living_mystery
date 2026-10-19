// The standard questions the game offers everyone. This module is the single source for play (dist/cases/kernel-case.mjs)
// and for publishing (tools/refine-c/publish.py reads this file), so an account's own question can be checked against
// exactly what the menu already offers.
export const STANDARD_QUESTIONS = Object.freeze({
  case: 'What do we know so far?',
  night: 'What is your account of last night?',
  morning: 'What did you do this morning?',
  seen: 'Did you see anyone last night?',
  more: 'Is there anything else you remember about last night?',
  news: 'What have you heard this morning?',
  everyday: 'Tell me a little about yourself.',
});

// Standard topics that deliver an ordinary account of last night (the night question, then "anything else"). An
// account may be aliased (same_as) only to one of these, or to another account of the same speaker: an alias means
// "this account is asked through that question", so the target must actually deliver it. The morning, sightings and
// news questions deliver only their own kind of account, so they are never alias targets.
export const ALIAS_TOPICS = Object.freeze(['night', 'more']);

// Words that may surround a plain whereabouts question without changing what it asks: forms of address and filler.
// The case's own names and forms of address are added by the caller.
export const QUESTION_FILLER = Object.freeze(['mr', 'mrs', 'miss', 'ms', 'dr', 'doctor', 'reverend', 'vicar', 'rector',
  'constable', 'sergeant', 'sir', 'madam', 'ma', 'am', 'father', 'tell', 'me', 'please', 'so', 'and', 'now', 'well',
  'then', 'just']);

// The core of a plain "where were you last night?" question, over normalised wording (lower case, words joined by one
// space). Anything other than filler or a form of address around it makes the question specific, so it is not matched.
export const NIGHT_QUESTION_CORE = '(?:where (?:exactly )?were you|what did you do|what were you doing|how did you spend(?: your time)?) (?:last night|last evening|yesterday evening)';

// Case- and punctuation-insensitive wording. Must stay identical to publish.py `_question_key`.
export function questionKey(value) {
  return (String(value ?? '').toLowerCase().replace(/’/g, "'").match(/[a-z0-9]+/g) ?? []).join(' ');
}

// Whether a question asks only where the person was last night. `names` are the case's names and forms of address.
export function isPlainNightQuestion(question, names = []) {
  const words = new Set([...QUESTION_FILLER, ...names.flatMap(name => questionKey(name).split(' ')).filter(Boolean)]);
  const filler = [...words].map(word => word.replace(/[^a-z0-9]/g, '')).filter(Boolean).join('|');
  return new RegExp(`^(?:(?:${filler}) )*${NIGHT_QUESTION_CORE}(?: (?:${filler}))*$`).test(questionKey(question));
}
