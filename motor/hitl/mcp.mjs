import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { humanClient,approvalResult } from './client.mjs'
import {createSecurityAuditor} from '../security.mjs'
const client=humanClient()
const taskId=process.argv[2]||''
if(!/^[\w-]{0,100}$/.test(taskId))throw new Error('Invalid task binding')
const server=new McpServer({name:'aprobaciones',version:'1.0.0'})
const audit=createSecurityAuditor(process.env,{taskId})
const handle=fn=>async args=>{try{audit('tool_started',{subject:'human_approval'});const result=approvalResult(await fn(args));audit('tool_finished',{subject:'human_approval'});return {content:[{type:'text',text:JSON.stringify(result)}]}}catch{audit('tool_denied',{allowed:false,subject:'human_approval',reason:'approval_policy'});return {isError:true,content:[{type:'text',text:'No se pudo solicitar o consultar la aprobación. El operador debe revisar el plan y el servicio.'}]}}}
server.registerTool('solicitar_aprobacion',{description:'Solicita al propietario aprobar/rechazar por Telegram un plan YA preparado por el operador. Debes recibir el planId del propietario; no inventes planes. Solo solicita, nunca aprueba ni ejecuta. Espera el recibo executed antes de declarar realizada una operación.',inputSchema:{planId:z.string().uuid()},annotations:{destructiveHint:false,openWorldHint:true}},handle(async a=>{const record=await client('/request',{planId:a.planId,taskId});if(record.taskId!==taskId)throw new Error('Plan bound to another task');return record}))
server.registerTool('estado_aprobacion',{description:'Consulta el estado persistido de una solicitud. approved significa autorización; solo executed confirma que terminó el ejecutor.',inputSchema:{requestId:z.string().uuid()},annotations:{readOnlyHint:true}},handle(a=>client('/requests/'+a.requestId)))
await server.connect(new StdioServerTransport())
