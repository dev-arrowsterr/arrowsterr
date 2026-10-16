# Outreach

Get mentioned on the websites, press, podcasts and channels your audience uses and AI cites. UI plan: the "Arrowsterr Outreach UI" design canvas.

## Build order
1. **Sort and filter on the audience research.** Done.
2. **Lists, Add to list and contact finding.** Done.
2b. **Craft emails** with Open in Gmail. Done.
3. Connect Gmail (`gmail.send`), drafting by purpose with review.
4. The random sender: 18 to 30 emails a day per account, 4 to 25 minutes apart inside work hours, warm-up for new accounts, one email per domain per day, follow-ups that stop on reply.
5. Inbox for outreach threads only (`gmail.readonly`, needs Google's CASA review), reply tags by Haiku.
6. Zippie insights on campaigns.

## Step 2: what's in it
- **Outreach** (Agentic Content › Outreach, `/outreach`): lists on the left; on the right, the open list's Emails tab (first when it has drafts) and Targets tab. Make, rename and delete lists. Each list shows its targets with type, contact email and where it came from, status and date added. Filter by type, select rows to find emails again or remove them.
- **Add to Outreach List:** in Sources by link (each cited page, in its row and in its side panel), and in Competitive Analysis › Audience (websites, YouTube, podcasts, press, social accounts; subreddits aren't emailed). Pick a list or name a new one. Sources by site keeps only Analyze SEO.
- **Finding emails** (`contact` job, `src/lib/contactFinder.ts`):
  - Websites and press: the homepage, then its contact, about, "write for us", advertise and press pages (up to 6). Mailto links, Cloudflare-protected emails and plain text. Only the site's own domain counts, except on a contact page. Pitch inboxes (editor, partnerships, press) beat general ones (hello, info), and support and sales come last.
  - Podcasts: Apple's free podcast search finds the show's RSS feed, which lists the owner's email.
  - YouTube and social accounts: added by hand.
  - Every address must have a working mail server (MX record). Nothing is guessed. An email someone typed is never overwritten.
- **Do not contact:** targets on a blocked domain or address are marked Do not contact when added.

## Step 2b: Craft emails
- **Add to Outreach List from Sources by link:** each cited page (not your own) has the button, in its row and in its side panel. The page itself becomes the target, so the writer can quote it and the email search starts from it.
- **Write emails** (Lists, on the selected targets or every target without a draft): pick what the email is for, add an optional note, and Zippie writes one draft per target (`draft` job, `src/lib/drafts.ts`). Purposes by type: website (listicle, link, guest post, review), press (story, expert quote, link), podcast (guest, sponsorship), YouTube (guest, review, sponsorship), social (review, sponsorship, collaboration), or your own ask.
- Before writing, it reads the target: the page for websites and press, the latest 3 episodes from the RSS feed for podcasts. The email opens with one true detail from that reading and uses only facts from it and the brand profile. "Why it's written this way" says which detail it used.
- **Emails tab:** drafts on the left, the editor on the right. Save changes, Rewrite, Copy, Open in Gmail (a prefilled compose window), and Mark as sent. Real sending from Arrowsterr comes with step 3.
- Each draft costs 3 tasks, taken when it's written and handed back if it fails.

## Database
`supabase/040_outreach.sql`: `outreach_lists`, `outreach_targets`, `outreach_suppression`. `supabase/041_outreach_drafts.sql`: the draft columns on `outreach_targets`. Members read; the server writes through `/api/outreach` after checking the editor role.

## Running cost a month (steps 2 and 2b)

| | Beta (50 teams) | Growth (500 teams) |
|---|---|---|
| Email lookups (page reads and Apple search, no paid API) | $0 | $0 |
| Server time (current worker) | $0 | $0 |
| Drafts (Sonnet, ~$0.01 each, 300 a team a month) | ~$150 | ~$1,500 |
| **Total** | **~$150** | **~$1,500** |

The full outreach plan (drafting, sending, inbox) adds about $200 to $300 a month at Beta and $1,570 to $1,670 at Growth, mostly Claude drafts and Google's yearly CASA review (check).
