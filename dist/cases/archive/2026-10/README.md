# Archived cases (October 2026)

These cases are certified and playable, but are not offered in the case menu. The menu (`dist/cases/generated/index.json`)
offers six cases chosen for range and interest: one easy, two medium and three hard, with no culprit, victim, method,
motive or scene repeated, each with a surface twist, at least one red herring and at least one false account.

`index.json` here lists the archived cases in the same format. Tests and the playtest splits (`tools/playtest/cases.json`)
still read some of them. To offer a case again, move its file to `dist/cases/generated/` and its entry to that index.
Saved games embed their case records, so an investigation saved in an archived case still loads.

On 25 October 2026 three cases left the menu because their constable lies or keeps evidence back until it is earned
(the constable is the detective's ally; `tools/refine-c/roles.py` now refuses this for new cases): *Sealing Wax and
Steel*, *The Lamb Asleep Upstairs* and *Death Among the Orchids*. *Death at Vale Manor*, *The Last Train to Town* and
*A Fall Before Midnight* replaced them; the two older ones gained a `because` naming the existing attitude behind each
red herring that lacked one (wording only; certification is unchanged). Among the cases that keep both rules no choice
avoids every repeat; these remain: a fall at Vale Manor (Death at Vale Manor, A Fall Before Midnight), and inheritance
and a secret as motives (each twice).
