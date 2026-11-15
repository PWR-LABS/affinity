/** Private Air review transport. No credential, provider dispatch or budget pool.
 * Mini gateway must enforce the original benchmark's shared aggregate ledger.
 * Ordinary site/tool requests reach the existing Air loopback app; guru requests
 * reach only the existing SSH local forward. Never listen on a public interface. */
const http=require('node:http');
const REVIEW_ORIGIN='http://127.0.0.1:3013';
const NOTICE='Private guru review: real AI conversation with synthetic insurer/source evidence. Context you choose to provide may be real and is kept in protected private review records. This is not a live coverage or eligibility finding. Calls share the existing one-time benchmark cap; the service may stop when its allowance is exhausted.';
const json=(res,value)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
const server=http.createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:3013'||!req.url?.startsWith('/')||req.url.startsWith('//')||!['GET','HEAD','POST'].includes(req.method)){
  res.writeHead(403);res.end('Use the loopback review address.');return;
 }
 if(req.url==='/review'&&req.method==='GET'){
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});
  res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private guru review</title><style>body{font:18px/1.6 system-ui;max-width:44rem;margin:4rem auto;padding:1.5rem;color:#17221b}a{color:#156d43}</style><h1>Try the conversational guru</h1><p>'+NOTICE+'</p><p>You can use a fictional scenario or the personal context you have authorized for this private walkthrough. Your recent conversation and confirmed context are sent to OpenAI when connected mode is selected. Confirm only accurate suggested facts, then follow up or correct them. Source matches and coverage evidence here remain synthetic, even when your context is real. Private inputs and responses do not belong in public reports or test fixtures.</p><p>Review calls use the dedicated Mini gateway and its existing shared spending ledger. The public site remains unchanged.</p><p><a href="/">Open the private workspace →</a></p></html>');return;
 }
 const guru=req.url.split('?')[0]==='/api/guru';
 if(guru&&(req.method!=='POST'||req.headers.origin!==REVIEW_ORIGIN)){
  res.writeHead(403);res.end('Use connected guru from the private workspace.');return;
 }
 let body;
 try{
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>16000)throw Error('body limit');chunks.push(chunk);}
  body=Buffer.concat(chunks);
 }catch{res.writeHead(413);res.end('Please shorten this request.');return;}
 // Fixed fictional matches and unknown coverage. The private evaluation must
 // not require live CMS/insurer/production database access or personal inputs.
 const path=req.url.split('?')[0];let data={};
 if(body.length&&req.headers['content-type']?.includes('application/json')){try{data=JSON.parse(body.toString('utf8'));}catch{res.writeHead(400);res.end('Invalid JSON');return;}}
 if(path==='/api/providers/autocomplete'){json(res,{items:[{npi:'1234567890',name:'Dr Morgan Sample (fictional)',specialty:'Synthetic family medicine'},{npi:'1234567891',name:'Dr Taylor Example (fictional)',specialty:'Synthetic primary care'}]});return;}
 if(path==='/api/employers/search'){json(res,{items:[{ein:'111111111',name:'Synthetic Example Employer',state:'OH'}]});return;}
 if(path==='/api/tic/plans'){json(res,{items:[{planIdType:'ein',planId:'111111111',planName:'Synthetic Example Plan',issuer:'Synthetic review fixture'}]});return;}
 if(path==='/api/eligibility'){json(res,{year:data.year,verdict:'official_handoff',headline:'Private review: official coverage handoff',nextSteps:[NOTICE,'Use official Medicaid and Marketplace review; no live eligibility or subsidy calculation was run.']});return;}
 if(path==='/api/tic/verify'){json(res,{npi:data.npi,plan:{idType:data.planIdType,id:data.planId},value:'unknown',source:'SYNTHETIC_REVIEW_FIXTURE',evidenceStatus:'unknown',explanation:NOTICE});return;}
 if(path==='/api/plans'){json(res,{year:data.year,plans:[],totalPlans:0,notes:[NOTICE,'No live plan quotations were requested.']});return;}
 const upstream=http.request({hostname:'127.0.0.1',port:guru?3127:3012,path:req.url,method:req.method,
  headers:{...req.headers,host:guru?'127.0.0.1:3127':'127.0.0.1:3012','content-length':body.length},timeout:25000},reply=>{
   res.writeHead(reply.statusCode||502,{...reply.headers,'cache-control':'no-store'});reply.pipe(res);
  });
 // Never retry an uncertain model request. The Mini retains its reservation.
 upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({mode:'guided',error:'Private review gateway unavailable. Guided tools remain available.'}));});
 req.on('aborted',()=>upstream.destroy());upstream.end(body);
});
server.on('error',()=>{process.stderr.write('Private review proxy could not listen; no fallback interface was opened.\n');process.exitCode=1;});
server.listen(3013,'127.0.0.1',()=>process.stdout.write('Private review: '+REVIEW_ORIGIN+'/review (requires owned app3012 and approved SSH forward3127).\n'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
