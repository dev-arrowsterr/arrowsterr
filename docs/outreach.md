# Outreach

Get mentioned on the websites, press, podcasts and channels your audience uses and AI cites. UI plan: the "Arrowsterr Outreach UI" design canvas.

## Build order
1. **Sort and filter on Industry Research.** Done.
2. **Lists, Add to list and contact finding.** Done (this step).
3. Connect Gmail (`gmail.send`), drafting by purpose with review.
4. The random sender: 18 to 30 emails a day per account, 4 to 25 minutes apart inside work hours, warm-up for new accounts, one email per domain per day, follow-ups that stop on reply.
5. Inbox for outreach threads only (`gmail.readonly`, needs Google's CASA review), reply tags by Haiku.
6. Zippie insights on campaigns.

## Step 2: what's in it
- **Outreach › Lists** (`/outreach/lists`): make, rename and delete lists. Each list shows its targets with type, contact email and where it came from, status and date added. Filter by type, select rows to find emails again or remove them.
- **Add to list:** select rows on Industry Research (websites, press, social accounts, YouTube, podcasts; subreddits aren't emailed) or click Add to list on a site in Sources. Pick a list or name a new one.
- **Finding emails** (`contact` job, `src/lib/contactFinder.ts`):
  - Websites and press: the homepage, then its contact, about, "write for us", advertise and press pages (up to 6). Mailto links, Cloudflare-protected emails and plain text. Only the site's own domain counts, except on a contact page. Pitch inboxes (editor, partnerships, press) beat general ones (hello, info), and support and sales come last.
  - Podcasts: Apple's free podcast search finds the show's RSS feed, which lists the owner's email.
  - YouTube and social accounts: added by hand.
  - Every address must have a working mail server (MX record). Nothing is guessed. An email someone typed is never overwritten.
- **Do not contact:** targets on a blocked domain or address are marked Do not contact when added.

## Database
`supabase/040_outreach.sql`: `outreach_lists`, `outreach_targets`, `outreach_suppression`. Members read; the server writes through `/api/outreach` after checking the editor role.

## Running cost a month (step 2)

| | Beta (50 teams) | Growth (500 teams) |
|---|---|---|
| Email lookups (page reads and Apple search, no paid API) | $0 | $0 |
| Server time (current worker) | $0 | $0 |
| **Total** | **$0** | **$0** |

The full outreach plan (drafting, sending, inbox) adds about $200 to $300 a month at Beta and $1,570 to $1,670 at Growth, mostly Claude drafts and Google's yearly CASA review (check).
