// The questions the detective can put to anyone in a generated case, by topic. One source for the game (kernel-case.mjs)
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
