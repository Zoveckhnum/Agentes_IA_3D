import {readFileSync,readdirSync,lstatSync,existsSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
export const ZONE='America/Mexico_City'
export const CLOSED_MESSAGE='Oficina fuera de horario, se retoman actividades a las 07:00 am del día siguiente.'
export const MANUAL_CLOSED_MESSAGE='Oficina fuera de horario. Las actividades se retomarán cuando el CEO autorice la reapertura.'
export const officeClosedMessage=state=>state.autoResume===false?MANUAL_CLOSED_MESSAGE:CLOSED_MESSAGE
export function nextOpening(now=new Date()){
 const parts=date=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]))
 const p=parts(now),day=new Date(Date.UTC(p.year,p.month-1,p.day+1)),target=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),7)
 let candidate=target
 for(let n=0;n<3;n++){const z=parts(new Date(candidate)),actual=Date.UTC(z.year,z.month-1,z.day,z.hour,z.minute,z.second);candidate+=target-actual}
 return new Date(candidate).toISOString()
}
export function isHumanCeo(actor,profile){return !!actor&&!actor.worker&&!actor.mustChangePassword&&!!actor.uid&&['admin','empleado'].includes(profile?.role)&&profile?.executiveRole==='ceo'}
export function readOfficeState(file){
 if(!file)return {format:'stackbi-office-state-v1',mode:'open',revision:0}
 if(!existsSync(file))throw new Error('office_state_missing')
 const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw new Error('office_state_invalid')
 const state=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''))
 if(state.format!=='stackbi-office-state-v1'||!['open','closing','closed','opening','error'].includes(state.mode)||!Number.isSafeInteger(state.revision)||state.revision<0)throw new Error('office_state_invalid')
 return state
}
export const officeUnavailable=state=>state.mode!=='open'
export function publicOfficeState(state){return {mode:state.mode,revision:state.revision,message:state.mode==='open'?'Oficina abierta.':officeClosedMessage(state),reopenAt:state.autoResume===false?null:state.reopenAt||null,timeZone:ZONE,autoResume:state.autoResume!==false}}
export function atomicOfficeJson(file,value){const temp=file+'.'+randomUUID()+'.tmp',fd=openSync(temp,'wx');try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd)}finally{closeSync(fd)}renameSync(temp,file)}
export function enqueueOfficeCommand(root,{action,actor,profile,sessionHash,revision,now=new Date()}){
 if(!isHumanCeo(actor,profile)||!actor.tokenHash||sessionHash!==actor.tokenHash||!/^[a-f0-9]{64}$/.test(sessionHash))throw new Error('office_ceo_required')
 if(!['close','open'].includes(action)||!Number.isSafeInteger(revision)||revision<0)throw new Error('office_command_invalid')
 if(readdirSync(join(root,'requests')).length>=64)throw new Error('office_command_queue_full')
 const id=randomUUID(),command={format:'stackbi-office-command-v1',id,action,uid:actor.uid,sessionHash,expectedRevision:revision,createdAt:now.toISOString()}
 atomicOfficeJson(join(root,'requests',id+'.json'),command)
 return {id,action,accepted:true}
}
