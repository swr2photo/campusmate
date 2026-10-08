import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const c=vm.createContext({Date,Set,Array});
vm.runInContext(fs.readFileSync('src/utils/availabilityCalendar.js','utf8').replaceAll('export ',''),c);
for(const start of [new Date(2026,9,8),new Date(2026,11,27),new Date(2028,1,24),new Date(2026,2,7)]){
 test('calendar has exactly 14 selectable local dates from '+start.toDateString(),()=>{
  const days=c.nextAvailabilityDays(start);assert.equal(days.length,14);assert.equal(c.availabilityDateKey(days[0]),c.availabilityDateKey(start));
  const selectable=[];
  for(const month of c.availabilityMonths(days)){
   const cells=c.availabilityMonthCells(month,days);assert.equal(cells.length%7,0);
   for(const cell of cells.filter(Boolean))if(cell.available)selectable.push(cell.key);
   const first=cells.findIndex(Boolean);const [year,m]=month.split('-').map(Number);assert.equal(first,(new Date(year,m-1,1).getDay()+6)%7);
  }
  assert.deepEqual(Array.from(selectable),Array.from(days,c.availabilityDateKey));
  assert.equal(new Set(selectable).size,14);
 });
}
test('cross-year month navigation stays within the 14-day window',()=>{
 const days=c.nextAvailabilityDays(new Date(2026,11,27));assert.deepEqual(Array.from(c.availabilityMonths(days)),['2026-12','2027-01']);
});
test('deleting the same selected slot twice never removes the next row',()=>{
 const a={date:'2026-10-08',start:'18:00',end:'20:00'},b={date:'2026-10-09',start:'18:00',end:'20:00'};
 const key=c.availabilitySlotKey(a);const once=c.removeAvailabilitySlot([a,b],key);const twice=c.removeAvailabilitySlot(once,key);
 assert.equal(twice.length,1);assert.equal(twice[0],b);
});
test('deletion distinguishes time ranges and supports legacy weekday entries',()=>{
 const a={day:'mon',start:'18:00',end:'20:00'},b={day:'mon',start:'20:00',end:'22:00'};
 assert.equal(c.removeAvailabilitySlot([a,b],c.availabilitySlotKey(a))[0],b);
});
