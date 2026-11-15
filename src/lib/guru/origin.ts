/** Render terminates HTTPS before Next receives an internal HTTP request URL. */
export function guruOriginAllowed(req:Request,env:Record<string,string|undefined>){
 const expected=env.RENDER==='true'?'https://affinity.pwr-labs.ai':new URL(req.url).origin;
 return req.headers.get('origin')===expected;
}
