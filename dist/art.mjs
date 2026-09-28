// Presentation-only asset manifest. Never infer evidence or world state from art.
const root='./assets/last-bell/';
const files=ids=>Object.fromEntries(ids.map(id=>[id,`${root}${id}.jpg`]));
export const ART=Object.freeze({
  version:1,
  style:'bellweather-gouache-v1',
  people:files(['clara','rowan','silas','ada','iris','bell','edmund','vicar','dora','jonah','hugo']),
  locations:files(['square','manor','inn','greenhouse','vestry','surgery','halt','post','mill','boathouse']),
  artifacts:files(['folio','seal','letter','record']),
  detective:`${root}detective.jpg`,
});

// Clue illustrations for generated cases: a shared library of common objects in the same painted style, matched to a
// clue by the words in its title (then its kind). Accounts and behaviour use the person's portrait instead.
const OBJECTS=['letter','note','key','glove','slate','bottle','footprint','ledger','watch','cloak','ticket','receipt','photo','knife',
  'tin','basin','lamp','rope','oar','book','diary','button','handkerchief','candle','bag','glass','envelope','gun','flowers','register'];
// Images that did not come out as the right object point at the nearest good one (regenerate later with tools/art).
const ALIAS={slate:'note',ticket:'letter',receipt:'letter',envelope:'letter',photo:'book',button:'tin',handkerchief:'glove'};
export const OBJECT_ART=Object.freeze(Object.fromEntries(OBJECTS.map(k=>[k,`${root}obj-${ALIAS[k]??k}.jpg`])));
const WORDS=[[/\benvelope/,'envelope'],[/\bregister\b/,'register'],[/\b(letter|draft|correspondence|telegram)\b/,'letter'],
  [/\b(diary|journal)\b/,'diary'],[/\b(ledger|accounts?|daybook|casebook|tally|takings|books)\b/,'ledger'],
  [/\b(receipt|money orders?|bill|iou|pawn)\b/,'receipt'],[/\bticket/,'ticket'],[/\bphoto/,'photo'],
  [/\b(note|scrap|slip|page|card|notice|memo|blotter|pad)\b/,'note'],[/\bkeys?\b|\block\b|keyring/,'key'],[/\bgloves?\b/,'glove'],
  [/\b(slate|chalk)\b/,'slate'],[/\b(bottles?|phial|vial|draught|medicine|decanter|flask|cordial)\b/,'bottle'],
  [/\b(glass|tumbler|cup|teacup|mug)\b/,'glass'],[/\b(tin|powder|poison|jar|arsenic|strychnine)\b/,'tin'],
  [/\b(watch|clock)\b/,'watch'],[/\b(cloak|coat|shawl|skirt|hem|jacket|blazer|cape|apron|sleeve)\b/,'cloak'],
  [/\b(knife|blade|razor|shears)\b/,'knife'],[/\b(revolver|gun|pistol|cartridge|shot)\b/,'gun'],[/\b(basin|jug|sink|bowl)\b/,'basin'],
  [/\b(lamp|lantern)\b/,'lamp'],[/\b(candle|candlestick)\b/,'candle'],[/\b(rope|cord|twine|string)\b/,'rope'],
  [/\b(oar|boat|punt|skiff|landing|mooring)\b/,'oar'],[/\b(button|bead|cuff|brooch)\b/,'button'],[/\bhandkerchief/,'handkerchief'],
  [/\b(bag|satchel|case)\b/,'bag'],[/\b(flowers?|seedlings?|pots?|plants?|bench)\b/,'flowers'],
  [/\b(footprints?|prints?|boots?|mud|tracks?|heel|stairs?|path|floor)\b/,'footprint'],[/\b(book|deed|conveyance|will|trust)\b/,'book']];
const KIND_ART={document:'letter',record:'ledger',trace:'footprint',item:'key',observation:'lamp',absence:'note',rule:'book'};
export function clueArt(title,kind){const t=String(title||'').toLowerCase();for(const [re,k] of WORDS)if(re.test(t))return OBJECT_ART[k];return OBJECT_ART[KIND_ART[kind]]??null;}
