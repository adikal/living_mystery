"""A player agent: a fresh context per episode, a player profile, and only the game's text interface.

The agent sees what a person would see (tools/playtest/game.mjs) and nothing else: no case files, no code, no logs.
Each step it returns one action, and when something stands out (being stuck, confused, amused, surprised) a line for
its in-character diary. At the end it answers a fixed questionnaire. It never grades itself: the judge does that.
"""
import json
import os

from llm import PLAYER_MODEL, call_json

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILES = json.load(open(os.path.join(HERE, 'profiles.json')))

SYSTEM = """You are a person playing a text detective game set in an English village in 1932. Someone has died, and you
are the detective. You can walk between places, examine things, question people (with the question buttons or in your
own words), show people what you have found, wait, ask for a hint, and finally accuse someone, saying how and why. The
accusation is heard by the constable, in person.

Who you are as a player:
{profile}

Play as that person would, honestly: do not play better or more patiently than they would. You know nothing about the
case except what the game has shown you.

Each turn you get what you see now and what just happened. Reply by calling submit with:
  "action": one of
    {{"type": "move", "to": "<place id>"}}
    {{"type": "examine", "thing": "<thing id>"}}
    {{"type": "ask", "person": "<person id>", "question": "<question id>"}}
    {{"type": "say", "person": "<person id>", "text": "<what you say, in your own words>"}}
    {{"type": "show", "person": "<person id>", "item": "<inventory id>"}}
    {{"type": "wait", "minutes": <1 to 60>}}
    {{"type": "hint"}}            (each time you ask, the hint gets more explicit)
    {{"type": "accuse", "suspect": "<suspect id>", "method": "<method id>", "motive": "<motive id>"}}
    {{"type": "quit"}}            (if you would give up)
  "thinking": one or two sentences of what you are thinking, as the player,
  "diary": optional; one short line in your own voice when something stands out: you feel stuck, confused, pleased,
           surprised, bored or annoyed, or a character says something that does not make sense.
Keep your own notes in "thinking"; you will see your last few thoughts again."""

QUESTIONNAIRE = """You have just finished playing a text detective game. Here is who you are as a player, your diary from
the game, and how it ended. If it stopped at a fixed number of actions, that was the test session ending, not the game: leave it out of your
answers. Answer as that player, honestly, by calling submit with:
  "ratings": each from 1 (not at all) to 7 (very): "challenge" (how hard it was), "frustration" (how often you were stuck
             and did not know what to do), "confusion" (how often characters or clues did not make sense), "fairness"
             (whether the answer could be worked out from the clues), "liveliness" (whether the village felt alive),
             "believability" (whether the people felt like real people), "fun" (how much you enjoyed it),
  "best": the best moment, in one sentence,
  "worst": the worst moment, in one sentence,
  "confusing": up to three things that confused you or seemed broken, each one sentence,
  "would_play_again": true or false."""


def profile_text(name, temperament):
    p, t = PROFILES['profiles'][name], PROFILES['temperaments'][temperament]
    return '\n'.join(['- ' + p[k] for k in ('experience', 'reading', 'asking', 'hints', 'accusing')] +
                     [f"- You give up (quit) after about {p['patience']} actions without learning anything new, if hints do not help.",
                      f'- Temperament: {t}'])


def render(o):
    """The observation as text, the way the screen reads."""
    lines = [f"{o['time']} — {o['place_name']} (place id: {o['place']}). {o['description']}"]
    for p in o['people_here']:
        lines.append(f"Here: {p['name']} (person id: {p['id']}), {p['role']}. {p['appearance']}"
                     + (' They seem to be about some business of their own.' if p['acting_on_their_own'] else ''))
        lines += [f"   ask {q['id']}: {q['text']}" for q in p['questions']]
    lines += [f"Thing here: {t['label']} (thing id: {t['id']}){' — examined' if t['examined'] else ''}" for t in o['things_here']]
    if o['inventory']:
        lines.append('You carry:')
        lines += [f"   {e['title']} (inventory id: {e['id']}): {e['text']}" for e in o['inventory']]
    lines.append('Map: ' + '; '.join(f"{m['name']} (id {m['place']}, {m['minutes']} min)"
                                      + (f": {', '.join(m['people'])}" if m['people'] else '')
                                      + (f", {m['unexamined']} thing(s) not yet examined" if m['unexamined'] else '')
                                      + (', a lead points here' if m['lead'] else '') for m in o['map']))
    lines += o['walking']
    a = o['accusation']
    lines.append(f"To accuse: go to {a['heard_by']} ({a['where']}). Suspects: " + ', '.join(f"{s['name']} ({s['id']})" for s in a['suspects'])
                 + '. Methods: ' + ', '.join(f"{m['label']} ({m['id']})" for m in a['methods'])
                 + '. Motives: ' + ', '.join(f"{m['label']} ({m['id']})" for m in a['motives']) + '.')
    lines.append(f"Actions left: {o['actions_left']}.")
    return '\n'.join(lines)


def render_news(news):
    return '\n'.join(f"[{n['time']}] {n['speaker'] + ': ' if n.get('speaker') else ''}{n['text']}" for n in news) or '(nothing new)'


class Player:
    def __init__(self, profile, temperament, model=PLAYER_MODEL, temperature=0.8, memory=10):
        self.profile, self.temperament = profile, temperament
        self.system = SYSTEM.format(profile=profile_text(profile, temperament))
        self.model, self.temperature, self.memory = model, temperature, memory
        self.history = []      # (action, what happened) for the last steps, as the player remembers them
        self.thoughts = []     # the player's own running notes
        self.diary = []
        self.since_progress = 0

    def step(self, observation, news, actions_so_far, error=None):
        recent = '\n\n'.join(f"You did: {json.dumps(a)}\n{render_news(n)}" for a, n in self.history[-self.memory:])
        prompt = '\n\n'.join(filter(None, [
            f"Your earlier thoughts: {' | '.join(self.thoughts[-8:])}" if self.thoughts else None,
            f"What happened recently:\n{recent}" if recent else None,
            f"Just now:\n{render_news(news)}",
            f"That did not work: {error}" if error else None,
            f"What you see now:\n{render(observation)}",
            f"You have taken {actions_so_far} actions; {self.since_progress} since you last learned something new."]))
        out = call_json(self.system, prompt, self.model, max_tokens=600, temperature=self.temperature)
        action = out.get('action') if isinstance(out.get('action'), dict) else {'type': 'wait', 'minutes': 5}
        if out.get('thinking'):
            self.thoughts.append(str(out['thinking'])[:300])
        if out.get('diary'):
            self.diary.append({'actions': actions_so_far, 'time': observation['time'], 'line': str(out['diary'])[:400]})
        return action, out.get('thinking', '')

    def remember(self, action, news, learned):
        self.history.append((action, news))
        self.since_progress = 0 if learned else self.since_progress + 1

    def questionnaire(self, outcome):
        user = json.dumps({'player': profile_text(self.profile, self.temperament), 'diary': self.diary, 'outcome': outcome})
        return call_json(QUESTIONNAIRE, user, self.model, max_tokens=800, temperature=0.3)
