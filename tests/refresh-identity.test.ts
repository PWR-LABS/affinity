import test from 'node:test';
import assert from 'node:assert/strict';
import { logicalKey } from '../scripts/lib/managed-publication';
test('Cigna generations retain one identity across filename and month partition changes',()=>{
 const url=(month:string)=>`https://d25kgz5rikkq4n.cloudfront.net/cost_transparency/mrf/in-network-rates/reporting_month=2026-${month}/2026-${month}-01_cigna_network_in-network-rates.json.gz`;
 assert.equal(logicalKey(url('10')),logicalKey(url('11')));
 assert.notEqual(logicalKey(url('10')),logicalKey(url('10').replace('cigna_network','cigna_other')));
});
test('signatures do not identify content but semantic query selectors do',()=>{
 assert.equal(logicalKey('https://example.com/source?Signature=one'),logicalKey('https://example.com/source?Signature=two'));
 assert.notEqual(logicalKey('https://example.com/source?network=one'),logicalKey('https://example.com/source?network=two'));
});

test('plan order changes do not force a new logical mapping',async()=>{
 const {planMappingIdentity}=await import('../scripts/lib/managed-publication');
 const a={planName:'A',planIdType:'ein' as const,planId:'111111111',planMarketType:'group'};
 const b={...a,planName:'B'};
 assert.equal(planMappingIdentity([a,b]),planMappingIdentity([b,a]));
 assert.notEqual(planMappingIdentity([a]),planMappingIdentity([b]));
});
