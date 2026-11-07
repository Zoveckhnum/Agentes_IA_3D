import {portalJobTrace} from './portal-job-trace.mjs'
const find=id=>document.getElementById(id),taskId=new URLSearchParams(location.search).get('task')||''
const stamp=s=>s?new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'short',timeStyle:'medium',hourCycle:'h23'}).format(new Date(s)):'Sin registro'
const read=async path=>{const r=await fetch('/api/data/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'document',path})});if(!r.ok)throw new Error([401,403].includes(r.status)?'access':'unavailable');return(await r.json()).data}
let busy=false
async function refresh(){
 if(busy)return;busy=true;find('refresh').disabled=true
 try{
  if(!/^portal-[a-z0-9-]+-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(taskId)||taskId.length>200)throw new Error('invalid')
  const task=await read('tasks/'+taskId);if(!task)throw new Error('missing');const agent=task.asignado?await read('agents/'+task.asignado):null,trace=portalJobTrace(task,agent,taskId,location.origin)
  const blocked=trace.qualityStatus==='blocked'||trace.qualityStatus==='failed'||trace.reviews.some(r=>['blocked','failed'].includes(r.verdict)),passed=trace.qualityStatus==='passed'&&trace.reviews.length&&trace.reviews.every(r=>r.verdict==='passed'&&r.evidence.some(e=>e.trim())&&!r.issues.length)
  find('title').textContent=task.tarea||'Tarea de integración'
  find('status').textContent=task.agentStatus==='running'?'Agente trabajando':task.agentStatus==='reviewing'?'Revisión de calidad en curso':blocked?'Generado · QA bloqueada':passed?'QA aprobada · consultar revisión humana':task.agentStatus==='needs_info'?'El agente necesita información':'Resultado sujeto a revisión'
  find('status').className='status'+(blocked?' warning':'')
  const facts=[['Agente',trace.agent.name],['Tarea',taskId],['Creada',stamp(trace.createdAt)],['Inicio registrado',stamp(trace.startedAt)],['Duración registrada',trace.durationSeconds!=null?trace.durationSeconds+' segundos':'Sin registro'],['Ejecuciones del autor',String(trace.runCount)]]
  find('facts').replaceChildren(...facts.map(([label,value])=>{const box=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;box.append(dt,dd);return box}))
  find('reviews').replaceChildren(...(trace.reviews.length?trace.reviews.map(r=>{const p=document.createElement('p');p.textContent=`${r.reviewerName||r.role||'QA'} · ${{passed:'Aprobada',failed:'Con defectos',blocked:'Bloqueada'}[r.verdict]||'Sin verificar'}: ${r.summary}`;return p}):[Object.assign(document.createElement('p'),{textContent:'Sin aprobación de QA verificada.'})]))
  const milestones=[['Tarea creada',trace.createdAt],['Inicio registrado',trace.startedAt],['Resultado registrado',trace.resultRecordedAt],['Revisión de calidad registrada',trace.qualityCheckedAt],['Entrega registrada',trace.deliveryRecordedAt]].filter(([,at])=>at).sort((a,b)=>a[1].localeCompare(b[1]))
  find('timeline').replaceChildren(...milestones.map(([label,at])=>{const li=document.createElement('li'),time=document.createElement('time');li.textContent=label;time.textContent=stamp(at);li.append(time);return li}))
  find('output').textContent=task.agentOutput||task.agentQuestion||'Sin respuesta disponible todavía.'
  find('card').hidden=false;find('notice').textContent='Actualizado: '+stamp(new Date().toISOString())
 }catch(e){find('card').hidden=true;find('notice').textContent=e.message==='access'?'Inicia sesión desde Abrir oficina. Después regresa a esta tarjeta y pulsa Actualizar tarea.':e.message==='invalid'?'El enlace de la tarea no es válido.':e.message==='missing'?'La tarea no está disponible para esta cuenta.':'No se pudo consultar la tarea. Pulsa Actualizar para reintentar.'}
 finally{busy=false;find('refresh').disabled=false}
}
find('refresh').addEventListener('click',refresh);void refresh();setInterval(()=>{if(document.visibilityState==='visible')void refresh()},15000)
