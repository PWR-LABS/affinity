import test from 'node:test';
import assert from 'node:assert/strict';
import { renewedAnthemTransport } from '../scripts/lib/anthem-large-toc';
test('cached lineage retains its literal URL while fresh download signatures renew only the same object',()=>{
 const original='https://anthembcbsoh.mrf.bcbs.com/rate.json.gz?dataset=1&Signature=old&Expires=1';
 const renewed='https://anthembcbsoh.mrf.bcbs.com/rate.json.gz?dataset=1&Signature=new&Expires=9';
 assert.equal(renewedAnthemTransport(original,[renewed]),renewed);
 for(const invalid of [renewed.replace('dataset=1','dataset=2'),renewed.replace('rate.json','different.json'),renewed.replace('anthembcbsoh','other')])assert.throws(()=>renewedAnthemTransport(original,[invalid]),/identity mismatch/);
 assert.match(original,/Signature=old/);
});
