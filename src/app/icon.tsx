import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          borderRadius: 8,
          fontSize: 18,
          fontWeight: 900,
          color: "#fbbf24",
          fontFamily: "Arial, sans-serif",
        }}
      >
        $OPC
      </div>
    ),
    { ...size }
  );
}
