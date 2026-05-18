"use client";

import { useArrivalDetection } from "@/lib/useArrivalDetection";
import { ArrivalReportModal } from "./ArrivalReportModal";

export default function ArrivalDetector() {
  const { prompt, dismiss } = useArrivalDetection();
  if (!prompt) return null;
  return (
    <ArrivalReportModal
      courtId={prompt.courtId}
      venueName={prompt.venueName}
      postId={prompt.postId}
      onClose={dismiss}
    />
  );
}
