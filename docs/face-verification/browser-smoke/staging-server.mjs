// Loopback-only test UI/proxy for the actual Rust identity API. No AWS/R2
// operator credential or Firebase password is read or stored by this process.
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const dist=resolve(root,'dist');
const origin='http://127.0.0.1:4177';
const upstream='https://campusmate-backend-502731779521.fly.dev';
const cookie=randomBytes(32).toString('hex');
const config=JSON.parse(await readFile(resolve(root,'../../../google-services.json'),'utf8'));
if(config.project_info.project_id!=='campusmate-7f1ab')throw new Error('Unexpected Firebase project');
const android=config.client.find(c=>c.client_info.android_client_info.package_name==='com.campusmate.app');
const publicConfig={apiKey:android.api_key[0].current_key,projectId:'campusmate-7f1ab',authDomain:'campusmate-7f1ab.firebaseapp.com'};
const reply=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const server=http.createServer(async(req,res)=>{
  if(req.headers.host!=='127.0.0.1:4177')return reply(res,403,{error:'HOST_FORBIDDEN'});
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Permissions-Policy','camera=(self), microphone=()');
  if(!req.url.startsWith('/api/')){
    if(new URL(req.url,origin).pathname==='/')res.setHeader('Set-Cookie',`staging=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
    try{
      const path=decodeURIComponent(new URL(req.url,origin).pathname);
      const file=resolve(dist,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(dist+sep))return reply(res,403,{error:'PATH_FORBIDDEN'});
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');
      return res.end(await readFile(file));
    }catch{return reply(res,404,{error:'NOT_FOUND'});}
  }
  const actual=(req.headers.cookie||'').split('; ').find(c=>c.startsWith('staging='))?.slice(8)||'';
  if(actual.length!==cookie.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(cookie)))return reply(res,403,{error:'SESSION_REQUIRED'});
  if(req.method==='GET'&&req.url==='/api/config')return reply(res,200,publicConfig);
  if(req.method!=='GET'&&req.headers.origin!==origin)return reply(res,403,{error:'ORIGIN_FORBIDDEN'});
  // Fixed public hosts only: proves both serve the same avatar bytes. Logs the
  // outcome without the path (which contains the uid).
  if(req.method==='POST'&&req.url==='/api/photo-compare'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return reply(res,413,{error:'REQUEST_TOO_LARGE'});}
    let path;try{path=JSON.parse(body).path;}catch{return reply(res,400,{error:'BAD_REQUEST'});}
    if(typeof path!=='string'||!/^\/users\/[A-Za-z0-9_-]{1,128}\/avatar\.(jpe?g|png|webp)$/i.test(path))return reply(res,400,{error:'BAD_PATH'});
    const bust='cmpcheck='+randomBytes(8).toString('hex');
    const digest=async host=>{try{const r=await fetch(`https://${host}${path}?${bust}`,{redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!r.ok)return{status:r.status};const b=Buffer.from(await r.arrayBuffer());if(b.length>15*1024*1024)return{status:413};
      return{status:200,sha:createHash('sha256').update(b).digest('hex'),bytes:b.length};}catch{return{status:0};}};
    const [r2dev,cdn]=await Promise.all([digest('pub-73287d4af57d4e788f89d95e71d2ea70.r2.dev'),digest('images.getcampusmate.app')]);
    const same=Boolean(r2dev.sha&&r2dev.sha===cdn.sha);
    console.log('PHOTO_COMPARE '+JSON.stringify({r2devStatus:r2dev.status,cdnStatus:cdn.status,same,bytesEqual:r2dev.bytes===cdn.bytes}));
    return reply(res,200,{r2devStatus:r2dev.status,cdnStatus:cdn.status,same});
  }
  if(!/^\/api\/identity\/[a-zA-Z0-9/-]+$/.test(req.url)||!['GET','POST','DELETE'].includes(req.method))return reply(res,404,{error:'NOT_FOUND'});
  if(!/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(req.headers.authorization||''))return reply(res,401,{error:{code:'unauthenticated'}});
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>65536)return reply(res,413,{error:'REQUEST_TOO_LARGE'});}
    const response=await fetch(upstream+req.url.replace('/api/identity/','/v1/identity/'),{
      method:req.method,headers:{Authorization:req.headers.authorization,'Content-Type':'application/json'},
      ...(req.method==='POST'?{body:body||'{}'}:{}),redirect:'error',signal:AbortSignal.timeout(45000),
    });
    reply(res,response.status,await response.json());
  }catch{reply(res,502,{error:{code:'unavailable'}});}
});
server.listen(4177,'127.0.0.1',()=>console.log('Rust staging test ready: http://127.0.0.1:4177/?rust'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
