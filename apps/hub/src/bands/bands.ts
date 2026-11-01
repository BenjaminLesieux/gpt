/**
 * Who is in which band. Membership is to the band, never to a score: being in
 * a band is what makes every one of its scores yours (ADR 0012).
 */

import { and, asc, eq } from 'drizzle-orm';
import type { HubDatabase } from '../db/client';
import { accounts, bandMembers, bands } from '../db/schema';
import { newId } from '../ids';

export type BandRole = 'owner' | 'member';

/** A band as one of its members sees it. */
export interface MemberBand {
  id: string;
  name: string;
  role: BandRole;
}

/** A band with its first member, its owner. Callers wrap it in their own transaction. */
export function createBand(
  db: HubDatabase,
  name: string,
  ownerId: string,
  now: Date = new Date()
): string {
  const id = newId();
  db.insert(bands).values({ id, name, createdAt: now }).run();
  addBandMember(db, id, ownerId, 'owner', now);
  return id;
}

/**
 * The unique index on `(band_id, account_id)` means a second call for the same
 * pair throws rather than quietly making a person a member twice.
 */
export function addBandMember(
  db: HubDatabase,
  bandId: string,
  accountId: string,
  role: BandRole,
  now: Date = new Date()
): void {
  db.insert(bandMembers).values({ id: newId(), bandId, accountId, role, createdAt: now }).run();
}

/** Null covers "no such band" and "not yours", as a score read does. */
export function readMemberBand(
  db: HubDatabase,
  bandId: string,
  accountId: string
): MemberBand | null {
  const row = db
    .select({ id: bands.id, name: bands.name, role: bandMembers.role })
    .from(bandMembers)
    .innerJoin(bands, eq(bandMembers.bandId, bands.id))
    .where(and(eq(bandMembers.bandId, bandId), eq(bandMembers.accountId, accountId)))
    .get();
  return row ?? null;
}

/** Every band this account is in, oldest membership first — the band of one leads. */
export function listMemberBands(db: HubDatabase, accountId: string): MemberBand[] {
  return db
    .select({ id: bands.id, name: bands.name, role: bandMembers.role })
    .from(bandMembers)
    .innerJoin(bands, eq(bandMembers.bandId, bands.id))
    .where(eq(bandMembers.accountId, accountId))
    .orderBy(asc(bandMembers.createdAt))
    .all();
}

/** The people in a band, oldest first, so the owner who made it leads. */
export function listBandMembers(db: HubDatabase, bandId: string) {
  return db
    .select({ id: bandMembers.accountId, email: accounts.email, role: bandMembers.role })
    .from(bandMembers)
    .innerJoin(accounts, eq(bandMembers.accountId, accounts.id))
    .where(eq(bandMembers.bandId, bandId))
    .orderBy(asc(bandMembers.createdAt))
    .all();
}

/** What signup calls a solo musician's band: the email's local part. */
export function bandNameFor(email: string): string {
  return email.split('@')[0] || email;
}
