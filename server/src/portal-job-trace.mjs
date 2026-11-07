const text=(v,n=1200)=>typeof v==='string'?v.slice(0,n):''
const stamp=v=>{const ms=v?.$type==='timestamp'?Number(v.seconds)*1000+Number(v.nanoseconds||0)/1e6:typeof v==='string'?Date.parse(v):NaN;return Number.isFinite(ms)?new Date(ms).toISOString():null}
const reason=v=>/^(No se completó la revisión de Codex:)|(?:Bearer\s|(?:password|api.?key|secret|authorization)\s*[:=])/i.test(String(v))?'No se pudo completar la revisión técnica. Requiere revisión en la oficina.':text(v)
export function portalJobTrace(task,agent,id,officeOrigin){
 let officeTaskUrl=null;try{const u=new URL(officeOrigin);if(u.protocol==='https:'&&!u.username&&!u.password)officeTaskUrl=u.origin+'/portal-task.html?task='+encodeURIComponent(id)}catch{}
 return{taskId:id,agent:{id:text(task.asignado,160),name:text(agent?.name,200)||'Agente asignado',role:text(agent?.rol||agent?.role,100)},officeTaskUrl,
  createdAt:stamp(task.createdAt),startedAt:stamp(task.fechaInicio),resultRecordedAt:stamp(task.agentLastRunAt),qualityCheckedAt:stamp(task.qualityCheckedAt),deliveryRecordedAt:stamp(task.fechaEntrega),
  durationSeconds:Number.isFinite(task.totalTimeSeconds)&&task.totalTimeSeconds>=0?task.totalTimeSeconds:null,runCount:Number.isInteger(task.agentRuns)&&task.agentRuns>=0?task.agentRuns:0,
  qualityRevision:text(task.qualityRevision,100)||null,qualityStatus:text(task.qualityStatus,40)||null,
  history:(Array.isArray(task.qualityHistory)?task.qualityHistory:[]).slice(-12).map(h=>({qualityStatus:text(h.qualityStatus,40),qualityCheckedAt:stamp(h.qualityCheckedAt),qualityRevision:text(h.qualityRevision,100),kind:text(h.kind,40),reviews:portalJobTrace({...task,qualityHistory:[],qualityReviews:h.reviews||[]},null,id,officeOrigin).reviews})),

  reviews:(Array.isArray(task.qualityReviews)?task.qualityReviews:[]).slice(0,20).map(r=>({role:text(r.role,100),reviewerId:text(r.reviewerId,160),reviewerName:text(r.reviewerName,200),verdict:['passed','failed','blocked'].includes(r.verdict)?r.verdict:'unknown',summary:reason(r.summary),evidence:(Array.isArray(r.evidence)?r.evidence:[]).slice(0,8).map(v=>reason(v).slice(0,400)),issues:(Array.isArray(r.issues)?r.issues:[]).slice(0,8).map(v=>reason(typeof v==='string'?v:JSON.stringify(v)).slice(0,400))}))}
}
