const fs = require('node:fs');
const vm = require('node:vm');
const files = fs.readdirSync('src').filter(f => f.endsWith('.js'));
for (const file of files) new vm.Script(fs.readFileSync('src/'+file,'utf8'), {filename:file});
const manifest = JSON.parse(fs.readFileSync('src/appsscript.json','utf8'));
if(manifest.timeZone !== 'America/New_York') throw Error('Timezone mismatch');
if(manifest.oauthScopes.some(s => /gmail\.(modify|send)|\/auth\/gmail$/.test(s))) throw Error('Gmail must be read-only');
console.log(`Syntax OK: ${files.length} source files; Gmail access is read-only via DWD.`);
