import test from 'node:test';
import assert from 'node:assert/strict';
import {REFRESH_POLICY,sourceWorkspaceReserve,publicationCapacity} from '../scripts/lib/refresh-policy';
test('large local processing reserves scratch while preserving compact publication limits',()=>{
 assert.equal(sourceWorkspaceReserve(),6_500_000_000);
 assert.throws(()=>sourceWorkspaceReserve(REFRESH_POLICY.sourceBytes+1),/source_size_limit/);
 assert.equal(publicationCapacity(1_507_530_431,200_000,30_000).allowed,true);
 assert.equal(publicationCapacity(1_507_530_431,200_001,1).allowed,false);
 assert.equal(publicationCapacity(2_450_000_000,100_000,1).allowed,false);
 assert.equal(publicationCapacity(1_507_530_431,1,30_001).allowed,false);
 assert.equal(publicationCapacity(1,1,1).cloudResourceChange,false);
});
