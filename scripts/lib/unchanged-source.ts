import { readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sha256 } from '../../src/lib/tic/publication';

/** Some issuer CDNs reject HEAD but honor a normal conditional GET. */
export async function conditionalSourceUnchanged(url:string,etag:string,fetcher=fetch):Promise<boolean>{
 try {
 const response=await fetcher(url,{headers:{'If-None-Match':etag,'Accept-Encoding':'identity'},redirect:'error',signal:AbortSignal.timeout(30000)});
 await response.body?.cancel();
 return response.status===304;
 } catch { return false; } // A failed metadata request never bypasses the bounded full GET.
}

/** Remove only this run's duplicate download after its existing publication readback. */
export async function reclaimDuplicateDownload(path:string,retained:string,expected:string,guard:()=>void){
 guard();
 if(resolve(path)===resolve(retained)||await realpath(path)!==resolve(path)||await realpath(retained)!==resolve(retained))throw new Error('Unsafe duplicate archive');
 if(await sha256(path)!==expected||await sha256(retained)!==expected)throw new Error('Duplicate archive hash mismatch');
 const receipt=JSON.parse(await readFile(join(dirname(path),'download.json'),'utf8'));
 if(receipt.sha256!==expected)throw new Error('Duplicate download receipt mismatch');
 guard();await writeFile(join(dirname(path),'retention.json'),JSON.stringify({reason:'identical bytes; validated original and publication retained',removed:path,retained,sha256:expected,observedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
 guard();await unlink(path);
}
