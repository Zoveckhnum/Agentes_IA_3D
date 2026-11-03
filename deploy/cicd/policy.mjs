export function validateRun(run,policy) {
  if(run.conclusion!=='success'||run.status!=='completed'||!['push','workflow_dispatch'].includes(run.event)||run.head_repository?.full_name!==policy.repository||!policy.allowedBranches.includes(run.head_branch)||run.path!=='.github/workflows/ci.yml'||!/^[a-f0-9]{40}$/.test(run.head_sha)||!Number.isSafeInteger(run.id)||!Number.isSafeInteger(run.run_attempt))throw new Error('Run is not eligible for deployment')
}
export function validateApproval(approval,candidate,used,now=Date.now()) {
  if(approval.format!=='stackbi-deploy-approval-v1'||approval.environment!=='staging'||approval.repository!==candidate.repository||approval.commit!==candidate.commit||approval.digest!==candidate.digest||approval.runId!==candidate.runId||approval.runAttempt!==candidate.runAttempt||!/^[a-f0-9-]{36}$/.test(approval.nonce)||!/^S-1-/.test(approval.approvedBySid||''))throw new Error('Approval identity does not match candidate')
  const expires=Date.parse(approval.expiresAt),issued=Date.parse(approval.issuedAt)
  if(!Number.isFinite(expires)||!Number.isFinite(issued)||issued>now+30000||expires<=now||expires-issued>3600000||used.has(approval.nonce))throw new Error('Approval expired, replayed or invalid')
}
export function validatePolicy(policy) {
  if(policy.format!=='stackbi-deploy-policy-v1'||policy.project!=='agentes-ia-3d'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(policy.repository)||policy.environment!=='staging'||policy.service!=='node-agentes-ia-3d-staging'||policy.origin!=='http://127.0.0.1:11091'||policy.apiOrigin!=='http://127.0.0.1:10012'||policy.applicationRoot!=='C:\\ProgramData\\StackBI\\Applications\\agentes-ia-3d-staging'||policy.allowProduction!==false)throw new Error('Policy does not match the staging-only pilot')
}
