import { createHmac, timingSafeEqual } from 'node:crypto';
/** Short-lived, domain-separated operator readback proof; never a write capability. */
export function validReadinessProof(value:string|null,secret:string|undefined,now=Date.now()) {
 return validOperatorProof(value,secret,'guru-readiness',now);
}

export function validUsageProof(value:string|null,secret:string|undefined,month:string,now=Date.now()) {
 return validOperatorProof(value,secret,'guru-usage:'+month,now);
}

function validOperatorProof(value:string|null,secret:string|undefined,scope:string,now:number) {
 if(!secret||!/^(?:[0-9a-f]{2}){32,}$/i.test(secret)||!value)return false;
 const [timestamp,signature,extra]=value.split('.');
 if(extra||!/^\d{13}$/.test(timestamp??'')||! /^[a-f0-9]{64}$/.test(signature??''))return false;
 const age=now-Number(timestamp); if(age<0||age>300000)return false;
 const expected=createHmac('sha256',Buffer.from(secret,'hex')).update(scope+':'+timestamp).digest();
 return timingSafeEqual(Buffer.from(signature,'hex'),expected);
}
