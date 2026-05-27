"use client";

import { useArrivalDetection } from "@/hooks/useArrivalDetection";
import { ArrivalReportModal } from "./ArrivalReportModal";

// Always-mounted client component that wires the arrival-detection
// hook to the report-empty-courts modal. Mounted in the root layout so
// background polling runs on every authenticated page, exactly like
// the deleted <ArrivalDetector /> used to.
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
