import {createDatabase,sql} from '../server/src/db.mjs'
import {applicationConfig} from '../server/src/config.mjs'
const database=createDatabase(),config=applicationConfig()
try{
 const pool=await database.pool(),tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
 try{
  const result=await new sql.Request(tx).input('path',sql.NVarChar(450),'users/'+config.ownerUid).input('uid',sql.NVarChar(128),config.ownerUid).query('SELECT d.Payload FROM app.Documents d WITH(UPDLOCK,HOLDLOCK) JOIN app.Accounts a ON a.Uid=@uid WHERE d.Path=@path AND a.Disabled=0 AND a.MustChangePassword=0')
  const profile=result.recordset[0]&&JSON.parse(result.recordset[0].Payload)
  if(!profile||profile.role!=='admin'||String(profile.position).trim().toUpperCase()!=='CEO')throw new Error('Existing human owner must already hold the CEO position')
  if(profile.executiveRole!=='ceo')await new sql.Request(tx).input('path',sql.NVarChar(450),'users/'+config.ownerUid).query("UPDATE app.Documents SET Payload=JSON_MODIFY(Payload,'$.executiveRole','ceo'),UpdatedAt=SYSUTCDATETIME() WHERE Path=@path; INSERT INTO app.AuditLog(Actor,Action,DocumentPath) VALUES(N'office-setup',N'ceo-permission-bootstrap',@path)")
  await tx.commit()
 }catch(error){await tx.rollback().catch(()=>{});throw error}
 await new sql.Request(pool).query("IF SUSER_ID(N'NT SERVICE\\StackBI-OfficeControl') IS NULL CREATE LOGIN [NT SERVICE\\StackBI-OfficeControl] FROM WINDOWS; IF USER_ID(N'NT SERVICE\\StackBI-OfficeControl') IS NULL CREATE USER [NT SERVICE\\StackBI-OfficeControl] FOR LOGIN [NT SERVICE\\StackBI-OfficeControl]; GRANT SELECT ON OBJECT::app.Documents TO [NT SERVICE\\StackBI-OfficeControl]; GRANT SELECT ON OBJECT::app.Accounts TO [NT SERVICE\\StackBI-OfficeControl]; GRANT SELECT,INSERT,DELETE ON OBJECT::app.Sessions TO [NT SERVICE\\StackBI-OfficeControl]; GRANT UPDATE ON OBJECT::app.Accounts (FailedLogins,LockedUntil) TO [NT SERVICE\\StackBI-OfficeControl];")
 console.log(JSON.stringify({ok:true,humanCeoConfigured:true,controlIdentity:'NT SERVICE\\StackBI-OfficeControl',ddlTablesAdded:false}))
}finally{await database.close()}
