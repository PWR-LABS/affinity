import {readFile,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validatePublication,tocPlans,type TicPublication} from '../../src/lib/tic/publication';
import {sourceIdentity} from './issuer-discovery';
import {planMappingIdentity} from './managed-publication';
export type PreparedSource={etag:string;policy:string;receiptPath:string};
/** Reuse only complete local evidence bound to unchanged transport and current mappings. */
export async function preparedSource(entry:PreparedSource|undefined,args:{etag:string|null;policy:string;sourceUrl:string;tocPath:string;root:string;archiveKeyPath?:string}):Promise<TicPublication|undefined>{
 if(!entry||!args.etag||entry.etag!==args.etag||entry.policy!==args.policy)return;
 const root=resolve(args.root)+'/';
 if(!resolve(entry.receiptPath).startsWith(root)||!(await realpath(entry.receiptPath)).startsWith(root))throw new Error('Prepared receipt outside archive');
 const receipt=await validatePublication(JSON.parse(await readFile(entry.receiptPath,'utf8')),args.archiveKeyPath);
 if(sourceIdentity(receipt.sourceUrl)!==sourceIdentity(args.sourceUrl))return;
 if(!resolve(receipt.sourcePath).startsWith(root))throw new Error('Prepared source outside archive');
 for(const path of [receipt.sourceArchive?receipt.sourceArchive.proofPath:receipt.sourcePath,receipt.tocPath,receipt.membershipPath])if(!(await realpath(path)).startsWith(root))throw new Error('Prepared bytes outside archive');
 if(planMappingIdentity(receipt.plans)!==planMappingIdentity(await tocPlans(args.tocPath,args.sourceUrl)))return;
 return receipt;
}
