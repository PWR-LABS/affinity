/** Prepared review gateway; explicit launch only. Never starts from an app import. */
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {SOURCE_COMMIT,sourceHashes,sourceFiles,hash,exclusiveEvidence} from './private-runtime';
import {privateGateway} from './private-gateway';
const args=process.argv.slice(2);
async function main(){
 if(!args.includes('--serve')||args.some(x=>x!=='--serve'&&!x.startsWith('--ledger-root=')))throw Error('Explicit serve and ledger root required');
 const root=args.find(x=>x.startsWith('--ledger-root='))?.slice('--ledger-root='.length);
 if(!root||!path.isAbsolute(root))throw Error('Original absolute ledger root required');
 const key=process.env.AFFINITY_OPENAI_API_KEY;if(!key)throw Error('Dedicated key unavailable');
 const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const expected=Object.fromEntries(sourceFiles.map(f=>[f,createHash('sha256').update(execFileSync('git',['show',`${SOURCE_COMMIT}:${f}`],{cwd:sourceRoot})).digest('hex')]));
 const verifySource=async()=>{if(hash(await sourceHashes(sourceRoot))!==hash(expected))throw Error('Protocol changed');};
 await verifySource();
 const manifest={sourceCommit:SOURCE_COMMIT,sourceHashes:expected,phase:'interactive',maxRequests:10,reservationMicro:50000,resolver:'synthetic-unknown-plus-declared-premiums/1',allowedOrigin:'http://127.0.0.1:3013'};
 const manifestHash=hash(manifest),out=path.join(root,'conversation-v1');await mkdir(out,{recursive:true,mode:0o700});
 const target=path.join(out,`interactive-manifest-${manifestHash}.json`);
 try{if(hash(JSON.parse(await readFile(target,'utf8')))!==manifestHash)throw Error('Manifest changed');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await exclusiveEvidence(target,manifest);}
 const server=privateGateway({root,key,manifestHash,verifySource});
 server.requestTimeout=30000;server.headersTimeout=10000;
 server.listen(3127,'127.0.0.1',()=>console.log(JSON.stringify({state:'private_synthetic_gateway_listening',host:'127.0.0.1',port:3127,sourceCommit:SOURCE_COMMIT,manifestHash,uiInstalled:false})));
 server.on('error',()=>{console.error('Private gateway unavailable');process.exitCode=1;});
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close());
}
main().catch(()=>{console.error('Private gateway not started; inspect source and local configuration.');process.exitCode=1;});
