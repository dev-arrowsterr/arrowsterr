import { Logo } from "@/components/Logo";

export default function Home() {
  return (
    <main className="aw-dotgrid flex flex-1 items-center justify-center px-4 py-12">
      <div className="aw-frame aw-frame--shadow w-full max-w-md">
        <div className="aw-frame__head">
          <Logo size="md" />
        </div>
        <div className="aw-frame__body flex flex-col items-start gap-6">
          <span className="aw-status aw-status--pending">Step 2 works</span>
          <h1 className="aw-display">
            Your AI <span className="aw-accent">visibility</span> score
          </h1>
        </div>
      </div>
    </main>
  );
}
