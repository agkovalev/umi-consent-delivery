import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store, digest, versionPattern } from './store.js';
import { files, type Envelope, type Manifest } from './releases.js';

export function buildApp(store: Store, logger = false) {
  const app = Fastify({logger:logger ? {redact:['req.headers.authorization'],serializers:{req(req){return {method:req.method,url:req.url?.split('?')[0],remoteAddress:req.ip};}}} : false, bodyLimit:1024, requestTimeout:10000});
  app.decorateRequest('site', null);
  app.addHook('onRequest',async (req,reply) => {
    reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff');
    if (req.url.split('?')[0] === '/health') return;
    const auth = req.headers.authorization;
    const site = typeof auth === 'string' && auth.startsWith('Bearer ') ? store.authenticate(auth.slice(7)) : undefined;
    if (!site) return reply.code(401).send({error:'Unauthorized'});
    req.site = site;
  });
  app.get('/health',async () => ({ok:true}));
  app.get('/v1/manifest',async (req,reply) => {
    const site=req.site!;
    if (!site.target || !store.allowed(site.id,site.target)) return reply.code(403).send({error:'No approved release'});
    return reply.type('application/json').send(store.envelope(site.target));
  });
  app.get<{Params:{version:string;name:string}}>('/v1/releases/:version/files/:name',async (req,reply) => {
    const {version,name}=req.params;
    if (!versionPattern.test(version) || !files.includes(name as typeof files[number]) || !store.allowed(req.site!.id,version)) return reply.code(403).send({error:'Forbidden'});
    const envelope:Envelope=JSON.parse(store.envelope(version)!);
    const manifest:Manifest=JSON.parse(Buffer.from(envelope.manifest,'base64').toString());
    const expected=manifest.files.find(file=>file.name===name)!;
    const data=readFileSync(join(store.root,'releases',version,name));
    if (data.length!==expected.size || digest(data)!==expected.sha256) return reply.code(503).send({error:'Release integrity failure'});
    return reply.type('application/octet-stream').send(data);
  });
  app.setErrorHandler((error,request,reply)=>{request.log.error({err:error},'Request failed');reply.code(500).send({error:'Internal error'});});
  return app;
}
declare module 'fastify' { interface FastifyRequest { site:{id:string;target:string|null}|null; } }
