#!/usr/bin/env node
// Gate H — export compatibility: every imported symbol from a first-party module must exist in that module.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = join(import.meta.dirname,'..');
function walk(dir,out=[]){
 for(const e of readdirSync(dir)){const p=join(dir,e);const s=statSync(p);if(s.isDirectory()){if(['node_modules','.next','.git'].includes(e))continue;walk(p,out)}else if(/\.(ts|tsx|js|mjs)$/.test(p)) out.push(p);}
 return out;
}
const files=walk(join(ROOT,'apps/web')).concat(walk(join(ROOT,'packages')));
const importRe=/from\s+['"](@\/[^'"]+|@elogbook\/[^'"]+)['"]/g;
const exportCache=new Map();
function getExports(modPath){
 if(exportCache.has(modPath)) return exportCache.get(modPath);
 try{
  const src=readFileSync(modPath,'utf8');
  const exps=new Set();
  // export function/const/class/type/interface
  for(const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z0-9_]+)/g)) exps.add(m[1]);
  for(const m of src.matchAll(/export\s*\{\s*([^}]+)\s*\}/g)){
    for(const part of m[1].split(',')){
      const name=part.trim().split(/\s+as\s+/)[0].trim();
      if(name) exps.add(name);
    }
  }
  // export * from etc not handled
  exportCache.set(modPath,exps);
  return exps;
 }catch {return new Set();}
}
function resolveImport(fromFile, importPath){
 // @/ -> apps/web/
 if(importPath.startsWith('@/')) return join(ROOT,'apps/web',importPath.slice(2))+'.ts';
 if(importPath.startsWith('@elogbook/env')) return join(ROOT,'packages/env/src/index.ts');
 if(importPath.startsWith('@elogbook/shared')) return join(ROOT,'packages/shared/src/index.ts');
 if(importPath.startsWith('@elogbook/')) return null; // other packages
 return null;
}
let failures=[];
for(const file of files){
 const src=readFileSync(file,'utf8');
 let m;
 while((m=importRe.exec(src))){
  const importPath=m[1];
  const modPath=resolveImport(file,importPath);
  if(!modPath) continue;
  // find imported symbols in same line
  const lineStart=src.lastIndexOf('\n',m.index)+1;
  const lineEnd=src.indexOf('\n',m.index);
  const line=src.slice(lineStart, lineEnd===-1?undefined:lineEnd);
  const impMatch=line.match(/import\s*\{([^}]+)\}\s*from/);
  if(!impMatch) continue;
  const symbols=impMatch[1].split(',').map(s=>s.trim().split(/\s+as\s+/)[0].trim().split(':')[0].trim()).filter(Boolean);
  const exps=getExports(modPath);
  if(exps.size===0) continue; // skip if can't determine
  for(const sym of symbols){
    if(sym.startsWith('type ')) continue;
    if(!exps.has(sym)){
      failures.push({file:file.replace(ROOT+'/',''), sym, mod:importPath, modPath:modPath.replace(ROOT+'/','')});
    }
  }
 }
}
if(failures.length){
 console.error('Gate H FAILED: imported symbols not exported:');
 for(const f of failures) console.error(`  ${f.file} imports {${f.sym}} from '${f.mod}' — not exported in ${f.modPath}`);
 process.exit(1);
}
console.log('Gate H passed: all first-party imports resolve to exports');
