import { readFileSync } from 'node:fs'
import { createMemory } from '../motor/memoria.mjs'
const args=process.argv.slice(2),command=args.shift()
const options=Object.fromEntries(Array.from({length:Math.floor(args.length/2)},(_,i)=>[args[2*i],args[2*i+1]]))
if(!options['--root'])throw new Error('Indica --root con la carpeta privada de memoria del motor.')
const memory=createMemory(options['--root'])
if(command==='status')console.log(JSON.stringify(memory.status()))
else if(command==='search')console.log(JSON.stringify(memory.search(options['--query']||'',{project:options['--project']||'',client:options['--client']||''}),null,2))
else if(command==='put'){
  if(!options['--file']||!options['--source'])throw new Error('Indica --file Markdown revisado y --source con su procedencia.')
  const id=memory.put({layer:options['--layer'],title:options['--title'],content:readFileSync(options['--file'],'utf8'),source:options['--source'],project:options['--project']||'',client:options['--client']||'',id:options['--id'],trusted:true})
  console.log(JSON.stringify({saved:true,id}))
}else if(command==='remove'){memory.remove(options['--id']);console.log(JSON.stringify({removed:true}))}
else throw new Error('Usa status, search, put o remove.')
