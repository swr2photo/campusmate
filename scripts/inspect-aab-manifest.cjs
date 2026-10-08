// Decode the AAPT2 protobuf XML manifest extracted from an AAB, without
// inferring the release version from app.json.
const fs = require('node:fs');
function fields(buffer) {
  let p = 0; const result = [];
  function varint() {
    let value = 0, shift = 0, byte;
    do { if (p >= buffer.length || shift > 63) throw Error('Invalid protobuf'); byte = buffer[p++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  }
  while (p < buffer.length) {
    const key = varint(), number = key >> 3, type = key & 7; let value;
    if (type === 0) value = varint();
    else if (type === 2) { const length = varint(); value = buffer.subarray(p, p + length); p += length; }
    else if (type === 5 || type === 1) { const length = type === 5 ? 4 : 8; value = buffer.subarray(p, p + length); p += length; }
    else throw Error('Unsupported protobuf wire type');
    result.push({ number, type, value });
  }
  return result;
}
const root = fields(fs.readFileSync(process.argv[2]));
const element = fields(root.find(f => f.number === 1).value);
const attrs = element.filter(f => f.number === 4).map(f => fields(f.value));
const values = {};
for (const attr of attrs) {
  const name = attr.find(f => f.number === 2)?.value.toString();
  if (!['package', 'versionCode', 'versionName'].includes(name)) continue;
  const raw = attr.find(f => f.number === 3)?.value.toString();
  values[name] = raw || attr.find(f => f.number === 5)?.value.toString('hex');
}
console.log(JSON.stringify(values, null, 2));
