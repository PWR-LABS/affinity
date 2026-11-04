import { Prisma } from '@prisma/client';

/** Normalize only known issuer date partitions; network/file identities stay distinct. */
export function normalizeLedgerKey(key:string){
 return key.replace(/\d{4}-\d{2}-\d{2}/g,'{date}')
  .replace(/reporting_month=\d{4}-\d{2}/g,'reporting_month={month}')
  .replace(/\/\d{4}-\d{2}_/g,'/{month}_');
}
/** Reconcile already-published ledger keys without a destructive data migration. */
export const normalizedLedgerColumn=Prisma.sql`regexp_replace(regexp_replace("stableKey",'reporting_month=[0-9]{4}-[0-9]{2}','reporting_month={month}','g'),'/[0-9]{4}-[0-9]{2}_','/{month}_','g')`;
