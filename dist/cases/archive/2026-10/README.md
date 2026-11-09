# Archived cases (October 2026)

These cases are certified and playable, but are not offered in the case menu. The menu (`dist/cases/generated/index.json`)
offers six cases chosen for range and interest (one easy, two medium and three hard until 8 November 2026; see below), with no culprit, victim, method,
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

On 8 November 2026 the original *A Fall Before Midnight* (`mk-live-20261003-133036`, the case of the November 8 play and
the paper's running example) left the menu: today's whole-case review finds its notebook lock unnatural (gated on the
eel line). A regenerated case with the same premise and difficulty (`mk-live-20261108-121102`) replaced it. The archived
file keeps the wording repairs of that day (wording only; certification is unchanged).

The same day *Death at the Post Office* (`mk-live-20261002-225824`) and the first *The Last Train Waits*
(`mk-live-20261025-135936`) left the menu, replaced by cases regenerated with their premises and difficulties:
*A Letter Never Posted* (`mk-live-20261108-143345`) and a new *The Last Train Waits* (`mk-live-20261108-144216`). Today's
whole-case review found a death window at odds with the doctor's "dead six to eight hours" in the first, and two lock
problems (where the doctor and the wound sliver are at 8:00) in the second.

Later that day *Death at Vale Manor* (`mk-live-20261002-224855`) left the menu as well: today's review finds Mrs Finch's
"ten past eleven" at odds with the record's 23:30, the clue that breaks the heir's alibi. Its replacement, *The Third
Stair* (`mk-live-20261108-155618`), has the same premise but was rated hard against a medium target, so the menu now
offers one easy, one medium and four hard cases.

Last that day *Cocoa in the Vestry* (`mk-live-20261003-082807`) left the menu: today's review finds the vicar sitting in
the vestry through the poisoning and Jonah calling the landlady "the missus". *The Lamp Left Burning*
(`mk-live-20261108-190745`), regenerated with its premise and difficulty (easy), replaced it.
