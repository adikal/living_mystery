// Presentation-only asset manifest. Never infer evidence or world state from art.
const root='./assets/last-bell/';
const files=ids=>Object.fromEntries(ids.map(id=>[id,`${root}${id}.jpg`]));
export const ART=Object.freeze({
  version:1,
  style:'bellweather-gouache-v1',
  people:files(['clara','rowan','silas','ada','iris','bell','edmund','vicar','dora','jonah','hugo','vera']),
  locations:files(['square','manor','inn','greenhouse','vestry','surgery','halt','post','mill','boathouse']),
  artifacts:files(['folio','seal','letter','record']),
  detective:`${root}detective.jpg`,
});

// Clue illustrations for generated cases: a shared library of objects in the same painted style. The generator is told
// which objects have pictures (tools/extract-setting.mjs copies this list into the setting), and publishing gives each
// clue an explicit picture key from it ('art'); older clues without one are matched by the words in their title, then
// their kind. Accounts and behaviour use the person's portrait instead.
export const OBJECT_LIBRARY=Object.freeze({
  letter:'a handwritten letter',note:'a scrap of notepaper',key:'a door key',glove:'a lady\u2019s glove',slate:'a chalk slate',
  bottle:'a medicine bottle',footprint:'a muddy boot print',ledger:'an account ledger',watch:'a pocket watch',cloak:'a cloak or coat',
  ticket:'a railway ticket',receipt:'a paper receipt',photo:'a framed photograph',knife:'a pocket knife or blade',tin:'a small tin',
  basin:'a washbasin and jug',lamp:'an oil lamp',rope:'a coil of rope',oar:'a rowing oar',book:'a leather-bound book',diary:'a diary',
  button:'a coat button',handkerchief:'a handkerchief',candle:'a candle in a candlestick',bag:'a doctor\u2019s bag',glass:'a drinking glass',
  envelope:'a sealed envelope',gun:'a revolver',flowers:'a bunch of flowers',register:'a parish register',
  notes:'a doctor\u2019s case notes',coin:'a coin',ashes:'a half-burnt paper',telephone:'a telephone',telegram:'a telegram',
  cashbox:'a cash box or strongbox',notebook:'a pocket notebook',door:'a locked door',hook:'an empty hook or peg',sacking:'a bundle in sacking',
  stairs:'a staircase or steps',card:'a printed card or scorecard',timetable:'a railway timetable',suitcase:'a suitcase with luggage labels',
  badge:'a military badge',cigarette_case:'a cigarette case',spectacles:'spectacles',inkwell:'an inkwell and pen',spade:'a garden spade',
  matchbox:'a box of matches',
  mug:'a tea mug or cup',weed:'pond weed or water plants',grate:'a fireplace grate',brush:'a hearth brush or broom',carpet:'a carpet or rug',cassock:'a clergyman’s cassock or robe',shoes:'a pair of shoes',waders:'fishing waders or boots',fishing_line:'a fishing line and float',net:'a fishing net',switchboard:'a telephone switchboard',clock:'a clock',bandage:'a bandage or dressing',forceps:'surgical forceps or instruments',churn:'a milk churn',label:'a luggage or parcel label',bin:'a bin, crate or sack of grit or sand',doorstop:'a cast-iron doorstop or ornament',billhook:'a billhook or hedging blade',cordon:'a rope cordon',mailbag:'a mail sack or post',apron:'an apron',barrow:'a wheelbarrow',wound:'a doctor’s examination or a wound'});
const OBJECTS=Object.keys(OBJECT_LIBRARY);
const FILE={cigarette_case:'cigarette-case',fishing_line:'fishing-line'};
const ALIAS={};   // an image that has not come out right can point at the nearest good one until it is redone (tools/art)
export const OBJECT_ART=Object.freeze(Object.fromEntries(OBJECTS.map(k=>[k,`${root}obj-${FILE[ALIAS[k]??k]??ALIAS[k]??k}.jpg`])));
const WORDS=[[/\b(examination|post-mortem|case) notes\b|\bnotes (on|for) the (wound|coroner)\b/,'notes'],[/\btelegram/,'telegram'],
  [/\b(timetable)\b/,'timetable'],[/\b(cash ?box|strongbox|strong-box)\b/,'cashbox'],[/\b(telephone|exchange)\b/,'telephone'],
  [/\b(coin|florin|shilling|sovereign|penny)\b/,'coin'],[/\b(matches|matchbox|match)\b/,'matchbox'],[/\b(ash|ashes|grate|stove|scorched|burnt|charred)\b/,'ashes'],
  [/\b(notebook|beat card)\b/,'notebook'],[/\b(sacking|hessian|oilcloth|bundle)\b/,'sacking'],[/\b(peg|hook|nail)\b/,'hook'],
  [/\b(door|keyhole)\b/,'door'],[/\b(stairs?|steps|staircase)\b/,'stairs'],[/\b(scorecard|score-book|tally card)\b/,'card'],
  [/\b(suitcase|luggage|trunk)\b/,'suitcase'],[/\b(badge|medal|insignia)\b/,'badge'],[/\bcigarette/,'cigarette_case'],
  [/\b(spectacles|glasses|pince-nez)\b/,'spectacles'],[/\b(inkwell|ink|blotter|pen)\b/,'inkwell'],[/\b(spade|billhook|trowel|fork)\b/,'spade'],
  [/\benvelope/,'envelope'],[/\bregister\b/,'register'],[/\b(letter|draft|correspondence|telegram)\b/,'letter'],
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
export function clueArt(title,kind,art){
  if(art!==undefined)return OBJECT_ART[art]??null;                   // the picture publishing chose (null: none fits, so no picture)
  const t=String(title||'').toLowerCase();for(const [re,k] of WORDS)if(re.test(t))return OBJECT_ART[k];
  return OBJECT_ART[KIND_ART[kind]]??null;
}
