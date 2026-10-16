# Pricing v5

Built October 2026. Replaces the prices in `docs/pricing-v4.md`; its unit costs, competitor prices and Free plan still hold.

## The plans

| | Free forever | Starter | Pro | Agency | Enterprise |
|---|---|---|---|---|---|
| Monthly | $0 | **$39** | **$179** | **$499** | from $1,500 |
| Billed yearly (15% off) | $0 | $33 | $152 | $424 | custom |
| Toolsets | Both, light | **Pick one**, switch once a month | Both | Both | Both |
| AI Visibility | 10 prompts weekly, ChatGPT + AI Overviews | 50 prompts daily, 6 AIs, social listening (1 brand) | 150 daily | 400 daily | 1,000+ |
| Organic Research | 200 tasks | 3,000 tasks, Content Plan | 8,000 tasks | 20,000 tasks | 150,000 |
| Brands | 1 | 3 | 10 | Unlimited | Unlimited |
| Seats | 1 | 2 | 5 | 15 | Unlimited |
| Agentic Writer | – | – | Yes | Yes | Yes |

The trial (7 days, both toolsets, no card) still drops to Free.

## Margins (cost a month per customer, typical use)

| Plan | Price | Typical cost | Margin |
|---|---|---|---|
| Starter, AI Visibility | $39 | ~$17 | ~56% |
| Starter, Organic Research | $39 | ~$8 | ~80% |
| Pro | $179 | ~$71 | ~61% |
| Agency | $499 | ~$204 | ~60% |

## Running cost a month

Mix: 50% Starter, 40% Pro, 10% Agency.

| | Beta (50 paying, 500 free) | Growth (500 paying, 5,000 free) |
|---|---|---|
| Paying teams, typical use | ~$2,765 | ~$27,650 |
| Free users | ~$225 | ~$2,250 |
| Servers: Render web, Fly worker, Supabase Pro (check) | ~$45 | ~$150 |
| **Total cost** | **~$3,035** | **~$30,050** |
| Revenue (monthly billing) | ~$7,050 | ~$70,500 |
| **Gross margin** | **~57%** | **~57%** |

## Moving to it
- New Stripe keys `arrowsterr_v5_*`. Anyone on `v3` or `v4` keeps their price.
- After deploy, run `npm run stripe:setup` once to make the v5 prices.
