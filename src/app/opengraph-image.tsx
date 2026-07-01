import { ImageResponse } from "next/og";

export const alt = "[affinity.] — Medicaid or Marketplace? Find your coverage in 30 seconds.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Generated share image (link previews in Messages, Slack, social). Brand on the warm palette. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#faf6f0",
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 70, fontWeight: 800, letterSpacing: "-0.02em", color: "#2a2620" }}>
          <span style={{ color: "#8f8aa3", fontWeight: 500, marginRight: 10 }}>[</span>
          <span>affinity</span>
          <span style={{ color: "#2d9c4a" }}>.</span>
          <span style={{ color: "#8f8aa3", fontWeight: 500, marginLeft: 10 }}>]</span>
        </div>
        <div style={{ display: "flex", fontSize: 54, fontWeight: 700, color: "#2a2620", marginTop: 30, lineHeight: 1.15, maxWidth: 940 }}>
          Medicaid or Marketplace? Find your coverage in 30 seconds.
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#6f665a", marginTop: 28, maxWidth: 940 }}>
          Free, private, neutral — and it checks which plans actually keep your doctors and meds.
        </div>
      </div>
    ),
    { ...size },
  );
}
