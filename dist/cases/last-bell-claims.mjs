const claim=(key,subject,predicate,value,start=null,end=start,attribution='document',confidence=.95)=>({key,subject,predicate,value,interval:start===null?null:{start,end},attribution,confidence});
export const at=(key,subject,value,start,end,attribution='testimony',confidence=.9)=>claim(key,subject,'location',value,start,end,attribution,confidence);
export const evidenceClaims={
  medical:[claim('death_window','edmund','death_time','death',1270,1280,'medical inference')],
  appointment:[claim('appointment','silas','appointment_location','manor',1270,1270,'planned appointment',.7)],
  ledger:[claim('diversion','payments','beneficiary','silas')],
  folio:[claim('forgery','transfers','countersignature','silas')],
  fragment:[claim('fragment_material','fragment','material','brass'),claim('fragment_shape','fragment','shape','triangular')],
  seal:[claim('seal_material','seal','material','brass'),claim('seal_corner','seal','missing_shape','triangular')],
  letter:[claim('meeting_intent','clara','planned_meeting','rowan')],
  pump:[at('rowan_log','rowan','greenhouse',1260,1285,'self-authored log',.7)],
  record:[at('record_clara','clara','greenhouse',1266,1283,'medical record'),at('record_rowan','rowan','greenhouse',1266,1283,'medical record')],
  clock:[claim('clock_offset','inn_clock','clock_offset',12)],
  delivery:[at('receipt','silas','manor',1272,1272,'signed delivery receipt')],
  alibi:[{...at('silas_alibi','silas','vestry',1260,1290),claimant:'silas'}],
  rowan:[claim('coat_loan','coat','borrower','silas',1255,1255,'Rowan testimony',.85)],
  ada:[{...claim('coat_identity','coat_wearer','identity','rowan',1275,1275,'Ada inference',.65),claimant:'ada'}],
  clara:[claim('confrontation','edmund','intended_confrontation','silas',null,null,'Clara reporting Edmund',.85)],
};
export const testimonyClaims={
  silas_alibi:[{...at('silas_alibi','silas','vestry',1260,1290),claimant:'silas'}],
  silas_revision:[at('silas_alibi','silas','manor',1272,1272,'revised testimony')],
  clara_alibi:[at('clara_alibi','clara','manor',1266,1283)],
  clara_truth:[at('clara_alibi','clara','greenhouse',1266,1283)],
  ada_original:evidenceClaims.ada,
  ada_corrected:[claim('coat_identity','coat_wearer','identity','unidentified',1263,1263,'corrected observation',.96)],
};
