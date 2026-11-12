# Launch kit

## 1. App name

"ClassKit" is only a working name: Apple already ships an education framework called ClassKit. Pick one of:

| Name | Why |
|---|---|
| **StudioPass** (recommended) | Names the buyer (studios) and the thing (passes/packs). Easy to say, clean as a one-glyph icon. |
| ClassPack | The literal search term studios type ("class pack"). Wins marketplace search, less brandable. |
| SeatPass | Short; hints at seats + waitlist. |

Avoid anything with "ClassPass" or "Punchpass" in it (existing products in this exact space).

## 2. Logo

- `brand/icon.svg` (source) and `brand/icon-512.png` (upload this): 512×512, about 185 KB, transparent corners, which fits
  HighLevel's limits (400–800 px, under 500 KB).
- **C (in use)**: a class calendar shaped like a ticket, violet tile with a coral header (`brand/icon-c-512.png`). **A (alternative)**: a stack of class passes with credit dots and a coral check (`brand/icon-a-512.png`). Neither depends on the name.

## 3. Category

Primary **Scheduling / Calendars**. Secondary **Payments** (or **Memberships** if listed).

## 4. Tagline (≤ 60 chars)

1. **Class packs, credits and waitlists for studios.** (recommended)
2. Sell class packs. We count the credits.
3. Turn your HighLevel calendar into studio software.

## 5. Description

**Short description (listing card, ~160 chars):**
Sell class packs and memberships, take a credit with every booking, run waitlists and kiosk check-in, all on your HighLevel calendars.

**Long description:**

> Running a fitness, yoga, Pilates or wellness studio on HighLevel? StudioPass adds the part that's
> missing: class packs and credits.
>
> **Sell packs and memberships.** 10-class packs, unlimited monthly, drop-ins. Link them to your
> HighLevel products and every paid checkout, payment link or invoice adds credits automatically.
>
> **Credits that count themselves.** Each booking on your class calendars takes a credit. No credits?
> The booking is cancelled and the member gets a text with your buy link. Cancel early and the credit
> comes back; cancel late and it's kept, following your rule.
>
> **Full classes fill themselves.** Members join the waitlist from your public schedule. When a seat
> opens, the next person with credits is booked and texted automatically.
>
> **Front-desk check-in.** Put the kiosk on a tablet; members check in with their phone number.
> No-shows are marked automatically after class.
>
> **Built for HighLevel.** Credit balance on every contact (custom field + tags), 8 workflow triggers
> (credits low, pack expiring, no-show, checked in…) and actions to add or remove credits from any workflow.
>
> **Know your numbers.** Revenue from packs, fill rate, no-show rate, unused-credit liability and
> members at risk of churning.

## 6. Business niche

Boutique fitness, yoga, Pilates, martial arts, dance, swim schools, med spas and wellness clinics that
sell sessions in packs, and the agencies that run HighLevel for them. Today they pay $129–$400+/mo for
Mindbody, Glofox or Momence on top of HighLevel, just to track credits.

## 7. Keywords

class packs, class credits, studio booking, waitlist, check-in kiosk, punch card, GoHighLevel class
booking, gym membership credits, yoga studio software, Mindbody alternative

## 8. Pricing — recommendation

**A monthly subscription per sub-account, tiered by active members, with a 14-day free trial.
No usage-based ("dynamic") charges at launch.**

| Plan | Price / sub-account / mo | Active members* |
|---|---|---|
| Starter | $29 | up to 100 |
| Studio | $59 | up to 500 |
| Pro | $99 | unlimited, multi-location reporting |

\*Members holding credits or an unlimited membership. They're already counted in the Reports tab, so the limit is easy to enforce.

Why subscription over usage-based:

- **It's what studios compare against.** Mindbody/Glofox/Momence are flat monthly fees. "$59 instead
  of $199" is an easy sell; "$0.05 per check-in" makes them do maths and fear a surprise bill.
- **Agencies resell it.** HighLevel lets agencies mark up marketplace apps. A fixed price is easy to
  bundle into their package; usage charges hit the wallet unpredictably and cause support tickets.
- **ClassKit has no per-use cost.** SMS is already billed to the sub-account by HighLevel, and the app
  doesn't call paid AI or third-party APIs. Usage pricing is meant for passing on real per-use costs,
  and there are none here.
- **Tiers still scale with value.** A 400-member studio gets more value and pays more, without metering.
- **Code already exists.** HelmDesk's `subscriptionService` (plan ids → tiers, INSTALL/PLAN_CHANGE
  webhooks, enrol gate) can be copied over as-is.

When usage-based would make sense: if you later add something with a real per-use cost (AI
"win-back" texts, a branded member mobile app, payment processing), sell it as a metered add-on on top
of the subscription. Don't make it the base price.
