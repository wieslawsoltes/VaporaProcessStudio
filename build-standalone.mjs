/** A deliberately small, dependency-free bundler for this project's static named ESM imports.
 * Each module gets an isolated lexical scope. Unknown import/export forms fail the build.
 * Browser source stays native ESM; standalone workers use a classic Blob bundle so that
 * they also work on file:// and other contexts where Blob module imports are restricted.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
const sources = {};
for (const file of (await readdir(new URL('./src/', import.meta.url))).filter(f => f.endsWith('.js'))) sources[file] = await readFile(new URL('./src/' + file, import.meta.url), 'utf8');
const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?/g;
function bundle(entry) {
  const visited = new Set(), active = new Set(), order = [], requested = Object.create(null);
  function visit(name) {
    if (visited.has(name)) return;
    if (!Object.hasOwn(sources,name) || active.has(name)) throw new Error('Invalid dependency: ' + name);
    active.add(name);
    for (const [,names,dep] of sources[name].matchAll(importPattern)) {
      requested[dep] ??= new Set();
      for (const binding of names.split(',').map(s => s.trim()).filter(Boolean)) {
        if (!/^[A-Za-z_$][\w$]*$/.test(binding)) throw new Error('Unsupported binding: '+binding);
        requested[dep].add(binding);
      }
      visit(dep);
    }
    active.delete(name);visited.add(name);order.push(name);
  }
  visit(entry);
  return '"use strict";\n(()=>{\nconst __modules=Object.create(null);\n' + order.map(name => {
    let code = sources[name].replace(importPattern, (_, names, dep) => `const {${names}}=__modules[${JSON.stringify(dep)}];`);
    code = code.replace(/\bexport\s+(?=(?:const|let|function|class)\b)/g, '');
    // The standalone defines __VAPORA_WORKER_SOURCE__, so this branch is never used.
    code = code.replace("new URL('./worker.js',import.meta.url)", "'./src/worker.js'");
    if (/^\s*(?:import\s|export\s)/m.test(code) || code.includes('import.meta')) throw new Error('Unsupported ESM syntax in '+name);
    return `__modules[${JSON.stringify(name)}]=(()=>{\n${code}\nreturn {${[...(requested[name] ?? [])].join(',')}};\n})();\n`;
  }).join('\n') + '\n})();';
}
const workerSource = bundle('worker.js');
const mainSource = bundle('main.js');
let html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
const loader = `globalThis.__VAPORA_WORKER_SOURCE__=${JSON.stringify(workerSource).replaceAll('<','\\u003c')};\n${mainSource}`;
html = html.replace('<link rel="stylesheet" href="styles.css" />', '<style>\n'+css+'\n</style>');
html = html.replace('<script type="module" src="src/main.js"></script>', '<script>\n'+loader.replaceAll('</script','<\\/script')+'\n</script>');
await writeFile(new URL('./Vapora-Process-Studio.html', import.meta.url), html);
console.log('Built Vapora-Process-Studio.html ('+new TextEncoder().encode(html).length.toLocaleString()+' bytes; zero runtime dependencies).');
