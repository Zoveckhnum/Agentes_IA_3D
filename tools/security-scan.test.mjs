import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomBytes} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const scanner=fileURLToPath(new URL('security-scan.mjs',import.meta.url))
function fixture(){const root=mkdtempSync(join(tmpdir(),'stackbi-scan-'));const git=args=>execFileSync('git',['-c','core.hooksPath=NUL','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,windowsHide:true,stdio:'pipe'});git(['init']);return {root,git}}
function scan(root){const result=spawnSync(process.execPath,[scanner,'--root',root],{encoding:'utf8',windowsHide:true});return {result,report:JSON.parse(result.stdout.trim())}}
test('escáner detecta una credencial sintética eliminada del HEAD sin imprimirla',()=>{
 const {root,git}=fixture(),secret='sk-'+randomBytes(48).toString('hex');writeFileSync(join(root,'sample.txt'),secret);git(['add','sample.txt']);git(['commit','-m','fixture first']);unlinkSync(join(root,'sample.txt'));writeFileSync(join(root,'README.md'),'sin credenciales');git(['add','-A']);git(['commit','-m','fixture remove'])
 const {result,report}=scan(root);assert.equal(result.status,1);assert.equal(report.findings.length,1);assert.equal(report.findings[0].path,'sample.txt');assert.equal(result.stdout.includes(secret),false)
})
test('escáner excluye configuraciones privadas y diferencia plantillas sin leerlas',()=>{
 const {root,git}=fixture();writeFileSync(join(root,'.env'),'contenido privado');writeFileSync(join(root,'.env.example'),'plantilla');git(['add','-f','.env','.env.example']);git(['commit','-m','fixture private paths'])
 const {report}=scan(root);assert.deepEqual(report.privatePathsExcluded,['.env']);assert.deepEqual(report.templatesNotRead,['.env.example']);assert.equal(report.scannedBlobs,0);assert.equal(report.ok,false)
})
test('un encabezado PEM de documentación sin cuerpo no se presenta como clave',()=>{
 const {root,git}=fixture();writeFileSync(join(root,'README.md'),'Ejemplo de encabezado: -----BEGIN PRIVATE KEY-----');git(['add','README.md']);git(['commit','-m','fixture documentation']);const {report}=scan(root);assert.equal(report.ok,true);assert.equal(report.findings.length,0)
})
