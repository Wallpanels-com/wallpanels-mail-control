const {test}=require('node:test'),assert=require('node:assert/strict');
const {logFilter}=require('../scripts/runtime-status.cjs');
test('runtime audit filter excludes unrelated structured service records but retains console and failures',()=>{
 const filter=logFilter('2026-10-27T12:00:00.000Z','2026-10-27T17:00:00.000Z');
 assert.ok(filter.includes('timestamp >= "2026-10-27T12:00:00.000Z"'));
 assert.ok(filter.includes('timestamp <= "2026-10-27T17:00:00.000Z"'));
 assert.ok(filter.includes('(jsonPayload.message:* OR textPayload:* OR severity>=ERROR)'));
 assert.ok(!logFilter('2026-10-27T12:00:00.000Z').includes('undefined'));
});
