import {join} from 'node:path'
import {createTokenMeter,loadTokenPolicy} from '../motor/token-optimization.mjs'
const args=process.argv.slice(2)
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]}
const root=option('--root')||process.env.AGENTES_STATE_ROOT
if(!root)throw new Error('Indica --root con la carpeta de datos del motor, o AGENTES_STATE_ROOT.')
const meter=createTokenMeter(join(root,'state','tokens'),{policy:loadTokenPolicy(option('--policy')||process.env.AGENTES_TOKEN_POLICY)})
console.log(JSON.stringify(meter.report({taskId:option('--task'),projectId:option('--project')}),null,2))
