// Zippie's built-in skills: instructions he loads for one kind of task. Workspaces can turn each one
// off and add their own in the Skills panel.

export type Skill = { key: string; name: string; description: string; instructions: string; builtin: boolean; enabled: boolean };

export const BUILTIN_SKILLS: Omit<Skill, "builtin" | "enabled">[] = [
  {
    key: "ai-visibility-review",
    name: "AI visibility review",
    description: "A clear read of how AI talks about the brand, and the 3 moves that matter most.",
    instructions: `1. Call get_ai_visibility for the last 30 days, then get_visibility_trend.
2. Call get_competitors and get_cited_sources.
3. Report: visibility share, average position, sentiment, and the change versus the period before. Name the AI where the brand is weakest.
4. Name the 2 or 3 competitors that AI names most, and the sources it cites most that never mention the brand.
5. End with 3 moves, most impact first. Each move says what to do, where, and why it should move the numbers.`,
  },
  {
    key: "meta-writer",
    name: "Meta titles and descriptions",
    description: "SEO titles and meta descriptions that earn the click, prepared for your CMS.",
    instructions: `- Titles: 50 to 60 characters, the main keyword near the start, the brand at the end after a separator when it fits.
- Descriptions: 140 to 155 characters, a clear promise and one concrete detail (a number, a feature, a result). No clickbait, no ALL CAPS.
- Match what the page is about. Never promise what the page doesn't deliver.
- To change real pages, use get_site_content, then propose_changes with play "meta". Tell the person the changes wait for their approval.`,
  },
  {
    key: "faq-builder",
    name: "FAQ sections",
    description: "FAQ sections built from the questions buyers ask AI, with FAQ structured data.",
    instructions: `- Start from real questions: get_prompts and get_prompt_answers show what people ask AI about this market.
- 4 to 6 questions per page. Each answer is 2 to 4 sentences, answers the question in the first sentence, and stays true to the page.
- Write the way a helpful expert talks. No sales fluff.
- To add them to real pages, use propose_changes with play "faq". It also adds FAQ structured data when the CMS allows it.`,
  },
  {
    key: "competitor-teardown",
    name: "Competitor teardown",
    description: "Why AI picks a competitor over you, and how to close the gap.",
    instructions: `1. Ask which competitor if the person didn't say. Use get_competitors to see who leads.
2. Use get_prompt_answers to find prompts where the competitor is named and the brand is not. Quote short parts of the answers.
3. Use get_cited_sources to see which pages AI leans on for those answers.
4. Explain the pattern in plain words: what the competitor has (pages, reviews, comparisons, lists) that the brand lacks.
5. End with a short plan: the pages to write or fix, and the sources to get mentioned in.`,
  },
  {
    key: "llms-txt",
    name: "llms.txt writer",
    description: "Writes an llms.txt file that tells AI tools what your site is and where the best pages are.",
    instructions: `- Follow the llms.txt format: an H1 with the site name, a one-paragraph summary in a blockquote, then H2 sections with lists of links in the form "- [Title](url): one line on what it covers".
- Use get_site_content (or the site audit) to find the most useful pages: product, pricing, docs, comparisons, top guides.
- Keep it under 60 links. Plain, factual words.
- Give the file in a code block and say where it goes: the root of the site, at /llms.txt.`,
  },
  {
    key: "community-replies",
    name: "Community replies",
    description: "Drafts helpful Reddit and forum replies that AI tools learn from. You post them yourself.",
    instructions: `- Lead with real help that answers the question even without the brand.
- Mention the brand only where it truly fits, and say plainly that the writer works there.
- Match the community's tone. Short paragraphs. No links unless they help.
- Never post anything yourself. Give drafts the person can edit and post.`,
  },
  {
    key: "brand-voice",
    name: "Brand voice",
    description: "Writes in your brand's voice, using the guides and examples in Knowledge.",
    instructions: `- Read the Knowledge items first, mainly brand guides, tone notes and sample posts. Use read_knowledge for long ones.
- Copy the voice: sentence length, words they use and avoid, how formal they are, how they use humor.
- If Knowledge has no voice guide, ask for one or for 2 or 3 posts they like.`,
  },
];
