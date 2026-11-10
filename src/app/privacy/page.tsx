import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy and data flow",
  description: "What [affinity.] processes when you check coverage and where those requests go.",
};

export default function PrivacyPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Privacy and data flow</h1>
        <p className="page-subtitle">What happens to the information you enter into [affinity.].</p>
      </div>
      <div className="prose">
        <h2>Your answers</h2>
        <p>
          We do not ask you to create an account or save a household profile. Your browser sends the ZIP code,
          age, household size, income, and any selected doctors or medications to our server when you request a
          coverage estimate or plan comparison. We process those values to return an answer; our application does
          not write the submitted household answers to its database or deliberately log request bodies.
        </p>
        <h2>guru conversation</h2>
        <p>
          Guided mode organizes your next step in the browser. If you explicitly select connected AI,
          your recent conversation, confirmed workspace fields and applicable tool evidence are sent
          through our server to OpenAI for conversational guidance, explanations and proposed edits/checks. You review suggestions before applying them. The model does
          not determine coverage or enroll you. Connected AI may be unavailable when its allowance or
          service is unavailable; the structured tools remain usable.
        </p>
        <p>
          We do not save guru transcripts or household fields in our database or application logs. The
          AI request asks the provider not to store a response for conversation reuse; this is not a claim
          of zero retention by the provider. Provider handling is governed by its own policies. A small
          spending record stores only a request ID, reserved amount and time. Shared fields and selected
          doctors or medications remain in browser memory across site navigation until cleared, refreshed
          or closed. No conversation is placed in a URL or browser persistent storage.
        </p>
        <h2>Official data services</h2>
        <p>
          To calculate Marketplace estimates and check plans, our server sends the relevant request information
          to the HealthCare.gov Marketplace API. Doctor searches go to that API. Medication searches go to the
          National Library of Medicine&apos;s RxTerms service, which receives the search term. These services have
          their own request handling and retention practices. We do not control their logs.
        </p>
        <h2>Site infrastructure</h2>
        <p>
          Our hosting and delivery providers process ordinary connection metadata, such as IP address, browser
          information, request path, and time, to serve and protect the site. We use POST requests for doctor
          and medication searches so the terms are not placed in the URL of requests to [affinity.]. We do not
          load Google Analytics or advertising trackers in the current site.
        </p>
        <p>
          The live screening, plan comparison, and provider search flows do not save their Marketplace
          responses in our on-disk source cache. Separate source-loading tools may retain public issuer
          records; they are not a saved household profile. Results and form entries can remain in your
          browser until you refresh or close the page.
        </p>
        <h2>Before you rely on a result</h2>
        <p>
          Do not enter a patient record or anyone else&apos;s information without their permission. This public
          service is not a UH system. It does not submit enrollment or make an eligibility determination.
          Confirm plan, provider, and drug details with the official Marketplace, insurer, or provider before
          acting. For questions about this page, email chris@pwr-labs.ai.
        </p>
      </div>
    </div>
  );
}
