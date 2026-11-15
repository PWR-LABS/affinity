/** Refresh bounded official Marketplace metadata before compiling a production release. */
const {spawnSync}=require('node:child_process');
if(process.env.RENDER==='true'){
 if(process.env.RENDER_SERVICE_ID!=='srv-d9227o9kh4rs73c4i1tg'||process.env.RENDER_GIT_BRANCH!=='main'){
  console.error('Marketplace release target rejected.');process.exitCode=1;
 }else{
  const run=spawnSync(process.execPath,['--import','tsx','scripts/update-marketplace-catalog.ts'],{stdio:'inherit',timeout:180000});
  if(run.error||run.status!==0){console.error('Official Marketplace release verification failed; preserving previous deployment.');process.exitCode=1;}
 }
}
