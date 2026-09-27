// Presentation-only asset manifest. Never infer evidence or world state from art.
const root='./assets/last-bell/';
const files=ids=>Object.fromEntries(ids.map(id=>[id,`${root}${id}.jpg`]));
export const ART=Object.freeze({
  version:1,
  style:'bellweather-gouache-v1',
  people:files(['clara','rowan','silas','ada','iris','bell','edmund','vicar','dora','jonah','hugo']),
  locations:files(['square','manor','inn','greenhouse','vestry','surgery','halt','post','mill','boathouse']),
  artifacts:files(['folio','seal','letter','record']),
});
