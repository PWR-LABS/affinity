'use client';
import { createContext,useContext,useState,type Dispatch,type SetStateAction,type ReactNode } from 'react';
import { DEFAULT_MARKETPLACE_PLAN_YEAR } from '@/lib/marketplace/states';
import { initialContext,reconcileContext,type GuruContext } from '@/lib/guru/workspace';

type Store={context:GuruContext;setContext:Dispatch<SetStateAction<GuruContext>>;memory:Record<string,unknown>;setMemory:Dispatch<SetStateAction<Record<string,unknown>>>};
const Context=createContext<Store|null>(null);
export function GuruContextProvider({children}:{children:ReactNode}){
 const [context,rawSetContext]=useState(()=>initialContext(DEFAULT_MARKETPLACE_PLAN_YEAR));
 const setContext:Dispatch<SetStateAction<GuruContext>>=value=>rawSetContext(old=>reconcileContext(old,typeof value==='function'?value(old):value));
 const [memory,setMemory]=useState<Record<string,unknown>>({});
 return <Context.Provider value={{context,setContext,memory,setMemory}}>{children}</Context.Provider>;
}
export function useGuruStore(){return useContext(Context);}
/** Shared across client-side navigation, never URLs, localStorage or a database. */
export function useGuruField<K extends keyof GuruContext>(key:K,initial:GuruContext[K]):[GuruContext[K],Dispatch<SetStateAction<GuruContext[K]>>]{
 const store=useGuruStore(),[local,setLocal]=useState(initial);
 const set:Dispatch<SetStateAction<GuruContext[K]>>=value=>{
  if(!store){setLocal(value);return;}
  store.setContext(old=>({...old,[key]:typeof value==='function'?(value as (previous:GuruContext[K])=>GuruContext[K])(old[key]):value}));
 };
 return [store?store.context[key]:local,set];
}
export function useGuruMemory<T>(key:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
 const store=useGuruStore(),[local,setLocal]=useState(initial);
 const set:Dispatch<SetStateAction<T>>=value=>{
  if(!store){setLocal(value);return;}
  store.setMemory(old=>({...old,[key]:typeof value==='function'?(value as (previous:T)=>T)((old[key] as T)??initial):value}));
 };
 return [store?(store.memory[key] as T)??initial:local,set];
}
