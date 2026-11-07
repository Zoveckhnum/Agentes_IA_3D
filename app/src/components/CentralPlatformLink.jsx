import React, {useEffect,useState} from 'react'
import {useLocalSql} from '../data/mode.js'
export function useCentralAccess(){
 const [config,setConfig]=useState(null)
 useEffect(()=>{
  if(!useLocalSql)return
  const controller=new AbortController()
  fetch('/api/auth/central/config',{credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])})
   .then(r=>r.ok?r.json():null).then(value=>{if(!controller.signal.aborted)setConfig(value)})
   .catch(()=>{if(!controller.signal.aborted)setConfig({failed:true})})
  return()=>controller.abort()
 },[])
 return config
}
export default function CentralPlatformLink(){
 const config=useCentralAccess()
 if(!config?.required||!config.portalUrl)return null
 try{const target=new URL(config.portalUrl);if(target.username||target.password||(target.protocol!=='https:'&&!(target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname))))return null}catch{return null}
 return <a className="dropdown-item" href={config.portalUrl}>Cambiar plataforma</a>
}
