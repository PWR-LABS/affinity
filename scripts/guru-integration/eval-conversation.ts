/** Eight frozen synthetic requests. Dry by default; no public route or database. */
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {conversationBody} from '../../src/lib/guru/conversation';
import {conversationCases,conversationVersion,checkConversation} from './conversation-cases';
import {SOURCE_COMMIT,MODEL,hash,sourceHashes,validateBound,runPrivateTurn,exclusiveEvidence} from './private-runtime';
const args=process.argv.slice(2);
if(args.some(x=>x!=='--live'&&!x.startsWith('--ledger-root=')))throw Error('Unknown option');
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
async function main(){
 // The reviewed implementation must be available and unchanged at this checkout.
 execFileSync('git',['merge-base','--is-ancestor',SOURCE_COMMIT,'HEAD'],{cwd:sourceRoot});
 const hashes=await sourceHashes(sourceRoot);
 for(const [f,digest] of Object.entries(hashes)){
  const original=execFileSync('git',['show',`${SOURCE_COMMIT}:${f}`],{cwd:sourceRoot});
  const {createHash}=await import('node:crypto');
  if(createHash('sha256').update(original).digest('hex')!==digest)throw Error('Pinned protocol changed');
 }
 const jobs=conversationCases.map(item=>{const body=conversationBody(MODEL,item.history,item.context,item.evidence);return {id:item.id,requestHash:hash(body),...validateBound(body)};});
 const manifest={version:conversationVersion,sourceCommit:SOURCE_COMMIT,hashes,model:MODEL,jobs,requests:8,reservedMicro:400000};
 if(jobs.length!==8)throw Error('Unexpected corpus');
 const manifestHash=hash(manifest);
 if(!args.includes('--live')){console.log(JSON.stringify({...manifest,manifestHash,paidRequests:0},null,2));return;}
 const rootArg=args.find(x=>x.startsWith('--ledger-root='))?.slice('--ledger-root='.length);
 if(!rootArg||!path.isAbsolute(rootArg))throw Error('Explicit absolute original ledger root required');
 const key=process.env.AFFINITY_OPENAI_API_KEY;if(!key)throw Error('Dedicated key unavailable');
 const root=path.resolve(rootArg),out=path.join(root,'conversation-v1');await mkdir(out,{recursive:true,mode:0o700});
 // A previous start, even without terminal evidence, requires review; never rerun.
 await exclusiveEvidence(path.join(out,'held-out-manifest.json'),{...manifest,manifestHash,startedAt:new Date().toISOString()});
 const results=[];
 for(let i=0;i<conversationCases.length;i++){
  if(hash(await sourceHashes(sourceRoot))!==hash(hashes))throw Error('Source changed during run');
  const item=conversationCases[i];
  const result=await runPrivateTurn({root,key,request:{requestId:randomUUID(),phase:'held_out',sourceCommit:SOURCE_COMMIT,manifestHash,requestHash:jobs[i].requestHash,model:MODEL},history:item.history,context:item.context,evidence:item.evidence});
  const checked=checkConversation(item,result.reply);
  results.push({caseId:item.id,...result,checked});
  console.log(JSON.stringify({completed:i+1,caseId:item.id,checked,reply:result.reply,usage:result.usage,conservativeUsageMicro:result.conservativeUsageMicro}));
 }
 await exclusiveEvidence(path.join(out,'held-out-results.json'),{manifestHash,results});
 console.log(JSON.stringify({state:'eight_completed_semantic_review_pending',usageMicro:results.reduce((n,r)=>n+r.conservativeUsageMicro,0),reservedMicro:400000}));
}
main().catch(()=>{console.error('Private evaluation stopped; preserve ledger/artifacts and review. No automatic retry.');process.exitCode=1;});
