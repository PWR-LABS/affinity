/** Explicit two-case repair exercise. Original results are never modified. */
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {conversationBody} from '../../src/lib/guru/conversation';
import {conversationCases,checkConversation} from './conversation-cases';
import {SOURCE_COMMIT,MODEL,hash,sourceHashes,validateBound,runPrivateTurn,exclusiveEvidence} from './private-runtime';
const ids=['household-offer-official-path','followup-natural-doctor-intake'];
const args=process.argv.slice(2);
async function main(){
 if(args.some(x=>x!=='--live'&&!x.startsWith('--ledger-root=')))throw Error('Unknown option');
 const root=args.find(x=>x.startsWith('--ledger-root='))?.slice('--ledger-root='.length);
 if(!root||!path.isAbsolute(root))throw Error('Explicit absolute original ledger required');
 const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const hashes=await sourceHashes(sourceRoot);
 for(const [f,digest] of Object.entries(hashes))if(createHash('sha256').update(execFileSync('git',['show',`${SOURCE_COMMIT}:${f}`],{cwd:sourceRoot})).digest('hex')!==digest)throw Error('Protocol differs from pinned repair');
 const original=JSON.parse(await readFile(path.join(root,'conversation-v1/held-out-results.json'),'utf8'));
 const selected=ids.map(id=>{const item=conversationCases.find(x=>x.id===id);if(!item||!original.results.some((r:{caseId:string;checked:{passed:boolean}})=>r.caseId===id&&!r.checked.passed))throw Error('Repair identity mismatch');return item;});
 const jobs=selected.map(item=>{const body=conversationBody(MODEL,item.history,item.context,item.evidence);return {id:item.id,requestHash:hash(body),...validateBound(body)};});
 const manifest={version:'affinity.guru.conversation-repair-probe/1',sourceCommit:SOURCE_COMMIT,hashes,model:MODEL,originalManifestHash:original.manifestHash,originalReportCommit:'b8d985009cb3d3b57554b70caa36dddbda79e12b',phase:'repair_probe',jobs,reservedMicro:100000};
 const manifestHash=hash(manifest);
 if(!args.includes('--live')){console.log(JSON.stringify({...manifest,manifestHash,paidRequests:0},null,2));return;}
 const key=process.env.AFFINITY_OPENAI_API_KEY;if(!key)throw Error('Dedicated key unavailable');
 await exclusiveEvidence(path.join(root,'conversation-v1/repair-probe-manifest.json'),{...manifest,manifestHash,startedAt:new Date().toISOString()});
 const results=[];
 for(let i=0;i<selected.length;i++){
  if(hash(await sourceHashes(sourceRoot))!==hash(hashes))throw Error('Repair source changed');
  const item=selected[i];const result=await runPrivateTurn({root,key,request:{requestId:randomUUID(),phase:'repair_probe',sourceCommit:SOURCE_COMMIT,manifestHash,requestHash:jobs[i].requestHash,model:MODEL},history:item.history,context:item.context,evidence:item.evidence});
  const checked=checkConversation(item,result.reply);results.push({caseId:item.id,...result,checked});
  console.log(JSON.stringify({caseId:item.id,checked,reply:result.reply,usage:result.usage,conservativeUsageMicro:result.conservativeUsageMicro}));
 }
 await exclusiveEvidence(path.join(root,'conversation-v1/repair-probe-results.json'),{manifestHash,results});
 console.log(JSON.stringify({completed:results.length,reservedMicro:100000,usageMicro:results.reduce((n,r)=>n+r.conservativeUsageMicro,0)}));
}
main().catch(()=>{console.error('Repair exercise stopped; preserve evidence and reservations. No retry.');process.exitCode=1;});
