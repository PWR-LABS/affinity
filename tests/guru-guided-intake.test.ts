import assert from 'node:assert/strict';
import test from 'node:test';
import { guidedContext } from '@/lib/guru/guided-intake';
import { guidedReply, initialContext } from '@/lib/guru/workspace';

test('guided and quota-fallback answers populate the same workspace and advance the question', () => {
 let context = initialContext(2027);
 context = guidedContext(context, '30', 'Thanks. How old are you?');
 const notice = "This browser’s AI allowance has been reached. Try again in a minute. ";
 const stateQuestion = notice + guidedReply('30', context, 'discover').reply;
 context = guidedContext(context, 'ohio', stateQuestion);
 assert.equal(context.age, '30');
 assert.equal(context.state, 'OH');
 context = guidedContext(context, 'no', guidedReply('ohio', context, 'discover').reply);
 assert.equal(context.employerOffer, 'none');
 context = guidedContext(context, '44113', guidedReply('no', context, 'discover').reply);
 assert.equal(context.zip, '44113');
 context = guidedContext(context, '$32,450', guidedReply('44113', context, 'discover').reply);
 assert.equal(context.income, '32450');
});

test('guided intake uses explicit details without assuming other household offers or guessing unlabeled numbers', () => {
 const initial = initialContext(2027);
 const working = guidedContext(initial, "I work part time. My job doesn't offer insurance.", '');
 assert.equal(working.employment, 'working');
 // A personal absence of coverage is not a confirmed household answer.
 assert.equal(working.employerOffer, 'unknown');
 assert.equal(guidedContext(initial, '2026', '').year, 2027);
 assert.equal(guidedContext(initial, '30', '').age, '');
 assert.equal(guidedContext(initial, 'Ohio or Indiana', 'Which state do you need coverage in?').state, '');
 assert.equal(guidedContext(initial, 'Are you sure I live in Ohio?', '').state, '');
 assert.equal(guidedContext(initial, 'I live in Ohio. Where should I apply?', '').state, 'OH');
 const next = guidedContext(initial, "I'm in Ohio, my ZIP is 44113, and I am 30", '');
 assert.equal(next.state, 'OH');
 assert.equal(next.zip, '44113');
 assert.equal(next.age, '30');
 assert.equal(guidedContext(next, 'I live in Pennsylvania', '').zip, '');
});

test('guided corrections use the same dependent-field invalidation as the workspace', () => {
 const initial = { ...initialContext(2027), npi: '1234567890', doctorQuery: 'Dr Lee', premiumBasis: 'self' as const };
 const corrected = guidedContext(initial, 'My doctor is Dr Rivera', '');
 assert.equal(corrected.doctorQuery, 'Dr Rivera');
 assert.equal(corrected.npi, '');
 assert.equal(guidedContext(corrected, 'household size is 2', '').premiumBasis, 'unknown');
 const premium = guidedContext(initial, '$82.50 every two weeks', 'What is the other option’s premium contribution and how often would you pay it?');
 assert.equal(premium.employerPremium, '82.5');
 assert.equal(premium.employerFrequency, 'biweekly');
 assert.equal(guidedContext(initial, '$80', 'What is the other option’s premium contribution and how often would you pay it?').employerPremium, '');
});
