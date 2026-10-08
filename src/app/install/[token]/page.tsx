import { headers } from "next/headers";
import { InstallGuide, snippetFor } from "@/components/InstallGuide";
import { Logo } from "@/components/Logo";
import { adminClient } from "@/lib/serverAuth";

// A private page a user sends to their web person. No login: the long random link is the key.
export default async function InstallPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = adminClient();
  const { data } =
    sb && /^[a-f0-9]{24}$/.test(token)
      ? await sb.from("brands").select("name, domain, umami_website_id, site_platform").eq("install_token", token).maybeSingle()
      : { data: null };
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;

  return (
    <main className="flex min-h-screen justify-center px-4 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <Logo size="md" />
        <section className="aw-frame">
          <div className="aw-frame__body flex flex-col gap-6">
            {data?.umami_website_id ? (
              <>
                <h1 className="aw-h3">Add website tracking to {data.domain}</h1>
                <p className="text-[15px] text-body">
                  {data.name} uses Arrowsterr to see how many visitors come from ChatGPT and other AI assistants. They asked you to add one line of code to
                  the site. It takes about 2 minutes.
                </p>
                <InstallGuide snippet={snippetFor(origin, data.umami_website_id, data.domain)} platform={data.site_platform ?? "other"} />
                <p className="aw-small">When you&apos;re done, open {data.domain} once in your browser. The team will see it turn live in Arrowsterr.</p>
              </>
            ) : (
              <>
                <h1 className="aw-h3">This link isn&apos;t valid</h1>
                <p className="text-[15px] text-body">Ask the person who sent it to copy a fresh link from Arrowsterr.</p>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
