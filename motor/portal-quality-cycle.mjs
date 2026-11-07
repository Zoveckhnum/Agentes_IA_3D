import {createHash} from 'node:crypto'
import {isPortalReview,portalReviewCriteria} from './calidad.mjs'
export const outputHash = text => createHash('sha256').update(text).digest('hex')
export function exclusivePortalQa(task){return isPortalReview(task)&&/^[a-f0-9-]{36}$/i.test(task.portalQaOnly?.requestId||'')&&typeof task.agentOutput==='string'&&outputHash(task.agentOutput)===task.portalQaOnly?.outputSHA256}

// Author correction is allowed only for concrete failed verdicts. Blocked QA,
// permissions, missing information and invalid verdicts never trigger the author.
export async function portalQualityCycle({task,result,review,correct,allowCorrections=true,onStage=async()=>{}}) {
 let quality,corrections=0
 let usedCorrections=Number.isInteger(task.qualityCorrectionCount)?Math.min(2,Math.max(0,task.qualityCorrectionCount)):0
 const history=Array.isArray(task.qualityHistory)?task.qualityHistory.slice(-8):[]
 if(task.qualityCheckedAt&&!history.some(h=>h.qualityCheckedAt===task.qualityCheckedAt))history.push({qualityStatus:task.qualityStatus,qualityCheckedAt:task.qualityCheckedAt,qualityRevision:task.qualityRevision,reviews:task.qualityReviews||[],kind:'previous'})
 const enabled=isPortalReview(task)
 while(true){
  await onStage('reviewing',usedCorrections)
  quality=await review(result)
  history.push({qualityStatus:quality.qualityStatus,qualityCheckedAt:quality.qualityCheckedAt,qualityRevision:quality.qualityRevision,reviews:quality.qualityReviews||[],kind:corrections?'correction':'review',outputSHA256:outputHash(result)})
  if(!enabled||!allowCorrections||quality.qualityStatus!=='failed'||usedCorrections>=2||!(quality.qualityReviews||[]).some(r=>r.verdict==='failed'&&r.issues?.some(x=>x.trim())))break
  usedCorrections++
  await onStage('correcting',usedCorrections)
  const response=await correct({result,quality,criteria:portalReviewCriteria(task),cycle:usedCorrections})
  if(!response?.result?.trim()||response.blocked){quality={...quality,qualityStatus:'blocked',qualityCheckedAt:new Date().toISOString(),qualityReviews:[...quality.qualityReviews,{verdict:'blocked',summary:response?.reason||'No se pudo completar la corrección del autor.',evidence:[],issues:[]}]};break}
  result=response.result;corrections++
 }
 return{result,quality:{...quality,...(enabled?{qualityHistory:history.slice(-12),qualityCorrectionCount:usedCorrections}:{})},corrections}
}
