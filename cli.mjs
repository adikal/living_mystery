import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {readFile,writeFile} from 'node:fs/promises';
import {createSession,dispatch,parseCommand,playerView,exportSession,importSession,PEOPLE,timeLabel,caseTables} from './dist/engine.mjs';
let s=createSession(17,process.argv[2]??'last-bell');
const rl=createInterface({input:stdin,output:stdout});
console.log('LIVING MYSTERY · '+caseTables(s).CASE.title+'\n');
console.log(playerView(s).transcript.at(-1).text);
console.log('\nCommands: go manor · inspect desk · ask Clara about alibi · wait 10 · clues\nAlso: show PERSON CLUE [private|press] · accuse PERSON METHOD MOTIVE · save PATH · load PATH · quit\nUse the browser for the visual inspector.');
try{while(true){const raw=(await rl.question(`\n[${timeLabel(s.world.minute)}] > `)).trim();if(!raw)continue;if(raw==='quit')break;
  if(raw==='clues'){console.log(playerView(s).evidence.map(e=>`${e.clue}: ${e.title}\n${e.text}`).join('\n\n')||'No evidence recorded.');continue;}
  if(raw.startsWith('save ')){await writeFile(raw.slice(5),exportSession(s));console.log('Saved.');continue;}
  if(raw.startsWith('load ')){try{s=importSession(await readFile(raw.slice(5),'utf8'));console.log('Restored.');}catch(e){console.log(e.message);}continue;}
  const n=s.events.length,parts=raw.toLowerCase().split(/\s+/);let a;
  if(parts[0]==='show'&&PEOPLE[parts[1]])a={type:'present',person:parts[1],clue:parts[2],tone:parts[3]||'private'};
  else if(parts[0]==='accuse')a={type:'accuse',suspect:parts[1],method:parts[2],motive:parts[3],evidence:s.world.player.evidence.map(e=>e.clue)};
  else a=parseCommand(raw,s);
  dispatch(s,a);for(const e of s.events.slice(n).filter(e=>e.playerText))console.log(`\n${e.playerText}`);
}}finally{rl.close();}
