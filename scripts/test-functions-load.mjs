import * as funcs from '../functions/index.js';
console.log('Available exported functions:');
console.log(Object.keys(funcs).filter(k => k.includes('Membership') || k.includes('revenueCat')));
