import {fileURLToPath} from 'node:url'

// Resolve from the running release, independently of a legacy absolute staticRoot.
export function mountPortalTaskAssets(app) {
  for (const name of ['portal-task.html','portal-task.js','portal-task.css','portal-job-trace.mjs']) {
    const asset = fileURLToPath(new URL(name === 'portal-job-trace.mjs' ? './'+name : '../public/'+name, import.meta.url))
    app.get('/'+name, (_req,res) => res.sendFile(asset, {cacheControl:false}))
  }
}
