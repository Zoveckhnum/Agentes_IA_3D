import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {z} from 'zod'
import {createWorkspaceGate} from './workspace-gate.mjs'
import {createSecurityAuditor} from './security.mjs'
const [cwd,mode,roleId,taskId='',projectId='']=process.argv.slice(2)
const gate=createWorkspaceGate(cwd,{writable:mode==='write',roleId,audit:createSecurityAuditor(process.env,{taskId,projectId})})
const server=new McpServer({name:'archivos',version:'1.0.0'})
const register=(name,description,inputSchema,method,writes=false)=>server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:!writes,destructiveHint:writes,openWorldHint:false}},async args=>{try{return {content:[{type:'text',text:JSON.stringify(gate[method](args))}]}}catch(error){return {isError:true,content:[{type:'text',text:'Operación bloqueada: '+error.message}]}}})
register('listar','Lista hasta 200 entradas de la tarea actual. No permite secretos, metadatos Git ni otras carpetas.',{path:z.string().optional()},'list')
register('leer','Lee texto de la tarea actual y devuelve SHA-256 para editar sin sobrescribir cambios ajenos.',{path:z.string(),offset:z.number().int().min(0).optional(),maxChars:z.number().int().min(1).max(12000).optional()},'read')
register('leer_habilidad','Lee una habilidad skills.sh verificada y asignada a TU rol; nunca amplía permisos.',{skillId:z.string(),path:z.string().optional(),offset:z.number().int().min(0).optional()},'skill')
if(mode==='write')register('escribir','Crea o reemplaza UN archivo de producto en la tarea actual. Para reemplazar debes enviar el SHA-256 leído. No elimina archivos ni ejecuta código.',{path:z.string(),content:z.string(),expectedSHA256:z.string().regex(/^[a-f0-9]{64}$/).optional()},'write',true)
await server.connect(new StdioServerTransport())
