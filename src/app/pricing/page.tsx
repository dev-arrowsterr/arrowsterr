import type { Metadata } from "next";
import { PricingPage } from "@/components/PricingPage";

export const metadata: Metadata = {
  title: "Pricing · Arrowsterr",
  description: "Track how ChatGPT, Claude, Gemini, Perplexity and Google AI name your brand. Plans from $29 a month. 14-day free trial, no card.",
};

export default function Pricing() {
  return <PricingPage />;
}
