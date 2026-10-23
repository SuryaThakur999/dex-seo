import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  let customer, website;
  try {
    ({ customer, website } = await resolveWebsiteForRequest(userId, params.id));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  const old = await db.clientProfile.findUniqueOrThrow({
    where: { id: website.clientProfileId },
    select: {
      businessDescription: true, audience: true, brandVoice: true,
      approvedClaims: true, restrictedWording: true, markets: true, languages: true,
    },
  });

  const result = await db.$transaction(async (tx) => {
    // New profile copies the old one's brand fields as a starting point -- the human
    // can diverge them afterward; the website's own normalizedHost is the real,
    // non-fabricated name (never an invented brand name).
    const newProfile = await tx.clientProfile.create({
      data: {
        customerId: customer.id,
        name: website.normalizedHost,
        isDefault: false,
        businessDescription: old.businessDescription,
        audience: old.audience,
        brandVoice: old.brandVoice,
        approvedClaims: old.approvedClaims,
        restrictedWording: old.restrictedWording,
        markets: old.markets,
        languages: old.languages,
      },
    });

    // Composite-FK order matters: ProfileSuggestion's FK is (websiteId, clientProfileId)
    // -> Website(id, clientProfileId), so the Website row must already carry the new
    // clientProfileId before any ProfileSuggestion row pointing at it is updated to match.
    await tx.website.update({ where: { id: website.id }, data: { clientProfileId: newProfile.id } });
    await tx.profileSuggestion.updateMany({ where: { websiteId: website.id }, data: { clientProfileId: newProfile.id } });
    await tx.researchJob.updateMany({ where: { websiteId: website.id }, data: { clientProfileId: newProfile.id } });
    await tx.contentRecommendation.updateMany({ where: { websiteId: website.id }, data: { clientProfileId: newProfile.id } });
    // CompetitorEntity has no websiteId column -- there is no principled way to split
    // it by website when a profile has more than one, so it deliberately stays with
    // the original profile (flagged in the plan doc as a non-blocking gap).
    // ContentPiece.clientProfileId is never rewritten -- past content keeps its real
    // original attribution, per explicit instruction not to rewrite history.

    return newProfile;
  });

  return NextResponse.json({ clientProfileId: result.id }, { status: 200 });
}
