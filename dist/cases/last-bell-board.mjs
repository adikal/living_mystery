// Authored suspect theory board for The Last Bell.
//
// Per suspect, the pillars of a case — Motive, Means, Opportunity — plus Alibi
// as the defensive counter-pillar. Each entry ties an acquired clue to a pillar
// with a polarity RELATIVE TO GUILT:
//   'supports'    → the clue strengthens the case that this suspect is guilty
//   'contradicts' → the clue undermines it (exonerates / breaks the theory)
// and a one-line rationale. Polarity is authored (tags give pillar + subject,
// but not whether a clue incriminates or exonerates), which keeps the red
// herrings — Ada's coat sighting, the borrowed coat — labelled correctly.
//
// The board reads only clues the PLAYER has acquired (gated in the UI), so it is
// a working theory, never a spoiler map of the solution.

export const SUSPECTS = ['clara', 'rowan', 'silas'];
export const PILLARS = [
  ['motive', 'Motive'],
  ['means', 'Means'],
  ['opportunity', 'Opportunity'],
  ['alibi', 'Alibi'],
];

// method/motive shown on the verdict node when the player could name them.
export const suspectMeta = {
  silas: { method: 'the brass seal', motive: 'to bury the diverted payments' },
  clara: null,
  rowan: null,
};

export const suspectBoard = {
  silas: {
    motive: [
      { clue: 'ledger', polarity: 'supports', why: '£400 in estate payments were redirected to an account Silas controls.' },
      { clue: 'folio', polarity: 'supports', why: 'The forged transfer folio carries Silas’s countersignature; Edmund meant to take it to the police.' },
      { clue: 'clara', polarity: 'supports', why: 'Clara reports Edmund intended to confront Silas over the accounts that night.' },
    ],
    means: [
      { clue: 'seal', polarity: 'supports', why: 'Silas’s engraved brass seal is missing a triangular corner.' },
      { clue: 'fragment', polarity: 'supports', why: 'A triangular brass corner under the desk matches the seal and the wound.' },
      { clue: 'medical', polarity: 'supports', why: 'The fatal wound fits a small, hard, angled edge.' },
    ],
    opportunity: [
      { clue: 'delivery', polarity: 'supports', why: 'A signed courier receipt places Silas at the manor at 21:12, inside the medical window.' },
      { clue: 'appointment', polarity: 'supports', why: 'Edmund’s diary records a 21:10 meeting with “S. Voss” — intent, not proof of attendance.' },
    ],
    alibi: [
      { clue: 'alibi', polarity: 'contradicts', why: 'Silas claims the vestry all evening — uncorroborated, and the receipt contradicts it.' },
    ],
  },
  clara: {
    motive: [
      { clue: 'letter', polarity: 'contradicts', why: 'The private letter explains why Clara hid her whereabouts — to protect Rowan, not a motive to kill.' },
    ],
    means: [],
    opportunity: [],
    alibi: [
      { clue: 'record', polarity: 'contradicts', why: 'Dr Marsh’s record places Clara at the greenhouse across the death window.' },
      { clue: 'clara', polarity: 'contradicts', why: 'Clara’s own account puts her at the greenhouse meeting, not the study.' },
    ],
  },
  rowan: {
    motive: [],
    means: [],
    opportunity: [
      { clue: 'ada', polarity: 'supports', why: 'Ada reports Rowan’s green coat heading toward the manor near the time.' },
    ],
    alibi: [
      { clue: 'record', polarity: 'contradicts', why: 'The visiting record places Rowan at the greenhouse during the death window.' },
      { clue: 'rowan', polarity: 'contradicts', why: 'Rowan lent his green coat to Silas at 20:55 — the coat is not the man.' },
      { clue: 'clock', polarity: 'contradicts', why: 'The inn clock ran twelve minutes fast; Ada’s “21:15” was nearer 21:03.' },
      { clue: 'pump', polarity: 'contradicts', why: 'Rowan’s frost-pump log records greenhouse work through the window (needs corroboration).' },
    ],
  },
};
