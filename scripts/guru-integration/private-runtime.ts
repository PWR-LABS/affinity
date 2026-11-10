/** Private evaluation transport; never imported by the public app.
 * Interactive inputs/provider receipts may contain real authorized user context.
 * Keep those artifacts private: never export, replay, or promote them to synthetic
 * benchmark cases. Only held-out/repair fixtures are synthetic inputs. Insurer
 * evidence remains synthetic regardless of the interactive input's provenance.
 */
import {createHash} from 'node:crypto';
import {open,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {conversationBody,conversationTurn} from '../../src/lib/guru/conversation';
import {type History,type ReferencedEvidence} from '../../src/lib/guru/chat';
import {type GuruContext} from '../../src/lib/guru/workspace';
import {withExtensionReservation,type ExtensionRequest} from '../guru-benchmark/extension-ledger';
import {usageMicro,type Response} from '../guru-benchmark/core';

export const SOURCE_COMMIT='5534ee609eca7c17e5e6f9df1310647a58641637';
export const MODEL='gpt-6.1-terra';
export const sourceFiles=['src/lib/guru/conversation.ts','src/lib/guru/chat.ts','src/lib/guru/planner.ts','src/lib/guru/workspace.ts','src/lib/guru/proposal.ts','src/lib/medicaid/states.ts','scripts/guru-integration/conversation-cases.ts'];
export const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function sourceHashes(root:string){return Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')])));}
export async function exclusiveEvidence(file:string,data:unknown){
 const handle=await open(file,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(data,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 const dir=await open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}
}
export function validateBound(body:ReturnType<typeof conversationBody>,now=new Date()){
 const bytes=Buffer.byteLength(JSON.stringify(body),'utf8');
 const upperMicro=Math.ceil((bytes+4096)*2.5+body.max_output_tokens*10);
 const age=now.getTime()-Date.parse('2026-11-09T00:00:00Z');
 if(age<0||age>7*86400000||bytes>12000||upperMicro>50000||body.max_output_tokens!==1000)throw Error('Unreviewed request bound/pricing');
 return {bytes,upperMicro};
}
export async function runPrivateTurn(options:{root:string;request:ExtensionRequest;history:History;context:GuruContext;evidence:ReferencedEvidence[];key:string;fetcher?:typeof fetch}){
 const body=conversationBody(MODEL,options.history,options.context,options.evidence);
 validateBound(body);
 if(hash(body)!==options.request.requestHash)throw Error('Frozen request changed');
 const evidenceDir=path.join(options.root,'conversation-v1');await mkdir(evidenceDir,{recursive:true,mode:0o700});
 return withExtensionReservation({root:options.root,request:options.request,dispatch:async()=>{
  let reservedHook=false,calls=0,raw:Response|undefined;
  const started=performance.now();
  const fetcher=(async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
   if(!reservedHook||++calls!==1||input!=='https://api.openai.com/v1/responses'||init?.redirect!=='error'||init.body!==JSON.stringify(body))throw Error('Transport contract changed');
   const response=await(options.fetcher??fetch)(input,init);
   if(response.ok){raw=await response.clone().json() as Response;
    await exclusiveEvidence(path.join(evidenceDir,options.request.requestId+'.provider.json'),{request:options.request,body,response:raw});}
   return response;
  }) as typeof fetch;
  const reply=await conversationTurn({model:MODEL,history:options.history,context:options.context,evidence:options.evidence,key:options.key,reserve:async()=>{if(reservedHook)throw Error('Repeated reserve hook');reservedHook=true;},fetcher});
  const measured=raw?usageMicro(MODEL,raw):null;
  if(measured===null||measured>50000||calls!==1)throw Error('Missing or excessive usage');
  const result={request:options.request,reply,evidence:options.evidence,usage:raw!.usage,conservativeUsageMicro:measured,returnedModel:raw!.model,latencyMs:Math.round(performance.now()-started)};
  await exclusiveEvidence(path.join(evidenceDir,options.request.requestId+'.result.json'),result);
  return {value:result,usageMicro:measured};
 }});
}
